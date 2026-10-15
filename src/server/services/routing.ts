import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { z } from "zod";
import {
  batches,
  cncProgramMachines,
  cncProgramRevisions,
  cncPrograms,
  competencies,
  documentRevisions,
  controlledDocuments,
  employees,
  gateExceptions,
  inspectionPlans,
  jobLines,
  jobs,
  machineCapabilities,
  machines,
  operationAssignments,
  operationDependencies,
  operationDocuments,
  operationEvents,
  operations,
  operationTypes,
  serials,
  users,
  operationTools,
  tools,
} from "../db/schema";
import { audit } from "../audit";
import { mutate, requirePermission, requireAnyPermission, type Ctx } from "../context";
import { invalid, notFound } from "../errors";
import { d } from "@/lib/decimal";
import { hasValidCompetency } from "./employees";
import { notify } from "./notifications";

const STARTED = ["in_setup", "awaiting_first_off", "in_production", "paused", "awaiting_inspection", "subcontracted", "complete"];

async function loadLine(ctx: Ctx, jobLineId: string) {
  const [row] = await ctx.db.select({ line: jobLines, job: jobs }).from(jobLines).innerJoin(jobs, eq(jobs.id, jobLines.jobId)).where(eq(jobLines.id, jobLineId)).limit(1);
  if (!row) throw notFound("Job line");
  if (["completed", "cancelled"].includes(row.job.status)) throw invalid(`Job ${row.job.jobNumber} is ${row.job.status}.`);
  return row;
}

export async function loadOp(ctx: Ctx, opId: string) {
  const [row] = await ctx.db
    .select({ op: operations, job: jobs, line: jobLines, type: operationTypes })
    .from(operations)
    .innerJoin(jobs, eq(jobs.id, operations.jobId))
    .innerJoin(jobLines, eq(jobLines.id, operations.jobLineId))
    .innerJoin(operationTypes, eq(operationTypes.id, operations.operationTypeId))
    .where(eq(operations.id, opId))
    .limit(1);
  if (!row) throw notFound("Operation");
  return row;
}

export const operationInput = z.object({
  operationTypeId: z.string().uuid("Select an operation type."),
  title: z.string().trim().min(2, "Describe the operation."),
  instructions: z.string().nullish(),
  machineId: z.string().uuid().nullish(),
  machineGroupId: z.string().uuid().nullish(),
  setupMinutesEst: z.string().regex(/^\d+(\.\d+)?$/).default("0"),
  cycleMinutesEst: z.string().regex(/^\d+(\.\d+)?$/).default("0"),
  plannedQty: z.string().regex(/^\d+(\.\d+)?$/).nullish(),
  requiresMaterial: z.boolean().nullish(),
  requiresProgram: z.boolean().nullish(),
  requiresFirstOff: z.boolean().nullish(),
  requiredCompetencyId: z.string().uuid().nullish(),
  programRevisionId: z.string().uuid().nullish(),
  inspectionPlanId: z.string().uuid().nullish(),
  toolingRequirements: z.string().nullish(),
  fixtureRequirements: z.string().nullish(),
  allowParallel: z.boolean().default(false),
  batchId: z.string().uuid().nullish(),
  opNumber: z.string().trim().max(10).nullish(),
});

async function validateMachine(ctx: Ctx, machineId: string | null | undefined, operationTypeId: string) {
  if (!machineId) return;
  const [m] = await ctx.db.select().from(machines).where(eq(machines.id, machineId)).limit(1);
  if (!m?.isActive) throw invalid("Selected machine is not active.", { field: "machineId" });
  const caps = await ctx.db.select().from(machineCapabilities).where(eq(machineCapabilities.machineId, machineId));
  if (caps.length && !caps.some((c) => c.operationTypeId === operationTypeId)) {
    const [t] = await ctx.db.select().from(operationTypes).where(eq(operationTypes.id, operationTypeId));
    throw invalid(`${m.code} is not configured for ${t?.name ?? "this operation type"}.`, { field: "machineId" });
  }
}

async function validateProgram(ctx: Ctx, programRevisionId: string | null | undefined, machineId: string | null | undefined) {
  if (!programRevisionId) return;
  const [r] = await ctx.db.select({ rev: cncProgramRevisions, p: cncPrograms }).from(cncProgramRevisions).innerJoin(cncPrograms, eq(cncPrograms.id, cncProgramRevisions.programId)).where(eq(cncProgramRevisions.id, programRevisionId)).limit(1);
  if (!r) throw invalid("Program revision not found.", { field: "programRevisionId" });
  if (r.rev.status !== "released" || r.p.currentReleasedRevisionId !== r.rev.id) throw invalid(`Program ${r.p.programNumber} revision ${r.rev.revision} is not the current released revision.`, { field: "programRevisionId" });
  if (machineId) {
    const compat = await ctx.db.select().from(cncProgramMachines).where(eq(cncProgramMachines.programId, r.p.id));
    if (compat.length && !compat.some((c) => c.machineId === machineId)) throw invalid(`Program ${r.p.programNumber} is not compatible with the selected machine.`, { field: "programRevisionId" });
  }
}

