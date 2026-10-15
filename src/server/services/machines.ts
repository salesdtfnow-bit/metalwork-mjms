import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  calendarExceptions,
  calendarShifts,
  downtimeEvents,
  downtimeReasons,
  employees,
  jobs,
  machineCapabilities,
  machineGroups,
  machineStatusEvents,
  machineTypes,
  machines,
  maintenancePlans,
  maintenanceWorkOrders,
  operations,
  operationTypes,
  timeEntries,
  users,
  workCalendars,
} from "../db/schema";
import { audit } from "../audit";
import { mutate, requirePermission, requireAnyPermission, type Ctx } from "../context";
import { conflict, invalid, notFound } from "../errors";
import { MACHINE_STATUS, type MachineStatus } from "@/lib/status";
import { zonedToUtc } from "@/lib/format";

export const machineInput = z.object({
  code: z.string().trim().min(1, "Machine ID is required.").max(20).transform((s) => s.toUpperCase()),
  name: z.string().trim().min(2, "Name is required."),
  machineTypeId: z.string().uuid("Select a machine type."),
  machineGroupId: z.string().uuid().nullish(),
  manufacturer: z.string().nullish(),
  model: z.string().nullish(),
  serialNumber: z.string().nullish(),
  yearOfManufacture: z.number().int().min(1900).max(2100).nullish(),
  controller: z.string().nullish(),
  axes: z.string().nullish(),
  capabilities: z.string().nullish(),
  workEnvelope: z.string().nullish(),
  maxWeightKg: z.string().nullish(),
  spindleSpeedMax: z.number().int().nullish(),
  permittedMaterials: z.string().nullish(),
  accessories: z.string().nullish(),
  location: z.string().nullish(),
  responsibleEmployeeId: z.string().uuid().nullish(),
  calendarId: z.string().uuid().nullish(),
  hourlyRate: z.string().nullish(),
  allowsConcurrent: z.boolean().default(false),
  safetyNotes: z.string().nullish(),
  setupRequirements: z.string().nullish(),
  customFields: z.record(z.string(), z.unknown()).default({}),
  operationTypeIds: z.array(z.string().uuid()).default([]),
});

/** Validates custom field values against the machine type's definitions. */
function validateCustomFields(defs: unknown, values: Record<string, unknown>) {
  const list = (Array.isArray(defs) ? defs : []) as { key: string; label: string; type: string }[];
  const out: Record<string, unknown> = {};
  for (const def of list) {
    const v = values[def.key];
    if (v === undefined || v === null || v === "") continue;
    if (def.type === "number" && Number.isNaN(Number(v))) throw invalid(`${def.label} must be a number.`, { field: `cf_${def.key}` });
    out[def.key] = def.type === "number" ? String(v) : def.type === "boolean" ? v === true || v === "on" || v === "true" : String(v);
  }
  return out;
}

export async function saveMachine(ctx: Ctx, raw: z.input<typeof machineInput>, id?: string) {
  requirePermission(ctx, "machines.manage");
  const data = machineInput.parse(raw);
  return mutate(ctx, async (tx) => {
    const [type] = await tx.db.select().from(machineTypes).where(eq(machineTypes.id, data.machineTypeId)).limit(1);
    if (!type) throw invalid("Unknown machine type.");
    const customFields = validateCustomFields(type.customFieldDefs, data.customFields);
    const { operationTypeIds, ...values } = { ...data, customFields };
    const [dup] = await tx.db.select({ id: machines.id }).from(machines).where(eq(machines.code, data.code)).limit(1);
    if (dup && dup.id !== id) throw conflict(`Machine ID ${data.code} is already used.`, { field: "code" });
    let m;
    if (id) {
      const [before] = await tx.db.select().from(machines).where(eq(machines.id, id)).limit(1);
      if (!before) throw notFound("Machine");
      [m] = await tx.db.update(machines).set(values).where(eq(machines.id, id)).returning();
      await audit(tx, { action: "machine.update", entityType: "machine", entityId: id, entityRef: m.code, before, after: data });
    } else {
      [m] = await tx.db.insert(machines).values(values).returning();
      await audit(tx, { action: "machine.create", entityType: "machine", entityId: m.id, entityRef: m.code, after: data });
    }
    await tx.db.delete(machineCapabilities).where(eq(machineCapabilities.machineId, m.id));
    if (operationTypeIds.length) await tx.db.insert(machineCapabilities).values(operationTypeIds.map((operationTypeId) => ({ machineId: m.id, operationTypeId })));
    return m;
  });
}

