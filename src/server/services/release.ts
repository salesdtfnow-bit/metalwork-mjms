import { and, asc, desc, eq, inArray, isNull, ne, notInArray } from "drizzle-orm";
import {
  cncProgramRevisions,
  customerRequirements,
  documentRevisions,
  finalReleaseItems,
  finalReleases,
  holds,
  inspections,
  jobLines,
  jobs,
  materialLots,
  materialTransactions,
  ncrs,
  operations,
  releaseChecklistTemplates,
  timeEntries,
  users,
} from "../db/schema";
import { audit } from "../audit";
import { mutate, requirePermission, requireAnyPermission, type Ctx } from "../context";
import { forbidden, invalid, notFound } from "../errors";
import { d } from "@/lib/decimal";
import { storeFile } from "../storage";
import { signApproval } from "./approvals";
import { getSettings } from "./settings";
import { notify } from "./notifications";

type SysCheck = { key: string; label: string; ok: boolean; detail: string };

/** Automatic evidence checks for final release of a job line. */
export async function systemReleaseChecks(ctx: Ctx, jobLineId: string): Promise<SysCheck[]> {
  const [line] = await ctx.db.select().from(jobLines).where(eq(jobLines.id, jobLineId)).limit(1);
  if (!line) throw notFound("Job line");
  const ops = await ctx.db.select().from(operations).where(and(eq(operations.jobLineId, jobLineId), ne(operations.status, "cancelled")));
  const insp = await ctx.db.select().from(inspections).where(eq(inspections.jobLineId, jobLineId));
  const checks: SysCheck[] = [];
  const openOps = ops.filter((o) => o.status !== "complete");
  checks.push({ key: "operations", label: "All operations complete and signed off", ok: ops.length > 0 && openOps.length === 0, detail: openOps.length ? `Open: ${openOps.map((o) => `${o.opNumber} (${o.status})`).join(", ")}` : `${ops.length} operation(s) complete` });
  const fo = ops.filter((o) => o.requiresFirstOff && o.firstOffStatus !== "approved");
  checks.push({ key: "first_off", label: "Required first-off inspections approved", ok: fo.length === 0, detail: fo.length ? `Not approved: ${fo.map((o) => o.opNumber).join(", ")}` : "All approved or not required" });
  const openInsp = insp.filter((i) => !["passed", "cancelled", "failed"].includes(i.status));
  const failedOpen = insp.filter((i) => i.status === "failed");
  checks.push({ key: "inspections", label: "No open inspections", ok: openInsp.length === 0, detail: openInsp.length ? `Open: ${openInsp.map((i) => i.ref).join(", ")}` : "None open" });
  const finals = insp.filter((i) => i.stage === "final" && i.status === "passed");
  const accepted = d(line.qtyAccepted);
  const releasable = accepted.minus(d(line.qtyReleased));
  checks.push({ key: "final_inspection", label: "Final inspection passed with accepted quantity", ok: finals.length > 0 && releasable.greaterThan(0), detail: finals.length ? `${accepted} accepted, ${releasable} not yet released` : "No passed final inspection" });
  const openN = await ctx.db.select().from(ncrs).where(and(eq(ncrs.jobLineId, jobLineId), notInArray(ncrs.status, ["closed", "cancelled"])));
  checks.push({ key: "ncr", label: "No open non-conformances on this line", ok: openN.length === 0, detail: openN.length ? `Open: ${openN.map((n) => n.ref).join(", ")}${failedOpen.length ? "" : ""}` : "None" });
  const hl = await ctx.db.select().from(holds).where(and(eq(holds.jobId, line.jobId), isNull(holds.releasedAt)));
  checks.push({ key: "holds", label: "No active holds", ok: hl.length === 0, detail: hl.length ? hl.map((h) => h.reason).join("; ") : "None" });
  // Material traceability: every lot issued to the job was released and has verified certification.
  const issued = await ctx.db.select({ lot: materialLots }).from(materialTransactions).innerJoin(materialLots, eq(materialLots.id, materialTransactions.lotId)).where(and(eq(materialTransactions.jobId, line.jobId), eq(materialTransactions.kind, "issue")));
  const badLots = issued.filter((x) => !["verified", "not_required"].includes(x.lot.certificateStatus) || !x.lot.releasedAt);
  const anyMaterialOps = ops.some((o) => o.requiresMaterial);
  checks.push({
    key: "material",
    label: "Material traceable to released, certified lots",
    ok: (!anyMaterialOps || issued.length > 0) && badLots.length === 0,
    detail: anyMaterialOps && !issued.length ? "No material issue recorded" : badLots.length ? `Uncertified/unreleased: ${[...new Set(badLots.map((b) => b.lot.lotNo))].join(", ")}` : `${new Set(issued.map((i) => i.lot.lotNo)).size} lot(s) traceable`,
  });
  // Programs used: every production time entry used a released revision.
  const entries = ops.length ? await ctx.db.select({ t: timeEntries, rev: cncProgramRevisions }).from(timeEntries).leftJoin(cncProgramRevisions, eq(cncProgramRevisions.id, timeEntries.programRevisionId)).where(inArray(timeEntries.operationId, ops.map((o) => o.id))) : [];
  const badProg = entries.filter((e) => e.t.programRevisionId && e.rev && !["released", "superseded"].includes(e.rev.status));
  checks.push({ key: "programs", label: "Only approved program revisions used", ok: badProg.length === 0, detail: badProg.length ? `${badProg.length} run(s) with unapproved revisions` : "OK" });
  if (line.drawingRevisionId) {
    const [dr] = await ctx.db.select().from(documentRevisions).where(eq(documentRevisions.id, line.drawingRevisionId));
    checks.push({ key: "drawing", label: "Drawing revision current or change reviewed", ok: !line.drawingReviewRequired, detail: line.drawingReviewRequired ? `Drawing rev ${dr?.revision} superseded — review outstanding` : `Rev ${dr?.revision} (${dr?.status})` });
  }
  return checks;
}