/** Adds an operation. Defaults come from the operation type; by default it depends on the previous operation. */
export async function addOperation(ctx: Ctx, jobLineId: string, raw: z.input<typeof operationInput>, opts: { dependsOn?: "previous" | "none" | string[]; reason?: string | null } = {}) {
  requirePermission(ctx, "routing.manage");
  const data = operationInput.parse(raw);
  return mutate(ctx, async (tx) => {
    const { line, job } = await loadLine(tx, jobLineId);
    if (line.routeStatus === "released" && !opts.reason?.trim()) throw invalid("The route is released — give a reason for adding an operation.", { field: "reason" });
    const [type] = await tx.db.select().from(operationTypes).where(eq(operationTypes.id, data.operationTypeId)).limit(1);
    if (!type?.isActive) throw invalid("Operation type is not active.");
    await validateMachine(tx, data.machineId, type.id);
    await validateProgram(tx, data.programRevisionId, data.machineId);
    const existing = await tx.db.select().from(operations).where(eq(operations.jobLineId, jobLineId)).orderBy(asc(operations.sequence));
    const last = existing[existing.length - 1];
    const sequence = (last?.sequence ?? 0) + 10;
    const opNumber = data.opNumber || String(Math.max(0, ...existing.map((o) => Number.parseInt(o.opNumber, 10) || 0)) + 10);
    const [op] = await tx.db
      .insert(operations)
      .values({
        jobId: job.id,
        jobLineId,
        batchId: data.batchId ?? null,
        sequence,
        opNumber,
        operationTypeId: type.id,
        title: data.title,
        instructions: data.instructions ?? null,
        machineId: data.machineId ?? null,
        machineGroupId: data.machineGroupId ?? null,
        setupMinutesEst: data.setupMinutesEst,
        cycleMinutesEst: data.cycleMinutesEst,
        plannedQty: data.plannedQty ?? line.quantity,
        requiresMaterial: data.requiresMaterial ?? existing.length === 0,
        requiresProgram: data.requiresProgram ?? type.requiresProgramDefault,
        requiresFirstOff: data.requiresFirstOff ?? type.requiresFirstOffDefault,
        firstOffStatus: (data.requiresFirstOff ?? type.requiresFirstOffDefault) ? "required" : "not_required",
        requiredCompetencyId: data.requiredCompetencyId ?? type.defaultCompetencyId,
        programRevisionId: data.programRevisionId ?? null,
        drawingRevisionId: line.drawingRevisionId,
        inspectionPlanId: data.inspectionPlanId ?? null,
        toolingRequirements: data.toolingRequirements ?? null,
        fixtureRequirements: data.fixtureRequirements ?? null,
        allowParallel: data.allowParallel,
      })
      .returning();
    const deps = opts.dependsOn ?? (data.allowParallel ? "none" : "previous");
    if (deps === "previous" && last) await tx.db.insert(operationDependencies).values({ operationId: op.id, dependsOnId: last.id });
    if (Array.isArray(deps) && deps.length) await setDependenciesInternal(tx, op.id, deps);
    await audit(tx, { action: "operation.add", entityType: "operation", entityId: op.id, entityRef: `${job.jobNumber}/${opNumber}`, jobId: job.id, operationId: op.id, after: data, reason: opts.reason });
    return op;
  });
}

export async function updateOperation(ctx: Ctx, opId: string, raw: Partial<z.input<typeof operationInput>>, reason?: string | null) {
  requirePermission(ctx, "routing.manage");
  // Only fields actually supplied are applied (zod 4 .partial() would otherwise inject defaults).
  const parsed = operationInput.partial().parse(raw);
  const data = Object.fromEntries(Object.entries(parsed).filter(([k]) => k in raw)) as typeof parsed;
  return mutate(ctx, async (tx) => {
    const { op, job, line } = await loadOp(tx, opId);
    if (["complete", "cancelled"].includes(op.status)) throw invalid(`Operation ${op.opNumber} is ${op.status}.`);
    const started = STARTED.includes(op.status);
    if ((started || line.routeStatus === "released") && !reason?.trim()) throw invalid("Give a reason for changing a released or started operation.", { field: "reason" });
    if (started && (data.programRevisionId !== undefined && data.programRevisionId !== op.programRevisionId)) {
      throw invalid("The program of a started operation is changed through the revision review (clear review), not by editing.");
    }
    if (started && data.operationTypeId && data.operationTypeId !== op.operationTypeId) throw invalid("Operation type cannot change after work has started.");
    const typeId = data.operationTypeId ?? op.operationTypeId;
    const machineId = data.machineId !== undefined ? data.machineId : op.machineId;
    await validateMachine(tx, machineId, typeId);
    await validateProgram(tx, data.programRevisionId !== undefined ? data.programRevisionId : null, machineId);
    const { opNumber: newOpNumber, ...rest } = data;
    const patch: Partial<typeof operations.$inferInsert> = { ...rest, ...(newOpNumber ? { opNumber: newOpNumber } : {}) } as Partial<typeof operations.$inferInsert>;
    if (data.requiresFirstOff !== undefined && data.requiresFirstOff !== null && op.firstOffStatus !== "approved") patch.firstOffStatus = data.requiresFirstOff ? "required" : "not_required";
    await tx.db.update(operations).set(patch).where(eq(operations.id, opId));
    await audit(tx, { action: "operation.update", entityType: "operation", entityId: opId, entityRef: `${job.jobNumber}/${op.opNumber}`, jobId: job.id, operationId: opId, before: op, after: data, reason });
  });
}