export async function setMachineActive(ctx: Ctx, id: string, active: boolean, reason: string) {
  requirePermission(ctx, "machines.manage");
  if (!reason?.trim()) throw invalid("A reason is required.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const [m] = await tx.db.update(machines).set({ isActive: active }).where(eq(machines.id, id)).returning();
    if (!m) throw notFound("Machine");
    await audit(tx, { action: active ? "machine.reactivate" : "machine.deactivate", entityType: "machine", entityId: id, entityRef: m.code, reason });
  });
}

/**
 * Manual status report (always labelled "manual" — never presented as live telemetry).
 */
export async function reportMachineStatus(ctx: Ctx, machineId: string, status: MachineStatus, reason?: string | null, operationId?: string | null) {
  requirePermission(ctx, "machines.report_status");
  if (!(status in MACHINE_STATUS)) throw invalid("Unknown machine status.");
  if (["blocked", "offline", "maintenance"].includes(status) && !reason?.trim()) throw invalid("Give a reason for this status.", { field: "reason" });
  return mutate(ctx, async (tx) => setMachineStatusInternal(tx, machineId, status, reason ?? null, operationId ?? null));
}

/** Internal (also used by production flows). */
export async function setMachineStatusInternal(ctx: Ctx, machineId: string, status: MachineStatus, reason: string | null, operationId: string | null) {
  const [m] = await ctx.db.select().from(machines).where(eq(machines.id, machineId)).limit(1);
  if (!m) throw notFound("Machine");
  if (m.currentStatus === status && !reason) return;
  await ctx.db.insert(machineStatusEvents).values({ machineId, status, source: "manual", reason, operationId, userId: ctx.actor.userId });
  await ctx.db.update(machines).set({ currentStatus: status, currentStatusSource: "manual", currentStatusAt: new Date(), currentStatusBy: ctx.actor.userId }).where(eq(machines.id, machineId));
  await audit(ctx, { action: "machine.status", entityType: "machine", entityId: machineId, entityRef: m.code, operationId, before: { status: m.currentStatus }, after: { status, source: "manual" }, reason });
}

// ───────────── Downtime ─────────────

export async function startDowntime(ctx: Ctx, input: { machineId: string; reasonId: string; operationId?: string | null; notes?: string | null; startedAt?: Date }) {
  requireAnyPermission(ctx, "machines.report_status", "production.execute");
  return mutate(ctx, async (tx) => {
    const [open] = await tx.db.select().from(downtimeEvents).where(and(eq(downtimeEvents.machineId, input.machineId), isNull(downtimeEvents.endedAt))).limit(1);
    if (open) throw invalid("There is already an open downtime record for this machine — end it first.");
    const [reason] = await tx.db.select().from(downtimeReasons).where(eq(downtimeReasons.id, input.reasonId)).limit(1);
    if (!reason) throw invalid("Select a downtime reason.", { field: "reasonId" });
    const [ev] = await tx.db
      .insert(downtimeEvents)
      .values({ machineId: input.machineId, reasonId: input.reasonId, operationId: input.operationId ?? null, notes: input.notes ?? null, startedAt: input.startedAt ?? new Date(), reportedBy: ctx.actor.userId })
      .returning();
    await setMachineStatusInternal(tx, input.machineId, reason.code === "PM" || reason.code === "BREAK" ? "maintenance" : "blocked", `${reason.name}${input.notes ? ` — ${input.notes}` : ""}`, input.operationId ?? null);
    await audit(tx, { action: "downtime.start", entityType: "machine", entityId: input.machineId, operationId: input.operationId, after: ev });
    return ev;
  });
}