/** Creates (or returns the open) release record with its checklist: system + template + customer items. */
export async function prepareRelease(ctx: Ctx, jobLineId: string) {
  requireAnyPermission(ctx, "quality.release", "quality.final_inspect");
  return mutate(ctx, async (tx) => {
    const [line] = await tx.db.select().from(jobLines).where(eq(jobLines.id, jobLineId)).limit(1);
    if (!line) throw notFound("Job line");
    const [open] = await tx.db.select().from(finalReleases).where(and(eq(finalReleases.jobLineId, jobLineId), eq(finalReleases.status, "draft"))).limit(1);
    if (open) return open;
    const [job] = await tx.db.select().from(jobs).where(eq(jobs.id, line.jobId));
    const [rel] = await tx.db.insert(finalReleases).values({ jobId: line.jobId, jobLineId, createdBy: ctx.actor.userId }).returning();
    const templates = await tx.db.select().from(releaseChecklistTemplates).where(eq(releaseChecklistTemplates.isActive, true)).orderBy(asc(releaseChecklistTemplates.sortOrder));
    const custReqs = await tx.db.select().from(customerRequirements).where(and(eq(customerRequirements.customerId, job.customerId), eq(customerRequirements.isActive, true)));
    const items = [
      ...templates.map((t) => ({ releaseId: rel.id, source: "template", key: `tpl:${t.id}`, label: t.label, required: t.required })),
      ...custReqs.map((r) => ({ releaseId: rel.id, source: "customer", key: `cust:${r.id}`, label: `Customer requirement (${r.kind.replace("_", " ")}): ${r.description}`, required: r.mandatory })),
    ];
    if (items.length) await tx.db.insert(finalReleaseItems).values(items);
    await audit(tx, { action: "release.prepare", entityType: "final_release", entityId: rel.id, entityRef: `${job.jobNumber} line ${line.lineNo}`, jobId: job.id });
    return rel;
  });
}

export async function checkReleaseItem(ctx: Ctx, itemId: string, status: "pass" | "fail" | "na", detail?: string | null) {
  requireAnyPermission(ctx, "quality.release", "quality.final_inspect");
  return mutate(ctx, async (tx) => {
    const [item] = await tx.db.select().from(finalReleaseItems).where(eq(finalReleaseItems.id, itemId)).limit(1);
    if (!item) throw notFound("Checklist item");
    const [rel] = await tx.db.select().from(finalReleases).where(eq(finalReleases.id, item.releaseId));
    if (rel.status !== "draft") throw invalid("This release has been decided.");
    if (status === "na" && item.required) throw invalid("A required item cannot be marked not applicable.");
    await tx.db.update(finalReleaseItems).set({ status, detail: detail ?? null, checkedBy: ctx.actor.userId, checkedAt: new Date() }).where(eq(finalReleaseItems.id, itemId));
    await audit(tx, { action: "release.item_check", entityType: "final_release", entityId: rel.id, jobId: rel.jobId, after: { item: item.label, status, detail } });
  });
}