async function setDependenciesInternal(ctx: Ctx, opId: string, dependsOnIds: string[]) {
  const [op] = await ctx.db.select().from(operations).where(eq(operations.id, opId)).limit(1);
  const others = dependsOnIds.length ? await ctx.db.select().from(operations).where(inArray(operations.id, dependsOnIds)) : [];
  if (others.some((o) => o.jobId !== op.jobId)) throw invalid("Dependencies must be operations of the same job.");
  if (dependsOnIds.includes(opId)) throw invalid("An operation cannot depend on itself.");
  // cycle check: none of the prerequisites may (transitively) depend on this op
  const all = await ctx.db.select().from(operationDependencies);
  const graph = new Map<string, string[]>();
  for (const e of all) if (e.operationId !== opId) graph.set(e.operationId, [...(graph.get(e.operationId) ?? []), e.dependsOnId]);
  graph.set(opId, dependsOnIds);
  const visit = (n: string, seen: Set<string>): boolean => {
    if (seen.has(n)) return true;
    seen.add(n);
    return (graph.get(n) ?? []).some((m) => visit(m, new Set(seen)));
  };
  if (visit(opId, new Set())) throw invalid("These dependencies would create a cycle.");
  await ctx.db.delete(operationDependencies).where(eq(operationDependencies.operationId, opId));
  if (dependsOnIds.length) await ctx.db.insert(operationDependencies).values(dependsOnIds.map((dependsOnId) => ({ operationId: opId, dependsOnId })));
}

export async function setDependencies(ctx: Ctx, opId: string, dependsOnIds: string[], reason?: string | null) {
  requirePermission(ctx, "routing.manage");
  return mutate(ctx, async (tx) => {
    const { op, job } = await loadOp(tx, opId);
    if (STARTED.includes(op.status)) throw invalid("Dependencies of a started operation cannot change.");
    const before = await tx.db.select().from(operationDependencies).where(eq(operationDependencies.operationId, opId));
    await setDependenciesInternal(tx, opId, dependsOnIds);
    await tx.db.update(operations).set({ allowParallel: dependsOnIds.length === 0 }).where(eq(operations.id, opId));
    await audit(tx, { action: "operation.dependencies", entityType: "operation", entityId: opId, entityRef: `${job.jobNumber}/${op.opNumber}`, jobId: job.id, operationId: opId, before: before.map((b) => b.dependsOnId), after: dependsOnIds, reason });
  });
}

/** Re-sequences unstarted operations of a job line. Dependencies are kept and checked for consistency. */
export async function reorderOperations(ctx: Ctx, jobLineId: string, orderedIds: string[], reason?: string | null) {
  requirePermission(ctx, "routing.manage");
  return mutate(ctx, async (tx) => {
    const { job } = await loadLine(tx, jobLineId);
    const ops = await tx.db.select().from(operations).where(eq(operations.jobLineId, jobLineId));
    if (orderedIds.length !== ops.length || !ops.every((o) => orderedIds.includes(o.id))) throw invalid("The new order must include every operation of the line.");
    const moved = ops.filter((o) => orderedIds.indexOf(o.id) !== [...ops].sort((a, b) => a.sequence - b.sequence).findIndex((x) => x.id === o.id));
    if (moved.some((o) => STARTED.includes(o.status))) throw invalid("Started operations cannot be moved.");
    for (const [i, id] of orderedIds.entries()) await tx.db.update(operations).set({ sequence: (i + 1) * 10 }).where(eq(operations.id, id));
    // Sequential defaults: rebuild "depends on previous" for non-parallel, unstarted ops.
    const sorted = orderedIds.map((id) => ops.find((o) => o.id === id)!);
    for (const [i, o] of sorted.entries()) {
      if (o.allowParallel || STARTED.includes(o.status) || i === 0) {
        if (i === 0 && !STARTED.includes(o.status)) await tx.db.delete(operationDependencies).where(eq(operationDependencies.operationId, o.id));
        continue;
      }
      await tx.db.delete(operationDependencies).where(eq(operationDependencies.operationId, o.id));
      await tx.db.insert(operationDependencies).values({ operationId: o.id, dependsOnId: sorted[i - 1].id });
    }
    await audit(tx, { action: "route.reorder", entityType: "job", entityId: job.id, entityRef: job.jobNumber, jobId: job.id, after: { order: sorted.map((o) => o.opNumber) }, reason });
  });
}

