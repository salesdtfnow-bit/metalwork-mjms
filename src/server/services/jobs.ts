import { and, asc, desc, eq, ilike, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  addresses,
  customerOrders,
  customers,
  finalReleases,
  holds,
  jobLines,
  jobs,
  materialAllocations,
  materialLots,
  ncrs,
  operations,
  parts,
  quotationRevisions,
  quotations,
  statusTransitions,
  users,
} from "../db/schema";
import { audit } from "../audit";
import { can, mutate, requirePermission, type Ctx } from "../context";
import { AppError, forbidden, GateError, invalid, notFound } from "../errors";
import { JOB_STATUS, type JobStatus } from "@/lib/status";
import { d } from "@/lib/decimal";
import { todayISO } from "@/lib/format";
import { notify } from "./notifications";

export const TERMINAL: JobStatus[] = ["completed", "cancelled"];
/** Statuses the system derives automatically from operation activity. */
export const PRODUCTION_PHASE: JobStatus[] = [
  "in_setup",
  "awaiting_first_off",
  "in_production",
  "partially_completed",
  "awaiting_inspection",
  "non_conformance",
  "rework_required",
  "subcontracted",
  "production_complete",
];
const AUTO_ELIGIBLE: JobStatus[] = [
  "order_confirmed",
  "awaiting_material",
  "material_received",
  "awaiting_material_release",
  "ready_for_planning",
  "planned",
  "awaiting_programming",
  "programming_in_progress",
  "awaiting_program_approval",
  "ready_for_production",
  ...PRODUCTION_PHASE,
];

export async function getJobRow(ctx: Ctx, jobId: string) {
  const [j] = await ctx.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!j) throw notFound("Job");
  return j;
}

/** Hard gates for specific target statuses. Enforced regardless of transition configuration. */
export async function jobGateFailures(ctx: Ctx, jobId: string, to: JobStatus): Promise<{ gate: string; message: string }[]> {
  const fails: { gate: string; message: string }[] = [];
  const lines = await ctx.db.select().from(jobLines).where(eq(jobLines.jobId, jobId));
  const ops = await ctx.db.select().from(operations).where(eq(operations.jobId, jobId));
  if (to === "ready_for_production") {
    for (const l of lines) if (l.routeStatus !== "released") fails.push({ gate: "route", message: `Route for line ${l.lineNo} (${l.partNumber}) is not released.` });
    if (ops.some((o) => o.requiresMaterial)) {
      const released = await ctx.db
        .select({ id: materialAllocations.id })
        .from(materialAllocations)
        .innerJoin(materialLots, eq(materialLots.id, materialAllocations.lotId))
        .where(and(eq(materialAllocations.jobId, jobId), ne(materialAllocations.status, "cancelled"), eq(materialLots.status, "released")));
      if (!released.length) fails.push({ gate: "material", message: "No released material is allocated to this job." });
    }
    const progOps = ops.filter((o) => o.requiresProgram && o.status !== "cancelled");
    for (const o of progOps) if (!o.programRevisionId) fails.push({ gate: "program", message: `Operation ${o.opNumber} has no CNC program revision assigned.` });
    if (progOps.length) {
      const { cncProgramRevisions } = await import("../db/schema");
      const revs = await ctx.db.select().from(cncProgramRevisions).where(inArray(cncProgramRevisions.id, progOps.map((o) => o.programRevisionId).filter((x): x is string => !!x)));
      for (const o of progOps.filter((x) => x.programRevisionId)) {
        const r = revs.find((x) => x.id === o.programRevisionId);
        if (r?.status !== "released") fails.push({ gate: "program", message: `Program for operation ${o.opNumber} is ${r?.status ?? "missing"}, not released.` });
      }
    }
  }
  if (to === "production_complete") {
    const open = ops.filter((o) => !["complete", "cancelled"].includes(o.status));
    if (!ops.length) fails.push({ gate: "route", message: "The job has no operations." });
    if (open.length) fails.push({ gate: "operations", message: `${open.length} operation(s) are not complete (${open.map((o) => o.opNumber).join(", ")}).` });
  }
  if (to === "ready_for_dispatch") {
    const rels = await ctx.db.select().from(finalReleases).where(and(eq(finalReleases.jobId, jobId), eq(finalReleases.status, "approved")));
    for (const l of lines) {
      if (d(l.qtyDispatched).greaterThanOrEqualTo(l.quantity)) continue;
      if (!rels.some((r) => r.jobLineId === l.id)) fails.push({ gate: "final_release", message: `Line ${l.lineNo} (${l.partNumber}) has no approved final quality release.` });
    }
  }
  if (to === "completed") {
    const openNcrs = await ctx.db.select({ ref: ncrs.ref }).from(ncrs).where(and(eq(ncrs.jobId, jobId), notInArray(ncrs.status, ["closed", "cancelled"])));
    if (openNcrs.length) fails.push({ gate: "ncr", message: `Open non-conformance(s): ${openNcrs.map((n) => n.ref).join(", ")}.` });
    const activeHolds = await ctx.db.select({ id: holds.id }).from(holds).where(and(eq(holds.jobId, jobId), isNull(holds.releasedAt)));
    if (activeHolds.length) fails.push({ gate: "hold", message: "The job has active holds." });
  }
  return fails;
}

