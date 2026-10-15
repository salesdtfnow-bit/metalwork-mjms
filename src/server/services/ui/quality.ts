/**
 * Read-only UI queries for the quality and NCR screens (option lists, history, context).
 * No writes. Every function checks permissions.
 */
import { and, asc, desc, eq, gt, inArray, lt, notInArray, or, sql } from "drizzle-orm";
import {
  auditEvents,
  batches,
  cncProgramRevisions,
  cncPrograms,
  correctiveActions,
  customers,
  employees,
  finalReleases,
  inspectionCharacteristics,
  jobLines,
  jobs,
  materialLots,
  measuringInstruments,
  ncrs,
  operations,
  operationTypes,
  parts,
  suppliers,
  timeEntries,
  users,
} from "../../db/schema";
import { requireAnyPermission, type Ctx } from "../../context";
import { instrumentValid } from "../inspections";
import { getSettings } from "../settings";
import { todayISO } from "@/lib/format";

const LOOKUP_PERMS = ["quality.view", "quality.inspect", "quality.plans", "quality.instruments", "quality.release", "materials.inspect", "ncr.view", "ncr.raise"] as const;
const lookup = (ctx: Ctx) => requireAnyPermission(ctx, ...LOOKUP_PERMS);

// ───────────── Option lists ─────────────

export async function jobOptions(ctx: Ctx, opts: { includeClosed?: boolean } = {}) {
  lookup(ctx);
  return ctx.db
    .select({ id: jobs.id, jobNumber: jobs.jobNumber, title: jobs.title, status: jobs.status, customerId: jobs.customerId })
    .from(jobs)
    .where(opts.includeClosed ? undefined : notInArray(jobs.status, ["completed", "cancelled"]))
    .orderBy(desc(jobs.createdAt))
    .limit(500);
}

export async function jobLineOptions(ctx: Ctx, jobId?: string | null) {
  lookup(ctx);
  return ctx.db
    .select({ id: jobLines.id, jobId: jobLines.jobId, lineNo: jobLines.lineNo, partNumber: jobLines.partNumber, description: jobLines.description, quantity: jobLines.quantity, jobNumber: jobs.jobNumber })
    .from(jobLines)
    .innerJoin(jobs, eq(jobs.id, jobLines.jobId))
    .where(jobId ? eq(jobLines.jobId, jobId) : notInArray(jobs.status, ["completed", "cancelled"]))
    .orderBy(desc(jobs.createdAt), asc(jobLines.lineNo))
    .limit(500);
}

export async function operationOptions(ctx: Ctx, jobId: string) {
  lookup(ctx);
  return ctx.db
    .select({ id: operations.id, opNumber: operations.opNumber, title: operations.title, status: operations.status, jobLineId: operations.jobLineId, batchId: operations.batchId, lineNo: jobLines.lineNo })
    .from(operations)
    .innerJoin(jobLines, eq(jobLines.id, operations.jobLineId))
    .where(eq(operations.jobId, jobId))
    .orderBy(asc(jobLines.lineNo), asc(operations.sequence));
}

export async function batchOptions(ctx: Ctx, jobId: string) {
  lookup(ctx);
  return ctx.db
    .select({ id: batches.id, batchNo: batches.batchNo, quantity: batches.quantity, status: batches.status, lineNo: jobLines.lineNo })
    .from(batches)
    .innerJoin(jobLines, eq(jobLines.id, batches.jobLineId))
    .where(eq(jobLines.jobId, jobId))
    .orderBy(asc(jobLines.lineNo), asc(batches.batchNo));
}

export async function lotOptions(ctx: Ctx) {
  lookup(ctx);
  return ctx.db
    .select({ id: materialLots.id, lotNo: materialLots.lotNo, heatNumber: materialLots.heatNumber, status: materialLots.status, supplierId: materialLots.supplierId })
    .from(materialLots)
    .where(notInArray(materialLots.status, ["consumed"]))
    .orderBy(desc(materialLots.lotNo))
    .limit(500);
}

