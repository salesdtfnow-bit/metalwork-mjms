import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or, sql } from "drizzle-orm";
import {
  cncProgramMachines,
  cncProgramRevisions,
  customers,
  employees,
  jobLines,
  jobs,
  machineCapabilities,
  machines,
  maintenanceWorkOrders,
  operationAssignments,
  operationDependencies,
  operations,
  operationTypes,
  scheduleChanges,
  subcontractOrders,
  users,
} from "../db/schema";
import { audit } from "../audit";
import { mutate, requirePermission, type Ctx } from "../context";
import { AppError, invalid, notFound } from "../errors";
import { d } from "@/lib/decimal";
import { todayISO, addDaysISO } from "@/lib/format";
import { addWorkingMinutes, windowMinutes, workingWindows } from "./machines";
import { hasValidCompetency } from "./employees";

export function remainingMinutes(op: typeof operations.$inferSelect) {
  const remainingQty = Math.max(0, Number(op.plannedQty) - Number(op.qtyGood) - Number(op.qtyScrapped));
  return (op.setupStatus === "complete" ? 0 : Number(op.setupMinutesEst)) + remainingQty * Number(op.cycleMinutesEst);
}

export type ScheduleCheck = { errors: string[]; warnings: string[]; plannedEnd: Date | null };

/** Validates placing an operation on a machine at a start time (no changes made). */
export async function checkSchedule(ctx: Ctx, opId: string, machineId: string, start: Date): Promise<ScheduleCheck> {
  const [op] = await ctx.db.select().from(operations).where(eq(operations.id, opId)).limit(1);
  if (!op) throw notFound("Operation");
  const errors: string[] = [];
  const warnings: string[] = [];
  if (["complete", "cancelled"].includes(op.status)) errors.push(`Operation is ${op.status}.`);
  const [m] = await ctx.db.select().from(machines).where(eq(machines.id, machineId)).limit(1);
  if (!m?.isActive) errors.push("Machine is not active.");
  const caps = await ctx.db.select().from(machineCapabilities).where(eq(machineCapabilities.machineId, machineId));
  if (caps.length && !caps.some((c) => c.operationTypeId === op.operationTypeId)) errors.push(`${m?.code} is not configured for this operation type.`);
  const minutes = Math.max(remainingMinutes(op), 1);
  const plannedEnd = await addWorkingMinutes(ctx, m?.calendarId ?? null, start, minutes);
  // Conflicting bookings
  if (m && !m.allowsConcurrent) {
    const clash = await ctx.db
      .select({ op: operations, job: jobs.jobNumber })
      .from(operations)
      .innerJoin(jobs, eq(jobs.id, operations.jobId))
      .where(and(eq(operations.machineId, machineId), ne(operations.id, opId), notInArray(operations.status, ["complete", "cancelled"]), isNotNull(operations.plannedStart), lt(operations.plannedStart, plannedEnd), gte(operations.plannedEnd, start)));
    for (const c of clash) errors.push(`Overlaps ${c.job} op ${c.op.opNumber} on ${m.code}.`);
  }
  // Maintenance windows
  const mw = await ctx.db
    .select()
    .from(maintenanceWorkOrders)
    .where(and(eq(maintenanceWorkOrders.machineId, machineId), eq(maintenanceWorkOrders.locksMachine, true), inArray(maintenanceWorkOrders.status, ["scheduled", "in_progress"]), or(eq(maintenanceWorkOrders.status, "in_progress"), and(lt(maintenanceWorkOrders.scheduledStart, plannedEnd), gte(maintenanceWorkOrders.scheduledEnd, start)))));
  for (const w of mw) errors.push(`${m?.code} is booked for maintenance (${w.ref}${w.scheduledStart ? ` ${w.scheduledStart.toISOString().slice(0, 16).replace("T", " ")}` : ""}).`);
  // Dependencies
  const deps = await ctx.db.select({ o: operations }).from(operationDependencies).innerJoin(operations, eq(operations.id, operationDependencies.dependsOnId)).where(eq(operationDependencies.operationId, opId));
  for (const { o } of deps) {
    if (["complete", "cancelled"].includes(o.status)) continue;
    if (!o.plannedEnd) warnings.push(`Prerequisite op ${o.opNumber} is not scheduled yet.`);
    else if (o.plannedEnd > start) errors.push(`Starts before prerequisite op ${o.opNumber} is planned to finish.`);
  }
  // Program/machine compatibility
  if (op.programRevisionId) {
    const [r] = await ctx.db.select().from(cncProgramRevisions).where(eq(cncProgramRevisions.id, op.programRevisionId));
    const compat = await ctx.db.select().from(cncProgramMachines).where(eq(cncProgramMachines.programId, r.programId));
    if (compat.length && !compat.some((c) => c.machineId === machineId)) errors.push("The operation's CNC program is not approved for this machine.");
  } else if (op.requiresProgram) warnings.push("No CNC program assigned yet.");
  // Operators
  const assigned = await ctx.db.select().from(operationAssignments).where(and(eq(operationAssignments.operationId, opId), eq(operationAssignments.isActive, true)));
  if (!assigned.length) warnings.push("No operator assigned.");
  else if (op.requiredCompetencyId) {
    for (const a of assigned) if (!(await hasValidCompetency(ctx, a.employeeId, op.requiredCompetencyId, start.toISOString().slice(0, 10)))) warnings.push("An assigned operator's competency is not valid on the planned date.");
  }
  // Delivery risk
  const [job] = await ctx.db.select().from(jobs).where(eq(jobs.id, op.jobId));
  if (job.requiredDate && plannedEnd.toISOString().slice(0, 10) > job.requiredDate) warnings.push(`Planned finish is after the required date (${job.requiredDate}).`);
  if (start < new Date(Date.now() - 5 * 60_000)) warnings.push("Start time is in the past.");
  return { errors, warnings, plannedEnd };
}

