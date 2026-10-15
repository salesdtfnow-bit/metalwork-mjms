import { and, asc, desc, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import {
  cncProgramRevisions,
  cncPrograms,
  controlledDocuments,
  documentRevisions,
  employees,
  files,
  holds,
  inspections,
  jobLines,
  jobs,
  machines,
  materialAllocations,
  materialLots,
  operationAssignments,
  operationChecks,
  operationDocuments,
  operationEvents,
  operations,
  operationTypes,
  timeEntries,
  users,
  operationTools,
  tools,
} from "../db/schema";
import { audit } from "../audit";
import { can, mutate, requirePermission, type Ctx } from "../context";
import { forbidden, GateError, invalid, notFound } from "../errors";
import { d } from "@/lib/decimal";
import { evaluateGates } from "./gates";
import { loadOp, refreshReadiness } from "./routing";
import { setMachineStatusInternal } from "./machines";
import { refreshJobStatus } from "./jobs";
import { openInspection, findApplicablePlan } from "./inspections";
import { notify } from "./notifications";

/** The employee acting on the shop floor (the signed-in user's employee record). */
function employeeOf(ctx: Ctx): string {
  if (!ctx.actor.employeeId) throw forbidden("Your user account is not linked to an employee record. Ask an administrator to link it.");
  return ctx.actor.employeeId;
}

async function assertAssigned(ctx: Ctx, opId: string, employeeId: string) {
  const a = await ctx.db.select().from(operationAssignments).where(and(eq(operationAssignments.operationId, opId), eq(operationAssignments.employeeId, employeeId), eq(operationAssignments.isActive, true))).limit(1);
  if (!a.length) throw forbidden("You are not assigned to this operation.");
}

async function openEntries(ctx: Ctx, opId: string, employeeId?: string) {
  return ctx.db.select().from(timeEntries).where(and(eq(timeEntries.operationId, opId), isNull(timeEntries.endedAt), employeeId ? eq(timeEntries.employeeId, employeeId) : undefined));
}

function blockOnGates(results: Awaited<ReturnType<typeof evaluateGates>>) {
  const failed = results.filter((r) => !r.ok);
  if (failed.length) throw new GateError(failed.map((f) => ({ gate: f.gate, message: f.message })));
}

// ───────────── Pre-start confirmations ─────────────

export async function confirmCheck(
  ctx: Ctx,
  opId: string,
  input: { kind: "drawing_reviewed" | "instructions_read" | "material_confirmed" | "program_confirmed"; materialLotId?: string | null; programRevisionId?: string | null; checksumPrefix?: string | null },
) {
  requirePermission(ctx, "production.execute");
  const employeeId = employeeOf(ctx);
  return mutate(ctx, async (tx) => {
    const { op, job } = await loadOp(tx, opId);
    await assertAssigned(tx, opId, employeeId);
    let drawingRevisionId: string | null = null;
    if (input.kind === "drawing_reviewed") {
      if (op.drawingRevisionId) {
        const [dr] = await tx.db.select().from(documentRevisions).where(eq(documentRevisions.id, op.drawingRevisionId));
        if (dr?.status !== "released") throw invalid(`Drawing revision ${dr?.revision} is ${dr?.status} — do not use it. Contact your supervisor.`);
        drawingRevisionId = dr.id;
      }
    }
    if (input.kind === "program_confirmed") {
      if (!op.programRevisionId) throw invalid("No program is assigned to this operation.");
      if (input.programRevisionId !== op.programRevisionId) throw invalid("That is not the program revision issued for this operation.");
      const [r] = await tx.db.select({ rev: cncProgramRevisions, p: cncPrograms }).from(cncProgramRevisions).innerJoin(cncPrograms, eq(cncPrograms.id, cncProgramRevisions.programId)).where(eq(cncProgramRevisions.id, op.programRevisionId));
      if (r.rev.status !== "released" || r.p.currentReleasedRevisionId !== r.rev.id) throw invalid(`Program ${r.p.programNumber} rev ${r.rev.revision} is no longer the released revision — stop and contact your supervisor.`);
      if (input.checksumPrefix && r.rev.checksum && !r.rev.checksum.toLowerCase().startsWith(input.checksumPrefix.trim().toLowerCase())) {
        throw invalid("The checksum on the machine does not match the released program file.");
      }
    }
    if (input.kind === "material_confirmed") {
      if (!input.materialLotId) throw invalid("Scan or select the material lot.", { field: "materialLotId" });
      const [alloc] = await tx.db
        .select({ lot: materialLots })
        .from(materialAllocations)
        .innerJoin(materialLots, eq(materialLots.id, materialAllocations.lotId))
        .where(and(eq(materialAllocations.jobId, job.id), eq(materialAllocations.lotId, input.materialLotId), ne(materialAllocations.status, "cancelled")))
        .limit(1);
      if (!alloc) throw invalid("This material lot is not allocated to this job.");
      if (alloc.lot.status !== "released") throw invalid(`Lot ${alloc.lot.lotNo} is ${alloc.lot.status.replace("_", " ")} — it must not be used.`);
    }
    await tx.db.insert(operationChecks).values({ operationId: opId, employeeId, kind: input.kind, materialLotId: input.materialLotId ?? null, programRevisionId: input.programRevisionId ?? null, drawingRevisionId });
    await audit(tx, { action: `operation.check_${input.kind}`, entityType: "operation", entityId: opId, entityRef: `${job.jobNumber}/${op.opNumber}`, jobId: job.id, operationId: opId, after: input });
  });
}

// ───────────── Setup ─────────────

export async function startSetup(ctx: Ctx, opId: string) {
  requirePermission(ctx, "production.execute");
  const employeeId = employeeOf(ctx);
  return mutate(ctx, async (tx) => {
    const { op, job } = await loadOp(tx, opId);
    if (!["ready", "pending", "paused"].includes(op.status) || op.setupStatus === "complete") {
      if (!(op.status === "in_setup" && op.firstOffStatus === "rejected")) throw invalid(`Setup cannot start: operation is ${op.status.replace("_", " ")}${op.setupStatus === "complete" ? " and setup is complete" : ""}.`);
    }
    if ((await openEntries(tx, opId, employeeId)).length) throw invalid("You already have an open time entry on this operation.");
    blockOnGates(await evaluateGates(tx, opId, { phase: "setup", employeeId }));
    await tx.db.insert(timeEntries).values({ operationId: opId, employeeId, machineId: op.machineId, kind: "setup", startedAt: new Date(), programRevisionId: op.programRevisionId, batchId: op.batchId });
    await tx.db.update(operations).set({ status: "in_setup", setupStatus: "in_setup", actualStart: op.actualStart ?? new Date() }).where(eq(operations.id, opId));
    if (op.machineId) await setMachineStatusInternal(tx, op.machineId, "setup", `Setup ${job.jobNumber} op ${op.opNumber}`, opId);
    await audit(tx, { action: "operation.setup_start", entityType: "operation", entityId: opId, entityRef: `${job.jobNumber}/${op.opNumber}`, jobId: job.id, operationId: opId });
    await refreshJobStatus(tx, job.id);
  });
}

/** Ends setup. If first-off is required, production stays blocked and a first-off inspection is opened. */
export async function finishSetup(ctx: Ctx, opId: string, notes?: string | null) {
  requirePermission(ctx, "production.execute");
  const employeeId = employeeOf(ctx);
  return mutate(ctx, async (tx) => {
    const { op, job, line } = await loadOp(tx, opId);
    if (op.status !== "in_setup") throw invalid("Operation is not in setup.");
    const entries = await openEntries(tx, opId, employeeId);
    if (!entries.some((e) => e.kind === "setup")) throw invalid("You have no open setup on this operation.");
    for (const e of entries.filter((x) => x.kind === "setup")) await tx.db.update(timeEntries).set({ endedAt: new Date(), notes: notes ?? null }).where(eq(timeEntries.id, e.id));
    let inspectionRef: string | null = null;
    if (op.requiresFirstOff && op.firstOffStatus !== "approved") {
      const planId = op.inspectionPlanId ?? (await findApplicablePlan(tx, { stage: "first_off", jobId: job.id, partId: line.partId, customerId: job.customerId, operationTypeId: op.operationTypeId }))?.id ?? null;
      const insp = await openInspection(tx, {
        stage: "first_off",
        planId,
        jobId: job.id,
        jobLineId: line.id,
        operationId: opId,
        batchId: op.batchId,
        drawingRevisionId: op.drawingRevisionId,
        programRevisionId: op.programRevisionId,
        machineId: op.machineId,
        setupOperatorId: employeeId,
        sampleQty: "1",
      });
      inspectionRef = insp.ref;
      await tx.db.update(operations).set({ setupStatus: "complete", status: "awaiting_first_off", firstOffStatus: "requested" }).where(eq(operations.id, opId));
    } else {
      await tx.db.update(operations).set({ setupStatus: "complete", status: "paused" }).where(eq(operations.id, opId));
    }
    if (op.machineId) await setMachineStatusInternal(tx, op.machineId, "available", `Setup complete ${job.jobNumber} op ${op.opNumber}`, opId);
    await audit(tx, { action: "operation.setup_finish", entityType: "operation", entityId: opId, entityRef: `${job.jobNumber}/${op.opNumber}`, jobId: job.id, operationId: opId, after: { firstOffInspection: inspectionRef }, reason: notes });
    await refreshJobStatus(tx, job.id);
    return { firstOffInspection: inspectionRef };
  });
}

// ───────────── Production runs ─────────────

/** Starts a production run. Records the exact program revision and material lot used. */
export async function startProduction(ctx: Ctx, opId: string, input: { materialLotId?: string | null } = {}) {
  requirePermission(ctx, "production.execute");
  const employeeId = employeeOf(ctx);
  return mutate(ctx, async (tx) => {
    const { op, job } = await loadOp(tx, opId);
    // awaiting_first_off / on_hold fall through so the operator sees the specific gate failure.
    if (!["paused", "ready", "awaiting_first_off", "on_hold"].includes(op.status)) throw invalid(`Production cannot start: operation is ${op.status.replace(/_/g, " ")}.`);
    if (op.setupStatus !== "complete") throw invalid("Complete the setup first.");
    if ((await openEntries(tx, opId, employeeId)).length) throw invalid("You already have an open time entry on this operation.");
    blockOnGates(await evaluateGates(tx, opId, { phase: "production", employeeId }));
    let lotId = input.materialLotId ?? null;
    if (!lotId) {
      const [c] = await tx.db.select().from(operationChecks).where(and(eq(operationChecks.operationId, opId), eq(operationChecks.employeeId, employeeId), eq(operationChecks.kind, "material_confirmed"))).orderBy(desc(operationChecks.at)).limit(1);
      lotId = c?.materialLotId ?? null;
    }
    await tx.db.insert(timeEntries).values({ operationId: opId, employeeId, machineId: op.machineId, kind: op.isRework ? "rework" : "production", startedAt: new Date(), programRevisionId: op.programRevisionId, materialLotId: lotId, batchId: op.batchId });
    await tx.db.update(operations).set({ status: "in_production" }).where(eq(operations.id, opId));
    if (op.machineId) await setMachineStatusInternal(tx, op.machineId, "running", `Running ${job.jobNumber} op ${op.opNumber}`, opId);
    await audit(tx, { action: "operation.production_start", entityType: "operation", entityId: opId, entityRef: `${job.jobNumber}/${op.opNumber}`, jobId: job.id, operationId: opId, after: { programRevisionId: op.programRevisionId, materialLotId: lotId } });
    await refreshJobStatus(tx, job.id);
  });
}

/** Stops the run and records quantities produced, rejected and scrapped in this run. */
export async function stopProduction(ctx: Ctx, opId: string, input: { qtyGood: string; qtyRejected?: string; qtyScrapped?: string; notes?: string | null }) {
  requirePermission(ctx, "production.execute");
  const employeeId = employeeOf(ctx);
  const good = d(input.qtyGood || 0);
  const rej = d(input.qtyRejected || 0);
  const scr = d(input.qtyScrapped || 0);
  if (good.isNegative() || rej.isNegative() || scr.isNegative()) throw invalid("Quantities cannot be negative.");
  return mutate(ctx, async (tx) => {
    const { op, job } = await loadOp(tx, opId);
    const entries = (await openEntries(tx, opId, employeeId)).filter((e) => ["production", "rework"].includes(e.kind));
    if (!entries.length) throw invalid("You have no running production on this operation.");
    const total = d(op.qtyGood).plus(good).plus(d(op.qtyRejected)).plus(rej).plus(d(op.qtyScrapped)).plus(scr);
    if (total.greaterThan(d(op.plannedQty).times(1.2).plus(5))) throw invalid(`Recorded quantities (${total}) far exceed the planned quantity (${d(op.plannedQty)}). Check the figures.`);
    await tx.db.update(timeEntries).set({ endedAt: new Date(), qtyGood: good.toString(), qtyRejected: rej.toString(), qtyScrapped: scr.toString(), notes: input.notes ?? null }).where(eq(timeEntries.id, entries[0].id));
    await tx.db
      .update(operations)
      .set({ status: "paused", qtyGood: d(op.qtyGood).plus(good).toString(), qtyRejected: d(op.qtyRejected).plus(rej).toString(), qtyScrapped: d(op.qtyScrapped).plus(scr).toString() })
      .where(eq(operations.id, opId));
    if (op.machineId) await setMachineStatusInternal(tx, op.machineId, "available", `Stopped ${job.jobNumber} op ${op.opNumber}`, opId);
    await audit(tx, { action: "operation.production_stop", entityType: "operation", entityId: opId, entityRef: `${job.jobNumber}/${op.opNumber}`, jobId: job.id, operationId: opId, after: { good: good.toString(), rejected: rej.toString(), scrapped: scr.toString() }, reason: input.notes });
    await refreshJobStatus(tx, job.id);
    return { suggestNcr: rej.greaterThan(0) || scr.greaterThan(0) };
  });
}

// ───────────── Notes, assistance, holds ─────────────

export async function addOperationEvent(ctx: Ctx, opId: string, kind: "note" | "issue" | "assist_request", message: string) {
  requirePermission(ctx, "production.execute");
  if (!message?.trim()) throw invalid("Enter a message.", { field: "message" });
  return mutate(ctx, async (tx) => {
    const { op, job } = await loadOp(tx, opId);
    await tx.db.insert(operationEvents).values({ operationId: opId, kind, message: message.trim(), userId: ctx.actor.userId, employeeId: ctx.actor.employeeId });
    await audit(tx, { action: `operation.${kind}`, entityType: "operation", entityId: opId, entityRef: `${job.jobNumber}/${op.opNumber}`, jobId: job.id, operationId: opId, reason: message });
    if (kind === "assist_request" || kind === "issue") {
      await notify(tx, { type: "assist.requested", title: `${kind === "assist_request" ? "Assistance requested" : "Issue reported"}: ${job.jobNumber} op ${op.opNumber}`, body: message, link: `/jobs/${job.id}?tab=route`, permission: "production.supervise", excludeActor: true });
    }
  });
}

export async function resolveOperationEvent(ctx: Ctx, eventId: string) {
  requirePermission(ctx, "production.supervise");
  return mutate(ctx, async (tx) => {
    const [e] = await tx.db.update(operationEvents).set({ resolvedBy: ctx.actor.userId, resolvedAt: new Date() }).where(eq(operationEvents.id, eventId)).returning();
    if (!e) throw notFound("Event");
    await audit(tx, { action: "operation.event_resolved", entityType: "operation", entityId: e.operationId, operationId: e.operationId });
  });
}

export async function holdOperation(ctx: Ctx, opId: string, reason: string) {
  if (!can(ctx.actor, "production.execute") && !can(ctx.actor, "production.supervise")) throw forbidden();
  if (!reason?.trim()) throw invalid("Give a reason for the hold.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const { op, job } = await loadOp(tx, opId);
    if (["complete", "cancelled"].includes(op.status)) throw invalid(`Operation is ${op.status}.`);
    for (const e of await openEntries(tx, opId)) await tx.db.update(timeEntries).set({ endedAt: new Date(), notes: `Stopped: hold — ${reason}` }).where(eq(timeEntries.id, e.id));
    await tx.db.insert(holds).values({ targetType: "operation", operationId: opId, jobId: job.id, reason, placedBy: ctx.actor.userId });
    if (op.status !== "on_hold") await tx.db.update(operations).set({ status: "on_hold", statusBeforeHold: op.status }).where(eq(operations.id, opId));
    if (op.machineId && ["in_setup", "in_production"].includes(op.status)) await setMachineStatusInternal(tx, op.machineId, "available", `Hold on ${job.jobNumber} op ${op.opNumber}`, opId);
    await tx.db.insert(operationEvents).values({ operationId: opId, kind: "hold", message: reason, userId: ctx.actor.userId, employeeId: ctx.actor.employeeId });
    await audit(tx, { action: "operation.hold", entityType: "operation", entityId: opId, entityRef: `${job.jobNumber}/${op.opNumber}`, jobId: job.id, operationId: opId, reason });
    await notify(tx, { type: "assist.requested", title: `${job.jobNumber} op ${op.opNumber} placed on hold`, body: reason, link: `/jobs/${job.id}?tab=route`, permission: "production.supervise", excludeActor: true });
  });
}

