import { and, asc, desc, eq, ilike, inArray, notInArray, or } from "drizzle-orm";
import { z } from "zod";
import { cncProgramMachines, cncProgramRevisions, cncPrograms, files, jobs, machines, operations, operationTypes, parts, users, fileAccessLog } from "../db/schema";
import { audit } from "../audit";
import { can, mutate, requirePermission, type Ctx } from "../context";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { nextRef, REF } from "../refs";
import { storeUpload } from "../storage";
import { signApproval } from "./approvals";
import { getSettings } from "./settings";
import { notify } from "./notifications";

export const programInput = z.object({
  programNumber: z.string().trim().max(40).nullish(),
  name: z.string().trim().min(2, "Program name is required."),
  partId: z.string().uuid().nullish(),
  jobId: z.string().uuid().nullish(),
  operationTypeId: z.string().uuid().nullish(),
  opNumber: z.string().trim().nullish(),
  description: z.string().nullish(),
  machineIds: z.array(z.string().uuid()).min(1, "Select at least one compatible machine."),
});

export const programRevisionInput = z.object({
  revision: z.string().trim().min(1, "Revision is required.").max(20),
  changeDescription: z.string().trim().min(3, "Describe the change."),
  drawingRevisionId: z.string().uuid().nullish(),
  setupSheetRevisionId: z.string().uuid().nullish(),
});

export async function createProgram(ctx: Ctx, raw: z.input<typeof programInput>, rev: z.input<typeof programRevisionInput>, file: File) {
  requirePermission(ctx, "programs.create");
  const data = programInput.parse(raw);
  const r = programRevisionInput.parse(rev);
  if (!file || !file.size) throw invalid("Attach the program file.", { field: "file" });
  return mutate(ctx, async (tx) => {
    const programNumber = data.programNumber?.trim() || (await nextRef(tx.db, REF.program, { yearly: false, pad: 5 }));
    const [dup] = await tx.db.select({ id: cncPrograms.id }).from(cncPrograms).where(eq(cncPrograms.programNumber, programNumber)).limit(1);
    if (dup) throw conflict(`Program ${programNumber} already exists — add a revision to it.`, { field: "programNumber" });
    const [p] = await tx.db
      .insert(cncPrograms)
      .values({ programNumber, name: data.name, partId: data.partId ?? null, jobId: data.jobId ?? null, operationTypeId: data.operationTypeId ?? null, opNumber: data.opNumber ?? null, description: data.description ?? null, createdBy: ctx.actor.userId })
      .returning();
    await tx.db.insert(cncProgramMachines).values(data.machineIds.map((machineId) => ({ programId: p.id, machineId })));
    const f = await storeUpload(tx.db, file, ctx.actor.userId);
    const [pr] = await tx.db
      .insert(cncProgramRevisions)
      .values({ programId: p.id, revision: r.revision, fileId: f.id, checksum: f.sha256, changeDescription: r.changeDescription, programmerId: ctx.actor.userId, drawingRevisionId: r.drawingRevisionId ?? null, setupSheetRevisionId: r.setupSheetRevisionId ?? null })
      .returning();
    await audit(tx, { action: "program.create", entityType: "cnc_program", entityId: p.id, entityRef: programNumber, jobId: data.jobId, after: { ...data, revision: r.revision, sha256: f.sha256 } });
    return { program: p, revision: pr };
  });
}

/** New revision. The released revision stays in force until the new one is released. */
export async function addProgramRevision(ctx: Ctx, programId: string, rev: z.input<typeof programRevisionInput>, file: File) {
  requirePermission(ctx, "programs.create");
  const r = programRevisionInput.parse(rev);
  if (!file || !file.size) throw invalid("Attach the program file.", { field: "file" });
  return mutate(ctx, async (tx) => {
    const [p] = await tx.db.select().from(cncPrograms).where(eq(cncPrograms.id, programId)).limit(1);
    if (!p) throw notFound("Program");
    const [dup] = await tx.db.select({ id: cncProgramRevisions.id }).from(cncProgramRevisions).where(and(eq(cncProgramRevisions.programId, programId), eq(cncProgramRevisions.revision, r.revision))).limit(1);
    if (dup) throw conflict(`Revision ${r.revision} already exists. Released revisions are never overwritten.`, { field: "revision" });
    const f = await storeUpload(tx.db, file, ctx.actor.userId);
    const [pr] = await tx.db
      .insert(cncProgramRevisions)
      .values({
        programId,
        revision: r.revision,
        fileId: f.id,
        checksum: f.sha256,
        changeDescription: r.changeDescription,
        programmerId: ctx.actor.userId,
        drawingRevisionId: r.drawingRevisionId ?? null,
        setupSheetRevisionId: r.setupSheetRevisionId ?? null,
        previousRevisionId: p.currentReleasedRevisionId,
      })
      .returning();
    await audit(tx, { action: "program.revision_add", entityType: "cnc_program", entityId: programId, entityRef: `${p.programNumber} rev ${r.revision}`, jobId: p.jobId, after: { ...r, sha256: f.sha256 } });
    return pr;
  });
}