export async function endDowntime(ctx: Ctx, downtimeId: string, notes?: string | null) {
  requireAnyPermission(ctx, "machines.report_status", "production.execute");
  return mutate(ctx, async (tx) => {
    const [ev] = await tx.db.select().from(downtimeEvents).where(eq(downtimeEvents.id, downtimeId)).limit(1);
    if (!ev || ev.endedAt) throw invalid("Downtime record is not open.");
    await tx.db.update(downtimeEvents).set({ endedAt: new Date(), notes: [ev.notes, notes].filter(Boolean).join(" | ") || null }).where(eq(downtimeEvents.id, downtimeId));
    await setMachineStatusInternal(tx, ev.machineId, "available", "Downtime ended", ev.operationId);
    await audit(tx, { action: "downtime.end", entityType: "machine", entityId: ev.machineId, operationId: ev.operationId, reason: notes });
  });
}

// ───────────── Calendars & available time ─────────────

export async function saveCalendar(ctx: Ctx, input: { id?: string; name: string; shifts: { dayOfWeek: number; startTime: string; endTime: string }[] }) {
  requirePermission(ctx, "admin.config");
  if (!input.name.trim()) throw invalid("Calendar name is required.");
  for (const s of input.shifts) if (!/^\d{2}:\d{2}$/.test(s.startTime) || !/^\d{2}:\d{2}$/.test(s.endTime) || s.endTime <= s.startTime) throw invalid("Each shift needs a valid start and end time (HH:MM), end after start.");
  return mutate(ctx, async (tx) => {
    const [cal] = input.id
      ? await tx.db.update(workCalendars).set({ name: input.name }).where(eq(workCalendars.id, input.id)).returning()
      : await tx.db.insert(workCalendars).values({ name: input.name }).returning();
    await tx.db.delete(calendarShifts).where(eq(calendarShifts.calendarId, cal.id));
    if (input.shifts.length) await tx.db.insert(calendarShifts).values(input.shifts.map((s) => ({ ...s, calendarId: cal.id })));
    await audit(tx, { action: "calendar.save", entityType: "calendar", entityId: cal.id, entityRef: cal.name, after: input });
    return cal;
  });
}

export async function addCalendarException(ctx: Ctx, calendarId: string, input: { date: string; isWorking: boolean; note?: string | null }) {
  requirePermission(ctx, "admin.config");
  return mutate(ctx, async (tx) => {
    await tx.db.insert(calendarExceptions).values({ calendarId, date: input.date, isWorking: input.isWorking, note: input.note ?? null });
    await audit(tx, { action: "calendar.exception_add", entityType: "calendar", entityId: calendarId, after: input });
  });
}

export type ShiftWindow = { start: Date; end: Date };

/**
 * Working windows of a calendar between two instants. Shift times are interpreted in the
 * company timezone. Without a calendar, a default 07:00–15:30 Mon–Fri day is assumed.
 */
