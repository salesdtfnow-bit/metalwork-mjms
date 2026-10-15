/**
 * Read-only query helpers for the Shop floor, Machines, Operators and CNC programs UI pages.
 * No writes happen here; every function checks permissions before reading.
 */
import { and, asc, desc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import {
  controlledDocuments,
  documentRevisions,
  downtimeEvents,
  downtimeReasons,
  employees,
  jobLines,
  jobs,
  machines,
  operationAssignments,
  operationDependencies,
  operations,
  operationTypes,
  timeEntries,
  users,
} from "../../db/schema";
import { requireAnyPermission, type Ctx } from "../../context";

/** The open downtime record for a machine (if any), with its reason. */
export async function openDowntime(ctx: Ctx, machineId: string) {
  requireAnyPermission(ctx, "machines.view", "machines.report_status", "production.execute");
  const [row] = await ctx.db
    .select({ d: downtimeEvents, reason: downtimeReasons.name, category: downtimeReasons.category })
    .from(downtimeEvents)
    .innerJoin(downtimeReasons, eq(downtimeReasons.id, downtimeEvents.reasonId))
    .where(and(eq(downtimeEvents.machineId, machineId), isNull(downtimeEvents.endedAt)))
    .orderBy(desc(downtimeEvents.startedAt))
    .limit(1);
  return row ?? null;
}

/** Display names for user ids (e.g. "status reported by"). */
export async function userNames(ctx: Ctx, ids: (string | null | undefined)[]) {
  requireAnyPermission(ctx, "machines.view", "employees.view", "programs.view", "production.execute");
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const rows = await ctx.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, list));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** For pending operations: which prerequisite operations are not yet complete. */
export async function pendingBlockers(ctx: Ctx, opIds: string[]) {
  requireAnyPermission(ctx, "production.execute", "production.view_all");
  if (!opIds.length) return new Map<string, { opNumber: string; status: string; title: string }[]>();
  const rows = await ctx.db
    .select({ operationId: operationDependencies.operationId, opNumber: operations.opNumber, status: operations.status, title: operations.title })
    .from(operationDependencies)
    .innerJoin(operations, eq(operations.id, operationDependencies.dependsOnId))
    .where(and(inArray(operationDependencies.operationId, opIds), notInArray(operations.status, ["complete", "cancelled"])));
  const out = new Map<string, { opNumber: string; status: string; title: string }[]>();
  for (const r of rows) out.set(r.operationId, [...(out.get(r.operationId) ?? []), { opNumber: r.opNumber, status: r.status, title: r.title }]);
  return out;
}

/** Recorded minutes per operation, split into setup and run (production + rework) time. */
export async function recordedMinutesByOperation(ctx: Ctx, opIds: string[]) {
  requireAnyPermission(ctx, "machines.view", "production.view_all");
  const out = new Map<string, { setup: number; run: number }>();
  if (!opIds.length) return out;
  const rows = await ctx.db.select().from(timeEntries).where(inArray(timeEntries.operationId, opIds));
  const now = Date.now();
  for (const t of rows) {
    const mins = ((t.endedAt?.getTime() ?? now) - t.startedAt.getTime()) / 60_000;
    const cur = out.get(t.operationId) ?? { setup: 0, run: 0 };
    if (t.kind === "setup") cur.setup += mins;
    else if (t.kind === "production" || t.kind === "rework") cur.run += mins;
    out.set(t.operationId, cur);
  }
  return out;
}

/** Part numbers for a set of operations (machine queue display). */
export async function opPartNumbers(ctx: Ctx, opIds: string[]) {
  requireAnyPermission(ctx, "machines.view", "production.view_all");
  if (!opIds.length) return new Map<string, string>();
  const rows = await ctx.db.select({ id: operations.id, partNumber: jobLines.partNumber }).from(operations).innerJoin(jobLines, eq(jobLines.id, operations.jobLineId)).where(inArray(operations.id, opIds));
  return new Map(rows.map((r) => [r.id, r.partNumber]));
}

