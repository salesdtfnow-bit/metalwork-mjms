import { and, asc, desc, eq, gte, inArray, lt, lte, notInArray, sql } from "drizzle-orm";
import {
  correctiveActions,
  customers,
  dispatches,
  employees,
  inspections,
  jobLines,
  jobs,
  machines,
  materialLots,
  ncrs,
  operations,
  purchaseOrderLines,
  purchaseOrders,
  quotationRevisions,
  quotations,
  stockSyncTransactions,
  suppliers,
  timeEntries,
} from "../db/schema";
import { can, requireAnyPermission, requirePermission, type Ctx } from "../context";
import { d, sum } from "@/lib/decimal";
import { addDaysISO, todayISO } from "@/lib/format";
import { machineUtilisation } from "./machines";
import { calibrationDue } from "./maintenance";
import { expiringQualifications } from "./employees";
import { overdueDeliveries } from "./purchasing";

/**
 * KPI definitions (also documented in docs/KPI_DEFINITIONS.md):
 *  - On-time delivery (OTD) %: dispatched consignments in the period whose dispatch date ≤ the job's
 *    required date ÷ all consignments dispatched in the period.
 *  - Scrap rate %: Σ scrapped ÷ Σ (good + rejected + scrapped) on operations with time recorded in the period.
 *  - Rework rate %: Σ good qty on rework operations ÷ Σ good qty on all operations in the period.
 *  - First-pass yield %: inspections passed at first attempt ÷ inspections completed (first-off/in-process/final).
 *  - Machine utilisation %: recorded setup+production time ÷ available calendar shift time (see machines.ts).
 *  - WIP: jobs in production-phase statuses; WIP value = Σ (line qty − dispatched) × unit price (commercial view only).
 *  - Quotation pipeline: Σ total of revisions sent/awaiting response (not expired).
 */
