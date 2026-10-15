import { and, asc, desc, eq, ilike, inArray, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import {
  batchMaterials,
  boxheroItems,
  holds,
  jobs,
  materialAllocations,
  materialCertificates,
  materialLotCertificates,
  materialLots,
  materialReceipts,
  materialSpecItems,
  materialSpecs,
  materialTransactions,
  purchaseOrderLines,
  purchaseOrders,
  stockSyncTransactions,
  suppliers,
  users,
  files,
} from "../db/schema";
import { audit } from "../audit";
import { mutate, requirePermission, requireAnyPermission, type Ctx } from "../context";
import { conflict, invalid, notFound } from "../errors";
import { nextRef, REF } from "../refs";
import { storeUpload } from "../storage";
import { d, sum } from "@/lib/decimal";
import { signApproval } from "./approvals";
import { notify } from "./notifications";
import { enqueueStockMovement } from "../integrations/boxhero/sync";

// ───────────── Material specifications & BoxHero links ─────────────

export const materialSpecInput = z.object({
  code: z.string().trim().min(2).max(40).transform((s) => s.toUpperCase()),
  grade: z.string().trim().min(1, "Grade is required."),
  standard: z.string().nullish(),
  materialFamily: z.string().nullish(),
  form: z.enum(["bar", "plate", "sheet", "tube", "billet", "casting", "forging", "extrusion", "other"]),
  description: z.string().nullish(),
  certRequirement: z.enum(["none", "2.1", "2.2", "3.1", "3.2"]).default("3.1"),
  uom: z.string().default("mm"),
});

export async function saveMaterialSpec(ctx: Ctx, raw: z.input<typeof materialSpecInput>, id?: string) {
  requirePermission(ctx, "materials.manage_specs");
  const data = materialSpecInput.parse(raw);
  return mutate(ctx, async (tx) => {
    const [dup] = await tx.db.select({ id: materialSpecs.id }).from(materialSpecs).where(eq(materialSpecs.code, data.code)).limit(1);
    if (dup && dup.id !== id) throw conflict(`Material spec ${data.code} already exists.`, { field: "code" });
    const [s] = id ? await tx.db.update(materialSpecs).set(data).where(eq(materialSpecs.id, id)).returning() : await tx.db.insert(materialSpecs).values(data).returning();
    await audit(tx, { action: id ? "material_spec.update" : "material_spec.create", entityType: "material_spec", entityId: s.id, entityRef: s.code, after: data });
    return s;
  });
}

export async function linkSpecToBoxheroItem(ctx: Ctx, materialSpecId: string, boxheroItemRowId: string, dimensions?: string | null) {
  requirePermission(ctx, "materials.manage_specs");
  return mutate(ctx, async (tx) => {
    await tx.db
      .insert(materialSpecItems)
      .values({ materialSpecId, boxheroItemId: boxheroItemRowId, dimensions: dimensions ?? null, linkedBy: ctx.actor.userId })
      .onConflictDoUpdate({ target: [materialSpecItems.materialSpecId, materialSpecItems.boxheroItemId], set: { dimensions: dimensions ?? null } });
    await audit(tx, { action: "material_spec.boxhero_link", entityType: "material_spec", entityId: materialSpecId, after: { boxheroItemRowId, dimensions } });
  });
}

export async function searchBoxheroItems(ctx: Ctx, q: string) {
  requireAnyPermission(ctx, "boxhero.view", "materials.view");
  const s = q.trim();
  return ctx.db
    .select()
    .from(boxheroItems)
    .where(and(eq(boxheroItems.deleted, false), s ? or(ilike(boxheroItems.name, `%${s}%`), ilike(boxheroItems.sku, `%${s}%`), ilike(boxheroItems.barcode, `%${s}%`)) : undefined))
    .orderBy(asc(boxheroItems.name))
    .limit(50);
}

// ───────────── Receipt ─────────────

export const receiptLineInput = z.object({
  purchaseOrderLineId: z.string().uuid(),
  quantity: z.string().regex(/^\d+(\.\d+)?$/, "Enter the quantity received."),
  heatNumber: z.string().trim().min(1, "Heat / cast number is required for traceability."),
  supplierBatchNo: z.string().nullish(),
  dimensions: z.string().nullish(),
  boxheroItemId: z.string().uuid().nullish(),
  boxheroLocationId: z.string().nullish(),
  storageLocation: z.string().nullish(),
  notes: z.string().nullish(),
});

/**
 * Goods receipt. Creates one lot per line (heat number), status awaiting inspection.
 * Receipt does NOT make material available: inspection, certificate verification and a
 * signed release are separate steps. A BoxHero stock-in is queued when an item is linked.
 */
export async function receiveMaterial(
  ctx: Ctx,
  input: { purchaseOrderId: string; deliveryNoteNo?: string | null; notes?: string | null; lines: z.input<typeof receiptLineInput>[] },
  deliveryNoteFile?: File | null,
) {
  requirePermission(ctx, "materials.receive");
  const lines = input.lines.map((l) => receiptLineInput.parse(l)).filter((l) => d(l.quantity).greaterThan(0));
  if (!lines.length) throw invalid("Enter at least one received quantity.");
  return mutate(ctx, async (tx) => {
    const [po] = await tx.db.select().from(purchaseOrders).where(eq(purchaseOrders.id, input.purchaseOrderId)).limit(1);
    if (!po) throw notFound("Purchase order");
    if (!["sent", "partially_received"].includes(po.status)) throw invalid(`Cannot receive against a PO that is ${po.status}.`);
    const dnFileId = deliveryNoteFile && deliveryNoteFile.size ? (await storeUpload(tx.db, deliveryNoteFile, ctx.actor.userId)).id : null;
    const ref = await nextRef(tx.db, REF.receipt);
    const [receipt] = await tx.db
      .insert(materialReceipts)
      .values({ ref, purchaseOrderId: po.id, supplierId: po.supplierId, deliveryNoteNo: input.deliveryNoteNo ?? null, deliveryNoteFileId: dnFileId, receivedBy: ctx.actor.userId, notes: input.notes ?? null })
      .returning();
    const lots = [];
    for (const l of lines) {
      const [pol] = await tx.db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, l.purchaseOrderLineId)).limit(1);
      if (!pol || pol.purchaseOrderId !== po.id) throw invalid("Receipt line does not belong to this purchase order.");
      if (pol.status === "cancelled") throw invalid(`PO line ${pol.lineNo} is cancelled.`);
      const lotNo = await nextRef(tx.db, REF.lot);
      const boxheroItemId = l.boxheroItemId ?? pol.boxheroItemId ?? null;
      const [lot] = await tx.db
        .insert(materialLots)
        .values({
          lotNo,
          receiptId: receipt.id,
          purchaseOrderLineId: pol.id,
          materialSpecId: pol.materialSpecId,
          supplierId: po.supplierId,
          heatNumber: l.heatNumber,
          supplierBatchNo: l.supplierBatchNo ?? null,
          form: pol.form,
          dimensions: l.dimensions ?? pol.dimensions,
          qtyReceived: l.quantity,
          uom: pol.uom,
          status: "awaiting_inspection",
          certificateStatus: pol.certRequirement === "none" ? "not_required" : "pending",
          boxheroItemId,
          boxheroLocationId: l.boxheroLocationId ?? null,
          storageLocation: l.storageLocation ?? null,
          notes: l.notes ?? null,
        })
        .returning();
      const newQty = d(pol.qtyReceived).plus(d(l.quantity));
      await tx.db
        .update(purchaseOrderLines)
        .set({ qtyReceived: newQty.toString(), status: newQty.greaterThanOrEqualTo(d(pol.quantity)) ? "received" : "partially_received" })
        .where(eq(purchaseOrderLines.id, pol.id));
      if (boxheroItemId) {
        const [item] = await tx.db.select().from(boxheroItems).where(eq(boxheroItems.id, boxheroItemId)).limit(1);
        const sync = await enqueueStockMovement(tx, {
          kind: "in",
          boxheroItemId: item.boxheroItemId,
          quantity: l.quantity,
          locationId: l.boxheroLocationId ?? null,
          memo: `Goods in ${ref} ${lotNo} PO ${po.ref} heat ${l.heatNumber}`,
          sourceType: "material_lot",
          sourceId: lot.id,
          jobId: pol.jobId,
        });
        await tx.db.update(materialLots).set({ stockInSyncId: sync.id }).where(eq(materialLots.id, lot.id));
      }
      lots.push(lot);
    }
    const allLines = await tx.db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
    const allReceived = allLines.filter((x) => x.status !== "cancelled").every((x) => x.status === "received");
    await tx.db.update(purchaseOrders).set({ status: allReceived ? "received" : "partially_received" }).where(eq(purchaseOrders.id, po.id));
    // Jobs waiting for this material move to "material received / awaiting release".
    const jobIds = [...new Set(allLines.map((x) => x.jobId).filter((x): x is string => !!x))];
    for (const jobId of jobIds) {
      const [j] = await tx.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
      if (j && ["awaiting_material", "order_confirmed", "planned", "ready_for_planning"].includes(j.status)) {
        await tx.db.update(jobs).set({ status: "awaiting_material_release" }).where(eq(jobs.id, jobId));
        await audit(tx, { action: "job.status_auto", entityType: "job", entityId: jobId, entityRef: j.jobNumber, jobId, before: { status: j.status }, after: { status: "awaiting_material_release" }, reason: `Material received on ${ref}` });
      }
    }
    await audit(tx, { action: "material.receive", entityType: "material_receipt", entityId: receipt.id, entityRef: ref, after: { po: po.ref, deliveryNote: input.deliveryNoteNo, lots: lots.map((x) => ({ lotNo: x.lotNo, heat: x.heatNumber, qty: x.qtyReceived })) } });
    await notify(tx, { type: "material.awaiting_inspection", title: `Material received on ${ref} — ${lots.length} lot(s) awaiting inspection`, link: `/materials?tab=lots`, permission: "materials.inspect", dedupeKey: `grn:${receipt.id}` });
    return { receipt, lots };
  });
}