/** Splits an unstarted operation into batches (e.g. 20 → 20A/20B) on the same or different machines. */
export async function splitOperation(ctx: Ctx, opId: string, quantities: string[], reason: string) {
  requirePermission(ctx, "routing.manage");
  if (!reason?.trim()) throw invalid("Give a reason for splitting.", { field: "reason" });
  if (quantities.length < 2) throw invalid("Split into at least two quantities.");
  return mutate(ctx, async (tx) => {
    const { op, job, line } = await loadOp(tx, opId);
    if (STARTED.includes(op.status) || op.status === "cancelled") throw invalid("Only unstarted operations can be split.");
    const total = quantities.reduce((a, q) => a.plus(d(q)), d(0));
    if (!total.equals(d(op.plannedQty))) throw invalid(`Quantities must add up to ${d(op.plannedQty).toString()}.`);
    const deps = await tx.db.select().from(operationDependencies).where(eq(operationDependencies.operationId, opId));
    const dependants = await tx.db.select().from(operationDependencies).where(eq(operationDependencies.dependsOnId, opId));
    const created: string[] = [];
    for (const [i, q] of quantities.entries()) {
      const suffix = String.fromCharCode(65 + i);
      const batchNo = `${job.jobNumber}-L${line.lineNo}-${op.opNumber}${suffix}`;
      const [b] = await tx.db.insert(batches).values({ jobLineId: line.id, batchNo, quantity: q }).returning();
      if (i === 0) {
        await tx.db.update(operations).set({ opNumber: `${op.opNumber}${suffix}`, plannedQty: q, batchId: b.id }).where(eq(operations.id, opId));
        created.push(opId);
      } else {
        const { id: _id, createdAt: _c, updatedAt: _u, ...copy } = op;
        const [n] = await tx.db.insert(operations).values({ ...copy, opNumber: `${op.opNumber}${suffix}`, plannedQty: q, batchId: b.id, splitFromId: opId, sequence: op.sequence + i, status: "pending" }).returning();
        for (const dep of deps) await tx.db.insert(operationDependencies).values({ operationId: n.id, dependsOnId: dep.dependsOnId });
        for (const dt of dependants) await tx.db.insert(operationDependencies).values({ operationId: dt.operationId, dependsOnId: n.id }).onConflictDoNothing();
        const assigns = await tx.db.select().from(operationAssignments).where(and(eq(operationAssignments.operationId, opId), eq(operationAssignments.isActive, true)));
        if (assigns.length) await tx.db.insert(operationAssignments).values(assigns.map((a) => ({ operationId: n.id, employeeId: a.employeeId, role: a.role, assignedBy: ctx.actor.userId })));
        created.push(n.id);
      }
    }
    await tx.db.insert(operationEvents).values({ operationId: opId, kind: "split", message: `Split into ${quantities.join(" + ")}: ${reason}`, userId: ctx.actor.userId });
    await audit(tx, { action: "operation.split", entityType: "operation", entityId: opId, entityRef: `${job.jobNumber}/${op.opNumber}`, jobId: job.id, operationId: opId, after: { quantities, operations: created }, reason });
    return created;
  });
}

/** Repeats an operation (e.g. a second pass) as a new operation after it. */
export async function repeatOperation(ctx: Ctx, opId: string, reason: string) {
  requirePermission(ctx, "routing.manage");
  if (!reason?.trim()) throw invalid("Give a reason.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const { op, job } = await loadOp(tx, opId);
    const { id: _id, createdAt: _c, updatedAt: _u, ...copy } = op;
    const siblings = await tx.db.select().from(operations).where(eq(operations.jobLineId, op.jobLineId));
    const [n] = await tx.db
      .insert(operations)
      .values({
        ...copy,
        opNumber: `${op.opNumber}.${siblings.filter((s) => s.repeatOfId === opId).length + 1}`,
        sequence: op.sequence + 1,
        status: "pending",
        setupStatus: "not_started",
        firstOffStatus: op.requiresFirstOff ? "required" : "not_required",
        qtyGood: "0",
        qtyRejected: "0",
        qtyScrapped: "0",
        actualStart: null,
        actualEnd: null,
        signedOffBy: null,
        signedOffAt: null,
        reviewRequired: false,
        repeatOfId: opId,
      })
      .returning();
    await tx.db.insert(operationDependencies).values({ operationId: n.id, dependsOnId: opId });
    await audit(tx, { action: "operation.repeat", entityType: "operation", entityId: n.id, entityRef: `${job.jobNumber}/${n.opNumber}`, jobId: job.id, operationId: n.id, reason });
    return n;
  });
}

export async function cancelOperation(ctx: Ctx, opId: string, reason: string) {
  requirePermission(ctx, "routing.manage");
  if (!reason?.trim()) throw invalid("A reason is required.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const { op, job } = await loadOp(tx, opId);
    if (STARTED.includes(op.status) && op.status !== "paused") throw invalid("A started operation cannot be cancelled — place it on hold instead.");
    if (d(op.qtyGood).greaterThan(0)) throw invalid("Parts have been produced on this operation; it cannot be cancelled.");
    await tx.db.update(operations).set({ status: "cancelled" }).where(eq(operations.id, opId));
    await tx.db.delete(operationDependencies).where(eq(operationDependencies.dependsOnId, opId));
    await audit(tx, { action: "operation.cancel", entityType: "operation", entityId: opId, entityRef: `${job.jobNumber}/${op.opNumber}`, jobId: job.id, operationId: opId, reason });
  });
}