/** Current (open) operation assignments for an employee. */
export async function employeeAssignments(ctx: Ctx, employeeId: string) {
  requireAnyPermission(ctx, "employees.view", "production.assign");
  return ctx.db
    .select({ a: operationAssignments, op: operations, job: jobs, partNumber: jobLines.partNumber, type: operationTypes.name, machine: machines.code })
    .from(operationAssignments)
    .innerJoin(operations, eq(operations.id, operationAssignments.operationId))
    .innerJoin(jobs, eq(jobs.id, operations.jobId))
    .innerJoin(jobLines, eq(jobLines.id, operations.jobLineId))
    .innerJoin(operationTypes, eq(operationTypes.id, operations.operationTypeId))
    .leftJoin(machines, eq(machines.id, operations.machineId))
    .where(and(eq(operationAssignments.employeeId, employeeId), eq(operationAssignments.isActive, true), notInArray(operations.status, ["complete", "cancelled"])))
    .orderBy(asc(jobs.priority), asc(operations.plannedStart));
}

/** Active employees as select options (responsible person, supervisor). */
export async function employeeOptions(ctx: Ctx) {
  requireAnyPermission(ctx, "employees.view", "employees.manage", "machines.manage", "production.assign");
  const rows = await ctx.db
    .select({ id: employees.id, employeeNo: employees.employeeNo, firstName: employees.firstName, lastName: employees.lastName })
    .from(employees)
    .where(eq(employees.isActive, true))
    .orderBy(asc(employees.lastName));
  return rows.map((e) => ({ value: e.id, label: `${e.firstName} ${e.lastName} (${e.employeeNo})` }));
}

/** Open jobs as select options (linking a CNC program to a job). */
export async function openJobOptions(ctx: Ctx) {
  requireAnyPermission(ctx, "programs.create", "jobs.view");
  const rows = await ctx.db
    .select({ id: jobs.id, jobNumber: jobs.jobNumber, title: jobs.title })
    .from(jobs)
    .where(notInArray(jobs.status, ["completed", "cancelled"]))
    .orderBy(desc(jobs.createdAt))
    .limit(300);
  return rows.map((j) => ({ value: j.id, label: `${j.jobNumber} — ${j.title}` }));
}

/** Document revisions of the given types (drawings, setup sheets) for program revision links. */
export async function documentRevisionOptions(ctx: Ctx, docTypes: string[]) {
  requireAnyPermission(ctx, "programs.create", "documents.view");
  const rows = await ctx.db
    .select({ id: documentRevisions.id, revision: documentRevisions.revision, status: documentRevisions.status, docNumber: controlledDocuments.docNumber, title: controlledDocuments.title })
    .from(documentRevisions)
    .innerJoin(controlledDocuments, eq(controlledDocuments.id, documentRevisions.documentId))
    .where(and(inArray(controlledDocuments.docType, docTypes), notInArray(documentRevisions.status, ["obsolete", "rejected"])))
    .orderBy(asc(controlledDocuments.docNumber), desc(documentRevisions.createdAt))
    .limit(500);
  return rows.map((r) => ({ value: r.id, label: `${r.docNumber} rev ${r.revision} — ${r.title} (${r.status.replace(/_/g, " ")})` }));
}

/** Labels for document revisions referenced by program revisions. */
export async function documentRevisionLabels(ctx: Ctx, ids: (string | null | undefined)[]) {
  requireAnyPermission(ctx, "programs.view", "documents.view");
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const rows = await ctx.db
    .select({ id: documentRevisions.id, revision: documentRevisions.revision, docNumber: controlledDocuments.docNumber })
    .from(documentRevisions)
    .innerJoin(controlledDocuments, eq(controlledDocuments.id, documentRevisions.documentId))
    .where(inArray(documentRevisions.id, list));
  return new Map(rows.map((r) => [r.id, `${r.docNumber} rev ${r.revision}`]));
}