// ───────────── Certificates ─────────────

export async function addMaterialCertificate(
  ctx: Ctx,
  input: { lotIds: string[]; certType: string; certNumber?: string | null; heatNumber?: string | null; issuedBy?: string | null },
  file: File,
) {
  requireAnyPermission(ctx, "materials.receive", "materials.inspect");
  const certType = z.enum(["2.1", "2.2", "3.1", "3.2", "coc", "other"]).parse(input.certType);
  if (!input.lotIds.length) throw invalid("Select the lot(s) this certificate covers.");
  if (!file || !file.size) throw invalid("Attach the certificate.", { field: "file" });
  return mutate(ctx, async (tx) => {
    const lots = await tx.db.select().from(materialLots).where(inArray(materialLots.id, input.lotIds));
    if (lots.length !== input.lotIds.length) throw invalid("Unknown lot selected.");
    const f = await storeUpload(tx.db, file, ctx.actor.userId, { isCustomerOriginal: false });
    const [cert] = await tx.db
      .insert(materialCertificates)
      .values({ certType, certNumber: input.certNumber ?? null, heatNumber: input.heatNumber ?? lots[0].heatNumber, issuedBy: input.issuedBy ?? null, fileId: f.id, uploadedBy: ctx.actor.userId })
      .returning();
    await tx.db.insert(materialLotCertificates).values(lots.map((l) => ({ lotId: l.id, certificateId: cert.id })));
    await tx.db
      .update(materialLots)
      .set({ certificateStatus: "received" })
      .where(and(inArray(materialLots.id, input.lotIds), eq(materialLots.certificateStatus, "pending")));
    await audit(tx, { action: "material.certificate_add", entityType: "material_certificate", entityId: cert.id, entityRef: cert.certNumber, after: { lots: lots.map((l) => l.lotNo), heat: cert.heatNumber, sha256: f.sha256 } });
    return cert;
  });
}

