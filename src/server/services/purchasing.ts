import { and, asc, desc, eq, ilike, inArray, lt, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { jobs, materialSpecs, purchaseOrderLines, purchaseOrders, purchaseRequisitions, suppliers, users } from "../db/schema";
import { audit } from "../audit";
import { mutate, requireAnyPermission, requirePermission, type Ctx } from "../context";
import { forbidden, invalid, notFound } from "../errors";
import { nextRef, REF } from "../refs";
import { d, money2, sum } from "@/lib/decimal";
import { todayISO } from "@/lib/format";
import { supplierUsable } from "./parties";
import { notify } from "./notifications";

export const requisitionInput = z.object({
  jobId: z.string().uuid().nullish(),
  jobLineId: z.string().uuid().nullish(),
  materialSpecId: z.string().uuid().nullish(),
  description: z.string().trim().min(2, "Describe the material."),
  dimensions: z.string().nullish(),
  quantity: z.string().regex(/^\d+(\.\d+)?$/, "Enter a quantity."),
  uom: z.string().default("pcs"),
  requiredDate: z.string().nullish(),
  notes: z.string().nullish(),
});

export async function createRequisition(ctx: Ctx, raw: z.input<typeof requisitionInput>) {
  requirePermission(ctx, "purchasing.manage");
  const data = requisitionInput.parse(raw);
  return mutate(ctx, async (tx) => {
    if (data.jobId) {
      const [j] = await tx.db.select().from(jobs).where(eq(jobs.id, data.jobId)).limit(1);
      if (!j) throw invalid("Job not found.");
      if (!j.authorisedAt) throw invalid(`Job ${j.jobNumber} has not been authorised — material cannot be requested yet.`);
      if (["cancelled", "completed"].includes(j.status)) throw invalid(`Job ${j.jobNumber} is ${j.status}.`);
    }
    const ref = await nextRef(tx.db, REF.purchaseRequisition);
    const [r] = await tx.db.insert(purchaseRequisitions).values({ ...data, ref, requiredDate: data.requiredDate || null, requestedBy: ctx.actor.userId }).returning();
    await audit(tx, { action: "requisition.create", entityType: "purchase_requisition", entityId: r.id, entityRef: ref, jobId: data.jobId, after: data });
    return r;
  });
}

export const poInput = z.object({
  supplierId: z.string().uuid("Select a supplier."),
  kind: z.enum(["material", "subcontract", "tooling", "service"]).default("material"),
  requiredDate: z.string().nullish(),
  supplierReference: z.string().nullish(),
  currency: z.string().trim().length(3).transform((s) => s.toUpperCase()).default("GBP"),
  deliveryInstructions: z.string().nullish(),
  notes: z.string().nullish(),
});
export const poLineInput = z.object({
  jobId: z.string().uuid().nullish(),
  materialSpecId: z.string().uuid().nullish(),
  boxheroItemId: z.string().uuid().nullish(),
  description: z.string().trim().min(2),
  form: z.string().nullish(),
  dimensions: z.string().nullish(),
  quantity: z.string().regex(/^\d+(\.\d+)?$/),
  uom: z.string().default("pcs"),
  unitPrice: z.string().default("0"),
  requiredDate: z.string().nullish(),
  certRequirement: z.string().nullish(),
  requisitionId: z.string().uuid().nullish(),
});

export async function createPurchaseOrder(ctx: Ctx, raw: z.input<typeof poInput>, lines: z.input<typeof poLineInput>[]) {
  requirePermission(ctx, "purchasing.manage");
  const data = poInput.parse(raw);
  const ls = lines.map((l) => poLineInput.parse(l));
  if (!ls.length) throw invalid("Add at least one line.");
  return mutate(ctx, async (tx) => {
    const [s] = await tx.db.select().from(suppliers).where(eq(suppliers.id, data.supplierId)).limit(1);
    if (!s) throw invalid("Supplier not found.");
    if (!supplierUsable(s, todayISO())) throw invalid(`${s.name} is not an approved supplier (status: ${s.approvalStatus}${s.approvalExpiresOn ? `, expires ${s.approvalExpiresOn}` : ""}).`);
    const needCat = data.kind === "material" ? "material" : data.kind === "subcontract" ? "subcontract" : null;
    if (needCat && !s.categories.includes(needCat)) throw invalid(`${s.name} is not approved for ${needCat} supply.`);
    for (const l of ls) {
      if (l.jobId) {
        const [j] = await tx.db.select().from(jobs).where(eq(jobs.id, l.jobId)).limit(1);
        if (!j?.authorisedAt) throw invalid(`Job ${j?.jobNumber ?? ""} is not authorised for purchasing.`);
      }
    }
    const ref = await nextRef(tx.db, REF.purchaseOrder);
    const total = money2(sum(ls.map((l) => d(l.quantity).times(d(l.unitPrice)))));
    const [po] = await tx.db
      .insert(purchaseOrders)
      .values({ ...data, ref, total, requiredDate: data.requiredDate || null, orderDate: todayISO(), createdBy: ctx.actor.userId })
      .returning();
    let n = 0;
    for (const l of ls) {
      const [pol] = await tx.db
        .insert(purchaseOrderLines)
        .values({ ...l, requisitionId: undefined, purchaseOrderId: po.id, lineNo: ++n, requiredDate: l.requiredDate || data.requiredDate || null } as typeof purchaseOrderLines.$inferInsert)
        .returning();
      if (l.requisitionId) await tx.db.update(purchaseRequisitions).set({ status: "ordered", purchaseOrderLineId: pol.id }).where(eq(purchaseRequisitions.id, l.requisitionId));
    }
    await audit(tx, { action: "po.create", entityType: "purchase_order", entityId: po.id, entityRef: ref, after: { ...data, lines: ls } });
    return po;
  });
}

/** Approval (independent of the creator). */
export async function approvePurchaseOrder(ctx: Ctx, poId: string) {
  requirePermission(ctx, "purchasing.approve");
  return mutate(ctx, async (tx) => {
    const [po] = await tx.db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)).limit(1);
    if (!po) throw notFound("Purchase order");
    if (po.status !== "draft") throw invalid(`Purchase order is ${po.status}.`);
    if (po.createdBy === ctx.actor.userId) throw forbidden("A different person must approve a purchase order you created.");
    await tx.db.update(purchaseOrders).set({ status: "approved", approvedBy: ctx.actor.userId, approvedAt: new Date() }).where(eq(purchaseOrders.id, poId));
    await audit(tx, { action: "po.approve", entityType: "purchase_order", entityId: poId, entityRef: po.ref });
  });
}

