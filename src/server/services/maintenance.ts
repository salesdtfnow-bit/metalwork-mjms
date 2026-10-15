import { and, asc, desc, eq, inArray, lte, notInArray } from "drizzle-orm";
import { z } from "zod";
import { machines, maintenancePlans, maintenanceWorkOrders, suppliers, users, measuringInstruments } from "../db/schema";
import { audit } from "../audit";
import { mutate, requirePermission, type Ctx } from "../context";
import { invalid, notFound } from "../errors";
import { nextRef, REF } from "../refs";
import { addDaysISO, todayISO } from "@/lib/format";
import { storeUpload } from "../storage";
import { setMachineStatusInternal } from "./machines";
import { notify } from "./notifications";

export const planInput = z.object({
  machineId: z.string().uuid(),
  title: z.string().trim().min(2),
  intervalDays: z.number().int().min(1).max(3650),
  checklist: z.string().nullish(),
  estimatedHours: z.string().nullish(),
  responsibleEmployeeId: z.string().uuid().nullish(),
  serviceProviderId: z.string().uuid().nullish(),
  lastDoneOn: z.string().nullish(),
});

export async function saveMaintenancePlan(ctx: Ctx, raw: z.input<typeof planInput>, id?: string) {
  requirePermission(ctx, "maintenance.manage");
  const data = planInput.parse(raw);
  return mutate(ctx, async (tx) => {
    const nextDueOn = data.lastDoneOn ? addDaysISO(data.lastDoneOn, data.intervalDays) : addDaysISO(todayISO(), data.intervalDays);
    const values = { ...data, lastDoneOn: data.lastDoneOn || null, nextDueOn };
    const [p] = id ? await tx.db.update(maintenancePlans).set(values).where(eq(maintenancePlans.id, id)).returning() : await tx.db.insert(maintenancePlans).values(values).returning();
    await audit(tx, { action: id ? "maintenance_plan.update" : "maintenance_plan.create", entityType: "machine", entityId: data.machineId, entityRef: p.title, after: values });
    return p;
  });
}

export const workOrderInput = z.object({
  machineId: z.string().uuid("Select the machine."),
  planId: z.string().uuid().nullish(),
  kind: z.enum(["preventive", "breakdown", "corrective", "inspection", "calibration"]),
  priority: z.number().int().min(1).max(4).default(3),
  title: z.string().trim().min(3),
  description: z.string().nullish(),
  scheduledStart: z.coerce.date().nullish(),
  scheduledEnd: z.coerce.date().nullish(),
  locksMachine: z.boolean().default(true),
  serviceProviderId: z.string().uuid().nullish(),
});

/** Raises a work order. Breakdowns take the machine out of service immediately (manual status). */
export async function raiseWorkOrder(ctx: Ctx, raw: z.input<typeof workOrderInput>) {
  requirePermission(ctx, "maintenance.manage");
  const data = workOrderInput.parse(raw);
  if (data.scheduledStart && data.scheduledEnd && data.scheduledEnd <= data.scheduledStart) throw invalid("End must be after start.", { field: "scheduledEnd" });
  return mutate(ctx, async (tx) => {
    const ref = await nextRef(tx.db, REF.maintenance);
    const status = data.kind === "breakdown" ? "in_progress" : data.scheduledStart ? "scheduled" : "open";
    const [wo] = await tx.db.insert(maintenanceWorkOrders).values({ ...data, ref, status, reportedBy: ctx.actor.userId, startedAt: data.kind === "breakdown" ? new Date() : null }).returning();
    if (data.kind === "breakdown") await setMachineStatusInternal(tx, data.machineId, "maintenance", `Breakdown ${ref}: ${data.title}`, null);
    await audit(tx, { action: "maintenance.raise", entityType: "maintenance_work_order", entityId: wo.id, entityRef: ref, after: data });
    await notify(tx, { type: "maintenance.due", title: `${data.kind === "breakdown" ? "Breakdown" : "Maintenance"} ${ref}: ${data.title}`, link: `/maintenance/${wo.id}`, permission: "maintenance.manage", excludeActor: true, dedupeKey: `mwo:${wo.id}` });
    return wo;
  });
}

export async function startWorkOrder(ctx: Ctx, id: string) {
  requirePermission(ctx, "maintenance.manage");
  return mutate(ctx, async (tx) => {
    const [wo] = await tx.db.select().from(maintenanceWorkOrders).where(eq(maintenanceWorkOrders.id, id)).limit(1);
    if (!wo || !["open", "scheduled"].includes(wo.status)) throw invalid("Work order cannot be started.");
    await tx.db.update(maintenanceWorkOrders).set({ status: "in_progress", startedAt: new Date() }).where(eq(maintenanceWorkOrders.id, id));
    if (wo.locksMachine) await setMachineStatusInternal(tx, wo.machineId, "maintenance", `${wo.ref}: ${wo.title}`, null);
    await audit(tx, { action: "maintenance.start", entityType: "maintenance_work_order", entityId: id, entityRef: wo.ref });
  });
}