/** Verifies a certificate against the lots: heat number must match and grade/standard checked by the inspector. */
export async function verifyMaterialCertificate(ctx: Ctx, certificateId: string, input: { result: "accepted" | "rejected"; notes?: string | null }) {
  requirePermission(ctx, "materials.inspect");
  return mutate(ctx, async (tx) => {
    const [cert] = await tx.db.select().from(materialCertificates).where(eq(materialCertificates.id, certificateId)).limit(1);
    if (!cert) throw notFound("Certificate");
    const linked = await tx.db.select({ lot: materialLots }).from(materialLotCertificates).innerJoin(materialLots, eq(materialLots.id, materialLotCertificates.lotId)).where(eq(materialLotCertificates.certificateId, certificateId));
    const mismatched = linked.filter((l) => cert.heatNumber && l.lot.heatNumber.trim().toUpperCase() !== cert.heatNumber.trim().toUpperCase());
    if (input.result === "accepted" && mismatched.length) {
      throw invalid(`Heat number on the certificate (${cert.heatNumber}) does not match lot(s) ${mismatched.map((m) => `${m.lot.lotNo} (${m.lot.heatNumber})`).join(", ")}.`);
    }
    if (input.result === "rejected" && !input.notes?.trim()) throw invalid("Explain why the certificate is rejected.", { field: "notes" });
    await tx.db.update(materialCertificates).set({ verificationResult: input.result, verifiedBy: ctx.actor.userId, verifiedAt: new Date(), verificationNotes: input.notes ?? null }).where(eq(materialCertificates.id, certificateId));
    await tx.db
      .update(materialLots)
      .set({ certificateStatus: input.result === "accepted" ? "verified" : "rejected" })
      .where(inArray(materialLots.id, linked.map((l) => l.lot.id)));
    await audit(tx, { action: `material.certificate_${input.result}`, entityType: "material_certificate", entityId: certificateId, entityRef: cert.certNumber, reason: input.notes, after: { lots: linked.map((l) => l.lot.lotNo) } });
  });
}

// ───────────── Inspection, quarantine, release ─────────────