export async function markPurchaseOrderSent(ctx: Ctx, poId: string, supplierReference?: string | null) {
  requirePermission(ctx, "purchasing.manage");
  return mutate(ctx, async (tx) => {
    const [po] = await tx.db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)).limit(1);
    if (!po) throw notFound("Purchase order");
    if (po.status !== "approved") throw invalid("Only approved purchase orders can be sent.");
    await tx.db.update(purchaseOrders).set({ status: "sent", sentAt: new Date(), supplierReference: supplierReference ?? po.supplierReference }).where(eq(purchaseOrders.id, poId));
    await audit(tx, { action: "po.sent", entityType: "purchase_order", entityId: poId, entityRef: po.ref });
    const lines = await tx.db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, poId));
    const jobIds = [...new Set(lines.map((l) => l.jobId).filter((x): x is string => !!x))];
    for (const jobId of jobIds) {
      const [j] = await tx.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
      if (j && ["order_confirmed", "ready_for_planning", "planned"].includes(j.status)) {
        await tx.db.update(jobs).set({ status: "awaiting_material" }).where(eq(jobs.id, jobId));
        await audit(tx, { action: "job.status_auto", entityType: "job", entityId: jobId, entityRef: j.jobNumber, jobId, before: { status: j.status }, after: { status: "awaiting_material" }, reason: `Material ordered on ${po.ref}` });
      }
      await notify(tx, { type: "material.ordered", title: `Material ordered for ${j?.jobNumber} (${po.ref})`, link: `/jobs/${jobId}?tab=materials`, userIds: [j?.ownerId], dedupeKey: `poSent:${po.id}:${jobId}` });
    }
  });
}

