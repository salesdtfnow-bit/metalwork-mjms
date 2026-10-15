"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/server/action";
import { f } from "@/server/forms";
import { parseDecimalInput } from "@/lib/decimal";
import { listMaterialSpecs, receiveMaterial } from "@/server/services/materials";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  cancelRequisition,
  closePurchaseOrder,
  createPurchaseOrder,
  createRequisition,
  listRequisitions,
  markPurchaseOrderSent,
  updatePurchaseOrderLinePrice,
} from "@/server/services/purchasing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: FormDataEntryValue | null | undefined) => (typeof v === "string" && v.trim() ? v.trim() : null);
const uuidOrNull = (v: FormDataEntryValue | null | undefined) => {
  const s = str(v);
  return s && UUID.test(s) ? s : null;
};

// ───────────── Requisitions ─────────────

export const createRequisitionAction = action(
  "requisition.create",
  z.object({
    jobId: f.optUuid(),
    materialSpecId: f.optUuid(),
    description: f.str("Describe the material."),
    dimensions: f.optStr(),
    quantity: f.dec({ min: 0, msg: "Enter a quantity." }),
    uom: f.optStr(),
    requiredDate: f.optDate(),
    notes: f.optStr(),
  }),
  async (ctx, { uom, ...i }) => {
    await createRequisition(ctx, { ...i, uom: uom ?? "pcs" });
    redirect("/purchasing?tab=requisitions");
  },
);

// ───────────── Purchase orders ─────────────

const poHeader = z.object({
  supplierId: f.uuid("Select a supplier."),
  kind: f.enumOf(["material", "subcontract", "tooling", "service"] as const),
  requiredDate: f.optDate(),
  supplierReference: f.optStr(),
  currency: f.optStr(),
  deliveryInstructions: f.optStr(),
  notes: f.optStr(),
});

type LineIn = {
  jobId: string | null;
  materialSpecId: string | null;
  boxheroItemId: string | null;
  description: string;
  form: string | null;
  dimensions: string | null;
  quantity: string;
  uom: string;
  unitPrice: string;
  requiredDate: string | null;
  certRequirement: string | null;
  requisitionId?: string | null;
};

export const createPurchaseOrderAction = action("po.create", poHeader, async (ctx, header, fd) => {
  const col = (name: string) => fd.getAll(name);
  const desc = col("line_desc");
  const specs = await listMaterialSpecs(ctx);
  const lines: LineIn[] = [];
  const errors: string[] = [];
  for (let i = 0; i < desc.length; i++) {
    const get = (n: string) => col(n)[i];
    const description = str(desc[i]);
    const qtyRaw = str(get("line_qty"));
    const specId = uuidOrNull(get("line_spec"));
    if (!description && !qtyRaw && !specId) continue; // empty row
    const spec = specs.find((s) => s.id === specId);
    const finalDesc = description ?? (spec ? `${spec.code} ${spec.grade}` : null);
    if (!finalDesc) {
      errors.push(`Line ${i + 1}: enter a description.`);
      continue;
    }
    const quantity = parseDecimalInput(qtyRaw ?? "", { min: 0 });
    if (!quantity || !(Number(quantity) > 0)) {
      errors.push(`Line ${i + 1}: enter a quantity greater than zero.`);
      continue;
    }
    const priceRaw = str(get("line_price"));
    const unitPrice = priceRaw ? parseDecimalInput(priceRaw, { min: 0 }) : "0";
    if (unitPrice === null) {
      errors.push(`Line ${i + 1}: enter a valid unit price.`);
      continue;
    }
    const date = str(get("line_date"));
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push(`Line ${i + 1}: enter a valid required date.`);
      continue;
    }
    lines.push({
      jobId: uuidOrNull(get("line_job")),
      materialSpecId: specId,
      boxheroItemId: uuidOrNull(get("line_item")),
      description: finalDesc,
      form: str(get("line_form")) ?? spec?.form ?? null,
      dimensions: str(get("line_dims")),
      quantity,
      uom: str(get("line_uom")) ?? "pcs",
      unitPrice,
      requiredDate: date,
      certRequirement: str(get("line_cert")) ?? spec?.certRequirement ?? null,
    });
  }
  if (errors.length) return { ok: false, error: errors.join(" ") };
  if (!lines.length) return { ok: false, error: "Add at least one line with a description and quantity." };
  const po = await createPurchaseOrder(ctx, { ...header, currency: (header.currency ?? "GBP").toUpperCase() }, lines);
  redirect(`/purchasing/${po.id}`);
});

export const createPoFromRequisitionsAction = action(
  "po.create_from_requisitions",
  z.object({
    requisitionIds: f.uuids(),
    supplierId: f.uuid("Select a supplier."),
    requiredDate: f.optDate(),
    notes: f.optStr(),
  }),
  async (ctx, i) => {
    if (!i.requisitionIds.length) return { ok: false, error: "Select at least one requisition." };
    const [open, specs] = await Promise.all([listRequisitions(ctx, "open"), listMaterialSpecs(ctx)]);
    const chosen = open.filter((r) => i.requisitionIds.includes(r.r.id));
    if (chosen.length !== i.requisitionIds.length) return { ok: false, error: "One or more selected requisitions are no longer open. Refresh the page." };
    const lines: LineIn[] = chosen.map(({ r }) => {
      const spec = specs.find((s) => s.id === r.materialSpecId);
      return {
        jobId: r.jobId,
        materialSpecId: r.materialSpecId,
        boxheroItemId: null,
        description: r.description,
        form: spec?.form ?? null,
        dimensions: r.dimensions,
        quantity: r.quantity,
        uom: r.uom,
        unitPrice: "0",
        requiredDate: r.requiredDate,
        certRequirement: spec?.certRequirement ?? null,
        requisitionId: r.id,
      };
    });
    const po = await createPurchaseOrder(ctx, { supplierId: i.supplierId, kind: "material", requiredDate: i.requiredDate, notes: i.notes, currency: "GBP" }, lines);
    redirect(`/purchasing/${po.id}`);
  },
);