export async function inspectLot(ctx: Ctx, lotId: string, input: { result: "pass" | "fail"; notes?: string | null }) {
  requirePermission(ctx, "materials.inspect");
  return mutate(ctx, async (tx) => {
    const lot = await getLotRow(tx, lotId);
    if (!["awaiting_inspection", "quarantined", "received"].includes(lot.status)) throw invalid(`Lot is ${lot.status}.`);
    if (input.result === "fail" && !input.notes?.trim()) throw invalid("Describe the failure.", { field: "notes" });
    await tx.db
      .update(materialLots)
      .set({ inspectionResult: input.result, inspectedBy: ctx.actor.userId, inspectedAt: new Date(), status: input.result === "fail" ? "quarantined" : lot.status, quarantineReason: input.result === "fail" ? input.notes : lot.quarantineReason })
      .where(eq(materialLots.id, lotId));
    if (input.result === "fail") await tx.db.insert(holds).values({ targetType: "lot", lotId, reason: `Incoming inspection failed: ${input.notes}`, placedBy: ctx.actor.userId });
    await audit(tx, { action: `material.inspect_${input.result}`, entityType: "material_lot", entityId: lotId, entityRef: lot.lotNo, reason: input.notes });
  });
}

export async function quarantineLot(ctx: Ctx, lotId: string, reason: string, ncrId?: string | null) {
  requireAnyPermission(ctx, "materials.inspect", "ncr.manage");
  if (!reason?.trim()) throw invalid("A reason is required.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const lot = await getLotRow(tx, lotId);
    if (["consumed", "returned"].includes(lot.status)) throw invalid(`Lot is ${lot.status}.`);
    await tx.db.update(materialLots).set({ status: "quarantined", quarantineReason: reason }).where(eq(materialLots.id, lotId));
    await tx.db.insert(holds).values({ targetType: "lot", lotId, ncrId: ncrId ?? null, reason, placedBy: ctx.actor.userId });
    await audit(tx, { action: "material.quarantine", entityType: "material_lot", entityId: lotId, entityRef: lot.lotNo, reason });
  });
}

/** Lot release readiness (all must pass before material can be used). */
export async function lotReleaseChecks(ctx: Ctx, lotId: string) {
  const lot = await getLotRow(ctx, lotId);
  const checks: { key: string; ok: boolean; message: string }[] = [];
  checks.push({ key: "inspection", ok: lot.inspectionResult === "pass", message: lot.inspectionResult === "pass" ? "Incoming inspection passed" : "Incoming inspection not passed" });
  const certOk = ["verified", "not_required"].includes(lot.certificateStatus);
  checks.push({ key: "certificate", ok: certOk, message: certOk ? `Certificate ${lot.certificateStatus === "verified" ? "verified" : "not required"}` : `Certificate ${lot.certificateStatus}` });
  if (lot.stockInSyncId) {
    const [s] = await ctx.db.select().from(stockSyncTransactions).where(eq(stockSyncTransactions.id, lot.stockInSyncId)).limit(1);
    const ok = !!s && ["confirmed", "manual_confirmed"].includes(s.status);
    checks.push({ key: "boxhero", ok, message: ok ? `Recorded in BoxHero (${s.boxheroTxId})` : `BoxHero stock-in ${s?.status ?? "missing"}` });
  } else {
    checks.push({ key: "boxhero", ok: true, message: "No BoxHero item linked (stock not tracked in BoxHero)" });
  }
  const activeHolds = await ctx.db.select().from(holds).where(and(eq(holds.lotId, lotId), isNull(holds.releasedAt)));
  checks.push({ key: "hold", ok: activeHolds.length === 0, message: activeHolds.length ? `${activeHolds.length} active hold(s)` : "No active holds" });
  return { lot, checks, ready: checks.every((c) => c.ok) };
}

/** Signed release of a lot for production use. */
export async function releaseLot(ctx: Ctx, lotId: string, input: { password: string; comment?: string | null }) {
  requirePermission(ctx, "materials.release");
  return mutate(ctx, async (tx) => {
    const { lot, checks, ready } = await lotReleaseChecks(tx, lotId);
    if (lot.status === "released") throw invalid("Lot is already released.");
    if (["rejected", "returned", "consumed"].includes(lot.status)) throw invalid(`Lot is ${lot.status}.`);
    if (!ready) throw invalid(`Lot cannot be released: ${checks.filter((c) => !c.ok).map((c) => c.message).join("; ")}.`);
    const approval = await signApproval(tx, {
      kind: "material.release",
      entityType: "material_lot",
      entityId: lot.id,
      decision: "approved",
      meaning: `I release material lot ${lot.lotNo} (heat ${lot.heatNumber}) for production: inspection passed and certification verified.`,
      comment: input.comment,
      password: input.password,
    });
    await tx.db.update(materialLots).set({ status: "released", releasedBy: ctx.actor.userId, releasedAt: new Date(), releaseApprovalId: approval.id }).where(eq(materialLots.id, lotId));
    await audit(tx, { action: "material.release", entityType: "material_lot", entityId: lotId, entityRef: lot.lotNo, approvalId: approval.id, after: { checks } });
  });
}

