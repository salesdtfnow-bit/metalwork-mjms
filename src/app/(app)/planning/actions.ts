"use server";

import { z } from "zod";
import { action } from "@/server/action";
import { f } from "@/server/forms";
import { requirePermission } from "@/server/context";
import { checkSchedule, scheduleOperation, unscheduleOperation } from "@/server/services/planning";
import { fmtDateTime } from "@/lib/format";
import { dtField } from "./_components/parse";

const placement = z.object({
  opId: f.uuid("Choose an operation."),
  machineId: f.uuid("Select the machine."),
  start: dtField.req("Enter the planned start."),
});

export type ScheduleCheckData = { errors: string[]; warnings: string[]; plannedEnd: string | null };

/** Dry run: validates a proposed placement without changing anything (used by the board). */
export const checkScheduleAction = action("planning.check", placement, async (ctx, i) => {
  requirePermission(ctx, "planning.schedule");
  const c = await checkSchedule(ctx, i.opId, i.machineId, i.start);
  const data: ScheduleCheckData = { errors: c.errors, warnings: c.warnings, plannedEnd: c.plannedEnd ? c.plannedEnd.toISOString() : null };
  return { ok: true, data };
});

export const scheduleOperationAction = action(
  "planning.schedule",
  placement.extend({ reason: f.optStr() }),
  async (ctx, i) => {
    const c = await scheduleOperation(ctx, i.opId, { machineId: i.machineId, start: i.start, reason: i.reason });
    const end = c.plannedEnd ? ` Planned finish ${fmtDateTime(c.plannedEnd)}.` : "";
    const warn = c.warnings.length ? ` Warnings: ${c.warnings.join(" ")}` : "";
    return `Operation scheduled for ${fmtDateTime(i.start)}.${end}${warn}`;
  },
  { revalidate: "/planning" },
);

export const unscheduleOperationAction = action(
  "planning.unschedule",
  z.object({ opId: f.uuid(), reason: f.str("Give a reason for removing the operation from the schedule.") }),
  async (ctx, i) => {
    await unscheduleOperation(ctx, i.opId, i.reason);
    return "Operation removed from the schedule.";
  },
  { revalidate: "/planning" },
);
