import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { addresses, batches, customerOrders, customers, dispatchLines, dispatchSerials, dispatches, finalReleases, holds, jobLines, jobs, serials, users } from "../db/schema";
import { audit } from "../audit";
import { mutate, requirePermission, type Ctx } from "../context";
import { invalid, notFound } from "../errors";
import { nextRef, REF } from "../refs";
import { d, sum } from "@/lib/decimal";
import { storeFile, storeUpload } from "../storage";
import { formatAddress } from "./parties";

/**
 * Quantity of a job line that may be dispatched now:
 * released − already dispatched − quantity on draft dispatches − quantity held.
 */
export async function dispatchableQty(ctx: Ctx, jobLineId: string, excludeDispatchId?: string) {
  const [line] = await ctx.db.select().from(jobLines).where(eq(jobLines.id, jobLineId)).limit(1);
  if (!line) throw notFound("Job line");
  const drafts = await ctx.db
    .select({ q: dispatchLines.quantity, id: dispatches.id })
    .from(dispatchLines)
    .innerJoin(dispatches, eq(dispatches.id, dispatchLines.dispatchId))
    .where(and(eq(dispatchLines.jobLineId, jobLineId), eq(dispatches.status, "draft")));
  const held = await ctx.db
    .select({ q: holds.qtyHeld })
    .from(holds)
    .innerJoin(batches, eq(batches.id, holds.batchId))
    .where(and(eq(batches.jobLineId, jobLineId), isNull(holds.releasedAt)));
  const draftQty = sum(drafts.filter((x) => x.id !== excludeDispatchId).map((x) => x.q));
  const free = d(line.qtyReleased).minus(d(line.qtyDispatched)).minus(draftQty).minus(sum(held.map((h) => h.q ?? 0)));
  return { line, free: free.isNegative() ? d(0) : free };
}

export const dispatchInput = z.object({
  jobId: z.string().uuid(),
  deliveryAddressId: z.string().uuid().nullish(),
  deliveryMethod: z.enum(["carrier", "own_vehicle", "collection", "courier"]).default("carrier"),
  carrier: z.string().nullish(),
  trackingRef: z.string().nullish(),
  packagingNotes: z.string().nullish(),
  packageCount: z.string().nullish(),
  grossWeightKg: z.string().nullish(),
  certificatesIncluded: z.string().nullish(),
  notes: z.string().nullish(),
  lines: z.array(z.object({ jobLineId: z.string().uuid(), quantity: z.string().regex(/^\d+(\.\d+)?$/), batchId: z.string().uuid().nullish(), serialIds: z.array(z.string().uuid()).default([]) })).min(1, "Add at least one line."),
});