export async function managementDashboard(ctx: Ctx, range = { from: new Date(Date.now() - 30 * 86_400_000), to: new Date() }) {
  requireAnyPermission(ctx, "reports.management", "reports.view");
  const commercial = can(ctx.actor, "reports.management");
  const today = todayISO();
  const openJobs = await ctx.db.select({ job: jobs, customer: customers.code }).from(jobs).innerJoin(customers, eq(customers.id, jobs.customerId)).where(notInArray(jobs.status, ["completed", "cancelled"]));
  const lines = openJobs.length ? await ctx.db.select().from(jobLines).where(inArray(jobLines.jobId, openJobs.map((j) => j.job.id))) : [];
  const orderValue = sum(lines.map((l) => d(l.unitPrice ?? 0).times(d(l.quantity))));
  const wipValue = sum(lines.map((l) => d(l.unitPrice ?? 0).times(d(l.quantity).minus(d(l.qtyDispatched)))));
  const pipeline = await ctx.db.select({ total: quotationRevisions.total }).from(quotationRevisions).where(and(inArray(quotationRevisions.status, ["sent", "awaiting_response"]), gte(quotationRevisions.validUntil, today)));
  const prodPhase = ["in_setup", "awaiting_first_off", "in_production", "partially_completed", "awaiting_inspection", "rework_required", "subcontracted", "non_conformance"];

  // OTD
  const dsp = await ctx.db
    .select({ d: dispatches, required: jobs.requiredDate })
    .from(dispatches)
    .innerJoin(jobs, eq(jobs.id, dispatches.jobId))
    .where(and(inArray(dispatches.status, ["dispatched", "delivered"]), gte(dispatches.dispatchedAt, range.from), lte(dispatches.dispatchedAt, range.to)));
  const onTime = dsp.filter((x) => x.required && x.d.dispatchedAt && x.d.dispatchedAt.toISOString().slice(0, 10) <= x.required).length;
  // Quality
  const opsInRange = await ctx.db
    .selectDistinct({ op: operations })
    .from(operations)
    .innerJoin(timeEntries, eq(timeEntries.operationId, operations.id))
    .where(gte(timeEntries.startedAt, range.from));
  const good = sum(opsInRange.map((o) => o.op.qtyGood));
  const rej = sum(opsInRange.map((o) => o.op.qtyRejected));
  const scr = sum(opsInRange.map((o) => o.op.qtyScrapped));
  const reworkGood = sum(opsInRange.filter((o) => o.op.isRework).map((o) => o.op.qtyGood));
  const done = await ctx.db.select().from(inspections).where(and(inArray(inspections.status, ["passed", "failed"]), gte(inspections.completedAt, range.from), inArray(inspections.stage, ["first_off", "in_process", "final"])));
  const total = good.plus(rej).plus(scr);
  const ms = await ctx.db.select().from(machines).where(eq(machines.isActive, true)).orderBy(asc(machines.code));
  const util = [];
  for (const m of ms) util.push({ machine: m.code, ...(await machineUtilisation(ctx, m.id, m.calendarId, range)) });
  const openNcrs = await ctx.db.select().from(ncrs).where(notInArray(ncrs.status, ["closed", "cancelled"]));
  const overdueInsp = await ctx.db.select().from(inspections).where(and(inArray(inspections.status, ["open", "in_progress"]), lt(inspections.requestedAt, new Date(Date.now() - 24 * 3_600_000))));
  const shortages = await ctx.db.select({ l: materialLots }).from(materialLots).where(inArray(materialLots.status, ["awaiting_inspection", "quarantined"]));
  const awaitingCustomer = await ctx.db.select({ r: quotationRevisions, q: quotations }).from(quotationRevisions).innerJoin(quotations, eq(quotations.id, quotationRevisions.quotationId)).where(inArray(quotationRevisions.status, ["sent", "awaiting_response"]));
  const late = openJobs.filter((j) => j.job.requiredDate && j.job.requiredDate < today && !["dispatched"].includes(j.job.status));
  const atRiskSoon = openJobs.filter((j) => j.job.requiredDate && j.job.requiredDate >= today && j.job.requiredDate <= addDaysISO(today, 7) && !["ready_for_dispatch", "dispatched"].includes(j.job.status));
  const maint = await calibrationDue(ctx, 14);
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
  return {
    commercial,
    range,
    openOrders: openJobs.length,
    orderValue: commercial ? orderValue.toFixed(2) : null,
    wipValue: commercial ? wipValue.toFixed(2) : null,
    pipelineValue: commercial ? sum(pipeline.map((p) => p.total)).toFixed(2) : null,
    pipelineCount: pipeline.length,
    inProgress: openJobs.filter((j) => prodPhase.includes(j.job.status)).length,
    late,
    atRiskSoon,
    otdPct: pct(onTime, dsp.length),
    dispatchedCount: dsp.length,
    scrapPct: total.isZero() ? null : Math.round(scr.dividedBy(total).times(1000).toNumber()) / 10,
    rejectPct: total.isZero() ? null : Math.round(rej.dividedBy(total).times(1000).toNumber()) / 10,
    reworkPct: good.isZero() ? null : Math.round(reworkGood.dividedBy(good).times(1000).toNumber()) / 10,
    firstPassYieldPct: pct(done.filter((i) => i.status === "passed").length, done.length),
    throughputQty: good.toString(),
    utilisation: util,
    openNcrs: openNcrs.length,
    overdueInspections: overdueInsp.length,
    materialAwaitingRelease: shortages.length,
    awaitingCustomer: awaitingCustomer.length,
    calibrationDue: maint.length,
  };
}

export async function qualityDashboard(ctx: Ctx) {
  requirePermission(ctx, "quality.view");
  const [openInsp, awaitingRelease, openNcr, openCapa, cal, flagged, lotsAwaiting] = await Promise.all([
    ctx.db.select({ i: inspections, job: jobs.jobNumber }).from(inspections).leftJoin(jobs, eq(jobs.id, inspections.jobId)).where(inArray(inspections.status, ["open", "in_progress"])).orderBy(asc(inspections.requestedAt)),
    ctx.db.select({ job: jobs }).from(jobs).where(inArray(jobs.status, ["production_complete", "final_qc"])),
    ctx.db.select({ n: ncrs, job: jobs.jobNumber }).from(ncrs).leftJoin(jobs, eq(jobs.id, ncrs.jobId)).where(notInArray(ncrs.status, ["closed", "cancelled"])).orderBy(asc(ncrs.raisedAt)),
    ctx.db.select().from(correctiveActions).where(notInArray(correctiveActions.status, ["closed", "cancelled", "verified_effective"])).orderBy(asc(correctiveActions.dueDate)),
    calibrationDue(ctx, 30),
    ctx.db.select({ n: sql<number>`count(*)::int` }).from(sql`inspection_results`).where(sql`under_review = true`),
    ctx.db.select().from(materialLots).where(inArray(materialLots.status, ["awaiting_inspection", "quarantined"])),
  ]);
  const certsOutstanding = lotsAwaiting.filter((l) => ["pending", "received"].includes(l.certificateStatus));
  return { openInspections: openInsp, awaitingRelease, openNcrs: openNcr, openCapa, calibrationDue: cal, resultsUnderReview: flagged[0]?.n ?? 0, lotsAwaiting, certsOutstanding, qualificationsExpiring: await expiringQualifications(ctx, 30) };
}