// ───────────── Assignments ─────────────

/**
 * Assigns an operator. If the operation requires a competency, the operator must hold a
 * valid, verified one — unless an approved "operator" gate exception exists for the op.
 */
export async function assignOperator(ctx: Ctx, opId: string, employeeId: string, role: "operator" | "setter" | "inspector" = "operator") {
  requirePermission(ctx, "production.assign");
  return mutate(ctx, async (tx) => {
    const { op, job } = await loadOp(tx, opId);
    if (["complete", "cancelled"].includes(op.status)) throw invalid(`Operation is ${op.status}.`);
    const [emp] = await tx.db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
    if (!emp?.isActive) throw invalid("Employee is not active.");
    if (op.requiredCompetencyId && role !== "inspector") {
      const ok = await hasValidCompetency(tx, employeeId, op.requiredCompetencyId);
      if (!ok) {
        const exc = await tx.db.select().from(gateExceptions).where(and(eq(gateExceptions.operationId, opId), eq(gateExceptions.gate, "operator"), eq(gateExceptions.status, "approved")));
        if (!exc.length) {
          const [c] = await tx.db.select().from(competencies).where(eq(competencies.id, op.requiredCompetencyId));
          throw invalid(`${emp.firstName} ${emp.lastName} does not hold a valid "${c?.name}" competency. Assign a qualified operator or record an authorised exception.`, { field: "employeeId" });
        }
      }
    }
    const [dup] = await tx.db.select().from(operationAssignments).where(and(eq(operationAssignments.operationId, opId), eq(operationAssignments.employeeId, employeeId), eq(operationAssignments.role, role), eq(operationAssignments.isActive, true))).limit(1);
    if (dup) throw invalid("Already assigned.");
    const [a] = await tx.db.insert(operationAssignments).values({ operationId: opId, employeeId, role, assignedBy: ctx.actor.userId }).returning();
    await audit(tx, { action: "operation.assign", entityType: "operation", entityId: opId, entityRef: `${job.jobNumber}/${op.opNumber}`, jobId: job.id, operationId: opId, after: { employee: `${emp.firstName} ${emp.lastName}`, role } });
    const [u] = await tx.db.select({ id: users.id }).from(users).where(eq(users.employeeId, employeeId)).limit(1);
    await notify(tx, { type: "operation.ready", title: `You have been assigned ${job.jobNumber} op ${op.opNumber}`, link: `/shopfloor/op/${opId}`, userIds: [u?.id], dedupeKey: `assign:${a.id}` });
    return a;
  });
}

export async function unassignOperator(ctx: Ctx, assignmentId: string, reason: string) {
  requirePermission(ctx, "production.assign");
  if (!reason?.trim()) throw invalid("A reason is required.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const [a] = await tx.db.update(operationAssignments).set({ isActive: false, unassignedAt: new Date() }).where(and(eq(operationAssignments.id, assignmentId), eq(operationAssignments.isActive, true))).returning();
    if (!a) throw notFound("Active assignment");
    const { op, job } = await loadOp(tx, a.operationId);
    await audit(tx, { action: "operation.unassign", entityType: "operation", entityId: a.operationId, entityRef: `${job.jobNumber}/${op.opNumber}`, jobId: job.id, operationId: a.operationId, reason });
  });
}

// ───────────── Documents & tools on operations ─────────────

export async function attachOperationDocument(ctx: Ctx, opId: string, documentRevisionId: string, purpose: "drawing" | "setup_sheet" | "work_instruction" | "reference") {
  requireAnyPermission(ctx, "routing.manage", "programs.create");
  return mutate(ctx, async (tx) => {
    const { op, job } = await loadOp(tx, opId);
    const [rev] = await tx.db.select({ rev: documentRevisions, doc: controlledDocuments }).from(documentRevisions).innerJoin(controlledDocuments, eq(controlledDocuments.id, documentRevisions.documentId)).where(eq(documentRevisions.id, documentRevisionId)).limit(1);
    if (!rev) throw notFound("Document revision");
    if (rev.rev.status !== "released") throw invalid(`${rev.doc.docNumber} rev ${rev.rev.revision} is ${rev.rev.status} — only released revisions can be issued to production.`);
    await tx.db.insert(operationDocuments).values({ operationId: opId, documentRevisionId, purpose, pinnedBy: ctx.actor.userId });
    if (purpose === "drawing") await tx.db.update(operations).set({ drawingRevisionId: documentRevisionId }).where(eq(operations.id, opId));
    await audit(tx, { action: "operation.document_attach", entityType: "operation", entityId: opId, entityRef: `${job.jobNumber}/${op.opNumber}`, jobId: job.id, operationId: opId, after: { doc: rev.doc.docNumber, revision: rev.rev.revision, purpose } });
  });
}