async function loadRev(ctx: Ctx, revisionId: string) {
  const [row] = await ctx.db
    .select({ rev: cncProgramRevisions, p: cncPrograms })
    .from(cncProgramRevisions)
    .innerJoin(cncPrograms, eq(cncPrograms.id, cncProgramRevisions.programId))
    .where(eq(cncProgramRevisions.id, revisionId))
    .limit(1);
  if (!row) throw notFound("Program revision");
  return row;
}

export async function submitProgramRevision(ctx: Ctx, revisionId: string) {
  requirePermission(ctx, "programs.create");
  return mutate(ctx, async (tx) => {
    const { rev, p } = await loadRev(tx, revisionId);
    if (rev.status !== "draft") throw invalid("Only draft revisions can be submitted.");
    await tx.db.update(cncProgramRevisions).set({ status: "submitted", submittedAt: new Date() }).where(eq(cncProgramRevisions.id, revisionId));
    await audit(tx, { action: "program.revision_submit", entityType: "cnc_program", entityId: p.id, entityRef: `${p.programNumber} rev ${rev.revision}`, jobId: p.jobId });
    await notify(tx, { type: "program.awaiting_approval", title: `CNC program ${p.programNumber} rev ${rev.revision} awaiting approval`, link: `/programs/${p.id}`, permission: "programs.approve", excludeActor: true, dedupeKey: `progrev:${rev.id}` });
  });
}

export async function recordProgramVerification(ctx: Ctx, revisionId: string, status: "not_required" | "simulated" | "proved_out" | "failed", notes: string | null) {
  if (!can(ctx.actor, "programs.create") && !can(ctx.actor, "programs.approve")) throw forbidden();
  return mutate(ctx, async (tx) => {
    const { rev, p } = await loadRev(tx, revisionId);
    if (["superseded", "obsolete", "rejected"].includes(rev.status)) throw invalid(`Revision is ${rev.status}.`);
    if (status === "failed" && !notes?.trim()) throw invalid("Describe the verification failure.", { field: "notes" });
    await tx.db.update(cncProgramRevisions).set({ verificationStatus: status, verificationNotes: notes }).where(eq(cncProgramRevisions.id, revisionId));
    await audit(tx, { action: "program.verification", entityType: "cnc_program", entityId: p.id, entityRef: `${p.programNumber} rev ${rev.revision}`, jobId: p.jobId, after: { status, notes } });
  });
}

/** Approval (signed). Approver must not be the programmer when independence is required. */
export async function approveProgramRevision(ctx: Ctx, revisionId: string, input: { password: string; comment?: string | null }) {
  requirePermission(ctx, "programs.approve");
  const settings = await getSettings(ctx.db);
  return mutate(ctx, async (tx) => {
    const { rev, p } = await loadRev(tx, revisionId);
    if (rev.status !== "submitted") throw invalid("Only submitted revisions can be approved.");
    if (settings.requireIndependentApproval && rev.programmerId === ctx.actor.userId) throw forbidden("Independent approval is required: you wrote this program revision.");
    if (!["simulated", "proved_out", "not_required"].includes(rev.verificationStatus)) {
      throw invalid(`Verification is "${rev.verificationStatus}". Record simulation/prove-out (or mark not required) before approval.`);
    }
    const approval = await signApproval(tx, {
      kind: "program.approve",
      entityType: "cnc_program_revision",
      entityId: rev.id,
      decision: "approved",
      meaning: `I have reviewed CNC program ${p.programNumber} revision ${rev.revision} (checksum ${rev.checksum?.slice(0, 12)}…) against the drawing and setup, and approve it.`,
      comment: input.comment,
      password: input.password,
    });
    await tx.db.update(cncProgramRevisions).set({ status: "approved", approvedBy: ctx.actor.userId, approvedAt: new Date(), approvalId: approval.id }).where(eq(cncProgramRevisions.id, revisionId));
    await audit(tx, { action: "program.revision_approve", entityType: "cnc_program", entityId: p.id, entityRef: `${p.programNumber} rev ${rev.revision}`, jobId: p.jobId, approvalId: approval.id });
  });
}

/**
 * Release (signed): the revision becomes the only one operators may use. The previous
 * released revision is superseded and kept; operations pinned to it are flagged for review.
 */