/** Schedules (or reschedules) an operation. Rescheduling requires a reason; every change is logged. */
export async function scheduleOperation(ctx: Ctx, opId: string, input: { machineId: string; start: Date; reason?: string | null; acceptWarnings?: boolean }) {
  requirePermission(ctx, "planning.schedule");
  return mutate(ctx, async (tx) => {
    const [op] = await tx.db.select().from(operations).where(eq(operations.id, opId)).limit(1);
    if (!op) throw notFound("Operation");
    const check = await checkSchedule(tx, opId, input.machineId, input.start);
    if (check.errors.length) throw new AppError(`Cannot schedule: ${check.errors.join(" ")}`, "validation", { errors: check.errors, warnings: check.warnings });
    const isReschedule = !!op.plannedStart;
    if (isReschedule && !input.reason?.trim()) throw invalid("Give a reason for rescheduling.", { field: "reason" });
    if (["in_setup", "in_production"].includes(op.status) && op.machineId !== input.machineId) throw invalid("A running operation cannot be moved to another machine.");
    await tx.db.update(operations).set({ machineId: input.machineId, plannedStart: input.start, plannedEnd: check.plannedEnd }).where(eq(operations.id, opId));
    await tx.db.insert(scheduleChanges).values({ operationId: opId, oldMachineId: op.machineId, newMachineId: input.machineId, oldStart: op.plannedStart, newStart: input.start, oldEnd: op.plannedEnd, newEnd: check.plannedEnd, reason: input.reason ?? (isReschedule ? null : "Initial schedule"), changedBy: ctx.actor.userId });
    await audit(tx, { action: isReschedule ? "schedule.change" : "schedule.set", entityType: "operation", entityId: opId, jobId: op.jobId, operationId: opId, before: { machineId: op.machineId, start: op.plannedStart, end: op.plannedEnd }, after: { machineId: input.machineId, start: input.start, end: check.plannedEnd, warnings: check.warnings }, reason: input.reason });
    return check;
  });
}