export async function attachOperationTool(ctx: Ctx, opId: string, toolId: string, notes?: string | null) {
  requireAnyPermission(ctx, "routing.manage", "tooling.manage");
  return mutate(ctx, async (tx) => {
    const { op, job } = await loadOp(tx, opId);
    const [t] = await tx.db.select().from(tools).where(eq(tools.id, toolId)).limit(1);
    if (!t) throw notFound("Tool");
    await tx.db.insert(operationTools).values({ operationId: opId, toolId, notes: notes ?? null });
    await audit(tx, { action: "operation.tool_attach", entityType: "operation", entityId: opId, entityRef: `${job.jobNumber}/${op.opNumber}`, jobId: job.id, operationId: opId, after: { tool: t.assetNo } });
  });
}

/**
 * Clears a revision-review flag. The supervisor either confirms the op keeps its pinned
 * revision (only if still valid) or switches it to the new released revision.
 */
export async function clearOperationReview(ctx: Ctx, opId: string, input: { programRevisionId?: string | null; drawingRevisionId?: string | null; reason: string }) {
  requirePermission(ctx, "production.supervise");
  if (!input.reason?.trim()) throw invalid("Record the review decision.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const { op, job } = await loadOp(tx, opId);
    if (!op.reviewRequired) throw invalid("This operation has no pending review.");
    const patch: Partial<typeof operations.$inferInsert> = { reviewRequired: false, reviewReason: null };
    if (input.programRevisionId) {
      await validateProgram(tx, input.programRevisionId, op.machineId);
      patch.programRevisionId = input.programRevisionId;
    } else if (op.programRevisionId) {
      const [r] = await tx.db.select({ rev: cncProgramRevisions, p: cncPrograms }).from(cncProgramRevisions).innerJoin(cncPrograms, eq(cncPrograms.id, cncProgramRevisions.programId)).where(eq(cncProgramRevisions.id, op.programRevisionId));
      if (r && (r.rev.status !== "released" || r.p.currentReleasedRevisionId !== r.rev.id)) {
        throw invalid(`The pinned program revision ${r.rev.revision} is ${r.rev.status}. Select the current released revision.`, { field: "programRevisionId" });
      }
    }
    if (input.drawingRevisionId) {
      const [dr] = await tx.db.select().from(documentRevisions).where(eq(documentRevisions.id, input.drawingRevisionId));
      if (dr?.status !== "released") throw invalid("Select a released drawing revision.", { field: "drawingRevisionId" });
      patch.drawingRevisionId = input.drawingRevisionId;
    } else if (op.drawingRevisionId) {
      const [dr] = await tx.db.select().from(documentRevisions).where(eq(documentRevisions.id, op.drawingRevisionId));
      if (dr && dr.status !== "released") throw invalid(`The pinned drawing revision ${dr.revision} is ${dr.status}. Select the released revision (customer change control may be required).`, { field: "drawingRevisionId" });
    }
    await tx.db.update(operations).set(patch).where(eq(operations.id, opId));
    if (input.drawingRevisionId) {
      const lineOps = await tx.db.select().from(operations).where(and(eq(operations.jobLineId, op.jobLineId), eq(operations.reviewRequired, true)));
      if (!lineOps.length) await tx.db.update(jobLines).set({ drawingReviewRequired: false, drawingRevisionId: input.drawingRevisionId }).where(eq(jobLines.id, op.jobLineId));
    }
    await tx.db.insert(operationEvents).values({ operationId: opId, kind: "review_cleared", message: input.reason, userId: ctx.actor.userId });
    await audit(tx, { action: "operation.review_cleared", entityType: "operation", entityId: opId, entityRef: `${job.jobNumber}/${op.opNumber}`, jobId: job.id, operationId: opId, before: { programRevisionId: op.programRevisionId, drawingRevisionId: op.drawingRevisionId, reason: op.reviewReason }, after: patch, reason: input.reason });
  });
}

// ───────────── Route release & copy ─────────────

export async function releaseRoute(ctx: Ctx, jobLineId: string) {
  requirePermission(ctx, "routing.release");
  return mutate(ctx, async (tx) => {
    const { line, job } = await loadLine(tx, jobLineId);
    if (line.routeStatus === "released") throw invalid("Route is already released.");
    const ops = (await tx.db.select({ op: operations, type: operationTypes }).from(operations).innerJoin(operationTypes, eq(operationTypes.id, operations.operationTypeId)).where(eq(operations.jobLineId, jobLineId))).filter((o) => o.op.status !== "cancelled");
    if (!ops.length) throw invalid("Add operations before releasing the route.");
    const problems: string[] = [];
    for (const { op, type } of ops) {
      if (type.requiresMachine && !op.machineId && !op.machineGroupId) problems.push(`Op ${op.opNumber}: no machine or machine group.`);
      if (op.requiresFirstOff && !op.inspectionPlanId) problems.push(`Op ${op.opNumber}: first-off required but no inspection plan selected.`);
    }
    if (problems.length) throw invalid(`Route cannot be released: ${problems.join(" ")}`);
    await tx.db.update(jobLines).set({ routeStatus: "released", routeReleasedBy: ctx.actor.userId, routeReleasedAt: new Date() }).where(eq(jobLines.id, jobLineId));
    // Operations with no unmet dependencies become "ready".
    await refreshReadiness(tx, job.id);
    await audit(tx, { action: "route.release", entityType: "job", entityId: job.id, entityRef: `${job.jobNumber} line ${line.lineNo}`, jobId: job.id, after: { operations: ops.map((o) => o.op.opNumber) } });
  });
}

