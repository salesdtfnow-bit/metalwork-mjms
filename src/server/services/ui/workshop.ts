/**
 * Read-only queries backing the Workshop UI (planning, tooling, maintenance, subcontract,
 * dispatch). No writes here — every mutation goes through the domain services.
 */
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  addresses,
  batches,
  boxheroItems,
  calendarShifts,
  customers,
  employees,
  files,
  finalReleases,
  holds,
  inspections,
  jobLines,
  jobs,
  machines,
  maintenancePlans,
  operations,
  operationTypes,
  scheduleChanges,
  serials,
  subcontractOrders,
  suppliers,
  users,
} from "../../db/schema";
import { requireAnyPermission, requirePermission, type Ctx } from "../../context";
import { notFound } from "../../errors";
import { todayISO } from "@/lib/format";
import { supplierUsable } from "../parties";

// ───────────── Planning ─────────────

/** Most recent schedule changes across all operations. */
export async function recentScheduleChanges(ctx: Ctx, limit = 100) {
  requirePermission(ctx, "planning.view");
  const oldM = alias(machines, "old_m");
  const newM = alias(machines, "new_m");
  return ctx.db
    .select({
      c: scheduleChanges,
      by: users.name,
      opNumber: operations.opNumber,
      opTitle: operations.title,
      jobId: jobs.id,
      jobNumber: jobs.jobNumber,
      oldMachine: oldM.code,
      newMachine: newM.code,
    })
    .from(scheduleChanges)
    .innerJoin(operations, eq(operations.id, scheduleChanges.operationId))
    .innerJoin(jobs, eq(jobs.id, operations.jobId))
    .leftJoin(users, eq(users.id, scheduleChanges.changedBy))
    .leftJoin(oldM, eq(oldM.id, scheduleChanges.oldMachineId))
    .leftJoin(newM, eq(newM.id, scheduleChanges.newMachineId))
    .orderBy(desc(scheduleChanges.changedAt))
    .limit(limit);
}

/**
 * Shift pattern used to draw the board's day columns: the earliest start and latest end over
 * the calendars of the given machines, plus the weekdays that have any shift. Machines without
 * a calendar use the default 07:00–15:30 Mon–Fri day (see `workingWindows`).
 */
export async function boardShiftPattern(ctx: Ctx, calendarIds: (string | null)[]) {
  requirePermission(ctx, "planning.view");
  const ids = [...new Set(calendarIds.filter((x): x is string => !!x))];
  const shifts: { dayOfWeek: number; startTime: string; endTime: string }[] = ids.length
    ? (await ctx.db.select().from(calendarShifts).where(inArray(calendarShifts.calendarId, ids))).map((s) => ({ dayOfWeek: s.dayOfWeek, startTime: String(s.startTime), endTime: String(s.endTime) }))
    : [];
  if (!ids.length || calendarIds.some((c) => !c)) for (const dow of [1, 2, 3, 4, 5]) shifts.push({ dayOfWeek: dow, startTime: "07:00:00", endTime: "15:30:00" });
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const starts = shifts.map((s) => toMin(s.startTime));
  // An end at/below the start means the shift runs past midnight — show up to 24:00.
  const ends = shifts.map((s) => (toMin(s.endTime) <= toMin(s.startTime) ? 24 * 60 : toMin(s.endTime)));
  const startMin = starts.length ? Math.floor(Math.min(...starts) / 60) * 60 : 7 * 60;
  const endMin = ends.length ? Math.ceil(Math.max(...ends) / 60) * 60 : 16 * 60;
  return { startMin, endMin: Math.max(endMin, startMin + 60), workingDays: [...new Set(shifts.map((s) => s.dayOfWeek))] };
}

// ───────────── Shared option lists ─────────────

export async function machineOptions(ctx: Ctx) {
  requireAnyPermission(ctx, "planning.view", "maintenance.view", "tooling.view", "machines.view");
  return ctx.db.select({ id: machines.id, code: machines.code, name: machines.name, status: machines.currentStatus }).from(machines).where(eq(machines.isActive, true)).orderBy(asc(machines.code));
}

export async function employeeOptions(ctx: Ctx) {
  requireAnyPermission(ctx, "maintenance.view", "employees.view");
  return ctx.db
    .select({ id: employees.id, no: employees.employeeNo, firstName: employees.firstName, lastName: employees.lastName })
    .from(employees)
    .where(eq(employees.isActive, true))
    .orderBy(asc(employees.lastName), asc(employees.firstName));
}

