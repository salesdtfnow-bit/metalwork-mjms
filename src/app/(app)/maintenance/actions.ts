"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/server/action";
import { f } from "@/server/forms";
import { cancelWorkOrder, completeWorkOrder, raiseWorkOrder, saveMaintenancePlan, setMaintenancePlanActive, startWorkOrder } from "@/server/services/maintenance";
import { dtField } from "../planning/_components/parse";

export const raiseWorkOrderAction = action(
  "maintenance.raise",
  z.object({
    machineId: f.uuid("Select the machine."),
    planId: f.optUuid(),
    kind: f.enumOf(["preventive", "breakdown", "corrective", "inspection", "calibration"] as const),
    priority: f.int({ min: 1, max: 4 }),
    title: f.str("Give the work order a title."),
    description: f.optStr(),
    scheduledStart: dtField.opt(),
    scheduledEnd: dtField.opt(),
    locksMachine: f.bool(),
    serviceProviderId: f.optUuid(),
  }),
  async (ctx, input) => {
    const wo = await raiseWorkOrder(ctx, input);
    redirect(`/maintenance/${wo.id}`);
  },
);

export const savePlanAction = action(
  "maintenance.plan",
  z.object({
    id: f.optUuid(),
    machineId: f.uuid("Select the machine."),
    title: f.str("Give the plan a title."),
    intervalDays: f.int({ min: 1, max: 3650 }),
    checklist: f.optStr(),
    estimatedHours: f.optDec({ min: 0 }),
    responsibleEmployeeId: f.optUuid(),
    serviceProviderId: f.optUuid(),
    lastDoneOn: f.optDate(),
  }),
  async (ctx, { id, ...input }) => {
    await saveMaintenancePlan(ctx, input, id ?? undefined);
    return id ? "Maintenance plan saved." : "Maintenance plan created. The next due date is calculated from the interval.";
  },
  { revalidate: "/maintenance" },
);

export const startWorkOrderAction = action(
  "maintenance.start",
  z.object({ id: f.uuid() }),
  async (ctx, { id }) => {
    await startWorkOrder(ctx, id);
    return "Work order started.";
  },
  { revalidate: (i) => [`/maintenance/${i.id}`, "/maintenance", "/planning"] },
);

export const completeWorkOrderAction = action(
  "maintenance.complete",
  z.object({ id: f.uuid(), findings: f.str("Record the work done / findings."), cost: f.optDec({ min: 0 }), returnToService: f.bool(), report: f.file() }),
  async (ctx, { id, findings, cost, returnToService, report }) => {
    await completeWorkOrder(ctx, id, { findings, cost, returnToService }, report ?? null);
    return returnToService ? "Work order completed and the machine returned to service." : "Work order completed. The machine status was not changed.";
  },
  { revalidate: (i) => [`/maintenance/${i.id}`, "/maintenance", "/planning"] },
);

export const cancelWorkOrderAction = action(
  "maintenance.cancel",
  z.object({ id: f.uuid(), reason: f.str("Give a reason for cancelling.") }),
  async (ctx, { id, reason }) => {
    await cancelWorkOrder(ctx, id, reason);
    return "Work order cancelled.";
  },
  { revalidate: (i) => [`/maintenance/${i.id}`, "/maintenance", "/planning"] },
);

export const setPlanActiveAction = action(
  "maintenance.plan_active",
  z.object({ id: f.uuid(), active: f.bool(), reason: f.str("Give a reason.") }),
  async (ctx, { id, active, reason }) => {
    await setMaintenancePlanActive(ctx, id, active, reason);
    return active ? "Plan reactivated." : "Plan deactivated. No further preventive work orders will be raised from it.";
  },
  { revalidate: "/maintenance" },
);