export async function releaseProgramRevision(ctx: Ctx, revisionId: string, input: { password: string; comment?: string | null }) {
  requirePermission(ctx, "programs.release");
  return mutate(ctx, async (tx) => {
    const { rev, p } = await loadRev(tx, revisionId);
    if (rev.status !== "approved") throw invalid("Only approved revisions can be released.");
    const approval = await signApproval(tx, {
      kind: "program.release",
      entityType: "cnc_program_revision",
      entityId: rev.id,
      decision: "approved",
      meaning: `I release CNC program ${p.programNumber} revision ${rev.revision} for production use. Previous revisions must not be used.`,
      comment: input.comment,
      password: input.password,
    });
    const now = new Date();
    const prev = p.currentReleasedRevisionId;
    await tx.db.update(cncProgramRevisions).set({ status: "released", releasedBy: ctx.actor.userId, releasedAt: now }).where(eq(cncProgramRevisions.id, revisionId));
    if (prev && prev !== revisionId) await tx.db.update(cncProgramRevisions).set({ status: "superseded", supersededAt: now }).where(eq(cncProgramRevisions.id, prev));
    await tx.db.update(cncPrograms).set({ currentReleasedRevisionId: revisionId }).where(eq(cncPrograms.id, p.id));
    let flagged = 0;
    if (prev) {
      const affected = await tx.db
        .select({ id: operations.id })
        .from(operations)
        .where(and(eq(operations.programRevisionId, prev), notInArray(operations.status, ["complete", "cancelled"])));
      if (affected.length) {
        await tx.db
          .update(operations)
          .set({ reviewRequired: true, reviewReason: `Program ${p.programNumber} revision superseded by ${rev.revision} — confirm which revision this operation must use.` })
          .where(inArray(operations.id, affected.map((a) => a.id)));
        flagged = affected.length;
        await notify(tx, { type: "drawing.revised", title: `Program ${p.programNumber} rev ${rev.revision} released — ${flagged} operation(s) need review`, link: `/programs/${p.id}`, permission: "production.supervise", dedupeKey: `progrel:${rev.id}` });
      }
    }
    await audit(tx, { action: "program.revision_release", entityType: "cnc_program", entityId: p.id, entityRef: `${p.programNumber} rev ${rev.revision}`, jobId: p.jobId, approvalId: approval.id, before: { currentReleasedRevisionId: prev }, after: { currentReleasedRevisionId: revisionId, operationsFlagged: flagged } });
    return { flagged };
  });
}

export async function rejectProgramRevision(ctx: Ctx, revisionId: string, reason: string) {
  requirePermission(ctx, "programs.approve");
  if (!reason?.trim()) throw invalid("Give a reason for rejecting.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const { rev, p } = await loadRev(tx, revisionId);
    if (!["submitted", "approved"].includes(rev.status)) throw invalid("Only submitted or approved revisions can be rejected.");
    await tx.db.update(cncProgramRevisions).set({ status: "rejected", rejectedBy: ctx.actor.userId, rejectedAt: new Date(), rejectionReason: reason }).where(eq(cncProgramRevisions.id, revisionId));
    await audit(tx, { action: "program.revision_reject", entityType: "cnc_program", entityId: p.id, entityRef: `${p.programNumber} rev ${rev.revision}`, jobId: p.jobId, reason });
  });
}

export async function listPrograms(ctx: Ctx, opts: { q?: string; machineId?: string; status?: string } = {}) {
  requirePermission(ctx, "programs.view");
  const q = opts.q?.trim();
  const rows = await ctx.db
    .select({ p: cncPrograms, part: parts.partNumber, job: jobs.jobNumber, current: cncProgramRevisions })
    .from(cncPrograms)
    .leftJoin(parts, eq(parts.id, cncPrograms.partId))
    .leftJoin(jobs, eq(jobs.id, cncPrograms.jobId))
    .leftJoin(cncProgramRevisions, eq(cncProgramRevisions.id, cncPrograms.currentReleasedRevisionId))
    .where(q ? or(ilike(cncPrograms.programNumber, `%${q}%`), ilike(cncPrograms.name, `%${q}%`), ilike(parts.partNumber, `%${q}%`)) : undefined)
    .orderBy(desc(cncPrograms.createdAt))
    .limit(300);
  const ids = rows.map((r) => r.p.id);
  const mach = ids.length ? await ctx.db.select({ programId: cncProgramMachines.programId, code: machines.code, id: machines.id }).from(cncProgramMachines).innerJoin(machines, eq(machines.id, cncProgramMachines.machineId)).where(inArray(cncProgramMachines.programId, ids)) : [];
  const pending = ids.length ? await ctx.db.select().from(cncProgramRevisions).where(and(inArray(cncProgramRevisions.programId, ids), inArray(cncProgramRevisions.status, ["draft", "submitted", "approved"]))) : [];
  return rows
    .map((r) => ({ ...r, machines: mach.filter((m) => m.programId === r.p.id), pending: pending.filter((x) => x.programId === r.p.id) }))
    .filter((r) => !opts.machineId || r.machines.some((m) => m.id === opts.machineId));
}