export async function cancelPurchaseOrder(ctx: Ctx, poId: string, reason: string) {
  requirePermission(ctx, "purchasing.manage");
  if (!reason?.trim()) throw invalid("A reason is required.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const [po] = await tx.db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)).limit(1);
    if (!po) throw notFound("Purchase order");
    const lines = await tx.db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, poId));
    if (lines.some((l) => d(l.qtyReceived).greaterThan(0))) throw invalid("Material has been received against this PO; close it instead of cancelling.");
    await tx.db.update(purchaseOrders).set({ status: "cancelled" }).where(eq(purchaseOrders.id, poId));
    await tx.db.update(purchaseOrderLines).set({ status: "cancelled" }).where(eq(purchaseOrderLines.purchaseOrderId, poId));
    await audit(tx, { action: "po.cancel", entityType: "purchase_order", entityId: poId, entityRef: po.ref, reason });
  });
}

export async function listPurchaseOrders(ctx: Ctx, opts: { q?: string; status?: string; supplierId?: string; open?: boolean } = {}) {
  requirePermission(ctx, "purchasing.view");
  const q = opts.q?.trim();
  return ctx.db
    .select({ po: purchaseOrders, supplier: suppliers.name, supplierCode: suppliers.code })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(
      and(
        opts.status ? eq(purchaseOrders.status, opts.status) : undefined,
        opts.open ? notInArray(purchaseOrders.status, ["received", "closed", "cancelled"]) : undefined,
        opts.supplierId ? eq(purchaseOrders.supplierId, opts.supplierId) : undefined,
        q ? or(ilike(purchaseOrders.ref, `%${q}%`), ilike(suppliers.name, `%${q}%`), ilike(purchaseOrders.supplierReference, `%${q}%`)) : undefined,
      ),
    )
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(300);
}

export async function getPurchaseOrder(ctx: Ctx, id: string) {
  requirePermission(ctx, "purchasing.view");
  const [row] = await ctx.db
    .select({ po: purchaseOrders, supplier: suppliers, createdByName: users.name })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .leftJoin(users, eq(users.id, purchaseOrders.createdBy))
    .where(eq(purchaseOrders.id, id))
    .limit(1);
  if (!row) throw notFound("Purchase order");
  const lines = await ctx.db
    .select({ l: purchaseOrderLines, job: jobs.jobNumber, spec: materialSpecs.code })
    .from(purchaseOrderLines)
    .leftJoin(jobs, eq(jobs.id, purchaseOrderLines.jobId))
    .leftJoin(materialSpecs, eq(materialSpecs.id, purchaseOrderLines.materialSpecId))
    .where(eq(purchaseOrderLines.purchaseOrderId, id))
    .orderBy(asc(purchaseOrderLines.lineNo));
  return { ...row, lines };
}

export async function listRequisitions(ctx: Ctx, status = "open") {
  requirePermission(ctx, "purchasing.view");
  return ctx.db
    .select({ r: purchaseRequisitions, job: jobs.jobNumber, spec: materialSpecs.code, requestedBy: users.name })
    .from(purchaseRequisitions)
    .leftJoin(jobs, eq(jobs.id, purchaseRequisitions.jobId))
    .leftJoin(materialSpecs, eq(materialSpecs.id, purchaseRequisitions.materialSpecId))
    .leftJoin(users, eq(users.id, purchaseRequisitions.requestedBy))
    .where(eq(purchaseRequisitions.status, status))
    .orderBy(sql`${purchaseRequisitions.requiredDate} asc nulls last`);
}