/**
 * Manual status change. Checks the configured transition (and its permission), then the
 * hard gates for the target status. Production-phase statuses are set by the system.
 */
export async function transitionJob(ctx: Ctx, jobId: string, to: JobStatus, reason?: string | null) {
  if (!(to in JOB_STATUS)) throw invalid("Unknown status.");
  if (PRODUCTION_PHASE.includes(to) || to === "dispatched") throw invalid(`"${JOB_STATUS[to].label}" is set automatically from production and dispatch records.`);
  if (to === "on_hold") return holdJob(ctx, jobId, reason ?? "");
  if (to === "cancelled") return cancelJob(ctx, jobId, reason ?? "");
  return mutate(ctx, async (tx) => {
    const j = await getJobRow(tx, jobId);
    if (TERMINAL.includes(j.status as JobStatus)) throw invalid(`Job is ${j.status}.`);
    if (j.status === "on_hold") throw invalid("Release the hold before changing status.");
    const rules = await tx.db
      .select()
      .from(statusTransitions)
      .where(and(eq(statusTransitions.entityType, "job"), eq(statusTransitions.toStatus, to), eq(statusTransitions.isActive, true), or(eq(statusTransitions.fromStatus, j.status), eq(statusTransitions.fromStatus, "*"))));
    // From a production-phase status, planners may move back to planning statuses (e.g. re-plan) only via configured rules.
    const rule = rules[0];
    if (!rule) throw invalid(`A job cannot move from "${JOB_STATUS[j.status as JobStatus]?.label ?? j.status}" to "${JOB_STATUS[to].label}".`);
    if (!can(ctx.actor, rule.permission as never)) throw new AppError(`Permission required: ${rule.permission}`, "forbidden", { permission: rule.permission, entityType: "job", entityId: jobId });
    if (rule.requiresReason && !reason?.trim()) throw invalid("A reason is required for this change.", { field: "reason" });
    const fails = await jobGateFailures(tx, jobId, to);
    if (fails.length) throw new GateError(fails);
    await tx.db.update(jobs).set({ status: to, completedAt: to === "completed" ? new Date() : j.completedAt }).where(eq(jobs.id, jobId));
    await audit(tx, { action: "job.status", entityType: "job", entityId: jobId, entityRef: j.jobNumber, jobId, before: { status: j.status }, after: { status: to }, reason });
    if (to === "ready_for_production") await notify(tx, { type: "job.ready", title: `${j.jobNumber} ready for production`, link: `/jobs/${jobId}`, permission: "planning.schedule", dedupeKey: `jobready:${jobId}` });
    if (to === "ready_for_dispatch") await notify(tx, { type: "job.ready_for_dispatch", title: `${j.jobNumber} ready for dispatch`, link: `/jobs/${jobId}`, permission: "dispatch.manage", dedupeKey: `jobrfd:${jobId}` });
  });
}