export async function unscheduleOperation(ctx: Ctx, opId: string, reason: string) {
  requirePermission(ctx, "planning.schedule");
  if (!reason?.trim()) throw invalid("A reason is required.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const [op] = await tx.db.select().from(operations).where(eq(operations.id, opId)).limit(1);
    if (!op) throw notFound("Operation");
    await tx.db.update(operations).set({ plannedStart: null, plannedEnd: null }).where(eq(operations.id, opId));
    await tx.db.insert(scheduleChanges).values({ operationId: opId, oldMachineId: op.machineId, newMachineId: op.machineId, oldStart: op.plannedStart, oldEnd: op.plannedEnd, reason, changedBy: ctx.actor.userId });
    await audit(tx, { action: "schedule.clear", entityType: "operation", entityId: opId, jobId: op.jobId, operationId: opId, reason });
  });
}

/** Machine-oriented timeline data for a date range. */
export async function planningBoard(ctx: Ctx, range: { from: Date; to: Date }) {
  requirePermission(ctx, "planning.view");
  const ms = await ctx.db.select().from(machines).where(eq(machines.isActive, true)).orderBy(asc(machines.code));
  const planned = await ctx.db
    .select({ op: operations, job: jobs, type: operationTypes.code, customer: customers.code, part: jobLines.partNumber })
    .from(operations)
    .innerJoin(jobs, eq(jobs.id, operations.jobId))
    .innerJoin(jobLines, eq(jobLines.id, operations.jobLineId))
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .innerJoin(operationTypes, eq(operationTypes.id, operations.operationTypeId))
    .where(and(isNotNull(operations.plannedStart), lt(operations.plannedStart, range.to), gte(operations.plannedEnd, range.from), ne(operations.status, "cancelled")));
  const unscheduled = await ctx.db
    .select({ op: operations, job: jobs, type: operationTypes, part: jobLines.partNumber })
    .from(operations)
    .innerJoin(jobs, eq(jobs.id, operations.jobId))
    .innerJoin(jobLines, eq(jobLines.id, operations.jobLineId))
    .innerJoin(operationTypes, eq(operationTypes.id, operations.operationTypeId))
    .where(and(isNull(operations.plannedStart), inArray(operations.status, ["pending", "ready", "paused"]), eq(operationTypes.requiresMachine, true), notInArray(jobs.status, ["cancelled", "completed", "on_hold"])))
    .orderBy(asc(jobs.priority), sql`${jobs.requiredDate} asc nulls last`);
  const maint = await ctx.db
    .select()
    .from(maintenanceWorkOrders)
    .where(and(inArray(maintenanceWorkOrders.status, ["scheduled", "in_progress"]), eq(maintenanceWorkOrders.locksMachine, true)));
  const load = [];
  for (const m of ms) {
    const avail = windowMinutes(await workingWindows(ctx, m.calendarId, range.from, range.to));
    const mine = planned.filter((p) => p.op.machineId === m.id);
    const plannedMin = mine.reduce((acc, p) => {
      const s = Math.max(p.op.plannedStart!.getTime(), range.from.getTime());
      const e = Math.min(p.op.plannedEnd!.getTime(), range.to.getTime());
      return acc + Math.max(0, (e - s) / 60_000);
    }, 0);
    load.push({ machineId: m.id, availableMinutes: Math.round(avail), plannedMinutes: Math.round(plannedMin), loadPct: avail ? Math.round((plannedMin / avail) * 100) : null });
  }
  return { machines: ms, planned, unscheduled, maintenance: maint, load };
}