/** Prepares a dispatch (draft). Only released, accepted, non-held quantity can be included. */
export async function createDispatch(ctx: Ctx, raw: z.input<typeof dispatchInput>) {
  requirePermission(ctx, "dispatch.manage");
  const data = dispatchInput.parse(raw);
  return mutate(ctx, async (tx) => {
    const [job] = await tx.db.select().from(jobs).where(eq(jobs.id, data.jobId)).limit(1);
    if (!job) throw notFound("Job");
    if (["on_hold", "cancelled", "completed"].includes(job.status)) throw invalid(`Job ${job.jobNumber} is ${job.status.replace("_", " ")} — it cannot be dispatched.`);
    const jobHold = await tx.db.select().from(holds).where(and(eq(holds.jobId, job.id), eq(holds.targetType, "job"), isNull(holds.releasedAt))).limit(1);
    if (jobHold.length) throw invalid(`Job ${job.jobNumber} has an active hold.`);
    for (const l of data.lines) {
      const q = d(l.quantity);
      if (!q.greaterThan(0)) throw invalid("Dispatch quantities must be greater than zero.");
      const { line, free } = await dispatchableQty(tx, l.jobLineId);
      if (line.jobId !== job.id) throw invalid("Line does not belong to this job.");
      const rel = await tx.db.select().from(finalReleases).where(and(eq(finalReleases.jobLineId, line.id), eq(finalReleases.status, "approved"))).limit(1);
      if (!rel.length) throw invalid(`Line ${line.lineNo} (${line.partNumber}) has no approved final quality release.`);
      if (q.greaterThan(free)) throw invalid(`Line ${line.lineNo}: only ${free} part(s) are released and available to dispatch (requested ${q}).`);
      if (l.batchId) {
        const [b] = await tx.db.select().from(batches).where(eq(batches.id, l.batchId));
        if (!b || ["on_hold", "quarantined", "rejected"].includes(b.status)) throw invalid(`Batch ${b?.batchNo ?? ""} is ${b?.status ?? "missing"} and cannot be dispatched.`);
      }
      if (l.serialIds.length) {
        const ss = await tx.db.select().from(serials).where(inArray(serials.id, l.serialIds));
        const bad = ss.filter((s) => s.status !== "accepted");
        if (bad.length) throw invalid(`Serial(s) not accepted: ${bad.map((b) => `${b.serialNo} (${b.status})`).join(", ")}.`);
        if (ss.length !== Number(l.quantity)) throw invalid("The number of serial numbers must equal the dispatch quantity.");
      }
      if (line.traceabilityLevel === "piece" && !l.serialIds.length) throw invalid(`Line ${line.lineNo} requires serial numbers for every dispatched piece.`);
    }
    const addressId = data.deliveryAddressId ?? job.deliveryAddressId;
    const [addr] = addressId ? await tx.db.select().from(addresses).where(eq(addresses.id, addressId)) : [];
    if (!addr) throw invalid("A delivery address is required.", { field: "deliveryAddressId" });
    const [order] = job.customerOrderId ? await tx.db.select().from(customerOrders).where(eq(customerOrders.id, job.customerOrderId)) : [];
    const ref = await nextRef(tx.db, REF.dispatch);
    const { lines, ...head } = data;
    const [dsp] = await tx.db
      .insert(dispatches)
      .values({ ...head, ref, customerId: job.customerId, customerOrderId: job.customerOrderId, customerPoNumber: order?.customerPoNumber ?? null, deliveryAddressId: addr.id, deliveryAddressText: formatAddress(addr), createdBy: ctx.actor.userId })
      .returning();
    for (const l of lines) {
      const [jl] = await tx.db.select().from(jobLines).where(eq(jobLines.id, l.jobLineId));
      const [dl] = await tx.db.insert(dispatchLines).values({ dispatchId: dsp.id, jobLineId: l.jobLineId, batchId: l.batchId ?? null, quantity: l.quantity, description: `${jl.partNumber} — ${jl.description}` }).returning();
      if (l.serialIds.length) await tx.db.insert(dispatchSerials).values(l.serialIds.map((serialId) => ({ dispatchLineId: dl.id, serialId })));
    }
    await audit(tx, { action: "dispatch.create", entityType: "dispatch", entityId: dsp.id, entityRef: ref, jobId: job.id, after: data });
    return dsp;
  });
}

