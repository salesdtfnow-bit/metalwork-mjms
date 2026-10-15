"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/server/action";
import { f } from "@/server/forms";
import { authoriseJob, cancelJob, holdJob, releaseJobHold, transitionJob, updateJob } from "@/server/services/jobs";
import {
  addOperation,
  assignOperator,
  attachOperationDocument,
  cancelOperation,
  clearOperationReview,
  copyRoute,
  createBatch,
  generateSerials,
  releaseRoute,
  reorderOperations,
  repeatOperation,
  setDependencies,
  splitOperation,
  unassignOperator,
  updateOperation,
} from "@/server/services/routing";
import { OVERRIDABLE, recordGateException, revokeGateException, type Gate } from "@/server/services/gates";
import { allocateLot, recordMaterialEvent } from "@/server/services/materials";
import { createRequisition } from "@/server/services/purchasing";
import { prepareRelease } from "@/server/services/release";
import type { JobStatus } from "@/lib/status";

const jobPath = (i: { jobId: string }) => [`/jobs/${i.jobId}`, "/jobs"];

/** "yes" / "no" / blank (use the operation type default). */
const tri = () => z.preprocess((v) => (v === "yes" ? true : v === "no" ? false : undefined), z.boolean().optional());
const minutes = () => f.dec({ msg: "Enter minutes (0 or more)." });

// ───────────── Job record ─────────────

export const updateJobAction = action(
  "job.update",
  z.object({
    jobId: f.uuid(),
    title: f.str("Title is required."),
    priority: f.int({ min: 1, max: 4 }),
    ownerId: f.optUuid(),
    requiredDate: f.optDate(),
    promisedDate: f.optDate(),
    deliveryAddressId: f.optUuid(),
    materialRequirements: f.optStr(),
    inspectionRequirements: f.optStr(),
    certificationRequirements: f.optStr(),
    packagingRequirements: f.optStr(),
    deliveryRequirements: f.optStr(),
    nextAction: f.optStr(),
    notes: f.optStr(),
    reason: f.optStr(),
  }),
  async (ctx, { jobId, reason, ...data }) => {
    await updateJob(ctx, jobId, data, reason);
    return "Job details saved.";
  },
  { revalidate: jobPath },
);

export const transitionJobAction = action(
  "job.transition",
  z.object({ jobId: f.uuid(), to: f.str("Select the new status."), reason: f.optStr() }),
  async (ctx, { jobId, to, reason }) => {
    await transitionJob(ctx, jobId, to as JobStatus, reason);
    return "Job status changed.";
  },
  { revalidate: jobPath },
);

export const authoriseJobAction = action(
  "job.authorise",
  z.object({ jobId: f.uuid() }),
  async (ctx, { jobId }) => {
    await authoriseJob(ctx, jobId);
    return "Job authorised for material purchasing and production.";
  },
  { revalidate: jobPath },
);

export const holdJobAction = action(
  "job.hold",
  z.object({ jobId: f.uuid(), reason: f.str("Give the reason for the hold.") }),
  async (ctx, { jobId, reason }) => {
    await holdJob(ctx, jobId, reason);
    return "Job placed on hold.";
  },
  { revalidate: jobPath },
);

export const releaseJobHoldAction = action(
  "job.hold_release",
  z.object({ jobId: f.uuid(), reason: f.str("Record why the hold can be released.") }),
  async (ctx, { jobId, reason }) => {
    await releaseJobHold(ctx, jobId, reason);
    return "Hold released.";
  },
  { revalidate: jobPath },
);

export const cancelJobAction = action(
  "job.cancel",
  z.object({ jobId: f.uuid(), reason: f.str("Give the reason for cancelling.") }),
  async (ctx, { jobId, reason }) => {
    await cancelJob(ctx, jobId, reason);
    return "Job cancelled.";
  },
  { revalidate: jobPath },
);

// ───────────── Lines: batches & serials ─────────────

export const createBatchAction = action(
  "job.batch_create",
  z.object({ jobId: f.uuid(), jobLineId: f.uuid(), quantity: f.dec({ min: 0, msg: "Enter the batch quantity." }) }),
  async (ctx, { jobLineId, quantity }) => {
    const b = await createBatch(ctx, jobLineId, quantity);
    return `Batch ${b.batchNo} created.`;
  },
  { revalidate: jobPath },
);