/**
 * Final quality release (signed). Every system check must pass, every required checklist item
 * must be ticked, and the signer must not have worked on the parts (unless configured).
 */
export async function approveRelease(ctx: Ctx, releaseId: string, input: { qtyReleased: string; password: string; comments?: string | null }) {
  requirePermission(ctx, "quality.release");
  const settings = await getSettings(ctx.db);
  return mutate(ctx, async (tx) => {
    const [rel] = await tx.db.select().from(finalReleases).where(eq(finalReleases.id, releaseId)).limit(1);
    if (!rel) throw notFound("Release");
    if (rel.status !== "draft") throw invalid(`Release is ${rel.status}.`);
    const [line] = await tx.db.select().from(jobLines).where(eq(jobLines.id, rel.jobLineId));
    const [job] = await tx.db.select().from(jobs).where(eq(jobs.id, rel.jobId));
    if (!settings.allowSelfInspection && ctx.actor.employeeId) {
      const opIds = (await tx.db.select({ id: operations.id }).from(operations).where(eq(operations.jobLineId, line.id))).map((o) => o.id);
      const worked = opIds.length ? await tx.db.select({ id: timeEntries.id }).from(timeEntries).where(and(inArray(timeEntries.operationId, opIds), eq(timeEntries.employeeId, ctx.actor.employeeId))).limit(1) : [];
      if (worked.length) throw forbidden("You worked on these parts — final release must be approved by someone independent of production.");
    }
    const sys = await systemReleaseChecks(tx, line.id);
    const failing = sys.filter((c) => !c.ok);
    const items = await tx.db.select().from(finalReleaseItems).where(eq(finalReleaseItems.releaseId, releaseId));
    const unticked = items.filter((i) => i.required && i.status !== "pass");
    if (failing.length || unticked.length) {
      throw invalid(`Release blocked: ${[...failing.map((f) => `${f.label} — ${f.detail}`), ...unticked.map((u) => `Checklist: ${u.label}`)].join(" · ")}`);
    }
    const qty = d(input.qtyReleased);
    const releasable = d(line.qtyAccepted).minus(d(line.qtyReleased));
    if (!qty.greaterThan(0) || qty.greaterThan(releasable)) throw invalid(`Quantity to release must be between 1 and ${releasable} (accepted but not yet released).`, { field: "qtyReleased" });
    const approval = await signApproval(tx, {
      kind: "final_release",
      entityType: "final_release",
      entityId: rel.id,
      decision: "approved",
      meaning: `I have reviewed the complete history of ${job.jobNumber} line ${line.lineNo} (${line.partNumber}) and release ${qty} part(s) as conforming to the order, drawing and specification requirements.`,
      comment: input.comments,
      password: input.password,
    });
    await tx.db.update(finalReleases).set({ status: "approved", qtyReleased: qty.toString(), decidedBy: ctx.actor.userId, decidedAt: new Date(), approvalId: approval.id, comments: input.comments ?? null }).where(eq(finalReleases.id, releaseId));
    for (const c of sys) await tx.db.insert(finalReleaseItems).values({ releaseId, source: "system", key: c.key, label: c.label, required: true, status: c.ok ? "pass" : "fail", detail: c.detail, checkedBy: ctx.actor.userId, checkedAt: new Date() });
    await tx.db.update(jobLines).set({ qtyReleased: d(line.qtyReleased).plus(qty).toString() }).where(eq(jobLines.id, line.id));
    const { renderCocPdf } = await import("../pdf/documents");
    const pdf = await renderCocPdf(tx, releaseId);
    const file = await storeFile(tx.db, { bytes: pdf, name: `CoC-${job.jobNumber}-L${line.lineNo}-${releaseId.slice(0, 8)}.pdf`, mimeType: "application/pdf", uploadedBy: ctx.actor.userId });
    await tx.db.update(finalReleases).set({ cocFileId: file.id }).where(eq(finalReleases.id, releaseId));
    await audit(tx, { action: "release.approve", entityType: "final_release", entityId: releaseId, entityRef: `${job.jobNumber} line ${line.lineNo}`, jobId: job.id, approvalId: approval.id, after: { qtyReleased: qty.toString(), checks: sys, cocFileId: file.id } });
    // Job becomes ready for dispatch when every undispatched line has an approved release.
    const lines = await tx.db.select().from(jobLines).where(eq(jobLines.jobId, job.id));
    const approved = await tx.db.select().from(finalReleases).where(and(eq(finalReleases.jobId, job.id), eq(finalReleases.status, "approved")));
    const allReleased = lines.every((l) => d(l.qtyDispatched).greaterThanOrEqualTo(l.quantity) || approved.some((r) => r.jobLineId === l.id));
    if (allReleased && ["production_complete", "final_qc", "partially_completed", "awaiting_inspection"].includes(job.status)) {
      await tx.db.update(jobs).set({ status: "ready_for_dispatch" }).where(eq(jobs.id, job.id));
      await audit(tx, { action: "job.status_auto", entityType: "job", entityId: job.id, entityRef: job.jobNumber, jobId: job.id, before: { status: job.status }, after: { status: "ready_for_dispatch" }, reason: "Final quality release approved" });
    }
    await notify(tx, { type: "job.ready_for_dispatch", title: `${job.jobNumber} line ${line.lineNo}: ${qty} part(s) released for dispatch`, link: `/jobs/${job.id}?tab=dispatch`, permission: "dispatch.manage", dedupeKey: `rel:${releaseId}` });
    return { approval, fileId: file.id };
  });
}