/** Confirms goods have left: re-validates controls, updates quantities, issues the delivery note. */
export async function confirmDispatch(ctx: Ctx, dispatchId: string, input: { carrier?: string | null; trackingRef?: string | null } = {}) {
  requirePermission(ctx, "dispatch.dispatch");
  return mutate(ctx, async (tx) => {
    const [dsp] = await tx.db.select().from(dispatches).where(eq(dispatches.id, dispatchId)).limit(1);
    if (!dsp) throw notFound("Dispatch");
    if (dsp.status !== "draft") throw invalid(`Dispatch is ${dsp.status}.`);
    const [job] = await tx.db.select().from(jobs).where(eq(jobs.id, dsp.jobId));
    if (["on_hold", "cancelled", "completed"].includes(job.status)) throw invalid(`Job is ${job.status.replace("_", " ")}.`);
    const lines = await tx.db.select().from(dispatchLines).where(eq(dispatchLines.dispatchId, dispatchId));
    for (const l of lines) {
      const { free, line } = await dispatchableQty(tx, l.jobLineId, dispatchId);
      if (d(l.quantity).greaterThan(free)) throw invalid(`Line ${line.lineNo}: only ${free} part(s) are now available to dispatch — the release or holds have changed.`);
    }
    for (const l of lines) {
      const [jl] = await tx.db.select().from(jobLines).where(eq(jobLines.id, l.jobLineId));
      await tx.db.update(jobLines).set({ qtyDispatched: d(jl.qtyDispatched).plus(d(l.quantity)).toString() }).where(eq(jobLines.id, l.jobLineId));
      if (l.batchId) await tx.db.update(batches).set({ status: "dispatched" }).where(eq(batches.id, l.batchId));
      const sids = await tx.db.select().from(dispatchSerials).where(eq(dispatchSerials.dispatchLineId, l.id));
      if (sids.length) await tx.db.update(serials).set({ status: "dispatched" }).where(inArray(serials.id, sids.map((s) => s.serialId)));
    }
    await tx.db.update(dispatches).set({ status: "dispatched", dispatchedAt: new Date(), dispatchedBy: ctx.actor.userId, carrier: input.carrier ?? dsp.carrier, trackingRef: input.trackingRef ?? dsp.trackingRef }).where(eq(dispatches.id, dispatchId));
    const { renderDeliveryNotePdf } = await import("../pdf/documents");
    const pdf = await renderDeliveryNotePdf(tx, dispatchId);
    const file = await storeFile(tx.db, { bytes: pdf, name: `${dsp.ref}-delivery-note.pdf`, mimeType: "application/pdf", uploadedBy: ctx.actor.userId });
    await tx.db.update(dispatches).set({ deliveryNoteFileId: file.id }).where(eq(dispatches.id, dispatchId));
    const all = await tx.db.select().from(jobLines).where(eq(jobLines.jobId, job.id));
    const complete = all.every((l) => d(l.qtyDispatched).greaterThanOrEqualTo(d(l.quantity)));
    if (complete && job.status !== "dispatched") {
      await tx.db.update(jobs).set({ status: "dispatched" }).where(eq(jobs.id, job.id));
      await audit(tx, { action: "job.status_auto", entityType: "job", entityId: job.id, entityRef: job.jobNumber, jobId: job.id, before: { status: job.status }, after: { status: "dispatched" }, reason: `All quantities dispatched (${dsp.ref})` });
    }
    await audit(tx, { action: "dispatch.confirm", entityType: "dispatch", entityId: dispatchId, entityRef: dsp.ref, jobId: job.id, after: { lines: lines.map((l) => ({ jobLineId: l.jobLineId, qty: l.quantity })), deliveryNoteFileId: file.id } });
    return { fileId: file.id, jobFullyDispatched: complete };
  });
}

export async function recordDelivery(ctx: Ctx, dispatchId: string, input: { deliveredAt?: string | null }, pod?: File | null) {
  requirePermission(ctx, "dispatch.manage");
  return mutate(ctx, async (tx) => {
    const [dsp] = await tx.db.select().from(dispatches).where(eq(dispatches.id, dispatchId)).limit(1);
    if (!dsp || dsp.status !== "dispatched") throw invalid("Only dispatched consignments can be marked delivered.");
    const deliveredAt = input.deliveredAt ? new Date(input.deliveredAt) : new Date();
    if (dsp.dispatchedAt && deliveredAt.getTime() < dsp.dispatchedAt.getTime() - 86_400_000) throw invalid("The delivery date cannot be before the dispatch date.", { field: "deliveredAt" });
    const podId = pod && pod.size ? (await storeUpload(tx.db, pod, ctx.actor.userId, { isCustomerOriginal: true })).id : null;
    await tx.db.update(dispatches).set({ status: "delivered", deliveredAt, proofOfDeliveryFileId: podId ?? dsp.proofOfDeliveryFileId }).where(eq(dispatches.id, dispatchId));
    await audit(tx, { action: "dispatch.delivered", entityType: "dispatch", entityId: dispatchId, entityRef: dsp.ref, jobId: dsp.jobId, after: { podFileId: podId } });
  });
}