export const generateSerialsAction = action(
  "job.serials_generate",
  z.object({ jobId: f.uuid(), jobLineId: f.uuid(), count: f.int({ min: 1, max: 5000 }), batchId: f.optUuid() }),
  async (ctx, { jobLineId, count, batchId }) => {
    const n = await generateSerials(ctx, jobLineId, count, batchId);
    return `${n} serial number(s) generated.`;
  },
  { revalidate: jobPath },
);

// ───────────── Route ─────────────

const opFields = {
  title: f.str("Describe the operation."),
  machineId: f.optUuid(),
  machineGroupId: f.optUuid(),
  setupMinutesEst: minutes(),
  cycleMinutesEst: minutes(),
  plannedQty: f.optDec(),
  programRevisionId: f.optUuid(),
  inspectionPlanId: f.optUuid(),
  requiredCompetencyId: f.optUuid(),
  instructions: f.optStr(),
  toolingRequirements: f.optStr(),
  fixtureRequirements: f.optStr(),
  reason: f.optStr(),
};

/** Operation columns shared by the add and edit forms (keeps routing keys like jobId out of the payload). */
function pickOp(i: {
  title: string;
  machineId: string | null;
  machineGroupId: string | null;
  setupMinutesEst: string;
  cycleMinutesEst: string;
  inspectionPlanId: string | null;
  instructions: string | null;
  toolingRequirements: string | null;
  fixtureRequirements: string | null;
}) {
  return {
    title: i.title,
    machineId: i.machineId,
    machineGroupId: i.machineGroupId,
    setupMinutesEst: i.setupMinutesEst,
    cycleMinutesEst: i.cycleMinutesEst,
    inspectionPlanId: i.inspectionPlanId,
    instructions: i.instructions,
    toolingRequirements: i.toolingRequirements,
    fixtureRequirements: i.fixtureRequirements,
  };
}

export const addOperationAction = action(
  "operation.add",
  z.object({
    jobId: f.uuid(),
    jobLineId: f.uuid(),
    operationTypeId: f.uuid("Select an operation type."),
    ...opFields,
    requiresMaterial: tri(),
    requiresProgram: tri(),
    requiresFirstOff: tri(),
    allowParallel: f.bool(),
    dependsOn: f.enumOf(["previous", "none"] as const),
  }),
  async (ctx, i) => {
    const op = await addOperation(
      ctx,
      i.jobLineId,
      {
        ...pickOp(i),
        operationTypeId: i.operationTypeId,
        programRevisionId: i.programRevisionId,
        // Blank = operation type default / line quantity.
        requiredCompetencyId: i.requiredCompetencyId ?? undefined,
        plannedQty: i.plannedQty ?? undefined,
        requiresMaterial: i.requiresMaterial,
        requiresProgram: i.requiresProgram,
        requiresFirstOff: i.requiresFirstOff,
        allowParallel: i.allowParallel,
      },
      { dependsOn: i.dependsOn, reason: i.reason },
    );
    return `Operation ${op.opNumber} added.`;
  },
  { revalidate: jobPath },
);

export const updateOperationAction = action(
  "operation.update",
  z.object({
    jobId: f.uuid(),
    opId: f.uuid(),
    operationTypeId: f.optUuid(),
    currentProgramRevisionId: f.optUuid(),
    ...opFields,
    requiresMaterial: f.bool(),
    requiresProgram: f.bool(),
    requiresFirstOff: f.bool(),
    // Always sent: the service schema defaults it to false when omitted.
    allowParallel: f.bool(),
  }),
  async (ctx, i) => {
    await updateOperation(
      ctx,
      i.opId,
      {
        ...pickOp(i),
        requiredCompetencyId: i.requiredCompetencyId,
        requiresMaterial: i.requiresMaterial,
        requiresProgram: i.requiresProgram,
        requiresFirstOff: i.requiresFirstOff,
        allowParallel: i.allowParallel,
        ...(i.operationTypeId ? { operationTypeId: i.operationTypeId } : {}),
        // Only send the program when it changed (the pinned one is re-validated otherwise).
        ...(i.programRevisionId !== i.currentProgramRevisionId ? { programRevisionId: i.programRevisionId } : {}),
        ...(i.plannedQty ? { plannedQty: i.plannedQty } : {}),
      },
      i.reason,
    );
    return "Operation updated.";
  },
  { revalidate: jobPath },
);

