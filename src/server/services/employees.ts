import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  competencies,
  employeeCompetencies,
  employees,
  jobs,
  machineTypes,
  machines,
  operationAssignments,
  operations,
  operationTypes,
  timeEntries,
  trainingRecords,
  users,
} from "../db/schema";
import { audit } from "../audit";
import { mutate, requirePermission, requireAnyPermission, type Ctx } from "../context";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { storeUpload } from "../storage";
import { todayISO } from "@/lib/format";

export const employeeInput = z.object({
  employeeNo: z.string().trim().min(1, "Employee ID is required."),
  firstName: z.string().trim().min(1, "First name is required."),
  lastName: z.string().trim().min(1, "Last name is required."),
  email: z.string().trim().email().nullish().or(z.literal("").transform(() => null)),
  phone: z.string().nullish(),
  jobTitle: z.string().nullish(),
  department: z.string().nullish(),
  supervisorId: z.string().uuid().nullish(),
  calendarId: z.string().uuid().nullish(),
  shift: z.string().nullish(),
  badgeCode: z.string().nullish(),
  startDate: z.string().nullish(),
  notes: z.string().nullish(),
});

export async function saveEmployee(ctx: Ctx, raw: z.input<typeof employeeInput>, id?: string) {
  requirePermission(ctx, "employees.manage");
  const data = employeeInput.parse(raw);
  return mutate(ctx, async (tx) => {
    const [dup] = await tx.db.select({ id: employees.id }).from(employees).where(eq(employees.employeeNo, data.employeeNo)).limit(1);
    if (dup && dup.id !== id) throw conflict(`Employee ID ${data.employeeNo} is already used.`, { field: "employeeNo" });
    if (id && data.supervisorId === id) throw invalid("An employee cannot supervise themselves.", { field: "supervisorId" });
    const values = { ...data, startDate: data.startDate || null };
    if (id) {
      const [before] = await tx.db.select().from(employees).where(eq(employees.id, id)).limit(1);
      if (!before) throw notFound("Employee");
      const [e] = await tx.db.update(employees).set(values).where(eq(employees.id, id)).returning();
      await audit(tx, { action: "employee.update", entityType: "employee", entityId: id, entityRef: e.employeeNo, before, after: data });
      return e;
    }
    const [e] = await tx.db.insert(employees).values(values).returning();
    await audit(tx, { action: "employee.create", entityType: "employee", entityId: e.id, entityRef: e.employeeNo, after: data });
    return e;
  });
}

export async function setEmployeeActive(ctx: Ctx, id: string, active: boolean, reason: string) {
  requirePermission(ctx, "employees.manage");
  if (!reason?.trim()) throw invalid("A reason is required.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const [e] = await tx.db.update(employees).set({ isActive: active, leftDate: active ? null : todayISO() }).where(eq(employees.id, id)).returning();
    if (!e) throw notFound("Employee");
    if (!active) {
      // End open assignments on unstarted operations.
      const open = await tx.db
        .select({ a: operationAssignments })
        .from(operationAssignments)
        .innerJoin(operations, eq(operations.id, operationAssignments.operationId))
        .where(and(eq(operationAssignments.employeeId, id), eq(operationAssignments.isActive, true), inArray(operations.status, ["pending", "ready"])));
      if (open.length) await tx.db.update(operationAssignments).set({ isActive: false, unassignedAt: new Date() }).where(inArray(operationAssignments.id, open.map((o) => o.a.id)));
    }
    await audit(tx, { action: active ? "employee.reactivate" : "employee.deactivate", entityType: "employee", entityId: id, entityRef: e.employeeNo, reason });
  });
}

// ───────────── Competencies ─────────────

export const competencyInput = z.object({
  code: z.string().trim().min(2).max(30).transform((s) => s.toUpperCase()),
  name: z.string().trim().min(2),
  description: z.string().nullish(),
  operationTypeId: z.string().uuid().nullish(),
  machineTypeId: z.string().uuid().nullish(),
  machineId: z.string().uuid().nullish(),
  requiresExpiry: z.boolean().default(false),
  validityMonths: z.number().int().min(1).max(120).nullish(),
});

export async function saveCompetency(ctx: Ctx, raw: z.input<typeof competencyInput>, id?: string) {
  requirePermission(ctx, "admin.config");
  const data = competencyInput.parse(raw);
  if (data.requiresExpiry && !data.validityMonths) throw invalid("Set a validity period for competencies that expire.", { field: "validityMonths" });
  return mutate(ctx, async (tx) => {
    const [c] = id ? await tx.db.update(competencies).set(data).where(eq(competencies.id, id)).returning() : await tx.db.insert(competencies).values(data).returning();
    await audit(tx, { action: id ? "competency.update" : "competency.create", entityType: "competency", entityId: c.id, entityRef: c.code, after: data });
    return c;
  });
}

