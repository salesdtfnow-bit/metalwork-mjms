"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/server/action";
import { f } from "@/server/forms";
import { can } from "@/server/context";
import {
  approveDisposition,
  cancelNcr,
  closeNcr,
  createCorrectiveAction,
  DISPOSITIONS,
  NCR_CATEGORIES,
  raiseNcr,
  releaseHold,
  updateCorrectiveAction,
  updateNcrInvestigation,
  verifyCorrectiveAction,
} from "@/server/services/ncr";

export const raiseNcrAction = action(
  "ncr.raise",
  z.object({
    source: f.enumOf(["internal", "supplier", "customer_complaint", "audit"] as const, "Select the source."),
    category: f.enumOf(NCR_CATEGORIES, "Select a category."),
    jobId: f.optUuid(),
    operationId: f.optUuid(),
    batchId: f.optUuid(),
    lotId: f.optUuid(),
    supplierId: f.optUuid(),
    customerId: f.optUuid(),
    qtyAffected: f.dec({ msg: "Enter the affected quantity." }),
    description: f.str("Describe the non-conformance."),
    containmentAction: f.optStr(),
    holdOperation: f.bool(),
    holdJob: f.bool(),
    holdBatch: f.bool(),
    holdLot: f.bool(),
    evidence: f.files(),
  }),
  async (ctx, { evidence, ...input }) => {
    const n = await raiseNcr(ctx, input, evidence);
    if (can(ctx.actor, "ncr.view")) redirect(`/ncr/${n.id}`);
    redirect(`/ncr?raised=${encodeURIComponent(n.ref)}`);
  },
);

const ncrPath = (i: { ncrId: string }) => [`/ncr/${i.ncrId}`, "/ncr"];

export const updateInvestigationAction = action(
  "ncr.investigation",
  z.object({ ncrId: f.uuid(), containmentAction: f.optStr(), rootCause: f.optStr(), ownerId: f.optUuid() }),
  async (ctx, { ncrId, ...input }) => {
    await updateNcrInvestigation(ctx, ncrId, input);
    return "Investigation updated.";
  },
  { revalidate: ncrPath },
);

export const approveDispositionAction = action(
  "ncr.disposition",
  z.object({
    ncrId: f.uuid(),
    disposition: f.enumOf(DISPOSITIONS, "Select a disposition."),
    notes: f.str("Record the disposition rationale."),
    customerConcessionRef: f.optStr(),
    reworkInstructions: f.optStr(),
    password: f.str("Enter your password to sign."),
  }),
  async (ctx, { ncrId, ...input }) => {
    const res = await approveDisposition(ctx, ncrId, input);
    return res.reworkOperationIds.length ? `Disposition approved. ${res.reworkOperationIds.length} rework operation(s) added to the job route.` : "Disposition approved.";
  },
  { revalidate: ncrPath },
);

export const releaseHoldAction = action(
  "hold.release",
  z.object({ holdId: f.uuid(), ncrId: f.optUuid(), reason: f.str("Record why the hold can be released.") }),
  async (ctx, { holdId, reason }) => {
    await releaseHold(ctx, holdId, reason);
    return "Hold released.";
  },
  { revalidate: (i) => (i.ncrId ? [`/ncr/${i.ncrId}`, "/ncr"] : "/ncr") },
);

export const closeNcrAction = action(
  "ncr.close",
  z.object({ ncrId: f.uuid(), notes: f.str("Closure notes are required.") }),
  async (ctx, { ncrId, notes }) => {
    await closeNcr(ctx, ncrId, notes);
    return "NCR closed.";
  },
  { revalidate: ncrPath },
);

export const cancelNcrAction = action(
  "ncr.cancel",
  z.object({ ncrId: f.uuid(), reason: f.str("A reason is required.") }),
  async (ctx, { ncrId, reason }) => {
    await cancelNcr(ctx, ncrId, reason);
    return "NCR cancelled.";
  },
  { revalidate: ncrPath },
);

// ───────────── Corrective action ─────────────

const capaPaths = (i: { ncrId?: string | null }) => (i.ncrId ? [`/ncr/${i.ncrId}`, "/ncr"] : ["/ncr"]);

export const createCapaAction = action(
  "capa.create",
  z.object({ ncrId: f.optUuid(), title: f.str("Title is required."), problem: f.str("Describe the problem."), ownerId: f.optUuid(), dueDate: f.optDate() }),
  async (ctx, input) => {
    const ca = await createCorrectiveAction(ctx, input);
    return `Corrective action ${ca.ref} created.`;
  },
  { revalidate: capaPaths },
);

export const updateCapaAction = action(
  "capa.update",
  z.object({
    capaId: f.uuid(),
    ncrId: f.optUuid(),
    rootCause: f.optStr(),
    action: f.optStr(),
    status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["in_progress", "implemented"]).optional()),
    verificationMethod: f.optStr(),
    verificationDueDate: f.optDate(),
  }),
  async (ctx, { capaId, ncrId: _n, ...input }) => {
    void _n;
    await updateCorrectiveAction(ctx, capaId, input);
    return input.status === "implemented" ? "Marked implemented — awaiting effectiveness verification." : "Corrective action updated.";
  },
  { revalidate: capaPaths },
);

export const verifyCapaAction = action(
  "capa.verify",
  z.object({ capaId: f.uuid(), ncrId: f.optUuid(), effective: f.enumOf(["yes", "no"] as const, "Was the action effective?"), notes: f.str("Record the verification evidence.") }),
  async (ctx, { capaId, effective, notes }) => {
    await verifyCorrectiveAction(ctx, capaId, { effective: effective === "yes", notes });
    return effective === "yes" ? "Verified effective." : "Verified ineffective — a further action is needed.";
  },
  { revalidate: capaPaths },
);