/** Active suppliers in a category; `usableOnly` keeps only approved/conditional, unexpired ones. */
async function suppliersInCategory(ctx: Ctx, category: string, usableOnly: boolean) {
  const rows = await ctx.db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.isActive, true), sql`${category} = any(${suppliers.categories})`))
    .orderBy(asc(suppliers.name));
  const today = todayISO();
  return rows
    .filter((s) => !usableOnly || supplierUsable(s, today))
    .map((s) => ({ id: s.id, code: s.code, name: s.name, approvalStatus: s.approvalStatus, approvalExpiresOn: s.approvalExpiresOn }));
}

export async function maintenanceProviders(ctx: Ctx) {
  requirePermission(ctx, "maintenance.view");
  return suppliersInCategory(ctx, "maintenance", false);
}

export async function approvedSubcontractors(ctx: Ctx) {
  requireAnyPermission(ctx, "subcontract.view", "subcontract.manage");
  return suppliersInCategory(ctx, "subcontract", true);
}

// ───────────── Tooling ─────────────

/** BoxHero items (cached from BoxHero) that tooling can reference. */
export async function boxheroItemOptions(ctx: Ctx) {
  requirePermission(ctx, "tooling.view");
  return ctx.db
    .select({ id: boxheroItems.id, name: boxheroItems.name, sku: boxheroItems.sku, quantityTotal: boxheroItems.quantityTotal, lastSyncedAt: boxheroItems.lastSyncedAt })
    .from(boxheroItems)
    .where(eq(boxheroItems.deleted, false))
    .orderBy(asc(boxheroItems.name))
    .limit(1000);
}

/** The cached BoxHero item a tool references (read-only mirror of BoxHero data). */
export async function linkedBoxheroItem(ctx: Ctx, boxheroItemId: string | null) {
  requirePermission(ctx, "tooling.view");
  if (!boxheroItemId) return null;
  const [bh] = await ctx.db.select().from(boxheroItems).where(eq(boxheroItems.id, boxheroItemId)).limit(1);
  return bh ?? null;
}

// ───────────── Maintenance ─────────────

export async function workOrderExtras(ctx: Ctx, wo: { planId: string | null; serviceProviderId: string | null; reportedBy: string | null; completedBy: string | null; reportFileId: string | null }) {
  requirePermission(ctx, "maintenance.view");
  const userIds = [wo.reportedBy, wo.completedBy].filter((x): x is string => !!x);
  const [plan] = wo.planId ? await ctx.db.select().from(maintenancePlans).where(eq(maintenancePlans.id, wo.planId)).limit(1) : [];
  const [provider] = wo.serviceProviderId ? await ctx.db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.id, wo.serviceProviderId)).limit(1) : [];
  const us = userIds.length ? await ctx.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : [];
  const [report] = wo.reportFileId ? await ctx.db.select({ id: files.id, name: files.originalName }).from(files).where(eq(files.id, wo.reportFileId)).limit(1) : [];
  const name = (id: string | null) => (id ? (us.find((u) => u.id === id)?.name ?? null) : null);
  return { plan: plan ?? null, provider: provider ?? null, reportedBy: name(wo.reportedBy), completedBy: name(wo.completedBy), report: report ?? null };
}

// ───────────── Subcontract ─────────────

/**
 * Open external-subcontract operations that do not yet have a live subcontract order
 * (draft/sent/at supplier/returned/accepted). Rejected or cancelled orders free the operation.
 */
export async function openSubcontractOperations(ctx: Ctx) {
  requirePermission(ctx, "subcontract.manage");
  const rows = await ctx.db
    .select({ op: operations, type: operationTypes.name, job: jobs, part: jobLines.partNumber, partDescription: jobLines.description, customer: customers.code })
    .from(operations)
    .innerJoin(operationTypes, eq(operationTypes.id, operations.operationTypeId))
    .innerJoin(jobs, eq(jobs.id, operations.jobId))
    .innerJoin(jobLines, eq(jobLines.id, operations.jobLineId))
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .where(and(eq(operationTypes.isSubcontract, true), inArray(operations.status, ["pending", "ready", "paused"]), notInArray(jobs.status, ["cancelled", "completed", "dispatched"])))
    .orderBy(asc(jobs.priority), sql`${jobs.requiredDate} asc nulls last`, asc(jobs.jobNumber), asc(operations.sequence));
  if (!rows.length) return [];
  const live = await ctx.db
    .select({ operationId: subcontractOrders.operationId })
    .from(subcontractOrders)
    .where(and(inArray(subcontractOrders.operationId, rows.map((r) => r.op.id)), notInArray(subcontractOrders.status, ["cancelled", "rejected"])));
  const taken = new Set(live.map((l) => l.operationId));
  return rows.filter((r) => !taken.has(r.op.id));
}