/** Records a verified competency for an employee. The verifier cannot verify themselves. */
export async function grantCompetency(
  ctx: Ctx,
  input: { employeeId: string; competencyId: string; level?: "trainee" | "competent" | "trainer"; expiresOn?: string | null; notes?: string | null; evidence?: File | null },
) {
  requirePermission(ctx, "competencies.verify");
  if (ctx.actor.employeeId && ctx.actor.employeeId === input.employeeId) throw forbidden("You cannot verify your own competency.");
  return mutate(ctx, async (tx) => {
    const [comp] = await tx.db.select().from(competencies).where(eq(competencies.id, input.competencyId)).limit(1);
    if (!comp) throw invalid("Select a competency.", { field: "competencyId" });
    const [emp] = await tx.db.select().from(employees).where(eq(employees.id, input.employeeId)).limit(1);
    if (!emp?.isActive) throw invalid("Employee is not active.");
    let expiresOn = input.expiresOn ?? null;
    if (comp.requiresExpiry && !expiresOn) {
      const d = new Date();
      d.setUTCMonth(d.getUTCMonth() + (comp.validityMonths ?? 12));
      expiresOn = d.toISOString().slice(0, 10);
    }
    const evidenceFileId = input.evidence && input.evidence.size ? (await storeUpload(tx.db, input.evidence, ctx.actor.userId)).id : null;
    // Supersede previous active record for the same competency.
    await tx.db
      .update(employeeCompetencies)
      .set({ status: "revoked", notes: sql`coalesce(${employeeCompetencies.notes}, '') || ' [superseded]'` })
      .where(and(eq(employeeCompetencies.employeeId, input.employeeId), eq(employeeCompetencies.competencyId, input.competencyId), eq(employeeCompetencies.status, "active")));
    const [ec] = await tx.db
      .insert(employeeCompetencies)
      .values({ employeeId: input.employeeId, competencyId: input.competencyId, level: input.level ?? "competent", verifiedBy: ctx.actor.userId, verifiedAt: new Date(), expiresOn, evidenceFileId, notes: input.notes ?? null })
      .returning();
    await audit(tx, { action: "competency.grant", entityType: "employee", entityId: input.employeeId, entityRef: `${emp.employeeNo} ${comp.code}`, after: ec });
    return ec;
  });
}

export async function revokeCompetency(ctx: Ctx, employeeCompetencyId: string, reason: string) {
  requirePermission(ctx, "competencies.verify");
  if (!reason?.trim()) throw invalid("A reason is required.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const [ec] = await tx.db.update(employeeCompetencies).set({ status: "revoked" }).where(eq(employeeCompetencies.id, employeeCompetencyId)).returning();
    if (!ec) throw notFound("Competency record");
    await audit(tx, { action: "competency.revoke", entityType: "employee", entityId: ec.employeeId, reason, before: ec });
  });
}

/** True if the employee holds the competency, active, verified, unexpired on `onDate`. */
export async function hasValidCompetency(ctx: Ctx, employeeId: string, competencyId: string, onDate = todayISO()) {
  const rows = await ctx.db
    .select()
    .from(employeeCompetencies)
    .where(
      and(
        eq(employeeCompetencies.employeeId, employeeId),
        eq(employeeCompetencies.competencyId, competencyId),
        eq(employeeCompetencies.status, "active"),
        or(isNull(employeeCompetencies.expiresOn), gte(employeeCompetencies.expiresOn, onDate)),
      ),
    )
    .limit(1);
  return rows.length > 0 && rows[0].level !== "trainee";
}

export async function addTrainingRecord(ctx: Ctx, input: { employeeId: string; title: string; provider?: string | null; completedOn: string; expiresOn?: string | null; notes?: string | null; file?: File | null }) {
  requirePermission(ctx, "employees.manage");
  if (!input.title?.trim()) throw invalid("Title is required.", { field: "title" });
  return mutate(ctx, async (tx) => {
    const fileId = input.file && input.file.size ? (await storeUpload(tx.db, input.file, ctx.actor.userId)).id : null;
    const [r] = await tx.db
      .insert(trainingRecords)
      .values({ employeeId: input.employeeId, title: input.title.trim(), provider: input.provider ?? null, completedOn: input.completedOn, expiresOn: input.expiresOn || null, notes: input.notes ?? null, fileId, recordedBy: ctx.actor.userId })
      .returning();
    await audit(tx, { action: "training.add", entityType: "employee", entityId: input.employeeId, after: r });
    return r;
  });
}

export async function listEmployees(ctx: Ctx, opts: { includeInactive?: boolean } = {}) {
  requireAnyPermission(ctx, "employees.view", "production.assign");
  const rows = await ctx.db.select().from(employees).where(opts.includeInactive ? undefined : eq(employees.isActive, true)).orderBy(asc(employees.lastName));
  const comps = rows.length
    ? await ctx.db
        .select({ ec: employeeCompetencies, c: competencies })
        .from(employeeCompetencies)
        .innerJoin(competencies, eq(competencies.id, employeeCompetencies.competencyId))
        .where(and(inArray(employeeCompetencies.employeeId, rows.map((r) => r.id)), eq(employeeCompetencies.status, "active")))
    : [];
  const today = todayISO();
  return rows.map((e) => ({
    ...e,
    name: `${e.firstName} ${e.lastName}`,
    competencies: comps.filter((c) => c.ec.employeeId === e.id).map((c) => ({ ...c, expired: !!c.ec.expiresOn && c.ec.expiresOn < today })),
  }));
}

