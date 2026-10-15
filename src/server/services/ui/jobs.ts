/**
 * Read-only query helpers for the jobs and parts UI (no service provides these views).
 * Every helper checks permissions first. Nothing here writes to the database.
 */
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import {
  addresses,
  auditEvents,
  batches,
  cncProgramMachines,
  cncProgramRevisions,
  cncPrograms,
  controlledDocuments,
  customers,
  dispatches,
  dispatchLines,
  documentRevisions,
  gateExceptions,
  jobLines,
  jobs,
  machines,
  operations,
  partRevisions,
  parts,
  scheduleChanges,
  serials,
  users,
} from "../../db/schema";
import { requireAnyPermission, requirePermission, type Ctx } from "../../context";

const JOB_VIEW = ["jobs.view", "production.view_all"] as const;

/** Customers that have at least one job (jobs list filter). */
export async function jobCustomerOptions(ctx: Ctx) {
  requireAnyPermission(ctx, ...JOB_VIEW);
  return ctx.db
    .selectDistinct({ id: customers.id, code: customers.code, name: customers.name })
    .from(customers)
    .innerJoin(jobs, eq(jobs.customerId, customers.id))
    .orderBy(asc(customers.code));
}

/** Active users who can be made job owner. */
export async function jobOwnerOptions(ctx: Ctx) {
  requirePermission(ctx, "jobs.manage");
  return ctx.db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.isActive, true), ne(users.email, "system@mjms.internal")))
    .orderBy(asc(users.name));
}

/** Delivery addresses of a customer (job edit form). */
export async function customerDeliveryAddresses(ctx: Ctx, customerId: string) {
  requirePermission(ctx, "jobs.manage");
  return ctx.db
    .select()
    .from(addresses)
    .where(and(eq(addresses.customerId, customerId), eq(addresses.isActive, true)))
    .orderBy(asc(addresses.kind), asc(addresses.label));
}

/** Pinned drawing revision (with document) for each line of a job. */
export async function jobLineDrawings(ctx: Ctx, jobId: string) {
  requireAnyPermission(ctx, ...JOB_VIEW);
  return ctx.db
    .select({ lineId: jobLines.id, rev: documentRevisions, doc: controlledDocuments })
    .from(jobLines)
    .innerJoin(documentRevisions, eq(documentRevisions.id, jobLines.drawingRevisionId))
    .innerJoin(controlledDocuments, eq(controlledDocuments.id, documentRevisions.documentId))
    .where(eq(jobLines.jobId, jobId));
}

/** Batches and serial numbers for every line of a job. */
export async function jobBatchesAndSerials(ctx: Ctx, jobId: string) {
  requireAnyPermission(ctx, ...JOB_VIEW);
  const lineIds = (await ctx.db.select({ id: jobLines.id }).from(jobLines).where(eq(jobLines.jobId, jobId))).map((l) => l.id);
  if (!lineIds.length) return { batches: [], serials: [] };
  const [b, s] = await Promise.all([
    ctx.db.select().from(batches).where(inArray(batches.jobLineId, lineIds)).orderBy(asc(batches.batchNo)),
    ctx.db.select().from(serials).where(inArray(serials.jobLineId, lineIds)).orderBy(asc(serials.serialNo)),
  ]);
  return { batches: b, serials: s };
}

/** For each line of a job: earlier lines of the same part (other jobs) whose route can be copied. */
export async function copyRouteSources(ctx: Ctx, jobId: string) {
  requirePermission(ctx, "routing.manage");
  const lines = await ctx.db.select().from(jobLines).where(eq(jobLines.jobId, jobId));
  if (!lines.length) return [];
  const partIds = [...new Set(lines.map((l) => l.partId))];
  const rows = await ctx.db
    .select({
      lineId: jobLines.id,
      partId: jobLines.partId,
      lineNo: jobLines.lineNo,
      jobId: jobs.id,
      jobNumber: jobs.jobNumber,
      createdAt: jobs.createdAt,
      ops: sql<number>`count(${operations.id})::int`,
    })
    .from(jobLines)
    .innerJoin(jobs, eq(jobs.id, jobLines.jobId))
    .innerJoin(operations, and(eq(operations.jobLineId, jobLines.id), ne(operations.status, "cancelled"), eq(operations.isRework, false)))
    .where(and(inArray(jobLines.partId, partIds), ne(jobLines.jobId, jobId)))
    .groupBy(jobLines.id, jobLines.partId, jobLines.lineNo, jobs.id, jobs.jobNumber, jobs.createdAt)
    .orderBy(desc(jobs.createdAt))
    .limit(200);
  return lines.map((l) => ({ lineId: l.id, sources: rows.filter((r) => r.partId === l.partId) }));
}