/** System: derive production-phase status from operation and NCR state. */
export async function refreshJobStatus(ctx: Ctx, jobId: string) {
  const j = await getJobRow(ctx, jobId);
  if (!AUTO_ELIGIBLE.includes(j.status as JobStatus)) return j.status;
  const ops = (await ctx.db.select().from(operations).where(eq(operations.jobId, jobId))).filter((o) => o.status !== "cancelled");
  if (!ops.length) return j.status;
  const has = (s: string) => ops.some((o) => o.status === s);
  const openNcr = await ctx.db.select().from(ncrs).where(and(eq(ncrs.jobId, jobId), notInArray(ncrs.status, ["closed", "cancelled"])));
  let next: JobStatus | null = null;
  if (has("awaiting_first_off")) next = "awaiting_first_off";
  else if (has("in_setup")) next = "in_setup";
  else if (has("in_production")) next = "in_production";
  else if (openNcr.some((n) => n.disposition === "rework" && ["disposition_approved", "in_rework"].includes(n.status))) next = "rework_required";
  else if (openNcr.length && ops.some((o) => o.status === "on_hold")) next = "non_conformance";
  else if (has("subcontracted")) next = "subcontracted";
  else if (has("awaiting_inspection")) next = "awaiting_inspection";
  else if (ops.every((o) => o.status === "complete")) next = "production_complete";
  else if (ops.some((o) => o.status === "complete" || d(o.qtyGood).greaterThan(0))) next = "partially_completed";
  if (next && next !== j.status) {
    await ctx.db.update(jobs).set({ status: next }).where(eq(jobs.id, jobId));
    await audit(ctx, { action: "job.status_auto", entityType: "job", entityId: jobId, entityRef: j.jobNumber, jobId, before: { status: j.status }, after: { status: next }, reason: "Derived from operation records" });
    if (next === "production_complete") {
      await notify(ctx, { type: "final_qc.awaiting", title: `${j.jobNumber} production complete — final QC required`, link: `/jobs/${jobId}?tab=quality`, permission: "quality.final_inspect", dedupeKey: `prodcomplete:${jobId}` });
    }
  }
  return next ?? j.status;
}

export async function holdJob(ctx: Ctx, jobId: string, reason: string, ncrId?: string | null) {
  requirePermission(ctx, "jobs.hold");
  if (!reason?.trim()) throw invalid("A reason is required to place a job on hold.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const j = await getJobRow(tx, jobId);
    if (TERMINAL.includes(j.status as JobStatus)) throw invalid(`Job is ${j.status}.`);
    await tx.db.insert(holds).values({ targetType: "job", jobId, ncrId: ncrId ?? null, reason, placedBy: ctx.actor.userId });
    if (j.status !== "on_hold") await tx.db.update(jobs).set({ status: "on_hold", statusBeforeHold: j.status, holdReason: reason }).where(eq(jobs.id, jobId));
    await audit(tx, { action: "job.hold", entityType: "job", entityId: jobId, entityRef: j.jobNumber, jobId, before: { status: j.status }, after: { status: "on_hold" }, reason });
  });
}

export async function releaseJobHold(ctx: Ctx, jobId: string, reason: string) {
  requirePermission(ctx, "jobs.hold");
  if (!reason?.trim()) throw invalid("Record why the hold can be released.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const j = await getJobRow(tx, jobId);
    const active = await tx.db.select().from(holds).where(and(eq(holds.jobId, jobId), eq(holds.targetType, "job"), isNull(holds.releasedAt)));
    if (!active.length) throw invalid("The job has no active hold.");
    // Quality holds raised from an NCR need the hold-release permission.
    if (active.some((h) => h.ncrId) && !can(ctx.actor, "holds.release")) throw forbidden("This hold was raised by a non-conformance; a quality manager must release it.");
    await tx.db.update(holds).set({ releasedBy: ctx.actor.userId, releasedAt: new Date(), releaseReason: reason }).where(inArray(holds.id, active.map((h) => h.id)));
    const back = (j.statusBeforeHold as JobStatus | null) ?? "order_confirmed";
    await tx.db.update(jobs).set({ status: back, statusBeforeHold: null, holdReason: null }).where(eq(jobs.id, jobId));
    await audit(tx, { action: "job.hold_release", entityType: "job", entityId: jobId, entityRef: j.jobNumber, jobId, before: { status: "on_hold" }, after: { status: back }, reason });
    await refreshJobStatus(tx, jobId);
  });
}

export async function cancelJob(ctx: Ctx, jobId: string, reason: string) {
  requirePermission(ctx, "jobs.cancel");
  if (!reason?.trim()) throw invalid("A reason is required to cancel a job.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const j = await getJobRow(tx, jobId);
    if (TERMINAL.includes(j.status as JobStatus)) throw invalid(`Job is already ${j.status}.`);
    const lines = await tx.db.select().from(jobLines).where(eq(jobLines.jobId, jobId));
    if (lines.some((l) => d(l.qtyDispatched).greaterThan(0))) throw invalid("Parts have already been dispatched on this job — close it as completed instead.");
    await tx.db.update(jobs).set({ status: "cancelled", cancelledAt: new Date(), cancelReason: reason }).where(eq(jobs.id, jobId));
    await tx.db.update(operations).set({ status: "cancelled" }).where(and(eq(operations.jobId, jobId), notInArray(operations.status, ["complete"])));
    await audit(tx, { action: "job.cancel", entityType: "job", entityId: jobId, entityRef: j.jobNumber, jobId, before: { status: j.status }, after: { status: "cancelled" }, reason });
  });
}