// ───────────── Inspection & sign-off ─────────────

export async function submitForInspection(ctx: Ctx, opId: string) {
  requirePermission(ctx, "production.execute");
  const employeeId = employeeOf(ctx);
  return mutate(ctx, async (tx) => {
    const { op, job, line } = await loadOp(tx, opId);
    await assertAssigned(tx, opId, employeeId);
    if (!["paused", "ready"].includes(op.status)) throw invalid("Stop production before submitting for inspection.");
    if ((await openEntries(tx, opId)).length) throw invalid("Close all open time entries first.");
    const planId = op.inspectionPlanId ?? (await findApplicablePlan(tx, { stage: "in_process", jobId: job.id, partId: line.partId, customerId: job.customerId, operationTypeId: op.operationTypeId }))?.id ?? null;
    const insp = await openInspection(tx, { stage: "in_process", planId, jobId: job.id, jobLineId: line.id, operationId: opId, batchId: op.batchId, drawingRevisionId: op.drawingRevisionId, programRevisionId: op.programRevisionId, machineId: op.machineId, setupOperatorId: employeeId, sampleQty: op.qtyGood });
    await tx.db.update(operations).set({ status: "awaiting_inspection" }).where(eq(operations.id, opId));
    await audit(tx, { action: "operation.submit_inspection", entityType: "operation", entityId: opId, entityRef: `${job.jobNumber}/${op.opNumber}`, jobId: job.id, operationId: opId, after: { inspection: insp.ref } });
    await refreshJobStatus(tx, job.id);
    return insp;
  });
}

