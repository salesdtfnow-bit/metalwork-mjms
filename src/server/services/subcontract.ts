import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { files, jobLines, jobs, operations, subcontractFiles, subcontractOrders, suppliers } from "../db/schema";
import { audit } from "../audit";
import { mutate, requirePermission, type Ctx } from "../context";
import { invalid, notFound } from "../errors";
import { nextRef, REF } from "../refs";
import { d } from "@/lib/decimal";
import { todayISO } from "@/lib/format";
import { storeUpload } from "../storage";
import { supplierUsable } from "./parties";
import { loadOp, refreshReadiness } from "./routing";
import { refreshJobStatus } from "./jobs";
import { openInspection, findApplicablePlan } from "./inspections";

export const subcontractInput = z.object({
  operationId: z.string().uuid(),
  supplierId: z.string().uuid("Select the subcontractor."),
  process: z.enum(["heat_treatment", "plating", "anodising", "grinding", "machining", "painting", "other"]),
  specification: z.string().trim().min(3, "State the process specification."),
  requiredReturnDate: z.string().nullish(),
  estimatedCost: z.string().nullish(),
  purchaseOrderId: z.string().uuid().nullish(),
  notes: z.string().nullish(),
});

export async function createSubcontractOrder(ctx: Ctx, raw: z.input<typeof subcontractInput>) {
  requirePermission(ctx, "subcontract.manage");
  const data = subcontractInput.parse(raw);
  return mutate(ctx, async (tx) => {
    const { op, job, type } = await loadOp(tx, data.operationId);
    if (!type.isSubcontract) throw invalid("Subcontract orders can only be raised for external subcontract operations.");
    const [s] = await tx.db.select().from(suppliers).where(eq(suppliers.id, data.supplierId)).limit(1);
    if (!s || !supplierUsable(s, todayISO()) || !s.categories.includes("subcontract")) throw invalid(`${s?.name ?? "Supplier"} is not an approved subcontractor.`);
    const ref = await nextRef(tx.db, REF.subcontract);
    const [sco] = await tx.db
      .insert(subcontractOrders)
      .values({ ...data, ref, jobId: job.id, jobLineId: op.jobLineId, batchId: op.batchId, requiredReturnDate: data.requiredReturnDate || null, estimatedCost: data.estimatedCost || null, createdBy: ctx.actor.userId })
      .returning();
    await audit(tx, { action: "subcontract.create", entityType: "subcontract_order", entityId: sco.id, entityRef: ref, jobId: job.id, operationId: op.id, after: data });
    return sco;
  });
}

export async function sendToSubcontractor(ctx: Ctx, id: string, input: { qtySent: string; dispatchNoteRef?: string | null }) {
  requirePermission(ctx, "subcontract.manage");
  if (!d(input.qtySent).greaterThan(0)) throw invalid("Enter the quantity sent.", { field: "qtySent" });
  return mutate(ctx, async (tx) => {
    const [sco] = await tx.db.select().from(subcontractOrders).where(eq(subcontractOrders.id, id)).limit(1);
    if (!sco) throw notFound("Subcontract order");
    if (sco.status !== "draft") throw invalid(`Order is ${sco.status}.`);
    const { op, job } = await loadOp(tx, sco.operationId);
    if (!["ready", "paused", "pending"].includes(op.status)) throw invalid(`Operation ${op.opNumber} is ${op.status}.`);
    const { evaluateGates } = await import("./gates");
    const gates = (await evaluateGates(tx, op.id, { phase: "setup", employeeId: null })).filter((g) => !g.ok && ["dependencies", "hold", "route"].includes(g.gate));
    if (gates.length) throw invalid(`Cannot send: ${gates.map((g) => g.message).join(" ")}`);
    await tx.db.update(subcontractOrders).set({ status: "at_supplier", qtySent: input.qtySent, dispatchedAt: new Date(), dispatchedBy: ctx.actor.userId, dispatchNoteRef: input.dispatchNoteRef ?? null }).where(eq(subcontractOrders.id, id));
    await tx.db.update(operations).set({ status: "subcontracted", actualStart: new Date() }).where(eq(operations.id, op.id));
    await audit(tx, { action: "subcontract.sent", entityType: "subcontract_order", entityId: id, entityRef: sco.ref, jobId: job.id, operationId: op.id, after: input });
    await refreshJobStatus(tx, job.id);
  });
}

/**
 * Records parts returning from the subcontractor. The operation is NOT complete: an incoming
 * (subcontract-return) inspection is opened, and only its acceptance completes the operation.
 */
