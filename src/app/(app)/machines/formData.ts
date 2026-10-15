import "server-only";
import type { Ctx } from "@/server/context";
import { calendarsList, machineGroupsList, machineTypesList } from "@/server/services/machines";
import { operationTypesList } from "@/server/services/routing";
import { employeeOptions } from "@/server/services/ui/shopfloor";

/** Option lists for the machine form (shared by the create page and the edit panel). */
export async function machineFormOptions(ctx: Ctx) {
  const [types, groups, calendars, opTypes, employees] = await Promise.all([machineTypesList(ctx), machineGroupsList(ctx), calendarsList(ctx), operationTypesList(ctx), employeeOptions(ctx)]);
  return {
    types: types.map((t) => ({ id: t.id, code: t.code, name: t.name, customFieldDefs: t.customFieldDefs })),
    groups: groups.map((g) => ({ value: g.id, label: `${g.name} (${g.code})` })),
    calendars: calendars.map((c) => ({ value: c.id, label: c.name })),
    operationTypes: opTypes.map((o) => ({ value: o.id, label: o.name })),
    employees,
  };
}