export async function getEmployee(ctx: Ctx, id: string) {
  requirePermission(ctx, "employees.view");
  const [e] = await ctx.db.select().from(employees).where(eq(employees.id, id)).limit(1);
  if (!e) throw notFound("Employee");
  const [comps, training, user, supervisor] = await Promise.all([
    ctx.db
      .select({ ec: employeeCompetencies, c: competencies, verifier: users.name, opType: operationTypes.name, machineType: machineTypes.name, machine: machines.code })
      .from(employeeCompetencies)
      .innerJoin(competencies, eq(competencies.id, employeeCompetencies.competencyId))
      .leftJoin(users, eq(users.id, employeeCompetencies.verifiedBy))
      .leftJoin(operationTypes, eq(operationTypes.id, competencies.operationTypeId))
      .leftJoin(machineTypes, eq(machineTypes.id, competencies.machineTypeId))
      .leftJoin(machines, eq(machines.id, competencies.machineId))
      .where(eq(employeeCompetencies.employeeId, id))
      .orderBy(desc(employeeCompetencies.createdAt)),
    ctx.db.select().from(trainingRecords).where(eq(trainingRecords.employeeId, id)).orderBy(desc(trainingRecords.completedOn)),
    ctx.db.select({ id: users.id, email: users.email, isActive: users.isActive }).from(users).where(eq(users.employeeId, id)).limit(1),
    e.supervisorId ? ctx.db.select().from(employees).where(eq(employees.id, e.supervisorId)).limit(1) : Promise.resolve([]),
  ]);
  return { employee: e, name: `${e.firstName} ${e.lastName}`, competencies: comps, training, user: user[0] ?? null, supervisor: supervisor[0] ?? null };
}

export async function listCompetencies(ctx: Ctx) {
  return ctx.db
    .select({ c: competencies, opType: operationTypes.name, machineType: machineTypes.name, machine: machines.code })
    .from(competencies)
    .leftJoin(operationTypes, eq(operationTypes.id, competencies.operationTypeId))
    .leftJoin(machineTypes, eq(machineTypes.id, competencies.machineTypeId))
    .leftJoin(machines, eq(machines.id, competencies.machineId))
    .orderBy(asc(competencies.code));
}

/** Competencies/training expiring within `days` (for dashboards and notifications). */
export async function expiringQualifications(ctx: Ctx, days = 30) {
  const limit = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  return ctx.db
    .select({ ec: employeeCompetencies, c: competencies, e: employees })
    .from(employeeCompetencies)
    .innerJoin(competencies, eq(competencies.id, employeeCompetencies.competencyId))
    .innerJoin(employees, eq(employees.id, employeeCompetencies.employeeId))
    .where(and(eq(employeeCompetencies.status, "active"), sql`${employeeCompetencies.expiresOn} <= ${limit}`, eq(employees.isActive, true)))
    .orderBy(asc(employeeCompetencies.expiresOn));
}

/** Operator workload: assigned open operations with estimated remaining minutes. */
export async function operatorWorkloads(ctx: Ctx) {
  requireAnyPermission(ctx, "planning.view", "production.view_all");
  const rows = await ctx.db
    .select({ a: operationAssignments, op: operations, job: jobs, e: employees })
    .from(operationAssignments)
    .innerJoin(operations, eq(operations.id, operationAssignments.operationId))
    .innerJoin(jobs, eq(jobs.id, operations.jobId))
    .innerJoin(employees, eq(employees.id, operationAssignments.employeeId))
    .where(and(eq(operationAssignments.isActive, true), inArray(operations.status, ["pending", "ready", "in_setup", "awaiting_first_off", "in_production", "paused"])));
  const byEmp = new Map<string, { employee: typeof employees.$inferSelect; ops: typeof rows; minutes: number }>();
  for (const r of rows) {
    const cur = byEmp.get(r.e.id) ?? { employee: r.e, ops: [], minutes: 0 };
    cur.ops.push(r);
    const remaining = Math.max(0, Number(r.op.plannedQty) - Number(r.op.qtyGood));
    cur.minutes += (r.op.setupStatus === "complete" ? 0 : Number(r.op.setupMinutesEst)) + remaining * Number(r.op.cycleMinutesEst);
    byEmp.set(r.e.id, cur);
  }
  return [...byEmp.values()].sort((a, b) => b.minutes - a.minutes);
}

export async function employeeTime(ctx: Ctx, employeeId: string, limit = 50) {
  return ctx.db
    .select({ t: timeEntries, op: operations, job: jobs, machine: machines.code })
    .from(timeEntries)
    .innerJoin(operations, eq(operations.id, timeEntries.operationId))
    .innerJoin(jobs, eq(jobs.id, operations.jobId))
    .leftJoin(machines, eq(machines.id, timeEntries.machineId))
    .where(eq(timeEntries.employeeId, employeeId))
    .orderBy(desc(timeEntries.startedAt))
    .limit(limit);
}