/** Dispatches (with lines) for one job. */
export async function jobDispatchRows(ctx: Ctx, jobId: string) {
  requireAnyPermission(ctx, "dispatch.view", ...JOB_VIEW);
  const ds = await ctx.db.select().from(dispatches).where(eq(dispatches.jobId, jobId)).orderBy(desc(dispatches.createdAt));
  const lines = ds.length
    ? await ctx.db
        .select({ l: dispatchLines, lineNo: jobLines.lineNo, partNumber: jobLines.partNumber })
        .from(dispatchLines)
        .innerJoin(jobLines, eq(jobLines.id, dispatchLines.jobLineId))
        .where(inArray(dispatchLines.dispatchId, ds.map((d) => d.id)))
    : [];
  return ds.map((d) => ({ dispatch: d, lines: lines.filter((l) => l.l.dispatchId === d.id) }));
}

/** Audit events recorded against a job (newest first). */
export async function jobAuditEvents(ctx: Ctx, jobId: string, limit = 500) {
  requireAnyPermission(ctx, ...JOB_VIEW);
  return ctx.db.select().from(auditEvents).where(eq(auditEvents.jobId, jobId)).orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id)).limit(limit);
}

/** Schedule changes for every operation of a job (newest first). */
export async function jobScheduleChanges(ctx: Ctx, jobId: string) {
  requireAnyPermission(ctx, ...JOB_VIEW, "planning.view");
  const rows = await ctx.db
    .select({ c: scheduleChanges, opNumber: operations.opNumber, by: users.name })
    .from(scheduleChanges)
    .innerJoin(operations, eq(operations.id, scheduleChanges.operationId))
    .leftJoin(users, eq(users.id, scheduleChanges.changedBy))
    .where(eq(operations.jobId, jobId))
    .orderBy(desc(scheduleChanges.changedAt));
  const machineIds = [...new Set(rows.flatMap((r) => [r.c.oldMachineId, r.c.newMachineId]).filter((x): x is string => !!x))];
  const ms = machineIds.length ? await ctx.db.select({ id: machines.id, code: machines.code }).from(machines).where(inArray(machines.id, machineIds)) : [];
  const code = (id: string | null) => (id ? (ms.find((m) => m.id === id)?.code ?? "?") : null);
  return rows.map((r) => ({ ...r, oldMachine: code(r.c.oldMachineId), newMachine: code(r.c.newMachineId) }));
}

/**
 * Released document revisions that may be issued to operations of a job:
 * documents linked to one of the job's parts or to the job's customer.
 */
export async function attachableDocuments(ctx: Ctx, jobId: string) {
  requireAnyPermission(ctx, "routing.manage", "programs.create", "production.supervise");
  const [job] = await ctx.db.select({ customerId: jobs.customerId }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return [];
  const partIds = (await ctx.db.selectDistinct({ id: jobLines.partId }).from(jobLines).where(eq(jobLines.jobId, jobId))).map((p) => p.id);
  const rows = await ctx.db
    .select({ doc: controlledDocuments, rev: documentRevisions })
    .from(controlledDocuments)
    .innerJoin(documentRevisions, eq(documentRevisions.id, controlledDocuments.currentRevisionId))
    .where(and(eq(controlledDocuments.isActive, true), eq(documentRevisions.status, "released")))
    .orderBy(asc(controlledDocuments.docNumber));
  return rows.filter((r) => (r.doc.partId && partIds.includes(r.doc.partId)) || r.doc.customerId === job.customerId);
}

/** Machines each program is approved for (empty list = not restricted). */
export async function programMachineCompat(ctx: Ctx, programIds: string[]) {
  requireAnyPermission(ctx, ...JOB_VIEW);
  if (!programIds.length) return [];
  return ctx.db.select().from(cncProgramMachines).where(inArray(cncProgramMachines.programId, programIds));
}

/** Gate exceptions recorded for one operation. */
export async function operationGateExceptions(ctx: Ctx, opId: string) {
  requireAnyPermission(ctx, ...JOB_VIEW);
  return ctx.db
    .select({ e: gateExceptions, by: users.name })
    .from(gateExceptions)
    .leftJoin(users, eq(users.id, gateExceptions.approvedBy))
    .where(eq(gateExceptions.operationId, opId))
    .orderBy(desc(gateExceptions.createdAt));
}

/** Display names for user ids. */
export async function userNames(ctx: Ctx, ids: (string | null | undefined)[]) {
  requireAnyPermission(ctx, ...JOB_VIEW);
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return new Map<string, string>();
  const rows = await ctx.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, uniq));
  return new Map(rows.map((r) => [r.id, r.name]));
}