export async function authoriseJob(ctx: Ctx, jobId: string) {
  requirePermission(ctx, "jobs.authorise");
  return mutate(ctx, async (tx) => {
    const j = await getJobRow(tx, jobId);
    if (j.authorisedAt) throw invalid("Job is already authorised.");
    if (TERMINAL.includes(j.status as JobStatus)) throw invalid(`Job is ${j.status}.`);
    await tx.db.update(jobs).set({ authorisedBy: ctx.actor.userId, authorisedAt: new Date() }).where(eq(jobs.id, jobId));
    await audit(tx, { action: "job.authorise", entityType: "job", entityId: jobId, entityRef: j.jobNumber, jobId });
  });
}

export const jobUpdateInput = z.object({
  title: z.string().trim().min(2).optional(),
  priority: z.number().int().min(1).max(4).optional(),
  ownerId: z.string().uuid().nullish(),
  requiredDate: z.string().nullish(),
  promisedDate: z.string().nullish(),
  deliveryAddressId: z.string().uuid().nullish(),
  materialRequirements: z.string().nullish(),
  inspectionRequirements: z.string().nullish(),
  certificationRequirements: z.string().nullish(),
  packagingRequirements: z.string().nullish(),
  deliveryRequirements: z.string().nullish(),
  nextAction: z.string().nullish(),
  notes: z.string().nullish(),
});

export async function updateJob(ctx: Ctx, jobId: string, raw: z.input<typeof jobUpdateInput>, reason?: string | null) {
  requirePermission(ctx, "jobs.manage");
  const data = jobUpdateInput.parse(raw);
  return mutate(ctx, async (tx) => {
    const j = await getJobRow(tx, jobId);
    if (TERMINAL.includes(j.status as JobStatus)) throw invalid(`Job is ${j.status} and can no longer be edited.`);
    if (data.requiredDate !== undefined && data.requiredDate !== j.requiredDate && !reason?.trim()) throw invalid("Give a reason when changing the required date.", { field: "reason" });
    await tx.db.update(jobs).set(data).where(eq(jobs.id, jobId));
    const changed = Object.fromEntries(Object.entries(data).filter(([k, v]) => (j as Record<string, unknown>)[k] !== v));
    await audit(tx, { action: "job.update", entityType: "job", entityId: jobId, entityRef: j.jobNumber, jobId, before: Object.fromEntries(Object.keys(changed).map((k) => [k, (j as Record<string, unknown>)[k]])), after: changed, reason });
  });
}

export async function listJobs(ctx: Ctx, opts: { q?: string; status?: string; customerId?: string; ownerId?: string; scope?: "open" | "late" | "all" | "on_hold" } = {}) {
  if (!can(ctx.actor, "jobs.view") && !can(ctx.actor, "production.view_all")) throw forbidden();
  const q = opts.q?.trim();
  const scope = opts.scope ?? "open";
  return ctx.db
    .select({ job: jobs, customer: customers.name, customerCode: customers.code, owner: users.name })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .leftJoin(users, eq(users.id, jobs.ownerId))
    .where(
      and(
        opts.status ? eq(jobs.status, opts.status) : undefined,
        scope === "open" ? notInArray(jobs.status, TERMINAL) : undefined,
        scope === "on_hold" ? eq(jobs.status, "on_hold") : undefined,
        scope === "late" ? and(notInArray(jobs.status, [...TERMINAL, "dispatched"]), lt(jobs.requiredDate, todayISO())) : undefined,
        opts.customerId ? eq(jobs.customerId, opts.customerId) : undefined,
        opts.ownerId ? eq(jobs.ownerId, opts.ownerId) : undefined,
        q ? or(ilike(jobs.jobNumber, `%${q}%`), ilike(jobs.title, `%${q}%`), ilike(customers.name, `%${q}%`)) : undefined,
      ),
    )
    .orderBy(asc(jobs.priority), sql`${jobs.requiredDate} asc nulls last`, desc(jobs.createdAt))
    .limit(500)
    .then((rows) => rows.map((r) => ({ ...r, job: { ...r.job, nextAction: suggestedNextAction(r.job) } })));
}