export async function rejectRelease(ctx: Ctx, releaseId: string, input: { password: string; comments: string }) {
  requirePermission(ctx, "quality.release");
  if (!input.comments?.trim()) throw invalid("Explain why the release is rejected.", { field: "comments" });
  return mutate(ctx, async (tx) => {
    const [rel] = await tx.db.select().from(finalReleases).where(eq(finalReleases.id, releaseId)).limit(1);
    if (!rel || rel.status !== "draft") throw invalid("Release is not open.");
    const approval = await signApproval(tx, { kind: "final_release", entityType: "final_release", entityId: rel.id, decision: "rejected", meaning: "I reject this final release.", comment: input.comments, password: input.password });
    await tx.db.update(finalReleases).set({ status: "rejected", decidedBy: ctx.actor.userId, decidedAt: new Date(), approvalId: approval.id, comments: input.comments }).where(eq(finalReleases.id, releaseId));
    await audit(tx, { action: "release.reject", entityType: "final_release", entityId: releaseId, jobId: rel.jobId, approvalId: approval.id, reason: input.comments });
  });
}

export async function getRelease(ctx: Ctx, releaseId: string) {
  requireAnyPermission(ctx, "quality.view", "quality.release");
  const [rel] = await ctx.db.select().from(finalReleases).where(eq(finalReleases.id, releaseId)).limit(1);
  if (!rel) throw notFound("Release");
  const items = await ctx.db.select({ i: finalReleaseItems, by: users.name }).from(finalReleaseItems).leftJoin(users, eq(users.id, finalReleaseItems.checkedBy)).where(eq(finalReleaseItems.releaseId, releaseId)).orderBy(asc(finalReleaseItems.source));
  const system = rel.status === "draft" ? await systemReleaseChecks(ctx, rel.jobLineId) : [];
  const [line] = await ctx.db.select().from(jobLines).where(eq(jobLines.id, rel.jobLineId));
  const [job] = await ctx.db.select().from(jobs).where(eq(jobs.id, rel.jobId));
  const decidedBy = rel.decidedBy ? (await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, rel.decidedBy)))[0]?.name : null;
  return { release: rel, items, system, line, job, decidedBy };
}

export async function releasesForJob(ctx: Ctx, jobId: string) {
  return ctx.db.select({ r: finalReleases, by: users.name }).from(finalReleases).leftJoin(users, eq(users.id, finalReleases.decidedBy)).where(eq(finalReleases.jobId, jobId)).orderBy(desc(finalReleases.createdAt));
}