/** Marks pending operations whose prerequisites are complete as "ready" (released routes only). */
export async function refreshReadiness(ctx: Ctx, jobId: string) {
  const ops = await ctx.db.select({ op: operations, line: jobLines }).from(operations).innerJoin(jobLines, eq(jobLines.id, operations.jobLineId)).where(eq(operations.jobId, jobId));
  const deps = ops.length ? await ctx.db.select().from(operationDependencies).where(inArray(operationDependencies.operationId, ops.map((o) => o.op.id))) : [];
  const status = new Map(ops.map((o) => [o.op.id, o.op.status]));
  const newlyReady: string[] = [];
  for (const { op, line } of ops) {
    if (op.status !== "pending" || line.routeStatus !== "released") continue;
    const pre = deps.filter((x) => x.operationId === op.id);
    if (pre.every((p) => ["complete", "cancelled"].includes(status.get(p.dependsOnId) ?? ""))) {
      await ctx.db.update(operations).set({ status: "ready" }).where(eq(operations.id, op.id));
      newlyReady.push(op.id);
    }
  }
  return newlyReady;
}

/** Repeat orders: copy the route (operations, dependencies, programs, plans) from another job line. */
export async function copyRoute(ctx: Ctx, targetLineId: string, sourceLineId: string) {
  requirePermission(ctx, "routing.manage");
  return mutate(ctx, async (tx) => {
    const { line } = await loadLine(tx, targetLineId);
    const existing = await tx.db.select().from(operations).where(eq(operations.jobLineId, targetLineId));
    if (existing.length) throw invalid("The target line already has operations.");
    const src = await tx.db.select().from(operations).where(and(eq(operations.jobLineId, sourceLineId), notInArray(operations.status, ["cancelled"]), eq(operations.isRework, false))).orderBy(asc(operations.sequence));
    if (!src.length) throw invalid("The source line has no operations to copy.");
    const map = new Map<string, string>();
    for (const o of src) {
      // Program revisions are re-validated: only the current released revision is carried over.
      let programRevisionId: string | null = null;
      if (o.programRevisionId) {
        const [r] = await tx.db.select({ p: cncPrograms }).from(cncProgramRevisions).innerJoin(cncPrograms, eq(cncPrograms.id, cncProgramRevisions.programId)).where(eq(cncProgramRevisions.id, o.programRevisionId));
        programRevisionId = r?.p.currentReleasedRevisionId ?? null;
      }
      const [n] = await tx.db
        .insert(operations)
        .values({
          jobId: line.jobId,
          jobLineId: targetLineId,
          sequence: o.sequence,
          opNumber: o.opNumber,
          operationTypeId: o.operationTypeId,
          title: o.title,
          instructions: o.instructions,
          machineGroupId: o.machineGroupId,
          machineId: o.machineId,
          setupMinutesEst: o.setupMinutesEst,
          cycleMinutesEst: o.cycleMinutesEst,
          plannedQty: line.quantity,
          requiresMaterial: o.requiresMaterial,
          requiresProgram: o.requiresProgram,
          requiresFirstOff: o.requiresFirstOff,
          firstOffStatus: o.requiresFirstOff ? "required" : "not_required",
          requiredCompetencyId: o.requiredCompetencyId,
          programRevisionId,
          drawingRevisionId: line.drawingRevisionId,
          inspectionPlanId: o.inspectionPlanId,
          toolingRequirements: o.toolingRequirements,
          fixtureRequirements: o.fixtureRequirements,
          allowParallel: o.allowParallel,
        })
        .returning();
      map.set(o.id, n.id);
    }
    const deps = await tx.db.select().from(operationDependencies).where(inArray(operationDependencies.operationId, src.map((s) => s.id)));
    for (const dp of deps) if (map.get(dp.operationId) && map.get(dp.dependsOnId)) await tx.db.insert(operationDependencies).values({ operationId: map.get(dp.operationId)!, dependsOnId: map.get(dp.dependsOnId)! });
    await audit(tx, { action: "route.copy", entityType: "job", entityId: line.jobId, jobId: line.jobId, after: { from: sourceLineId, operations: src.length } });
    return src.length;
  });
}

// ───────────── Batches & serials ─────────────

export async function createBatch(ctx: Ctx, jobLineId: string, quantity: string) {
  requirePermission(ctx, "routing.manage");
  return mutate(ctx, async (tx) => {
    const { line, job } = await loadLine(tx, jobLineId);
    const existing = await tx.db.select().from(batches).where(eq(batches.jobLineId, jobLineId));
    const batchNo = `${job.jobNumber}-L${line.lineNo}-B${existing.length + 1}`;
    const [b] = await tx.db.insert(batches).values({ jobLineId, batchNo, quantity }).returning();
    await audit(tx, { action: "batch.create", entityType: "batch", entityId: b.id, entityRef: batchNo, jobId: job.id, after: { quantity } });
    return b;
  });
}