// ───────────── Parts ─────────────

const PART_VIEW = ["jobs.view", "quotations.view", "documents.view", "production.view_all"] as const;

/** Customer, drawing document, revision drawing labels and usage for the part page. */
export async function partDetailExtras(ctx: Ctx, partId: string) {
  requireAnyPermission(ctx, ...PART_VIEW);
  const [p] = await ctx.db.select().from(parts).where(eq(parts.id, partId)).limit(1);
  if (!p) return null;
  const [customer, drawingDoc, revDrawings, jobRows, programs] = await Promise.all([
    p.customerId ? ctx.db.select().from(customers).where(eq(customers.id, p.customerId)).limit(1) : Promise.resolve([]),
    p.drawingDocumentId ? ctx.db.select().from(controlledDocuments).where(eq(controlledDocuments.id, p.drawingDocumentId)).limit(1) : Promise.resolve([]),
    ctx.db
      .select({ partRevisionId: partRevisions.id, rev: documentRevisions, doc: controlledDocuments })
      .from(partRevisions)
      .innerJoin(documentRevisions, eq(documentRevisions.id, partRevisions.drawingRevisionId))
      .innerJoin(controlledDocuments, eq(controlledDocuments.id, documentRevisions.documentId))
      .where(and(eq(partRevisions.partId, partId), isNotNull(partRevisions.drawingRevisionId))),
    ctx.db
      .select({ line: jobLines, job: jobs })
      .from(jobLines)
      .innerJoin(jobs, eq(jobs.id, jobLines.jobId))
      .where(eq(jobLines.partId, partId))
      .orderBy(desc(jobs.createdAt))
      .limit(200),
    ctx.db
      .select({ p: cncPrograms, rev: cncProgramRevisions })
      .from(cncPrograms)
      .leftJoin(cncProgramRevisions, eq(cncProgramRevisions.id, cncPrograms.currentReleasedRevisionId))
      .where(eq(cncPrograms.partId, partId))
      .orderBy(asc(cncPrograms.programNumber)),
  ]);
  return { customer: customer[0] ?? null, drawingDocument: drawingDoc[0] ?? null, revisionDrawings: revDrawings, jobs: jobRows, programs };
}

/** Drawing documents that can be linked as a part's drawing (same customer, or already on the part). */
export async function linkableDrawingDocuments(ctx: Ctx, partId: string) {
  requireAnyPermission(ctx, "documents.upload", "jobs.manage");
  const [p] = await ctx.db.select().from(parts).where(eq(parts.id, partId)).limit(1);
  if (!p) return [];
  const rows = await ctx.db
    .select({ doc: controlledDocuments, rev: documentRevisions })
    .from(controlledDocuments)
    .leftJoin(documentRevisions, eq(documentRevisions.id, controlledDocuments.currentRevisionId))
    .where(and(eq(controlledDocuments.docType, "drawing"), eq(controlledDocuments.isActive, true)))
    .orderBy(asc(controlledDocuments.docNumber));
  return rows.filter((r) => r.doc.partId === partId || (p.customerId ? r.doc.customerId === p.customerId : !r.doc.customerId));
}