export const setDependenciesAction = action(
  "operation.dependencies",
  z.object({ jobId: f.uuid(), opId: f.uuid(), dependsOn: f.uuids(), reason: f.optStr() }),
  async (ctx, { opId, dependsOn, reason }) => {
    await setDependencies(ctx, opId, dependsOn, reason);
    return dependsOn.length ? "Dependencies saved." : "Dependencies cleared — the operation can run in parallel.";
  },
  { revalidate: jobPath },
);

export const reorderOperationsAction = action(
  "route.reorder",
  z.object({ jobId: f.uuid(), jobLineId: f.uuid(), order: f.str() }),
  async (ctx, { jobLineId, order }) => {
    // No success message: the table simply re-renders in the new order.
    await reorderOperations(ctx, jobLineId, order.split(",").filter(Boolean));
  },
  { revalidate: jobPath },
);

export const splitOperationAction = action(
  "operation.split",
  z.object({ jobId: f.uuid(), opId: f.uuid(), quantities: f.str("Enter the split quantities."), reason: f.str("Give a reason for splitting.") }),
  async (ctx, { opId, quantities, reason }) => {
    const qs = quantities
      .split(/[,;\s]+/)
      .map((q) => q.trim())
      .filter(Boolean);
    if (qs.some((q) => !/^\d+(\.\d+)?$/.test(q))) return { ok: false, error: "Quantities must be numbers separated by commas.", fieldErrors: { quantities: "Use numbers separated by commas, e.g. 20, 30." } };
    const created = await splitOperation(ctx, opId, qs, reason);
    return `Operation split into ${created.length} batches.`;
  },
  { revalidate: jobPath },
);

export const repeatOperationAction = action(
  "operation.repeat",
  z.object({ jobId: f.uuid(), opId: f.uuid(), reason: f.str("Give a reason.") }),
  async (ctx, { opId, reason }) => {
    const n = await repeatOperation(ctx, opId, reason);
    return `Repeat operation ${n.opNumber} added.`;
  },
  { revalidate: jobPath },
);

export const cancelOperationAction = action(
  "operation.cancel",
  z.object({ jobId: f.uuid(), opId: f.uuid(), reason: f.str("A reason is required.") }),
  async (ctx, { opId, reason }) => {
    await cancelOperation(ctx, opId, reason);
    return "Operation cancelled.";
  },
  { revalidate: jobPath },
);

export const assignOperatorAction = action(
  "operation.assign",
  z.object({ jobId: f.uuid(), opId: f.uuid(), employeeId: f.uuid("Select an employee."), role: f.enumOf(["operator", "setter", "inspector"] as const) }),
  async (ctx, { opId, employeeId, role }) => {
    await assignOperator(ctx, opId, employeeId, role);
    return "Assigned.";
  },
  { revalidate: jobPath },
);

export const unassignOperatorAction = action(
  "operation.unassign",
  z.object({ jobId: f.uuid(), assignmentId: f.uuid(), reason: f.str("Give a reason.") }),
  async (ctx, { assignmentId, reason }) => {
    await unassignOperator(ctx, assignmentId, reason);
    return "Assignment removed.";
  },
  { revalidate: jobPath },
);

export const attachOperationDocumentAction = action(
  "operation.document_attach",
  z.object({
    jobId: f.uuid(),
    opId: f.uuid(),
    documentRevisionId: f.uuid("Select a released document revision."),
    purpose: f.enumOf(["drawing", "setup_sheet", "work_instruction", "reference"] as const),
  }),
  async (ctx, { opId, documentRevisionId, purpose }) => {
    await attachOperationDocument(ctx, opId, documentRevisionId, purpose);
    return "Document issued to the operation.";
  },
  { revalidate: jobPath },
);

export const clearReviewAction = action(
  "operation.review_clear",
  z.object({ jobId: f.uuid(), opId: f.uuid(), programRevisionId: f.optUuid(), drawingRevisionId: f.optUuid(), reason: f.str("Record the review decision.") }),
  async (ctx, { opId, ...input }) => {
    await clearOperationReview(ctx, opId, input);
    return "Review cleared.";
  },
  { revalidate: jobPath },
);