/**
 * Operator sign-off. Requires: no open time, quantities accounted for (or a shortfall
 * reason), first-off approved if required, every inspection on the op passed, no holds.
 * Completion is never just "clicked" — the evidence must exist.
 */
export async function signOffOperation(ctx: Ctx, opId: string, input: { note?: string | null; shortfallReason?: string | null } = {}) {
  requirePermission(ctx, "production.execute");
  const employeeId = employeeOf(ctx);
  return mutate(ctx, async (tx) => {
    const { op, job, type } = await loadOp(tx, opId);
    await assertAssigned(tx, opId, employeeId);
    if (!["paused", "ready"].includes(op.status)) throw invalid(`Operation cannot be signed off while ${op.status.replace(/_/g, " ")}.`);
    const fails: { gate: string; message: string }[] = [];
    if ((await openEntries(tx, opId)).length) fails.push({ gate: "time", message: "There are open time entries on this operation." });
    if (op.requiresFirstOff && op.firstOffStatus !== "approved") fails.push({ gate: "first_off", message: "First-off has not been approved." });
    const accounted = d(op.qtyGood).plus(d(op.qtyRejected)).plus(d(op.qtyScrapped));
    if (!type.isInspection && accounted.lessThan(d(op.plannedQty)) && !input.shortfallReason?.trim()) {
      fails.push({ gate: "quantity", message: `Only ${accounted} of ${d(op.plannedQty)} accounted for — record the remaining quantity or give a shortfall reason.` });
    }
    if (!type.isInspection && d(op.qtyGood).isZero()) fails.push({ gate: "quantity", message: "No good parts have been recorded." });
    const opInsp = await tx.db.select().from(inspections).where(eq(inspections.operationId, opId));
    // A failed inspection is governed by its NCR once a disposition has been approved.
    const { ncrs } = await import("../db/schema");
    const dispositioned = opInsp.length
      ? (await tx.db.select({ inspectionId: ncrs.inspectionId, disposition: ncrs.disposition }).from(ncrs).where(inArray(ncrs.inspectionId, opInsp.map((i) => i.id)))).filter((n) => n.disposition && n.disposition !== "awaiting_investigation")
      : [];
    const bad = opInsp.filter((i) => i.stage !== "first_off" && !["passed", "cancelled"].includes(i.status) && !(i.status === "failed" && dispositioned.some((n) => n.inspectionId === i.id)));
    if (bad.length) fails.push({ gate: "inspection", message: `Inspection(s) not passed: ${bad.map((b) => `${b.ref} (${b.status})`).join(", ")}.` });
    const activeHolds = await tx.db.select().from(holds).where(and(eq(holds.operationId, opId), isNull(holds.releasedAt)));
    if (activeHolds.length) fails.push({ gate: "hold", message: "The operation has an active hold." });
    if (op.reviewRequired) fails.push({ gate: "review", message: `Revision review pending: ${op.reviewReason}` });
    if (fails.length) throw new GateError(fails);
    await tx.db.update(operations).set({ status: "complete", actualEnd: new Date(), signedOffBy: ctx.actor.userId, signedOffAt: new Date(), signOffNote: [input.note, input.shortfallReason && `Shortfall: ${input.shortfallReason}`].filter(Boolean).join("\n") || null }).where(eq(operations.id, opId));
    await audit(tx, { action: "operation.sign_off", entityType: "operation", entityId: opId, entityRef: `${job.jobNumber}/${op.opNumber}`, jobId: job.id, operationId: opId, after: { good: op.qtyGood, rejected: op.qtyRejected, scrapped: op.qtyScrapped }, reason: input.shortfallReason ?? input.note });
    // Update line quantities from the final operation of the route.
    const lineOps = await tx.db.select().from(operations).where(and(eq(operations.jobLineId, op.jobLineId), ne(operations.status, "cancelled"), eq(operations.isRework, false))).orderBy(desc(operations.sequence));
    const lastProd = lineOps[0];
    if (lastProd?.id === opId) {
      await tx.db.update(jobLines).set({ qtyGood: op.qtyGood }).where(eq(jobLines.id, op.jobLineId));
    }
    await tx.db
      .update(jobLines)
      .set({ qtyRejected: sql`(select coalesce(sum(qty_rejected),0) from operations where job_line_id = ${op.jobLineId})`, qtyScrapped: sql`(select coalesce(sum(qty_scrapped),0) from operations where job_line_id = ${op.jobLineId})` })
      .where(eq(jobLines.id, op.jobLineId));
    if (op.isRework && op.ncrId) {
      const { onReworkComplete } = await import("./ncr");
      await onReworkComplete(tx, op.ncrId, opId);
    }
    const ready = await refreshReadiness(tx, job.id);
    for (const nextId of ready) {
      const assignees = await tx.db.select({ userId: users.id }).from(operationAssignments).innerJoin(users, eq(users.employeeId, operationAssignments.employeeId)).where(and(eq(operationAssignments.operationId, nextId), eq(operationAssignments.isActive, true)));
      const [n] = await tx.db.select().from(operations).where(eq(operations.id, nextId));
      await notify(tx, { type: "operation.ready", title: `${job.jobNumber} op ${n.opNumber} is ready for you`, link: `/shopfloor/op/${nextId}`, userIds: assignees.map((a) => a.userId), dedupeKey: `ready:${nextId}` });
    }
    await refreshJobStatus(tx, job.id);
  });
}