export async function workingWindows(ctx: Ctx, calendarId: string | null, from: Date, to: Date, tz = "Europe/London"): Promise<ShiftWindow[]> {
  const shifts = calendarId
    ? await ctx.db.select().from(calendarShifts).where(eq(calendarShifts.calendarId, calendarId))
    : [1, 2, 3, 4, 5].map((dow) => ({ dayOfWeek: dow, startTime: "07:00:00", endTime: "15:30:00" }));
  const exceptions = calendarId ? await ctx.db.select().from(calendarExceptions).where(eq(calendarExceptions.calendarId, calendarId)) : [];
  const out: ShiftWindow[] = [];
  const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() - 1));
  while (day.getTime() <= to.getTime() + 86_400_000) {
    const iso = day.toISOString().slice(0, 10);
    const ex = exceptions.find((e) => e.date === iso);
    if (!ex || ex.isWorking) {
      const dow = day.getUTCDay();
      for (const s of shifts.filter((x) => x.dayOfWeek === dow)) {
        const start = zonedTime(iso, String(s.startTime).slice(0, 5), tz);
        const end = zonedTime(iso, String(s.endTime).slice(0, 5), tz);
        const a = new Date(Math.max(start.getTime(), from.getTime()));
        const b = new Date(Math.min(end.getTime(), to.getTime()));
        if (b > a) out.push({ start: a, end: b });
      }
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Converts a local wall-clock time on a date in `tz` to a UTC instant. */
export function zonedTime(dateIso: string, hhmm: string, tz: string): Date {
  return zonedToUtc(dateIso, hhmm, tz);
}

export function windowMinutes(ws: ShiftWindow[]) {
  return ws.reduce((acc, w) => acc + (w.end.getTime() - w.start.getTime()) / 60_000, 0);
}

/** Adds working minutes to a start instant following the calendar (for scheduling end times). */
export async function addWorkingMinutes(ctx: Ctx, calendarId: string | null, start: Date, minutes: number, tz?: string): Promise<Date> {
  let remaining = minutes;
  let cursor = start;
  for (let i = 0; i < 12 && remaining > 0; i++) {
    const ws = await workingWindows(ctx, calendarId, cursor, new Date(cursor.getTime() + 31 * 86_400_000), tz);
    for (const w of ws) {
      const a = w.start < cursor ? cursor : w.start;
      const avail = (w.end.getTime() - a.getTime()) / 60_000;
      if (avail <= 0) continue;
      if (avail >= remaining) return new Date(a.getTime() + remaining * 60_000);
      remaining -= avail;
      cursor = w.end;
    }
    cursor = new Date(cursor.getTime() + 31 * 86_400_000);
  }
  return new Date(start.getTime() + minutes * 60_000);
}

// ───────────── Queries & dashboards ─────────────

export async function listMachines(ctx: Ctx, opts: { includeInactive?: boolean } = {}) {
  requirePermission(ctx, "machines.view");
  const rows = await ctx.db
    .select({ m: machines, type: machineTypes.name, group: machineGroups.name })
    .from(machines)
    .innerJoin(machineTypes, eq(machineTypes.id, machines.machineTypeId))
    .leftJoin(machineGroups, eq(machineGroups.id, machines.machineGroupId))
    .where(opts.includeInactive ? undefined : eq(machines.isActive, true))
    .orderBy(asc(machines.code));
  const current = rows.length
    ? await ctx.db
        .select({ op: operations, jobNumber: jobs.jobNumber })
        .from(operations)
        .innerJoin(jobs, eq(jobs.id, operations.jobId))
        .where(and(inArray(operations.machineId, rows.map((r) => r.m.id)), inArray(operations.status, ["in_setup", "awaiting_first_off", "in_production"])))
    : [];
  const queue = rows.length
    ? await ctx.db
        .select({ machineId: operations.machineId, n: sql<number>`count(*)::int` })
        .from(operations)
        .where(and(inArray(operations.machineId, rows.map((r) => r.m.id)), inArray(operations.status, ["pending", "ready", "paused"])))
        .groupBy(operations.machineId)
    : [];
  const lockouts = await activeMaintenanceLocks(ctx, rows.map((r) => r.m.id));
  return rows.map((r) => ({
    ...r,
    current: current.filter((c) => c.op.machineId === r.m.id),
    queued: queue.find((q) => q.machineId === r.m.id)?.n ?? 0,
    maintenanceLock: lockouts.find((l) => l.machineId === r.m.id) ?? null,
  }));
}

/** Work orders that currently lock a machine (in progress, or scheduled window covering now). */
export async function activeMaintenanceLocks(ctx: Ctx, machineIds: string[], at = new Date()) {
  if (!machineIds.length) return [];
  return ctx.db
    .select()
    .from(maintenanceWorkOrders)
    .where(
      and(
        inArray(maintenanceWorkOrders.machineId, machineIds),
        eq(maintenanceWorkOrders.locksMachine, true),
        or(
          eq(maintenanceWorkOrders.status, "in_progress"),
          and(eq(maintenanceWorkOrders.status, "scheduled"), lte(maintenanceWorkOrders.scheduledStart, at), gte(maintenanceWorkOrders.scheduledEnd, at)),
        ),
      ),
    );
}

/** Machine dashboard data: current work, queue, history, downtime, maintenance, utilisation. */
export async function machineDashboard(ctx: Ctx, machineId: string, range: { from: Date; to: Date }) {
  requirePermission(ctx, "machines.view");
  const [row] = await ctx.db
    .select({ m: machines, type: machineTypes, responsible: employees })
    .from(machines)
    .innerJoin(machineTypes, eq(machineTypes.id, machines.machineTypeId))
    .leftJoin(employees, eq(employees.id, machines.responsibleEmployeeId))
    .where(eq(machines.id, machineId))
    .limit(1);
  if (!row) throw notFound("Machine");
  const opsQ = (statuses: string[]) =>
    ctx.db
      .select({ op: operations, job: jobs, type: operationTypes.name })
      .from(operations)
      .innerJoin(jobs, eq(jobs.id, operations.jobId))
      .innerJoin(operationTypes, eq(operationTypes.id, operations.operationTypeId))
      .where(and(eq(operations.machineId, machineId), inArray(operations.status, statuses)))
      .orderBy(sql`${operations.plannedStart} asc nulls last`, asc(jobs.priority), sql`${jobs.requiredDate} asc nulls last`);
  const [active, queue, onHold, completed, caps, statusLog, downtime, plans, wos, entries] = await Promise.all([
    opsQ(["in_setup", "awaiting_first_off", "in_production"]),
    opsQ(["pending", "ready", "paused", "awaiting_inspection"]),
    opsQ(["on_hold"]),
    ctx.db
      .select({ op: operations, job: jobs, type: operationTypes.name })
      .from(operations)
      .innerJoin(jobs, eq(jobs.id, operations.jobId))
      .innerJoin(operationTypes, eq(operationTypes.id, operations.operationTypeId))
      .where(and(eq(operations.machineId, machineId), eq(operations.status, "complete")))
      .orderBy(desc(operations.actualEnd))
      .limit(30),
    ctx.db.select({ id: operationTypes.id, name: operationTypes.name, code: operationTypes.code }).from(machineCapabilities).innerJoin(operationTypes, eq(operationTypes.id, machineCapabilities.operationTypeId)).where(eq(machineCapabilities.machineId, machineId)),
    ctx.db.select({ e: machineStatusEvents, user: users.name }).from(machineStatusEvents).leftJoin(users, eq(users.id, machineStatusEvents.userId)).where(eq(machineStatusEvents.machineId, machineId)).orderBy(desc(machineStatusEvents.at)).limit(50),
    ctx.db.select({ d: downtimeEvents, reason: downtimeReasons.name, category: downtimeReasons.category }).from(downtimeEvents).innerJoin(downtimeReasons, eq(downtimeReasons.id, downtimeEvents.reasonId)).where(eq(downtimeEvents.machineId, machineId)).orderBy(desc(downtimeEvents.startedAt)).limit(50),
    ctx.db.select().from(maintenancePlans).where(and(eq(maintenancePlans.machineId, machineId), eq(maintenancePlans.isActive, true))),
    ctx.db.select().from(maintenanceWorkOrders).where(eq(maintenanceWorkOrders.machineId, machineId)).orderBy(desc(maintenanceWorkOrders.reportedAt)).limit(20),
    ctx.db.select().from(timeEntries).where(and(eq(timeEntries.machineId, machineId), gte(timeEntries.startedAt, range.from), lte(timeEntries.startedAt, range.to))),
  ]);
  const currentOperators = active.length
    ? await ctx.db
        .select({ name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`, operationId: timeEntries.operationId })
        .from(timeEntries)
        .innerJoin(employees, eq(employees.id, timeEntries.employeeId))
        .where(and(inArray(timeEntries.operationId, active.map((a) => a.op.id)), isNull(timeEntries.endedAt)))
    : [];
  const util = await machineUtilisation(ctx, machineId, row.m.calendarId, range, entries);
  return { ...row, active, queue, onHold, completed, capabilities: caps, statusLog, downtime, plans, workOrders: wos, utilisation: util, currentOperators };
}

/**
 * Utilisation = recorded setup + production time on the machine ÷ available production time
 * from the machine's working calendar (minus planned-maintenance downtime). Calendar hours
 * outside shifts are NOT counted as available time.
 */
export async function machineUtilisation(
  ctx: Ctx,
  machineId: string,
  calendarId: string | null,
  range: { from: Date; to: Date },
  entries?: (typeof timeEntries.$inferSelect)[],
) {
  const es = entries ?? (await ctx.db.select().from(timeEntries).where(and(eq(timeEntries.machineId, machineId), gte(timeEntries.startedAt, range.from), lte(timeEntries.startedAt, range.to))));
  const now = new Date();
  const runMinutes = es
    .filter((e) => ["setup", "production", "rework"].includes(e.kind))
    .reduce((acc, e) => acc + ((e.endedAt ?? now).getTime() - e.startedAt.getTime()) / 60_000, 0);
  const windows = await workingWindows(ctx, calendarId, range.from, new Date(Math.min(range.to.getTime(), now.getTime())));
  const planned = await ctx.db
    .select({ d: downtimeEvents })
    .from(downtimeEvents)
    .innerJoin(downtimeReasons, eq(downtimeReasons.id, downtimeEvents.reasonId))
    .where(and(eq(downtimeEvents.machineId, machineId), eq(downtimeReasons.category, "planned"), gte(downtimeEvents.startedAt, range.from)));
  const plannedMinutes = planned.reduce((acc, { d }) => acc + ((d.endedAt ?? now).getTime() - d.startedAt.getTime()) / 60_000, 0);
  const available = Math.max(0, windowMinutes(windows) - plannedMinutes);
  return {
    runMinutes: Math.round(runMinutes),
    availableMinutes: Math.round(available),
    utilisationPct: available > 0 ? Math.round((runMinutes / available) * 1000) / 10 : null,
    definition: "Recorded setup + production time ÷ available shift time from the machine calendar, less planned maintenance.",
  };
}

export async function machineTypesList(ctx: Ctx) {
  return ctx.db.select().from(machineTypes).orderBy(asc(machineTypes.name));
}
export async function machineGroupsList(ctx: Ctx) {
  return ctx.db.select().from(machineGroups).orderBy(asc(machineGroups.code));
}
export async function downtimeReasonsList(ctx: Ctx) {
  return ctx.db.select().from(downtimeReasons).where(eq(downtimeReasons.isActive, true)).orderBy(asc(downtimeReasons.name));
}
export async function calendarsList(ctx: Ctx) {
  const cals = await ctx.db.select().from(workCalendars).orderBy(asc(workCalendars.name));
  const shifts = await ctx.db.select().from(calendarShifts);
  return cals.map((c) => ({ ...c, shifts: shifts.filter((s) => s.calendarId === c.id) }));
}

export async function saveMachineType(ctx: Ctx, input: { id?: string; code: string; name: string; customFieldDefs: { key: string; label: string; type: string; unit?: string }[] }) {
  requirePermission(ctx, "admin.config");
  for (const f of input.customFieldDefs) {
    if (!/^[a-z][a-z0-9_]*$/.test(f.key)) throw invalid(`Custom field key "${f.key}" must be lower-case letters, digits or underscores.`);
    if (!["text", "number", "boolean", "date"].includes(f.type)) throw invalid(`Unsupported field type ${f.type}.`);
  }
  return mutate(ctx, async (tx) => {
    const values = { code: input.code.trim().toUpperCase(), name: input.name.trim(), customFieldDefs: input.customFieldDefs };
    const [t] = input.id ? await tx.db.update(machineTypes).set(values).where(eq(machineTypes.id, input.id)).returning() : await tx.db.insert(machineTypes).values(values).returning();
    await audit(tx, { action: "machine_type.save", entityType: "machine_type", entityId: t.id, entityRef: t.code, after: values });
    return t;
  });
}

export async function saveMachineGroup(ctx: Ctx, input: { code: string; name: string; description?: string | null }) {
  requirePermission(ctx, "machines.manage");
  return mutate(ctx, async (tx) => {
    const [g] = await tx.db.insert(machineGroups).values({ code: input.code.trim().toUpperCase(), name: input.name.trim(), description: input.description ?? null }).returning();
    await audit(tx, { action: "machine_group.create", entityType: "machine_group", entityId: g.id, entityRef: g.code });
    return g;
  });
}