export async function receiveFromSubcontractor(ctx: Ctx, id: string, input: { qtyReturned: string; supplierDeliveryNote?: string | null; actualCost?: string | null }, certificates: File[] = []) {
  requirePermission(ctx, "subcontract.receive");
  return mutate(ctx, async (tx) => {
    const [sco] = await tx.db.select().from(subcontractOrders).where(eq(subcontractOrders.id, id)).limit(1);
    if (!sco) throw notFound("Subcontract order");
    if (!["at_supplier", "sent"].includes(sco.status)) throw invalid(`Order is ${sco.status}.`);
    for (const f of certificates.filter((x) => x.size)) {
      const sf = await storeUpload(tx.db, f, ctx.actor.userId);
      await tx.db.insert(subcontractFiles).values({ subcontractOrderId: id, fileId: sf.id, kind: "certificate" });
    }
    const { op, job, line } = await loadOp(tx, sco.operationId);
    const planId = (await findApplicablePlan(tx, { stage: "subcontract_return", jobId: job.id, partId: line.partId, customerId: job.customerId }))?.id ?? null;
    const insp = await openInspection(tx, { stage: "subcontract_return", planId, jobId: job.id, jobLineId: line.id, operationId: op.id, batchId: sco.batchId, subcontractOrderId: sco.id, drawingRevisionId: op.drawingRevisionId, sampleQty: input.qtyReturned, notes: `Return from subcontractor ${sco.ref}` });
    await tx.db
      .update(subcontractOrders)
      .set({ status: "returned", qtyReturned: input.qtyReturned, returnedAt: new Date(), receivedBy: ctx.actor.userId, supplierDeliveryNote: input.supplierDeliveryNote ?? null, actualCost: input.actualCost || null, incomingInspectionId: insp.id })
      .where(eq(subcontractOrders.id, id));
    await tx.db.update(operations).set({ status: "awaiting_inspection" }).where(eq(operations.id, op.id));
    await audit(tx, { action: "subcontract.received", entityType: "subcontract_order", entityId: id, entityRef: sco.ref, jobId: job.id, operationId: op.id, after: { ...input, inspection: insp.ref, certificates: certificates.length } });
    await refreshJobStatus(tx, job.id);
    return insp;
  });
}

/** Hook from completeInspection for subcontract-return inspections. */
export async function onSubcontractInspection(ctx: Ctx, scoId: string, decision: "pass" | "fail", qtyAccepted: string | null, qtyRejected: string | null) {
  const [sco] = await ctx.db.select().from(subcontractOrders).where(eq(subcontractOrders.id, scoId)).limit(1);
  if (!sco) return;
  const accepted = qtyAccepted ?? (decision === "pass" ? sco.qtyReturned : "0");
  await ctx.db
    .update(subcontractOrders)
    .set({ status: decision === "pass" ? "accepted" : "rejected", qtyAccepted: accepted, qtyRejected: qtyRejected ?? (decision === "fail" ? sco.qtyReturned : "0"), acceptedBy: ctx.actor.userId, acceptedAt: new Date() })
    .where(eq(subcontractOrders.id, scoId));
  if (decision === "pass") {
    const [op] = await ctx.db.select().from(operations).where(eq(operations.id, sco.operationId)).limit(1);
    await ctx.db
      .update(operations)
      .set({ status: "complete", actualEnd: new Date(), qtyGood: accepted ?? "0", qtyRejected: qtyRejected ?? "0", signedOffBy: ctx.actor.userId, signedOffAt: new Date(), signOffNote: `Accepted on return from ${sco.ref}` })
      .where(eq(operations.id, sco.operationId));
    await refreshReadiness(ctx, op.jobId);
  }
  await audit(ctx, { action: `subcontract.${decision === "pass" ? "accepted" : "rejected"}`, entityType: "subcontract_order", entityId: scoId, entityRef: sco.ref, jobId: sco.jobId, operationId: sco.operationId, after: { qtyAccepted: accepted, qtyRejected } });
}

export async function listSubcontractOrders(ctx: Ctx, open = true) {
  requirePermission(ctx, "subcontract.view");
  const rows = await ctx.db
    .select({ sco: subcontractOrders, supplier: suppliers.name, job: jobs.jobNumber, opNumber: operations.opNumber, part: jobLines.partNumber })
    .from(subcontractOrders)
    .innerJoin(suppliers, eq(suppliers.id, subcontractOrders.supplierId))
    .innerJoin(jobs, eq(jobs.id, subcontractOrders.jobId))
    .innerJoin(operations, eq(operations.id, subcontractOrders.operationId))
    .innerJoin(jobLines, eq(jobLines.id, subcontractOrders.jobLineId))
    .orderBy(desc(subcontractOrders.createdAt))
    .limit(300);
  return open ? rows.filter((r) => !["closed", "cancelled", "accepted"].includes(r.sco.status)) : rows;
}

export async function getSubcontractOrder(ctx: Ctx, id: string) {
  requirePermission(ctx, "subcontract.view");
  const [row] = await ctx.db
    .select({ sco: subcontractOrders, supplier: suppliers, job: jobs, op: operations, line: jobLines })
    .from(subcontractOrders)
    .innerJoin(suppliers, eq(suppliers.id, subcontractOrders.supplierId))
    .innerJoin(jobs, eq(jobs.id, subcontractOrders.jobId))
    .innerJoin(operations, eq(operations.id, subcontractOrders.operationId))
    .innerJoin(jobLines, eq(jobLines.id, subcontractOrders.jobLineId))
    .where(eq(subcontractOrders.id, id))
    .limit(1);
  if (!row) throw notFound("Subcontract order");
  const docs = await ctx.db.select({ sf: subcontractFiles, f: files }).from(subcontractFiles).innerJoin(files, eq(files.id, subcontractFiles.fileId)).where(eq(subcontractFiles.subcontractOrderId, id));
  return { ...row, files: docs };
}

export const _v = { and };