export async function rejectLot(ctx: Ctx, lotId: string, reason: string) {
  requirePermission(ctx, "materials.release");
  if (!reason?.trim()) throw invalid("A reason is required.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const lot = await getLotRow(tx, lotId);
    const allocated = await tx.db.select().from(materialAllocations).where(and(eq(materialAllocations.lotId, lotId), eq(materialAllocations.status, "active")));
    if (allocated.length) throw invalid("Cancel allocations to jobs before rejecting this lot (or raise an NCR).");
    await tx.db.update(materialLots).set({ status: "rejected", quarantineReason: reason }).where(eq(materialLots.id, lotId));
    await audit(tx, { action: "material.reject", entityType: "material_lot", entityId: lotId, entityRef: lot.lotNo, reason });
  });
}

async function getLotRow(ctx: Ctx, lotId: string) {
  const [lot] = await ctx.db.select().from(materialLots).where(eq(materialLots.id, lotId)).limit(1);
  if (!lot) throw notFound("Material lot");
  return lot;
}

// ───────────── Allocation, issue, consumption ─────────────

async function lotBalances(ctx: Ctx, lotId: string) {
  const txs = await ctx.db.select().from(materialTransactions).where(eq(materialTransactions.lotId, lotId));
  const allocs = await ctx.db.select().from(materialAllocations).where(and(eq(materialAllocations.lotId, lotId), ne(materialAllocations.status, "cancelled")));
  const issued = sum(txs.filter((t) => t.kind === "issue").map((t) => t.quantity)).minus(sum(txs.filter((t) => t.kind === "return").map((t) => t.quantity)));
  return { allocated: sum(allocs.map((a) => a.quantity)), issued, txs, allocs };
}

export async function allocateLot(ctx: Ctx, input: { lotId: string; jobId: string; jobLineId?: string | null; quantity: string }) {
  requirePermission(ctx, "materials.allocate");
  if (!(d(input.quantity).greaterThan(0))) throw invalid("Enter a quantity greater than zero.", { field: "quantity" });
  return mutate(ctx, async (tx) => {
    const lot = await getLotRow(tx, input.lotId);
    if (lot.status !== "released") throw invalid(`Lot ${lot.lotNo} is ${lot.status.replace("_", " ")} — only released material can be allocated.`);
    const [j] = await tx.db.select().from(jobs).where(eq(jobs.id, input.jobId)).limit(1);
    if (!j || ["cancelled", "completed"].includes(j.status)) throw invalid("Job is not open.");
    const bal = await lotBalances(tx, input.lotId);
    if (bal.allocated.plus(d(input.quantity)).greaterThan(d(lot.qtyReceived))) {
      throw invalid(`Only ${d(lot.qtyReceived).minus(bal.allocated).toString()} ${lot.uom} of lot ${lot.lotNo} is unallocated.`, { field: "quantity" });
    }
    const [a] = await tx.db.insert(materialAllocations).values({ lotId: input.lotId, jobId: input.jobId, jobLineId: input.jobLineId ?? null, quantity: input.quantity, allocatedBy: ctx.actor.userId }).returning();
    await audit(tx, { action: "material.allocate", entityType: "material_lot", entityId: lot.id, entityRef: lot.lotNo, jobId: input.jobId, after: { quantity: input.quantity, jobNumber: j.jobNumber } });
    return a;
  });
}

export async function cancelAllocation(ctx: Ctx, allocationId: string, reason: string) {
  requirePermission(ctx, "materials.allocate");
  if (!reason?.trim()) throw invalid("A reason is required.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const [a] = await tx.db.select().from(materialAllocations).where(eq(materialAllocations.id, allocationId)).limit(1);
    if (!a || a.status !== "active") throw invalid("Allocation is not active.");
    const issued = await tx.db.select().from(materialTransactions).where(and(eq(materialTransactions.allocationId, allocationId), eq(materialTransactions.kind, "issue")));
    if (issued.length) throw invalid("Material has been issued against this allocation — record a return instead.");
    await tx.db.update(materialAllocations).set({ status: "cancelled", cancelledAt: new Date(), cancelReason: reason }).where(eq(materialAllocations.id, allocationId));
    await audit(tx, { action: "material.allocation_cancel", entityType: "material_lot", entityId: a.lotId, jobId: a.jobId, reason });
  });
}

export type MaterialEventKind = "issue" | "consume" | "remnant" | "return" | "scrap" | "adjust";

/**
 * Records a material event against a job. Idempotent on `idempotencyKey` (duplicate
 * submissions return the original record). issue/return/remnant/adjust queue BoxHero movements.
 */