export async function getProgram(ctx: Ctx, id: string) {
  requirePermission(ctx, "programs.view");
  const [p] = await ctx.db.select().from(cncPrograms).where(eq(cncPrograms.id, id)).limit(1);
  if (!p) throw notFound("Program");
  const [revs, mach, part, job, opType] = await Promise.all([
    ctx.db
      .select({ rev: cncProgramRevisions, file: files, programmer: users.name })
      .from(cncProgramRevisions)
      .innerJoin(files, eq(files.id, cncProgramRevisions.fileId))
      .leftJoin(users, eq(users.id, cncProgramRevisions.programmerId))
      .where(eq(cncProgramRevisions.programId, id))
      .orderBy(desc(cncProgramRevisions.createdAt)),
    ctx.db.select({ m: machines }).from(cncProgramMachines).innerJoin(machines, eq(machines.id, cncProgramMachines.machineId)).where(eq(cncProgramMachines.programId, id)),
    p.partId ? ctx.db.select().from(parts).where(eq(parts.id, p.partId)) : Promise.resolve([]),
    p.jobId ? ctx.db.select().from(jobs).where(eq(jobs.id, p.jobId)) : Promise.resolve([]),
    p.operationTypeId ? ctx.db.select().from(operationTypes).where(eq(operationTypes.id, p.operationTypeId)) : Promise.resolve([]),
  ]);
  const people = await ctx.db.select({ id: users.id, name: users.name }).from(users);
  const nm = (u: string | null) => people.find((x) => x.id === u)?.name ?? null;
  const access = revs.length
    ? await ctx.db
        .select({ log: fileAccessLog, user: users.name })
        .from(fileAccessLog)
        .leftJoin(users, eq(users.id, fileAccessLog.userId))
        .where(inArray(fileAccessLog.fileId, revs.map((r) => r.file.id)))
        .orderBy(desc(fileAccessLog.at))
        .limit(100)
    : [];
  const usedBy = revs.length
    ? await ctx.db
        .select({ op: operations, job: jobs.jobNumber })
        .from(operations)
        .innerJoin(jobs, eq(jobs.id, operations.jobId))
        .where(inArray(operations.programRevisionId, revs.map((r) => r.rev.id)))
    : [];
  // Operators (no access_unreleased) only see the current released revision's file link.
  const unrestricted = can(ctx.actor, "programs.access_unreleased");
  return {
    program: p,
    part: part[0] ?? null,
    job: job[0] ?? null,
    operationType: opType[0] ?? null,
    machines: mach.map((m) => m.m),
    revisions: revs.map((r) => ({ ...r, approvedByName: nm(r.rev.approvedBy), releasedByName: nm(r.rev.releasedBy), downloadable: unrestricted || (r.rev.status === "released" && p.currentReleasedRevisionId === r.rev.id) })),
    access,
    usedBy,
  };
}

/** Released revisions usable for an operation type on a machine (for the routing editor). */
export async function releasedProgramsFor(ctx: Ctx, opts: { machineId?: string | null; partId?: string | null }) {
  const rows = await ctx.db
    .select({ p: cncPrograms, rev: cncProgramRevisions })
    .from(cncPrograms)
    .innerJoin(cncProgramRevisions, eq(cncProgramRevisions.id, cncPrograms.currentReleasedRevisionId))
    .where(and(eq(cncPrograms.isActive, true), opts.partId ? or(eq(cncPrograms.partId, opts.partId)) : undefined))
    .orderBy(asc(cncPrograms.programNumber));
  if (!opts.machineId) return rows;
  // Programs with no machine restriction are usable on any machine (consistent with the gates).
  const all = rows.length ? await ctx.db.select().from(cncProgramMachines).where(inArray(cncProgramMachines.programId, rows.map((r) => r.p.id))) : [];
  return rows.filter((r) => {
    const restr = all.filter((c) => c.programId === r.p.id);
    return !restr.length || restr.some((c) => c.machineId === opts.machineId);
  });
}

/** Programs with any revisions awaiting approval or release. */
export async function programApprovalQueue(ctx: Ctx) {
  return ctx.db
    .select({ rev: cncProgramRevisions, p: cncPrograms, programmer: users.name })
    .from(cncProgramRevisions)
    .innerJoin(cncPrograms, eq(cncPrograms.id, cncProgramRevisions.programId))
    .leftJoin(users, eq(users.id, cncProgramRevisions.programmerId))
    .where(inArray(cncProgramRevisions.status, ["submitted", "approved"]))
    .orderBy(asc(cncProgramRevisions.submittedAt));
}