export async function cancelDispatch(ctx: Ctx, dispatchId: string, reason: string) {
  requirePermission(ctx, "dispatch.manage");
  if (!reason?.trim()) throw invalid("A reason is required.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const [dsp] = await tx.db.select().from(dispatches).where(eq(dispatches.id, dispatchId)).limit(1);
    if (!dsp || dsp.status !== "draft") throw invalid("Only draft dispatches can be cancelled. Dispatched goods are reversed by a customer return / NCR.");
    await tx.db.update(dispatches).set({ status: "cancelled", notes: [dsp.notes, `Cancelled: ${reason}`].filter(Boolean).join("\n") }).where(eq(dispatches.id, dispatchId));
    await audit(tx, { action: "dispatch.cancel", entityType: "dispatch", entityId: dispatchId, entityRef: dsp.ref, jobId: dsp.jobId, reason });
  });
}

export async function listDispatches(ctx: Ctx, opts: { status?: string } = {}) {
  requirePermission(ctx, "dispatch.view");
  return ctx.db
    .select({ d: dispatches, job: jobs.jobNumber, customer: customers.name })
    .from(dispatches)
    .innerJoin(jobs, eq(jobs.id, dispatches.jobId))
    .innerJoin(customers, eq(customers.id, dispatches.customerId))
    .where(opts.status ? eq(dispatches.status, opts.status) : undefined)
    .orderBy(desc(dispatches.createdAt))
    .limit(300);
}

export async function getDispatch(ctx: Ctx, id: string) {
  requirePermission(ctx, "dispatch.view");
  const [row] = await ctx.db
    .select({ d: dispatches, job: jobs, customer: customers, by: users.name })
    .from(dispatches)
    .innerJoin(jobs, eq(jobs.id, dispatches.jobId))
    .innerJoin(customers, eq(customers.id, dispatches.customerId))
    .leftJoin(users, eq(users.id, dispatches.dispatchedBy))
    .where(eq(dispatches.id, id))
    .limit(1);
  if (!row) throw notFound("Dispatch");
  const lines = await ctx.db.select({ l: dispatchLines, jl: jobLines, batch: batches.batchNo }).from(dispatchLines).innerJoin(jobLines, eq(jobLines.id, dispatchLines.jobLineId)).leftJoin(batches, eq(batches.id, dispatchLines.batchId)).where(eq(dispatchLines.dispatchId, id)).orderBy(asc(jobLines.lineNo));
  const sers = lines.length ? await ctx.db.select({ ds: dispatchSerials, s: serials }).from(dispatchSerials).innerJoin(serials, eq(serials.id, dispatchSerials.serialId)).where(inArray(dispatchSerials.dispatchLineId, lines.map((l) => l.l.id))) : [];
  return { ...row, lines: lines.map((l) => ({ ...l, serials: sers.filter((s) => s.ds.dispatchLineId === l.l.id).map((s) => s.s.serialNo) })) };
}

/** Lines ready to ship across all jobs (dispatch dashboard). */
export async function readyToDispatch(ctx: Ctx) {
  requirePermission(ctx, "dispatch.view");
  const rows = await ctx.db
    .select({ jl: jobLines, job: jobs, customer: customers.name })
    .from(jobLines)
    .innerJoin(jobs, eq(jobs.id, jobLines.jobId))
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .where(and(notInArray(jobs.status, ["cancelled", "completed"]), sql`${jobLines.qtyReleased} > ${jobLines.qtyDispatched}`));
  return rows;
}