export async function purchasingDashboard(ctx: Ctx) {
  requirePermission(ctx, "purchasing.view");
  const today = todayISO();
  const [openPos, overdue, lotsCert, failedSync, requirements] = await Promise.all([
    ctx.db.select({ po: purchaseOrders, supplier: suppliers.name }).from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId)).where(notInArray(purchaseOrders.status, ["received", "closed", "cancelled"])).orderBy(asc(purchaseOrders.requiredDate)),
    overdueDeliveries(ctx),
    ctx.db.select({ l: materialLots, supplier: suppliers.name }).from(materialLots).innerJoin(suppliers, eq(suppliers.id, materialLots.supplierId)).where(and(inArray(materialLots.certificateStatus, ["pending", "received", "rejected"]), notInArray(materialLots.status, ["rejected", "returned", "consumed"]))),
    ctx.db.select().from(stockSyncTransactions).where(inArray(stockSyncTransactions.status, ["failed", "needs_reconciliation"])),
    jobsNeedingMaterial(ctx),
  ]);
  const expected = await ctx.db
    .select({ l: purchaseOrderLines, po: purchaseOrders, supplier: suppliers.name })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(inArray(purchaseOrders.status, ["sent", "partially_received"]), gte(purchaseOrderLines.requiredDate, today), lte(purchaseOrderLines.requiredDate, addDaysISO(today, 14))));
  return { openPos, overdue, expected, certsOutstanding: lotsCert, syncProblems: failedSync, jobsNeedingMaterial: requirements };
}

/** Generic filtered job report (also exported to CSV). */
export async function jobsReport(ctx: Ctx, f: { from?: string; to?: string; customerId?: string; status?: string; machineId?: string; employeeId?: string }) {
  requireAnyPermission(ctx, "reports.view", "reports.management");
  const commercial = can(ctx.actor, "reports.management") || can(ctx.actor, "jobs.view_commercial");
  const rows = await ctx.db
    .select({ job: jobs, customer: customers.name })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .where(and(f.customerId ? eq(jobs.customerId, f.customerId) : undefined, f.status ? eq(jobs.status, f.status) : undefined, f.from ? gte(jobs.createdAt, new Date(f.from)) : undefined, f.to ? lte(jobs.createdAt, new Date(`${f.to}T23:59:59Z`)) : undefined))
    .orderBy(desc(jobs.createdAt))
    .limit(2000);
  const ids = rows.map((r) => r.job.id);
  const ls = ids.length ? await ctx.db.select().from(jobLines).where(inArray(jobLines.jobId, ids)) : [];
  let filteredIds = new Set(ids);
  if (f.machineId || f.employeeId) {
    const te = ids.length
      ? await ctx.db
          .selectDistinct({ jobId: operations.jobId })
          .from(timeEntries)
          .innerJoin(operations, eq(operations.id, timeEntries.operationId))
          .where(and(inArray(operations.jobId, ids), f.machineId ? eq(timeEntries.machineId, f.machineId) : undefined, f.employeeId ? eq(timeEntries.employeeId, f.employeeId) : undefined))
      : [];
    filteredIds = new Set(te.map((x) => x.jobId));
  }
  return rows
    .filter((r) => filteredIds.has(r.job.id))
    .map((r) => {
      const mine = ls.filter((l) => l.jobId === r.job.id);
      return {
        jobNumber: r.job.jobNumber,
        title: r.job.title,
        customer: r.customer,
        status: r.job.status,
        requiredDate: r.job.requiredDate,
        quantity: sum(mine.map((l) => l.quantity)).toString(),
        good: sum(mine.map((l) => l.qtyGood)).toString(),
        rejected: sum(mine.map((l) => l.qtyRejected)).toString(),
        scrapped: sum(mine.map((l) => l.qtyScrapped)).toString(),
        dispatched: sum(mine.map((l) => l.qtyDispatched)).toString(),
        value: commercial ? sum(mine.map((l) => d(l.unitPrice ?? 0).times(d(l.quantity)))).toFixed(2) : "",
      };
    });
}