// ───────────── Operator & supervisor views ─────────────

/** Everything the operator dashboard needs, limited to the signed-in operator's work. */
export async function myWork(ctx: Ctx) {
  requirePermission(ctx, "production.execute");
  const employeeId = employeeOf(ctx);
  const rows = await ctx.db
    .select({ op: operations, job: jobs, line: jobLines, type: operationTypes, machine: machines })
    .from(operationAssignments)
    .innerJoin(operations, eq(operations.id, operationAssignments.operationId))
    .innerJoin(jobs, eq(jobs.id, operations.jobId))
    .innerJoin(jobLines, eq(jobLines.id, operations.jobLineId))
    .innerJoin(operationTypes, eq(operationTypes.id, operations.operationTypeId))
    .leftJoin(machines, eq(machines.id, operations.machineId))
    .where(and(eq(operationAssignments.employeeId, employeeId), eq(operationAssignments.isActive, true), notInArray(jobs.status, ["cancelled", "completed"])))
    .orderBy(asc(jobs.priority), sql`${operations.plannedStart} asc nulls last`, sql`${jobs.requiredDate} asc nulls last`);
  const active = rows.filter((r) => ["in_setup", "in_production", "awaiting_first_off"].includes(r.op.status));
  const ready = rows.filter((r) => ["ready", "paused"].includes(r.op.status));
  const pending = rows.filter((r) => r.op.status === "pending");
  const onHold = rows.filter((r) => r.op.status === "on_hold");
  const awaitingInspection = rows.filter((r) => r.op.status === "awaiting_inspection");
  const completed = rows.filter((r) => r.op.status === "complete").slice(-10).reverse();
  const open = await ctx.db.select().from(timeEntries).where(and(eq(timeEntries.employeeId, employeeId), isNull(timeEntries.endedAt)));
  const history = await ctx.db
    .select({ t: timeEntries, op: operations, job: jobs })
    .from(timeEntries)
    .innerJoin(operations, eq(operations.id, timeEntries.operationId))
    .innerJoin(jobs, eq(jobs.id, operations.jobId))
    .where(eq(timeEntries.employeeId, employeeId))
    .orderBy(desc(timeEntries.startedAt))
    .limit(20);
  const [emp] = await ctx.db.select().from(employees).where(eq(employees.id, employeeId));
  return { employee: emp, active, ready, pending, onHold, awaitingInspection, completed, openEntries: open, history, next: ready[0] ?? pending[0] ?? null };
}