export async function recordMaterialEvent(
  ctx: Ctx,
  input: {
    kind: MaterialEventKind;
    lotId: string;
    jobId: string;
    quantity: string;
    idempotencyKey: string;
    allocationId?: string | null;
    operationId?: string | null;
    batchId?: string | null;
    jobLineId?: string | null;
    reason?: string | null;
    /** For remnants: the BoxHero item representing the offcut (optional). */
    remnantBoxheroItemId?: string | null;
    password?: string | null;
  },
) {
  const perm = input.kind === "adjust" || input.kind === "scrap" ? "materials.adjust" : "materials.issue";
  requirePermission(ctx, perm);
  if (!input.idempotencyKey) throw invalid("Missing idempotency key.");
  const q = d(input.quantity);
  if (input.kind !== "adjust" && !q.greaterThan(0)) throw invalid("Enter a quantity greater than zero.", { field: "quantity" });
  if (["return", "scrap", "adjust"].includes(input.kind) && !input.reason?.trim()) throw invalid("A reason is required.", { field: "reason" });
  const [existing] = await ctx.db.select().from(materialTransactions).where(eq(materialTransactions.idempotencyKey, input.idempotencyKey)).limit(1);
  if (existing) return { tx: existing, duplicate: true };
  return mutate(ctx, async (tx) => {
    const lot = await getLotRow(tx, input.lotId);
    const activeHold = await tx.db.select().from(holds).where(and(eq(holds.lotId, lot.id), isNull(holds.releasedAt))).limit(1);
    if (input.kind === "issue") {
      if (lot.status !== "released") throw invalid(`Lot ${lot.lotNo} is ${lot.status.replace("_", " ")} — it cannot be issued to production.`);
      if (activeHold.length) throw invalid(`Lot ${lot.lotNo} is on hold.`);
    }
    const bal = await lotBalances(tx, lot.id);
    const jobAllocs = bal.allocs.filter((a) => a.jobId === input.jobId);
    const allocation = input.allocationId ? jobAllocs.find((a) => a.id === input.allocationId) : jobAllocs[0];
    if (input.kind === "issue") {
      if (!allocation) throw invalid(`Lot ${lot.lotNo} is not allocated to this job.`);
      const jobIssued = sum(bal.txs.filter((t) => t.jobId === input.jobId && t.kind === "issue").map((t) => t.quantity)).minus(sum(bal.txs.filter((t) => t.jobId === input.jobId && t.kind === "return").map((t) => t.quantity)));
      if (jobIssued.plus(q).greaterThan(sum(jobAllocs.map((a) => a.quantity)))) throw invalid(`Issue exceeds the quantity allocated to this job.`, { field: "quantity" });
    }
    if (input.kind === "return") {
      const jobIssued = sum(bal.txs.filter((t) => t.jobId === input.jobId && t.kind === "issue").map((t) => t.quantity)).minus(sum(bal.txs.filter((t) => t.jobId === input.jobId && t.kind === "return").map((t) => t.quantity)));
      if (q.greaterThan(jobIssued)) throw invalid("Return exceeds the quantity issued to this job.", { field: "quantity" });
    }
    let approvalId: string | null = null;
    if (input.kind === "adjust") {
      const appr = await signApproval(tx, { kind: "material.adjust", entityType: "material_lot", entityId: lot.id, decision: "approved", meaning: `I authorise a stock adjustment of ${input.quantity} ${lot.uom} on lot ${lot.lotNo}.`, comment: input.reason, password: input.password });
      approvalId = appr.id;
    }
    const ref = await nextRef(tx.db, REF.materialTx);
    const [mt] = await tx.db
      .insert(materialTransactions)
      .values({
        ref,
        kind: input.kind,
        lotId: lot.id,
        jobId: input.jobId,
        jobLineId: input.jobLineId ?? allocation?.jobLineId ?? null,
        operationId: input.operationId ?? null,
        batchId: input.batchId ?? null,
        allocationId: allocation?.id ?? null,
        quantity: input.quantity,
        uom: lot.uom,
        reason: input.reason ?? null,
        idempotencyKey: input.idempotencyKey,
        approvalId,
        performedBy: ctx.actor.userId,
      })
      .returning();
    if (input.batchId && input.kind === "issue") {
      await tx.db.insert(batchMaterials).values({ batchId: input.batchId, lotId: lot.id, quantity: input.quantity }).onConflictDoNothing();
    }
    // BoxHero movements (only where the lot is tracked in BoxHero).
    const [item] = lot.boxheroItemId ? await tx.db.select().from(boxheroItems).where(eq(boxheroItems.id, lot.boxheroItemId)).limit(1) : [];
    const [jobRow] = await tx.db.select({ jobNumber: jobs.jobNumber }).from(jobs).where(eq(jobs.id, input.jobId));
    if (item && ["issue", "return", "adjust"].includes(input.kind)) {
      const signed = input.kind === "issue" ? q.negated() : q;
      const sync = await enqueueStockMovement(tx, {
        kind: input.kind === "issue" ? "out" : input.kind === "return" ? "in" : "adjust",
        boxheroItemId: item.boxheroItemId,
        quantity: signed.toString(),
        locationId: lot.boxheroLocationId,
        memo: `${input.kind.toUpperCase()} ${ref} ${lot.lotNo} heat ${lot.heatNumber} job ${jobRow?.jobNumber}`,
        sourceType: "material_transaction",
        sourceId: mt.id,
        jobId: input.jobId,
      });
      await tx.db.update(materialTransactions).set({ stockSyncId: sync.id }).where(eq(materialTransactions.id, mt.id));
    }
    if (input.kind === "remnant" && input.remnantBoxheroItemId) {
      const [rem] = await tx.db.select().from(boxheroItems).where(eq(boxheroItems.id, input.remnantBoxheroItemId)).limit(1);
      if (rem) {
        const sync = await enqueueStockMovement(tx, { kind: "in", boxheroItemId: rem.boxheroItemId, quantity: input.quantity, locationId: lot.boxheroLocationId, memo: `REMNANT ${ref} from ${lot.lotNo} heat ${lot.heatNumber}`, sourceType: "material_transaction", sourceId: mt.id, jobId: input.jobId });
        await tx.db.update(materialTransactions).set({ stockSyncId: sync.id }).where(eq(materialTransactions.id, mt.id));
      }
    }
    await audit(tx, { action: `material.${input.kind}`, entityType: "material_lot", entityId: lot.id, entityRef: `${lot.lotNo} ${ref}`, jobId: input.jobId, operationId: input.operationId, approvalId, reason: input.reason, after: { quantity: input.quantity, uom: lot.uom } });
    return { tx: mt, duplicate: false };
  });
}