export const recordGateExceptionAction = action(
  "gate.exception",
  z.object({
    jobId: f.uuid(),
    opId: f.uuid(),
    gate: f.enumOf(OVERRIDABLE as unknown as readonly [Gate, ...Gate[]], "Select the gate."),
    reason: f.str("Give a full justification."),
    password: f.str("Re-enter your password to sign."),
    validHours: f.optInt(),
  }),
  async (ctx, { opId, gate, reason, password, validHours }) => {
    const e = await recordGateException(ctx, { operationId: opId, gate, reason, password, validHours: validHours ?? undefined });
    return `Gate exception ${e.ref} recorded.`;
  },
  { revalidate: jobPath },
);

export const revokeGateExceptionAction = action(
  "gate.exception_revoke",
  z.object({ jobId: f.uuid(), exceptionId: f.uuid(), reason: f.str("Give a reason.") }),
  async (ctx, { exceptionId, reason }) => {
    await revokeGateException(ctx, exceptionId, reason);
    return "Exception revoked.";
  },
  { revalidate: jobPath },
);

export const releaseRouteAction = action(
  "route.release",
  z.object({ jobId: f.uuid(), jobLineId: f.uuid() }),
  async (ctx, { jobLineId }) => {
    await releaseRoute(ctx, jobLineId);
    return "Route released to production.";
  },
  { revalidate: jobPath },
);

export const copyRouteAction = action(
  "route.copy",
  z.object({ jobId: f.uuid(), jobLineId: f.uuid(), sourceLineId: f.uuid("Select the line to copy from.") }),
  async (ctx, { jobLineId, sourceLineId }) => {
    const n = await copyRoute(ctx, jobLineId, sourceLineId);
    return `${n} operation(s) copied. Check machines, programs and plans before releasing.`;
  },
  { revalidate: jobPath },
);

// ───────────── Materials ─────────────

export const requestMaterialAction = action(
  "requisition.create",
  z.object({
    jobId: f.uuid(),
    jobLineId: f.optUuid(),
    materialSpecId: f.optUuid(),
    description: f.str("Describe the material."),
    dimensions: f.optStr(),
    quantity: f.dec({ min: 0, msg: "Enter a quantity." }),
    uom: f.optStr(),
    requiredDate: f.optDate(),
    notes: f.optStr(),
  }),
  async (ctx, { uom, ...input }) => {
    const r = await createRequisition(ctx, { ...input, uom: uom ?? "pcs" });
    return `Material request ${r.ref} raised for purchasing.`;
  },
  { revalidate: jobPath },
);

export const allocateLotAction = action(
  "material.allocate",
  z.object({ jobId: f.uuid(), lotId: f.uuid("Select a released lot."), jobLineId: f.optUuid(), quantity: f.dec({ min: 0, msg: "Enter the quantity to allocate." }) }),
  async (ctx, input) => {
    await allocateLot(ctx, input);
    return "Material allocated to the job.";
  },
  { revalidate: jobPath },
);

export const materialEventAction = action(
  "material.event",
  z.object({
    jobId: f.uuid(),
    _key: f.str("Missing submission key — refresh the page."),
    kind: f.enumOf(["issue", "consume", "remnant", "return", "scrap"] as const),
    lotId: f.uuid("Select an allocated lot."),
    quantity: f.dec({ min: 0, msg: "Enter the quantity." }),
    operationId: f.optUuid(),
    reason: f.optStr(),
  }),
  async (ctx, { _key, ...input }) => {
    const res = await recordMaterialEvent(ctx, { ...input, idempotencyKey: _key });
    return res.duplicate ? "This movement was already recorded." : `Material ${input.kind} recorded (${res.tx.ref}).`;
  },
  { revalidate: jobPath },
);

// ───────────── Quality ─────────────

export const prepareReleaseAction = action(
  "release.prepare",
  z.object({ jobId: f.uuid(), jobLineId: f.uuid() }),
  async (ctx, { jobLineId }) => {
    const rel = await prepareRelease(ctx, jobLineId);
    redirect(`/quality/releases/${rel.id}`);
  },
);