export async function supplierOptions(ctx: Ctx, category?: string) {
  lookup(ctx);
  return ctx.db
    .select({ id: suppliers.id, code: suppliers.code, name: suppliers.name, categories: suppliers.categories, approvalStatus: suppliers.approvalStatus })
    .from(suppliers)
    .where(and(eq(suppliers.isActive, true), category ? sql`${category} = any(${suppliers.categories})` : undefined))
    .orderBy(asc(suppliers.name))
    .limit(500);
}

/** Supplier names by id (includes inactive) for display. */
export async function supplierNames(ctx: Ctx, ids: (string | null | undefined)[]) {
  lookup(ctx);
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return {} as Record<string, string>;
  const rows = await ctx.db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(inArray(suppliers.id, list));
  return Object.fromEntries(rows.map((r) => [r.id, r.name])) as Record<string, string>;
}

export async function customerOptions(ctx: Ctx) {
  lookup(ctx);
  return ctx.db.select({ id: customers.id, code: customers.code, name: customers.name }).from(customers).where(eq(customers.isActive, true)).orderBy(asc(customers.name)).limit(500);
}

export async function userOptions(ctx: Ctx) {
  lookup(ctx);
  return ctx.db.select({ id: users.id, name: users.name }).from(users).where(eq(users.isActive, true)).orderBy(asc(users.name));
}

export async function operationTypeOptions(ctx: Ctx) {
  lookup(ctx);
  return ctx.db.select({ id: operationTypes.id, code: operationTypes.code, name: operationTypes.name }).from(operationTypes).where(eq(operationTypes.isActive, true)).orderBy(asc(operationTypes.sortOrder), asc(operationTypes.name));
}

export async function partOptions(ctx: Ctx) {
  lookup(ctx);
  return ctx.db.select({ id: parts.id, partNumber: parts.partNumber, description: parts.description, customerId: parts.customerId }).from(parts).orderBy(asc(parts.partNumber)).limit(1000);
}

/** Instruments with calibration validity (usable by anyone who can record results). */
export async function instrumentOptions(ctx: Ctx) {
  lookup(ctx);
  const today = todayISO();
  const rows = await ctx.db.select().from(measuringInstruments).where(notInArray(measuringInstruments.status, ["retired", "lost"])).orderBy(asc(measuringInstruments.assetNo));
  return rows.map((i) => {
    const v = instrumentValid(i, today);
    return { id: i.id, assetNo: i.assetNo, description: i.description, instrumentType: i.instrumentType, calibrationDueOn: i.calibrationDueOn, ok: v.ok, reason: v.reason };
  });
}

// ───────────── Context helpers ─────────────

/** Names/labels the inspection screen needs that getInspection does not resolve. */
export async function inspectionExtras(ctx: Ctx, insp: { id: string; programRevisionId: string | null; requestedBy: string | null; operationId: string | null; setupOperatorId: string | null; stage: string }) {
  requireAnyPermission(ctx, "quality.view", "quality.inspect", "materials.inspect");
  const [prog, requester, linkedNcrs, settings] = await Promise.all([
    insp.programRevisionId
      ? ctx.db
          .select({ programNumber: cncPrograms.programNumber, revision: cncProgramRevisions.revision, status: cncProgramRevisions.status })
          .from(cncProgramRevisions)
          .innerJoin(cncPrograms, eq(cncPrograms.id, cncProgramRevisions.programId))
          .where(eq(cncProgramRevisions.id, insp.programRevisionId))
      : Promise.resolve([]),
    insp.requestedBy ? ctx.db.select({ name: users.name }).from(users).where(eq(users.id, insp.requestedBy)) : Promise.resolve([]),
    ctx.db.select({ id: ncrs.id, ref: ncrs.ref, status: ncrs.status }).from(ncrs).where(or(eq(ncrs.inspectionId, insp.id), eq(ncrs.reinspectionId, insp.id))),
    getSettings(ctx.db),
  ]);
  // Independence pre-check (the service enforces the same rule on submit).
  let independenceWarning: string | null = null;
  if (!settings.allowSelfInspection && ctx.actor.employeeId) {
    if (insp.setupOperatorId && insp.setupOperatorId === ctx.actor.employeeId) independenceWarning = "You set up this operation. An independent inspector must record and approve this inspection.";
    else if (insp.operationId && ["first_off", "final"].includes(insp.stage)) {
      const mine = await ctx.db.select({ id: timeEntries.id }).from(timeEntries).where(and(eq(timeEntries.operationId, insp.operationId), eq(timeEntries.employeeId, ctx.actor.employeeId))).limit(1);
      if (mine.length) independenceWarning = "You worked on this operation. An independent inspector must approve this inspection.";
    }
  }
  const p = prog[0];
  return {
    program: p ? `${p.programNumber} rev ${p.revision}` : null,
    requestedBy: requester[0]?.name ?? null,
    ncrs: linkedNcrs,
    independenceWarning,
  };
}