// ───────────── Queries ─────────────

export async function listLots(ctx: Ctx, opts: { q?: string; status?: string } = {}) {
  requirePermission(ctx, "materials.view");
  const q = opts.q?.trim();
  return ctx.db
    .select({ lot: materialLots, supplier: suppliers.name, spec: materialSpecs.code, grade: materialSpecs.grade, receiptRef: materialReceipts.ref, poRef: purchaseOrders.ref, sync: stockSyncTransactions })
    .from(materialLots)
    .innerJoin(suppliers, eq(suppliers.id, materialLots.supplierId))
    .innerJoin(materialReceipts, eq(materialReceipts.id, materialLots.receiptId))
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, materialReceipts.purchaseOrderId))
    .leftJoin(materialSpecs, eq(materialSpecs.id, materialLots.materialSpecId))
    .leftJoin(stockSyncTransactions, eq(stockSyncTransactions.id, materialLots.stockInSyncId))
    .where(and(opts.status ? eq(materialLots.status, opts.status) : undefined, q ? or(ilike(materialLots.lotNo, `%${q}%`), ilike(materialLots.heatNumber, `%${q}%`), ilike(suppliers.name, `%${q}%`)) : undefined))
    .orderBy(desc(materialLots.createdAt))
    .limit(300);
}

export async function getLot(ctx: Ctx, lotId: string) {
  requirePermission(ctx, "materials.view");
  const [row] = await ctx.db
    .select({ lot: materialLots, supplier: suppliers, spec: materialSpecs, receipt: materialReceipts, po: purchaseOrders, pol: purchaseOrderLines, item: boxheroItems })
    .from(materialLots)
    .innerJoin(suppliers, eq(suppliers.id, materialLots.supplierId))
    .innerJoin(materialReceipts, eq(materialReceipts.id, materialLots.receiptId))
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, materialReceipts.purchaseOrderId))
    .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.id, materialLots.purchaseOrderLineId))
    .leftJoin(materialSpecs, eq(materialSpecs.id, materialLots.materialSpecId))
    .leftJoin(boxheroItems, eq(boxheroItems.id, materialLots.boxheroItemId))
    .where(eq(materialLots.id, lotId))
    .limit(1);
  if (!row) throw notFound("Material lot");
  const [certs, allocs, txs, releaseInfo, syncs] = await Promise.all([
    ctx.db.select({ c: materialCertificates, f: files }).from(materialLotCertificates).innerJoin(materialCertificates, eq(materialCertificates.id, materialLotCertificates.certificateId)).innerJoin(files, eq(files.id, materialCertificates.fileId)).where(eq(materialLotCertificates.lotId, lotId)),
    ctx.db.select({ a: materialAllocations, job: jobs.jobNumber }).from(materialAllocations).innerJoin(jobs, eq(jobs.id, materialAllocations.jobId)).where(eq(materialAllocations.lotId, lotId)),
    ctx.db.select({ t: materialTransactions, job: jobs.jobNumber, by: users.name, sync: stockSyncTransactions }).from(materialTransactions).leftJoin(jobs, eq(jobs.id, materialTransactions.jobId)).leftJoin(users, eq(users.id, materialTransactions.performedBy)).leftJoin(stockSyncTransactions, eq(stockSyncTransactions.id, materialTransactions.stockSyncId)).where(eq(materialTransactions.lotId, lotId)).orderBy(asc(materialTransactions.performedAt)),
    lotReleaseChecks(ctx, lotId),
    row.lot.stockInSyncId ? ctx.db.select().from(stockSyncTransactions).where(eq(stockSyncTransactions.id, row.lot.stockInSyncId)) : Promise.resolve([]),
  ]);
  return { ...row, certificates: certs, allocations: allocs, transactions: txs, releaseChecks: releaseInfo.checks, releaseReady: releaseInfo.ready, stockIn: syncs[0] ?? null };
}