export const approvePoAction = action(
  "po.approve",
  z.object({ id: f.uuid() }),
  async (ctx, { id }) => {
    await approvePurchaseOrder(ctx, id);
    return "Purchase order approved.";
  },
  { revalidate: (i) => [`/purchasing/${i.id}`, "/purchasing"] },
);

export const markPoSentAction = action(
  "po.sent",
  z.object({ id: f.uuid(), supplierReference: f.optStr() }),
  async (ctx, i) => {
    await markPurchaseOrderSent(ctx, i.id, i.supplierReference);
    return "Purchase order marked as sent to the supplier.";
  },
  { revalidate: (i) => [`/purchasing/${i.id}`, "/purchasing"] },
);

export const cancelPoAction = action(
  "po.cancel",
  z.object({ id: f.uuid(), reason: f.str("A reason is required.") }),
  async (ctx, i) => {
    await cancelPurchaseOrder(ctx, i.id, i.reason);
    return "Purchase order cancelled.";
  },
  { revalidate: (i) => [`/purchasing/${i.id}`, "/purchasing"] },
);

// ───────────── Goods receipt ─────────────

export const receiveGoodsAction = action(
  "material.receive",
  z.object({
    purchaseOrderId: f.uuid(),
    deliveryNoteNo: f.optStr(),
    notes: f.optStr(),
    lineId: f.uuids(),
    deliveryNoteFile: f.file(),
  }),
  async (ctx, i, fd) => {
    const fieldErrors: Record<string, string> = {};
    const lines = [];
    for (const id of i.lineId) {
      const qtyRaw = str(fd.get(`qty_${id}`));
      if (!qtyRaw) continue;
      const quantity = parseDecimalInput(qtyRaw, { min: 0 });
      if (!quantity) {
        fieldErrors[`qty_${id}`] = "Enter a valid quantity.";
        continue;
      }
      if (!(Number(quantity) > 0)) continue;
      const heatNumber = str(fd.get(`heat_${id}`));
      if (!heatNumber) {
        fieldErrors[`heat_${id}`] = "Heat / cast number is required for traceability.";
        continue;
      }
      lines.push({
        purchaseOrderLineId: id,
        quantity,
        heatNumber,
        supplierBatchNo: str(fd.get(`batch_${id}`)),
        dimensions: str(fd.get(`dims_${id}`)),
        boxheroLocationId: str(fd.get(`loc_${id}`)),
        storageLocation: str(fd.get(`store_${id}`)),
      });
    }
    if (Object.keys(fieldErrors).length) return { ok: false, error: "Check the highlighted lines.", fieldErrors };
    if (!lines.length) return { ok: false, error: "Enter the quantity received on at least one line." };
    const { receipt, lots } = await receiveMaterial(ctx, { purchaseOrderId: i.purchaseOrderId, deliveryNoteNo: i.deliveryNoteNo, notes: i.notes, lines }, i.deliveryNoteFile ?? null);
    return `${receipt.ref} recorded — ${lots.length} lot(s) created: ${lots.map((l) => l.lotNo).join(", ")}. They are AWAITING INSPECTION and NOT yet usable for production.`;
  },
  { revalidate: (i) => [`/purchasing/${i.purchaseOrderId}`, "/purchasing", "/materials"] },
);

// ───────────── Close PO, line prices, requisition cancel ─────────────

export const closePoAction = action(
  "po.close",
  z.object({ id: f.uuid(), reason: f.str("A reason is required.") }),
  async (ctx, i) => {
    await closePurchaseOrder(ctx, i.id, i.reason);
    return "Purchase order closed. Any outstanding lines were cancelled.";
  },
  { revalidate: (i) => [`/purchasing/${i.id}`, "/purchasing"] },
);

export const updateLinePriceAction = action(
  "po.line_price",
  z.object({ id: f.uuid(), lineId: f.uuid(), unitPrice: f.dec({ min: 0, msg: "Enter a valid price." }), reason: f.optStr() }),
  async (ctx, i) => {
    await updatePurchaseOrderLinePrice(ctx, i.lineId, i.unitPrice, i.reason);
    return "Unit price updated.";
  },
  { revalidate: (i) => [`/purchasing/${i.id}`, "/purchasing"] },
);

export const cancelRequisitionAction = action(
  "requisition.cancel",
  z.object({ requisitionId: f.uuid(), reason: f.str("A reason is required.") }),
  async (ctx, i) => {
    await cancelRequisition(ctx, i.requisitionId, i.reason);
    return "Requisition cancelled.";
  },
  { revalidate: "/purchasing" },
);
