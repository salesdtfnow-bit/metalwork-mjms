"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/server/action";
import { f } from "@/server/forms";
import { can } from "@/server/context";
import { endDowntime, machineDashboard, reportMachineStatus, saveMachine, saveMachineGroup, setMachineActive, startDowntime } from "@/server/services/machines";
import { MACHINE_STATUS, type MachineStatus } from "@/lib/status";

const machineForm = z.object({
  code: f.str("Machine ID is required."),
  name: f.str("Name is required."),
  machineTypeId: f.uuid("Select a machine type."),
  machineGroupId: f.optUuid(),
  manufacturer: f.optStr(),
  model: f.optStr(),
  serialNumber: f.optStr(),
  yearOfManufacture: f.optInt(),
  controller: f.optStr(),
  axes: f.optStr(),
  capabilities: f.optStr(),
  workEnvelope: f.optStr(),
  maxWeightKg: f.optDec(),
  spindleSpeedMax: f.optInt(),
  permittedMaterials: f.optStr(),
  accessories: f.optStr(),
  location: f.optStr(),
  responsibleEmployeeId: f.optUuid(),
  calendarId: f.optUuid(),
  hourlyRate: f.optDec(),
  allowsConcurrent: f.bool(),
  safetyNotes: f.optStr(),
  setupRequirements: f.optStr(),
  operationTypeIds: f.uuids(),
});

/** Custom field inputs are named cf_<key> (definitions come from the machine type). */
function customFieldsFrom(fd: FormData) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("cf_") && typeof v === "string") out[k.slice(3)] = v;
  return out;
}

export const createMachineAction = action("machine.create", machineForm, async (ctx, input, fd) => {
  const m = await saveMachine(ctx, { ...input, customFields: customFieldsFrom(fd) });
  redirect(`/machines/${m.id}`);
});

export const updateMachineAction = action(
  "machine.update",
  machineForm.extend({ id: f.uuid() }),
  async (ctx, { id, ...input }, fd) => {
    let hourlyRate = input.hourlyRate;
    // Users who cannot see commercial values are not shown the rate field — keep the stored value.
    if (!fd.has("hourlyRate") || !can(ctx.actor, "jobs.view_commercial")) {
      const now = new Date();
      hourlyRate = (await machineDashboard(ctx, id, { from: now, to: now })).m.hourlyRate;
    }
    await saveMachine(ctx, { ...input, hourlyRate, customFields: customFieldsFrom(fd) }, id);
    return "Machine details saved.";
  },
  { revalidate: (i) => [`/machines/${i.id}`, "/machines"] },
);

export const setMachineActiveAction = action(
  "machine.active",
  z.object({ id: f.uuid(), active: f.bool(), reason: f.str("A reason is required.") }),
  async (ctx, i) => {
    await setMachineActive(ctx, i.id, i.active, i.reason);
    return i.active ? "Machine reactivated." : "Machine deactivated.";
  },
  { revalidate: (i) => [`/machines/${i.id}`, "/machines"] },
);

export const reportStatusAction = action(
  "machine.report_status",
  z.object({ id: f.uuid(), status: f.enumOf(Object.keys(MACHINE_STATUS) as [MachineStatus, ...MachineStatus[]]), reason: f.optStr() }),
  async (ctx, i) => {
    await reportMachineStatus(ctx, i.id, i.status, i.reason);
    return `Status reported as "${MACHINE_STATUS[i.status].label}" (manual).`;
  },
  { revalidate: (i) => [`/machines/${i.id}`, "/machines"] },
);

export const machineStartDowntimeAction = action(
  "machine.downtime_start",
  z.object({ id: f.uuid(), reasonId: f.uuid("Select a downtime reason."), notes: f.optStr() }),
  async (ctx, i) => {
    await startDowntime(ctx, { machineId: i.id, reasonId: i.reasonId, notes: i.notes });
    return "Downtime started.";
  },
  { revalidate: (i) => [`/machines/${i.id}`, "/machines"] },
);

export const machineEndDowntimeAction = action(
  "machine.downtime_end",
  z.object({ id: f.uuid(), downtimeId: f.uuid(), notes: f.optStr() }),
  async (ctx, i) => {
    await endDowntime(ctx, i.downtimeId, i.notes);
    return "Downtime ended. Machine reported available.";
  },
  { revalidate: (i) => [`/machines/${i.id}`, "/machines"] },
);

export const createMachineGroupAction = action(
  "machine_group.create",
  z.object({ code: f.str("Code is required."), name: f.str("Name is required."), description: f.optStr() }),
  async (ctx, i) => {
    const g = await saveMachineGroup(ctx, i);
    return `Machine group ${g.code} created.`;
  },
  { revalidate: ["/machines/new", "/machines"] },
);