export async function subcontractExtras(ctx: Ctx, sco: { incomingInspectionId: string | null; createdBy: string | null; dispatchedBy: string | null; receivedBy: string | null; acceptedBy: string | null }) {
  requirePermission(ctx, "subcontract.view");
  const [insp] = sco.incomingInspectionId
    ? await ctx.db.select({ id: inspections.id, ref: inspections.ref, status: inspections.status, result: inspections.result }).from(inspections).where(eq(inspections.id, sco.incomingInspectionId)).limit(1)
    : [];
  const ids = [sco.createdBy, sco.dispatchedBy, sco.receivedBy, sco.acceptedBy].filter((x): x is string => !!x);
  const us = ids.length ? await ctx.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : [];
  const name = (id: string | null) => (id ? (us.find((u) => u.id === id)?.name ?? null) : null);
  return { inspection: insp ?? null, createdBy: name(sco.createdBy), dispatchedBy: name(sco.dispatchedBy), receivedBy: name(sco.receivedBy), acceptedBy: name(sco.acceptedBy) };
}

// ───────────── Dispatch ─────────────

/** Everything the "prepare dispatch" form needs for one job. */
export async function dispatchJobContext(ctx: Ctx, jobId: string) {
  requirePermission(ctx, "dispatch.manage");
  const [row] = await ctx.db
    .select({ job: jobs, customer: customers })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!row) throw notFound("Job");
  const lines = await ctx.db.select().from(jobLines).where(eq(jobLines.jobId, jobId)).orderBy(asc(jobLines.lineNo));
  const lineIds = lines.map((l) => l.id);
  const [addrs, rels, sers, bats, jobHolds] = await Promise.all([
    ctx.db
      .select()
      .from(addresses)
      .where(and(eq(addresses.customerId, row.customer.id), eq(addresses.isActive, true)))
      .orderBy(desc(addresses.isDefault)),
    lineIds.length ? ctx.db.select().from(finalReleases).where(and(inArray(finalReleases.jobLineId, lineIds), eq(finalReleases.status, "approved"))) : Promise.resolve([]),
    lineIds.length ? ctx.db.select().from(serials).where(and(inArray(serials.jobLineId, lineIds), eq(serials.status, "accepted"))).orderBy(asc(serials.serialNo)) : Promise.resolve([]),
    lineIds.length ? ctx.db.select().from(batches).where(and(inArray(batches.jobLineId, lineIds), notInArray(batches.status, ["on_hold", "quarantined", "rejected", "dispatched"]))).orderBy(asc(batches.batchNo)) : Promise.resolve([]),
    ctx.db.select().from(holds).where(and(eq(holds.jobId, jobId), eq(holds.targetType, "job"), isNull(holds.releasedAt))),
  ]);
  // Job's own delivery address may belong to another party record; include it if missing.
  let all = addrs;
  if (row.job.deliveryAddressId && !addrs.some((a) => a.id === row.job.deliveryAddressId)) {
    const [ja] = await ctx.db.select().from(addresses).where(eq(addresses.id, row.job.deliveryAddressId)).limit(1);
    if (ja) all = [ja, ...addrs];
  }
  return {
    job: row.job,
    customer: { id: row.customer.id, code: row.customer.code, name: row.customer.name },
    lines: lines.map((l) => ({
      line: l,
      released: rels.some((r) => r.jobLineId === l.id),
      serials: sers.filter((s) => s.jobLineId === l.id).map((s) => ({ id: s.id, serialNo: s.serialNo })),
      batches: bats.filter((b) => b.jobLineId === l.id).map((b) => ({ id: b.id, batchNo: b.batchNo, status: b.status })),
    })),
    addresses: all,
    jobOnHold: jobHolds.length > 0 || row.job.status === "on_hold",
  };
}

/** Certificates of Conformity issued with the job's approved final releases. */
export async function jobConformityCertificates(ctx: Ctx, jobId: string) {
  requirePermission(ctx, "dispatch.view");
  return ctx.db
    .select({ releaseId: finalReleases.id, lineNo: jobLines.lineNo, partNumber: jobLines.partNumber, qtyReleased: finalReleases.qtyReleased, decidedAt: finalReleases.decidedAt, fileId: files.id, fileName: files.originalName })
    .from(finalReleases)
    .innerJoin(jobLines, eq(jobLines.id, finalReleases.jobLineId))
    .innerJoin(files, eq(files.id, finalReleases.cocFileId))
    .where(and(eq(finalReleases.jobId, jobId), eq(finalReleases.status, "approved")))
    .orderBy(asc(jobLines.lineNo));
}