export async function completeWorkOrder(ctx: Ctx, id: string, input: { findings: string; cost?: string | null; returnToService: boolean }, report?: File | null) {
  requirePermission(ctx, "maintenance.manage");
  if (!input.findings?.trim()) throw invalid("Record the work done / findings.", { field: "findings" });
  return mutate(ctx, async (tx) => {
    const [wo] = await tx.db.select().from(maintenanceWorkOrders).where(eq(maintenanceWorkOrders.id, id)).limit(1);
    if (!wo || ["completed", "cancelled"].includes(wo.status)) throw invalid("Work order is not open.");
    const fileId = report && report.size ? (await storeUpload(tx.db, report, ctx.actor.userId)).id : null;
    await tx.db.update(maintenanceWorkOrders).set({ status: "completed", completedAt: new Date(), completedBy: ctx.actor.userId, findings: input.findings, cost: input.cost || null, reportFileId: fileId }).where(eq(maintenanceWorkOrders.id, id));
    if (wo.planId) {
      const [plan] = await tx.db.select().from(maintenancePlans).where(eq(maintenancePlans.id, wo.planId));
      await tx.db.update(maintenancePlans).set({ lastDoneOn: todayISO(), nextDueOn: addDaysISO(todayISO(), plan.intervalDays) }).where(eq(maintenancePlans.id, wo.planId));
    }
    if (input.returnToService) await setMachineStatusInternal(tx, wo.machineId, "available", `Returned to service after ${wo.ref}`, null);
    await audit(tx, { action: "maintenance.complete", entityType: "maintenance_work_order", entityId: id, entityRef: wo.ref, after: input });
  });
}

/** Scheduled: raise preventive work orders for plans falling due within `daysAhead`. Idempotent. */
export async function raiseDuePreventiveWork(ctx: Ctx, daysAhead = 7) {
  const due = await ctx.db.select().from(maintenancePlans).where(and(eq(maintenancePlans.isActive, true), lte(maintenancePlans.nextDueOn, addDaysISO(todayISO(), daysAhead))));
  let raised = 0;
  for (const p of due) {
    const open = await ctx.db.select().from(maintenanceWorkOrders).where(and(eq(maintenanceWorkOrders.planId, p.id), notInArray(maintenanceWorkOrders.status, ["completed", "cancelled"]))).limit(1);
    if (open.length) continue;
    await mutate(ctx, async (tx) => {
      const ref = await nextRef(tx.db, REF.maintenance);
      await tx.db.insert(maintenanceWorkOrders).values({ ref, machineId: p.machineId, planId: p.id, kind: "preventive", title: p.title, description: p.checklist, reportedBy: ctx.actor.userId, locksMachine: true });
      await audit(tx, { action: "maintenance.auto_raise", entityType: "maintenance_work_order", entityRef: ref, after: { plan: p.title, due: p.nextDueOn } });
      await notify(tx, { type: "maintenance.due", title: `Preventive maintenance due: ${p.title} (${p.nextDueOn})`, link: `/maintenance`, permission: "maintenance.manage", dedupeKey: `pm:${p.id}:${p.nextDueOn}` });
    });
    raised++;
  }
  return raised;
}

export async function listWorkOrders(ctx: Ctx, opts: { open?: boolean; machineId?: string } = {}) {
  requirePermission(ctx, "maintenance.view");
  return ctx.db
    .select({ wo: maintenanceWorkOrders, machine: machines.code, machineName: machines.name, provider: suppliers.name, reportedBy: users.name })
    .from(maintenanceWorkOrders)
    .innerJoin(machines, eq(machines.id, maintenanceWorkOrders.machineId))
    .leftJoin(suppliers, eq(suppliers.id, maintenanceWorkOrders.serviceProviderId))
    .leftJoin(users, eq(users.id, maintenanceWorkOrders.reportedBy))
    .where(and(opts.open ? notInArray(maintenanceWorkOrders.status, ["completed", "cancelled"]) : undefined, opts.machineId ? eq(maintenanceWorkOrders.machineId, opts.machineId) : undefined))
    .orderBy(asc(maintenanceWorkOrders.priority), desc(maintenanceWorkOrders.reportedAt))
    .limit(300);
}

export async function listMaintenancePlans(ctx: Ctx) {
  requirePermission(ctx, "maintenance.view");
  return ctx.db.select({ p: maintenancePlans, machine: machines.code }).from(maintenancePlans).innerJoin(machines, eq(machines.id, maintenancePlans.machineId)).where(eq(maintenancePlans.isActive, true)).orderBy(asc(maintenancePlans.nextDueOn));
}

export async function getWorkOrder(ctx: Ctx, id: string) {
  requirePermission(ctx, "maintenance.view");
  const [row] = await ctx.db.select({ wo: maintenanceWorkOrders, machine: machines }).from(maintenanceWorkOrders).innerJoin(machines, eq(machines.id, maintenanceWorkOrders.machineId)).where(eq(maintenanceWorkOrders.id, id)).limit(1);
  if (!row) throw notFound("Work order");
  return row;
}

/** Instruments with calibration due in `days` (or overdue). */
export async function calibrationDue(ctx: Ctx, days = 30) {
  return ctx.db.select().from(measuringInstruments).where(and(eq(measuringInstruments.calibrationRequired, true), lte(measuringInstruments.calibrationDueOn, addDaysISO(todayISO(), days)), inArray(measuringInstruments.status, ["in_service", "out_of_calibration"]))).orderBy(asc(measuringInstruments.calibrationDueOn));
}