/** Operator view of a single operation (only the released program/drawing are exposed). */
export async function operationWorkspace(ctx: Ctx, opId: string) {
  if (!can(ctx.actor, "production.execute") && !can(ctx.actor, "production.view_all")) throw forbidden();
  const { op, job, line, type } = await loadOp(ctx, opId);
  if (!can(ctx.actor, "production.view_all")) {
    const employeeId = employeeOf(ctx);
    await assertAssigned(ctx, opId, employeeId);
  }
  const [machine, programRow, drawing, docs, opTools, lots, checks, entries, events, insp, assigns] = await Promise.all([
    op.machineId ? ctx.db.select().from(machines).where(eq(machines.id, op.machineId)) : Promise.resolve([]),
    op.programRevisionId
      ? ctx.db.select({ rev: cncProgramRevisions, p: cncPrograms, f: files }).from(cncProgramRevisions).innerJoin(cncPrograms, eq(cncPrograms.id, cncProgramRevisions.programId)).innerJoin(files, eq(files.id, cncProgramRevisions.fileId)).where(eq(cncProgramRevisions.id, op.programRevisionId))
      : Promise.resolve([]),
    op.drawingRevisionId
      ? ctx.db.select({ rev: documentRevisions, doc: controlledDocuments }).from(documentRevisions).innerJoin(controlledDocuments, eq(controlledDocuments.id, documentRevisions.documentId)).where(eq(documentRevisions.id, op.drawingRevisionId))
      : Promise.resolve([]),
    ctx.db.select({ od: operationDocuments, rev: documentRevisions, doc: controlledDocuments }).from(operationDocuments).innerJoin(documentRevisions, eq(documentRevisions.id, operationDocuments.documentRevisionId)).innerJoin(controlledDocuments, eq(controlledDocuments.id, documentRevisions.documentId)).where(eq(operationDocuments.operationId, opId)),
    ctx.db.select({ ot: operationTools, t: tools }).from(operationTools).innerJoin(tools, eq(tools.id, operationTools.toolId)).where(eq(operationTools.operationId, opId)),
    ctx.db.select({ a: materialAllocations, lot: materialLots }).from(materialAllocations).innerJoin(materialLots, eq(materialLots.id, materialAllocations.lotId)).where(and(eq(materialAllocations.jobId, job.id), ne(materialAllocations.status, "cancelled"))),
    ctx.actor.employeeId ? ctx.db.select().from(operationChecks).where(and(eq(operationChecks.operationId, opId), eq(operationChecks.employeeId, ctx.actor.employeeId))) : Promise.resolve([]),
    ctx.db.select({ t: timeEntries, e: employees }).from(timeEntries).innerJoin(employees, eq(employees.id, timeEntries.employeeId)).where(eq(timeEntries.operationId, opId)).orderBy(desc(timeEntries.startedAt)),
    ctx.db.select({ ev: operationEvents, user: users.name }).from(operationEvents).leftJoin(users, eq(users.id, operationEvents.userId)).where(eq(operationEvents.operationId, opId)).orderBy(desc(operationEvents.at)),
    ctx.db.select().from(inspections).where(eq(inspections.operationId, opId)).orderBy(desc(inspections.requestedAt)),
    ctx.db.select({ a: operationAssignments, e: employees }).from(operationAssignments).innerJoin(employees, eq(employees.id, operationAssignments.employeeId)).where(and(eq(operationAssignments.operationId, opId), eq(operationAssignments.isActive, true))),
  ]);
  const program = programRow[0] ?? null;
  const programUsable = !!program && program.rev.status === "released" && program.p.currentReleasedRevisionId === program.rev.id;
  const gates = ctx.actor.employeeId ? await evaluateGates(ctx, opId, { phase: op.setupStatus === "complete" ? "production" : "setup", employeeId: ctx.actor.employeeId }) : [];
  return {
    op,
    job,
    line,
    type,
    machine: machine[0] ?? null,
    program: program ? { ...program, usable: programUsable } : null,
    drawing: drawing[0] ?? null,
    documents: docs.filter((x) => x.rev.status === "released" || can(ctx.actor, "documents.upload")),
    tools: opTools,
    lots,
    checks,
    entries,
    events,
    inspections: insp,
    assignments: assigns,
    gates,
    myOpenEntry: entries.find((e) => !e.t.endedAt && e.t.employeeId === ctx.actor.employeeId)?.t ?? null,
  };
}