export async function operatorTimeReport(ctx: Ctx, f: { from: string; to: string; employeeId?: string; machineId?: string }) {
  requireAnyPermission(ctx, "reports.view", "reports.management");
  return ctx.db
    .select({ t: timeEntries, e: employees, job: jobs.jobNumber, op: operations.opNumber, machine: machines.code })
    .from(timeEntries)
    .innerJoin(employees, eq(employees.id, timeEntries.employeeId))
    .innerJoin(operations, eq(operations.id, timeEntries.operationId))
    .innerJoin(jobs, eq(jobs.id, operations.jobId))
    .leftJoin(machines, eq(machines.id, timeEntries.machineId))
    .where(and(gte(timeEntries.startedAt, new Date(f.from)), lte(timeEntries.startedAt, new Date(`${f.to}T23:59:59Z`)), f.employeeId ? eq(timeEntries.employeeId, f.employeeId) : undefined, f.machineId ? eq(timeEntries.machineId, f.machineId) : undefined))
    .orderBy(desc(timeEntries.startedAt))
    .limit(5000);
}

export async function ncrReport(ctx: Ctx, f: { from?: string; to?: string; category?: string; supplierId?: string }) {
  requireAnyPermission(ctx, "reports.view", "ncr.view");
  return ctx.db
    .select({ n: ncrs, job: jobs.jobNumber, supplier: suppliers.name })
    .from(ncrs)
    .leftJoin(jobs, eq(jobs.id, ncrs.jobId))
    .leftJoin(suppliers, eq(suppliers.id, ncrs.supplierId))
    .where(and(f.category ? eq(ncrs.category, f.category) : undefined, f.supplierId ? eq(ncrs.supplierId, f.supplierId) : undefined, f.from ? gte(ncrs.raisedAt, new Date(f.from)) : undefined, f.to ? lte(ncrs.raisedAt, new Date(`${f.to}T23:59:59Z`)) : undefined))
    .orderBy(desc(ncrs.raisedAt))
    .limit(2000);
}

/** Supplier performance: on-time receipts and NCR counts. */
export async function supplierPerformance(ctx: Ctx) {
  requireAnyPermission(ctx, "reports.view", "suppliers.view");
  const rows = await ctx.db.select().from(suppliers).where(eq(suppliers.isActive, true));
  const out = [];
  for (const s of rows) {
    const lines = await ctx.db.select({ l: purchaseOrderLines }).from(purchaseOrderLines).innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId)).where(eq(purchaseOrders.supplierId, s.id));
    const n = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(ncrs).where(eq(ncrs.supplierId, s.id));
    out.push({ supplier: s, poLines: lines.length, received: lines.filter((l) => l.l.status === "received").length, ncrs: n[0]?.n ?? 0 });
  }
  return out;
}

/** CSV serialisation (RFC 4180, formula-injection safe). */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // prevent spreadsheet formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n");
}


/** Authorised open jobs with material-consuming operations but no active allocation of released material. */
async function jobsNeedingMaterial(ctx: Ctx) {
  const { materialAllocations } = await import("../db/schema");
  const candidates = await ctx.db
    .selectDistinct({ job: jobs })
    .from(jobs)
    .innerJoin(operations, eq(operations.jobId, jobs.id))
    .where(and(notInArray(jobs.status, ["completed", "cancelled", "dispatched", "ready_for_dispatch"]), eq(operations.requiresMaterial, true), notInArray(operations.status, ["complete", "cancelled"])));
  const out = [];
  for (const c of candidates) {
    const alloc = await ctx.db.select({ id: materialAllocations.id }).from(materialAllocations).where(and(eq(materialAllocations.jobId, c.job.id), eq(materialAllocations.status, "active"))).limit(1);
    if (!alloc.length) out.push(c);
  }
  return out;
}