/** Overview lists for the production planning dashboard. */
export async function planningDashboard(ctx: Ctx) {
  requirePermission(ctx, "planning.view");
  const today = todayISO();
  const open = await ctx.db.select({ job: jobs, customer: customers.code }).from(jobs).innerJoin(customers, eq(customers.id, jobs.customerId)).where(notInArray(jobs.status, ["completed", "cancelled", "dispatched"]));
  const ops = await ctx.db
    .select({ op: operations, job: jobs, machine: machines.code, type: operationTypes })
    .from(operations)
    .innerJoin(jobs, eq(jobs.id, operations.jobId))
    .innerJoin(operationTypes, eq(operationTypes.id, operations.operationTypeId))
    .leftJoin(machines, eq(machines.id, operations.machineId))
    .where(and(notInArray(operations.status, ["complete", "cancelled"]), notInArray(jobs.status, ["completed", "cancelled"])));
  const byStatus = (s: string[]) => open.filter((j) => s.includes(j.job.status));
  const late = open.filter((j) => j.job.requiredDate && j.job.requiredDate < today);
  const upcoming = open.filter((j) => j.job.requiredDate && j.job.requiredDate >= today && j.job.requiredDate <= addDaysISO(today, 14)).sort((a, b) => (a.job.requiredDate! < b.job.requiredDate! ? -1 : 1));
  // At risk: remaining planned work ends after the required date, or unscheduled work within 5 days of it.
  const atRisk = open.filter((j) => {
    if (!j.job.requiredDate) return false;
    const mine = ops.filter((o) => o.job.id === j.job.id);
    const latest = mine.reduce<Date | null>((acc, o) => (o.op.plannedEnd && (!acc || o.op.plannedEnd > acc) ? o.op.plannedEnd : acc), null);
    if (latest && latest.toISOString().slice(0, 10) > j.job.requiredDate) return true;
    return mine.some((o) => !o.op.plannedStart && o.type.requiresMachine) && j.job.requiredDate <= addDaysISO(today, 5);
  });
  const opsBehind = ops.filter((o) => o.op.plannedEnd && o.op.plannedEnd < new Date());
  const subcon = await ctx.db.select().from(subcontractOrders).where(inArray(subcontractOrders.status, ["at_supplier", "sent", "returned"]));
  const maint = await ctx.db.select({ wo: maintenanceWorkOrders, machine: machines.code }).from(maintenanceWorkOrders).innerJoin(machines, eq(machines.id, maintenanceWorkOrders.machineId)).where(inArray(maintenanceWorkOrders.status, ["scheduled", "in_progress"]));
  const machineLoad = new Map<string, { code: string; minutes: number; ops: number }>();
  for (const o of ops) {
    if (!o.machine) continue;
    const cur = machineLoad.get(o.machine) ?? { code: o.machine, minutes: 0, ops: 0 };
    cur.minutes += remainingMinutes(o.op);
    cur.ops++;
    machineLoad.set(o.machine, cur);
  }
  return {
    activeJobs: open,
    awaitingMaterial: byStatus(["awaiting_material", "material_received", "awaiting_material_release"]),
    awaitingProgramming: byStatus(["awaiting_programming", "programming_in_progress", "awaiting_program_approval"]),
    readyOps: ops.filter((o) => o.op.status === "ready"),
    awaitingInspection: ops.filter((o) => ["awaiting_inspection", "awaiting_first_off"].includes(o.op.status)),
    onHold: byStatus(["on_hold", "non_conformance"]),
    late,
    upcoming,
    atRisk,
    opsBehind,
    subcontracted: subcon,
    maintenance: maint,
    machineLoad: [...machineLoad.values()].sort((a, b) => b.minutes - a.minutes),
  };
}

export async function scheduleHistory(ctx: Ctx, opId: string) {
  return ctx.db.select({ c: scheduleChanges, by: users.name }).from(scheduleChanges).leftJoin(users, eq(users.id, scheduleChanges.changedBy)).where(eq(scheduleChanges.operationId, opId)).orderBy(asc(scheduleChanges.changedAt));
}

export const _p = { lte, employees, d };