export async function getJob(ctx: Ctx, jobId: string) {
  if (!can(ctx.actor, "jobs.view") && !can(ctx.actor, "production.view_all")) throw forbidden();
  const [row] = await ctx.db
    .select({ job: jobs, customer: customers, order: customerOrders, address: addresses, owner: users.name })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .leftJoin(customerOrders, eq(customerOrders.id, jobs.customerOrderId))
    .leftJoin(addresses, eq(addresses.id, jobs.deliveryAddressId))
    .leftJoin(users, eq(users.id, jobs.ownerId))
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!row) throw notFound("Job");
  const lines = await ctx.db.select({ line: jobLines, part: parts }).from(jobLines).innerJoin(parts, eq(parts.id, jobLines.partId)).where(eq(jobLines.jobId, jobId)).orderBy(asc(jobLines.lineNo));
  const quote = row.job.quotationRevisionId
    ? (
        await ctx.db
          .select({ rev: quotationRevisions, q: quotations })
          .from(quotationRevisions)
          .innerJoin(quotations, eq(quotations.id, quotationRevisions.quotationId))
          .where(eq(quotationRevisions.id, row.job.quotationRevisionId))
      )[0]
    : null;
  const activeHolds = await ctx.db.select().from(holds).where(and(eq(holds.jobId, jobId), isNull(holds.releasedAt)));
  const showCommercial = can(ctx.actor, "jobs.view_commercial");
  return {
    ...row,
    job: { ...row.job, nextAction: suggestedNextAction(row.job) },
    order: row.order && !showCommercial ? { ...row.order, orderValue: null } : row.order,
    lines: lines.map((l) => (showCommercial ? l : { ...l, line: { ...l.line, unitPrice: null } })),
    quote,
    holds: activeHolds,
    showCommercial,
  };
}

/** Allowed manual next statuses for the UI (configured transitions the actor holds permission for). */
export async function availableTransitions(ctx: Ctx, jobId: string) {
  const j = await getJobRow(ctx, jobId);
  const rules = await ctx.db
    .select()
    .from(statusTransitions)
    .where(and(eq(statusTransitions.entityType, "job"), eq(statusTransitions.isActive, true), or(eq(statusTransitions.fromStatus, j.status), eq(statusTransitions.fromStatus, "*"))));
  return rules.filter((r) => can(ctx.actor, r.permission as never) && !TERMINAL.includes(j.status as JobStatus) && r.toStatus !== j.status);
}

const LEGACY_DEFAULT_NEXT_ACTION = "Authorise job, plan route and order material";

/** Suggested next action from the job's state (used unless a planner has set one explicitly). */
export function suggestedNextAction(job: Pick<typeof jobs.$inferSelect, "status" | "authorisedAt" | "holdReason" | "nextAction">): string {
  if (job.nextAction && job.nextAction !== LEGACY_DEFAULT_NEXT_ACTION) return job.nextAction;
  const map: Partial<Record<JobStatus, string>> = {
    order_confirmed: job.authorisedAt ? "Plan the route and order material" : "Authorise the job",
    awaiting_material: "Receive material from the supplier",
    material_received: "Inspect and release received material",
    awaiting_material_release: "Inspect, verify certificates and release material",
    ready_for_planning: "Release the route and schedule operations",
    planned: "Prepare programs and material for production",
    awaiting_programming: "Write the CNC programs",
    programming_in_progress: "Complete the CNC programs",
    awaiting_program_approval: "Approve and release the CNC programs",
    ready_for_production: "Start setup on the first operation",
    in_setup: "Complete setup",
    awaiting_first_off: "First-off inspection",
    in_production: "Continue production",
    partially_completed: "Continue with the next operations",
    awaiting_inspection: "Complete the inspection",
    on_hold: `Resolve hold${job.holdReason ? `: ${job.holdReason}` : ""}`,
    non_conformance: "Disposition the non-conformance",
    rework_required: "Complete rework and reinspection",
    subcontracted: "Await return from subcontractor",
    production_complete: "Final inspection and quality release",
    final_qc: "Approve final quality release",
    ready_for_dispatch: "Prepare and confirm dispatch",
    dispatched: "Confirm delivery and close the job",
  };
  return map[job.status as JobStatus] ?? "";
}