export async function employeeName(ctx: Ctx, id: string | null | undefined) {
  lookup(ctx);
  if (!id) return null;
  const [e] = await ctx.db.select({ f: employees.firstName, l: employees.lastName }).from(employees).where(eq(employees.id, id));
  return e ? `${e.f} ${e.l}` : null;
}

export async function characteristicNames(ctx: Ctx, ids: (string | null)[]) {
  lookup(ctx);
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return {} as Record<string, string>;
  const rows = await ctx.db.select({ id: inspectionCharacteristics.id, name: inspectionCharacteristics.name, balloonNo: inspectionCharacteristics.balloonNo }).from(inspectionCharacteristics).where(inArray(inspectionCharacteristics.id, list));
  return Object.fromEntries(rows.map((r) => [r.id, r.balloonNo ? `${r.balloonNo} · ${r.name}` : r.name])) as Record<string, string>;
}

// ───────────── Final release ─────────────

/** Job lines with accepted but unreleased quantity, plus any open (draft) release record. */
export async function releaseCandidates(ctx: Ctx) {
  requireAnyPermission(ctx, "quality.view", "quality.release");
  const lines = await ctx.db
    .select({ line: jobLines, jobNumber: jobs.jobNumber, jobStatus: jobs.status, jobTitle: jobs.title })
    .from(jobLines)
    .innerJoin(jobs, eq(jobs.id, jobLines.jobId))
    .where(and(notInArray(jobs.status, ["completed", "cancelled", "dispatched"]), or(gt(jobLines.qtyAccepted, jobLines.qtyReleased), and(inArray(jobs.status, ["production_complete", "final_qc"]), lt(jobLines.qtyReleased, jobLines.quantity)))))
    .orderBy(asc(jobs.jobNumber), asc(jobLines.lineNo));
  const drafts = lines.length
    ? await ctx.db
        .select({ id: finalReleases.id, jobLineId: finalReleases.jobLineId })
        .from(finalReleases)
        .where(and(eq(finalReleases.status, "draft"), inArray(finalReleases.jobLineId, lines.map((l) => l.line.id))))
    : [];
  return lines.map((l) => ({ ...l, draftReleaseId: drafts.find((d) => d.jobLineId === l.line.id)?.id ?? null }));
}

// ───────────── History ─────────────

/** Audit events for an NCR and its corrective actions. */
export async function ncrHistory(ctx: Ctx, ncrId: string) {
  requireAnyPermission(ctx, "ncr.view");
  const caIds = (await ctx.db.select({ id: correctiveActions.id }).from(correctiveActions).where(eq(correctiveActions.ncrId, ncrId))).map((c) => c.id);
  return ctx.db
    .select()
    .from(auditEvents)
    .where(or(and(eq(auditEvents.entityType, "ncr"), eq(auditEvents.entityId, ncrId)), caIds.length ? and(eq(auditEvents.entityType, "corrective_action"), inArray(auditEvents.entityId, caIds)) : undefined))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(200);
}

/** Audit events for a quality record (inspection, plan, instrument, release). */
export async function qualityHistory(ctx: Ctx, entityType: "inspection" | "inspection_plan" | "instrument" | "final_release", entityId: string) {
  requireAnyPermission(ctx, "quality.view", "quality.inspect", "materials.inspect", "quality.release");
  return ctx.db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.entityType, entityType), eq(auditEvents.entityId, entityId)))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(200);
}