/**
 * Material status for a job across the full lifecycle:
 * ordered → received → recorded in BoxHero → inspected/released → allocated → issued → consumed → remaining/returned.
 */
export async function jobMaterialStatus(ctx: Ctx, jobId: string) {
  requireAnyPermission(ctx, "materials.view", "jobs.view", "production.view_all");
  const poLines = await ctx.db
    .select({ l: purchaseOrderLines, po: purchaseOrders, supplier: suppliers.name })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(eq(purchaseOrderLines.jobId, jobId), ne(purchaseOrders.status, "cancelled")));
  const lotsFromPo = poLines.length ? await ctx.db.select().from(materialLots).where(inArray(materialLots.purchaseOrderLineId, poLines.map((p) => p.l.id))) : [];
  const allocs = await ctx.db.select({ a: materialAllocations, lot: materialLots }).from(materialAllocations).innerJoin(materialLots, eq(materialLots.id, materialAllocations.lotId)).where(and(eq(materialAllocations.jobId, jobId), ne(materialAllocations.status, "cancelled")));
  const txs = await ctx.db.select({ t: materialTransactions, lot: materialLots, sync: stockSyncTransactions }).from(materialTransactions).innerJoin(materialLots, eq(materialLots.id, materialTransactions.lotId)).leftJoin(stockSyncTransactions, eq(stockSyncTransactions.id, materialTransactions.stockSyncId)).where(eq(materialTransactions.jobId, jobId));
  const lotIds = [...new Set([...lotsFromPo.map((l) => l.id), ...allocs.map((a) => a.lot.id)])];
  const lots = lotIds.length ? await ctx.db.select({ lot: materialLots, sync: stockSyncTransactions }).from(materialLots).leftJoin(stockSyncTransactions, eq(stockSyncTransactions.id, materialLots.stockInSyncId)).where(inArray(materialLots.id, lotIds)) : [];
  const perLot = lots.map(({ lot, sync }) => {
    const mine = txs.filter((t) => t.lot.id === lot.id);
    const s = (k: string) => sum(mine.filter((t) => t.t.kind === k).map((t) => t.t.quantity));
    const allocated = sum(allocs.filter((a) => a.lot.id === lot.id).map((a) => a.a.quantity));
    const issued = s("issue").minus(s("return"));
    return {
      lot,
      stages: {
        received: lot.qtyReceived,
        recordedInBoxhero: !lot.stockInSyncId ? "not tracked" : sync && ["confirmed", "manual_confirmed"].includes(sync.status) ? "yes" : (sync?.status ?? "pending"),
        released: lot.status === "released",
        allocated: allocated.toString(),
        issued: issued.toString(),
        consumed: s("consume").toString(),
        remnant: s("remnant").toString(),
        returned: s("return").toString(),
        scrapped: s("scrap").toString(),
        remainingAtJob: issued.minus(s("consume")).minus(s("remnant")).minus(s("scrap")).toString(),
      },
    };
  });
  return { ordered: poLines, lots: perLot, transactions: txs, allocations: allocs };
}

export async function listMaterialSpecs(ctx: Ctx) {
  requireAnyPermission(ctx, "materials.view", "purchasing.view", "quality.view");
  const specs = await ctx.db.select().from(materialSpecs).orderBy(asc(materialSpecs.code));
  const links = await ctx.db.select({ link: materialSpecItems, item: boxheroItems }).from(materialSpecItems).innerJoin(boxheroItems, eq(boxheroItems.id, materialSpecItems.boxheroItemId));
  return specs.map((s) => ({ ...s, items: links.filter((l) => l.link.materialSpecId === s.id) }));
}

/** Released lots with unallocated quantity matching a spec (allocation picker). */
export async function availableLots(ctx: Ctx, materialSpecId?: string | null) {
  requireAnyPermission(ctx, "materials.allocate", "materials.view");
  const lots = await ctx.db
    .select({ lot: materialLots, spec: materialSpecs.code })
    .from(materialLots)
    .leftJoin(materialSpecs, eq(materialSpecs.id, materialLots.materialSpecId))
    .where(and(eq(materialLots.status, "released"), materialSpecId ? eq(materialLots.materialSpecId, materialSpecId) : undefined));
  const out = [];
  for (const l of lots) {
    const b = await lotBalances(ctx, l.lot.id);
    const free = d(l.lot.qtyReceived).minus(b.allocated);
    if (free.greaterThan(0)) out.push({ ...l, free: free.toString() });
  }
  return out;
}