/** PO lines past their required date and not fully received. */
export async function overdueDeliveries(ctx: Ctx) {
  requireAnyPermission(ctx, "purchasing.view", "reports.view", "reports.management", "planning.view");
  return ctx.db
    .select({ l: purchaseOrderLines, po: purchaseOrders, supplier: suppliers.name, job: jobs.jobNumber })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .leftJoin(jobs, eq(jobs.id, purchaseOrderLines.jobId))
    .where(and(inArray(purchaseOrders.status, ["sent", "partially_received"]), inArray(purchaseOrderLines.status, ["open", "partially_received"]), lt(purchaseOrderLines.requiredDate, todayISO())))
    .orderBy(asc(purchaseOrderLines.requiredDate));
}

/** Closes a PO (no further receipts expected). Remaining open lines are marked cancelled. */
export async function closePurchaseOrder(ctx: Ctx, poId: string, reason: string) {
  requirePermission(ctx, "purchasing.manage");
  if (!reason?.trim()) throw invalid("A reason is required.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const [po] = await tx.db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)).limit(1);
    if (!po) throw notFound("Purchase order");
    if (["closed", "cancelled", "draft"].includes(po.status)) throw invalid(`Purchase order is ${po.status}.`);
    await tx.db.update(purchaseOrderLines).set({ status: "cancelled" }).where(and(eq(purchaseOrderLines.purchaseOrderId, poId), inArray(purchaseOrderLines.status, ["open", "partially_received"])));
    await tx.db.update(purchaseOrders).set({ status: "closed" }).where(eq(purchaseOrders.id, poId));
    await audit(tx, { action: "po.close", entityType: "purchase_order", entityId: poId, entityRef: po.ref, reason });
  });
}

/** Updates the unit price of an open PO line (e.g. a PO raised from requisitions) — before receipt only. */
export async function updatePurchaseOrderLinePrice(ctx: Ctx, lineId: string, unitPrice: string, reason?: string | null) {
  requirePermission(ctx, "purchasing.manage");
  if (!/^\d+(\.\d+)?$/.test(unitPrice)) throw invalid("Enter a valid price.", { field: "unitPrice" });
  return mutate(ctx, async (tx) => {
    const [l] = await tx.db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, lineId)).limit(1);
    if (!l) throw notFound("PO line");
    const [po] = await tx.db.select().from(purchaseOrders).where(eq(purchaseOrders.id, l.purchaseOrderId));
    if (!["draft", "approved"].includes(po.status)) throw invalid("Prices can only be changed before the PO is sent.");
    if (po.status === "approved" && !reason?.trim()) throw invalid("Give a reason for changing an approved PO.", { field: "reason" });
    await tx.db.update(purchaseOrderLines).set({ unitPrice }).where(eq(purchaseOrderLines.id, lineId));
    const lines = await tx.db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
    const total = money2(sum(lines.map((x) => d(x.quantity).times(d(x.id === lineId ? unitPrice : x.unitPrice)))));
    // A price change on an approved PO sends it back for approval.
    await tx.db.update(purchaseOrders).set({ total, ...(po.status === "approved" ? { status: "draft", approvedBy: null, approvedAt: null } : {}) }).where(eq(purchaseOrders.id, po.id));
    await audit(tx, { action: "po.line_price", entityType: "purchase_order", entityId: po.id, entityRef: po.ref, before: { unitPrice: l.unitPrice }, after: { unitPrice }, reason });
  });
}

export async function cancelRequisition(ctx: Ctx, requisitionId: string, reason: string) {
  requirePermission(ctx, "purchasing.manage");
  if (!reason?.trim()) throw invalid("A reason is required.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const [r] = await tx.db.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.id, requisitionId)).limit(1);
    if (!r) throw notFound("Requisition");
    if (r.status !== "open") throw invalid(`Requisition is ${r.status}.`);
    await tx.db.update(purchaseRequisitions).set({ status: "cancelled" }).where(eq(purchaseRequisitions.id, requisitionId));
    await audit(tx, { action: "requisition.cancel", entityType: "purchase_requisition", entityId: requisitionId, entityRef: r.ref, jobId: r.jobId, reason });
  });
}