/** Piece-level traceability: generates serial numbers for a line (only where configured). */
export async function generateSerials(ctx: Ctx, jobLineId: string, count: number, batchId?: string | null) {
  requirePermission(ctx, "routing.manage");
  if (count < 1 || count > 5000) throw invalid("Serial count must be between 1 and 5000.");
  return mutate(ctx, async (tx) => {
    const { line, job } = await loadLine(tx, jobLineId);
    if (line.traceabilityLevel !== "piece") throw invalid("This line is not configured for piece-level traceability.");
    const existing = await tx.db.select().from(serials).where(eq(serials.jobLineId, jobLineId));
    if (existing.length + count > Number(line.quantity)) throw invalid(`Cannot exceed the order quantity (${line.quantity}).`);
    const rows = Array.from({ length: count }, (_, i) => ({ jobLineId, batchId: batchId ?? null, serialNo: `${job.jobNumber}-${line.lineNo}-${String(existing.length + i + 1).padStart(4, "0")}` }));
    await tx.db.insert(serials).values(rows);
    await audit(tx, { action: "serials.generate", entityType: "job", entityId: job.id, entityRef: job.jobNumber, jobId: job.id, after: { line: line.lineNo, count } });
    return rows.length;
  });
}

// ───────────── Queries ─────────────

export async function jobRoute(ctx: Ctx, jobId: string) {
  requireAnyPermission(ctx, "jobs.view", "production.view_all", "production.execute");
  const ops = await ctx.db
    .select({ op: operations, type: operationTypes, machine: machines, program: cncPrograms, programRev: cncProgramRevisions, plan: inspectionPlans, competency: competencies })
    .from(operations)
    .innerJoin(operationTypes, eq(operationTypes.id, operations.operationTypeId))
    .leftJoin(machines, eq(machines.id, operations.machineId))
    .leftJoin(cncProgramRevisions, eq(cncProgramRevisions.id, operations.programRevisionId))
    .leftJoin(cncPrograms, eq(cncPrograms.id, cncProgramRevisions.programId))
    .leftJoin(inspectionPlans, eq(inspectionPlans.id, operations.inspectionPlanId))
    .leftJoin(competencies, eq(competencies.id, operations.requiredCompetencyId))
    .where(eq(operations.jobId, jobId))
    .orderBy(asc(operations.jobLineId), asc(operations.sequence));
  const ids = ops.map((o) => o.op.id);
  const [deps, assigns, docs] = ids.length
    ? await Promise.all([
        ctx.db.select().from(operationDependencies).where(inArray(operationDependencies.operationId, ids)),
        ctx.db.select({ a: operationAssignments, e: employees }).from(operationAssignments).innerJoin(employees, eq(employees.id, operationAssignments.employeeId)).where(and(inArray(operationAssignments.operationId, ids), eq(operationAssignments.isActive, true))),
        ctx.db.select({ od: operationDocuments, rev: documentRevisions, doc: controlledDocuments }).from(operationDocuments).innerJoin(documentRevisions, eq(documentRevisions.id, operationDocuments.documentRevisionId)).innerJoin(controlledDocuments, eq(controlledDocuments.id, documentRevisions.documentId)).where(inArray(operationDocuments.operationId, ids)),
      ])
    : [[], [], []];
  return ops.map((o) => ({
    ...o,
    dependsOn: deps.filter((x) => x.operationId === o.op.id).map((x) => ops.find((y) => y.op.id === x.dependsOnId)?.op.opNumber ?? "?"),
    dependsOnIds: deps.filter((x) => x.operationId === o.op.id).map((x) => x.dependsOnId),
    assignments: assigns.filter((a) => a.a.operationId === o.op.id),
    documents: docs.filter((x) => x.od.operationId === o.op.id),
  }));
}

export async function operationTypesList(ctx: Ctx, includeInactive = false) {
  return ctx.db.select().from(operationTypes).where(includeInactive ? undefined : eq(operationTypes.isActive, true)).orderBy(asc(operationTypes.sortOrder));
}

export async function saveOperationType(ctx: Ctx, input: { id?: string; code: string; name: string; category: string; requiresMachine: boolean; requiresProgramDefault: boolean; requiresFirstOffDefault: boolean; isSubcontract: boolean; isInspection: boolean; defaultCompetencyId?: string | null; defaultRatePerHour?: string | null; isActive: boolean; sortOrder?: number }) {
  requirePermission(ctx, "admin.config");
  if (!input.code.trim() || !input.name.trim()) throw invalid("Code and name are required.");
  return mutate(ctx, async (tx) => {
    const values = { ...input, code: input.code.trim().toUpperCase(), name: input.name.trim(), id: undefined };
    delete values.id;
    const [t] = input.id ? await tx.db.update(operationTypes).set(values).where(eq(operationTypes.id, input.id)).returning() : await tx.db.insert(operationTypes).values(values).returning();
    await audit(tx, { action: input.id ? "operation_type.update" : "operation_type.create", entityType: "operation_type", entityId: t.id, entityRef: t.code, after: values });
    return t;
  });
}

