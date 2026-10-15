"use server";

import { z } from "zod";
import { action } from "@/server/action";
import { f } from "@/server/forms";
import { requirePermission } from "@/server/context";
import {
  addMaterialCertificate,
  allocateLot,
  cancelAllocation,
  inspectLot,
  linkSpecToBoxheroItem,
  quarantineLot,
  rejectLot,
  releaseLot,
  saveMaterialSpec,
  verifyMaterialCertificate,
} from "@/server/services/materials";
import {
  cancelStockMovement,
  confirmStockMovementManually,
  processStockOutbox,
  retryStockMovement,
  syncCatalogue,
} from "@/server/integrations/boxhero/sync";

const lotPath = (id: string) => [`/materials/lots/${id}`, "/materials"];

// ───────────── Specifications ─────────────

const specForm = z.object({
  id: f.optUuid(),
  code: f.str("Code is required."),
  grade: f.str("Grade is required."),
  standard: f.optStr(),
  materialFamily: f.optStr(),
  form: f.enumOf(["bar", "plate", "sheet", "tube", "billet", "casting", "forging", "extrusion", "other"] as const),
  description: f.optStr(),
  certRequirement: f.enumOf(["none", "2.1", "2.2", "3.1", "3.2"] as const),
  uom: f.optStr(),
});

export const saveSpecAction = action(
  "material_spec.save",
  specForm,
  async (ctx, { id, uom, ...input }) => {
    const s = await saveMaterialSpec(ctx, { ...input, uom: uom ?? "mm" }, id ?? undefined);
    return id ? `Specification ${s.code} saved.` : `Specification ${s.code} created.`;
  },
  { revalidate: "/materials" },
);

export const linkSpecItemAction = action(
  "material_spec.link_item",
  z.object({ materialSpecId: f.uuid("Select a specification."), boxheroItemId: f.uuid("Select a BoxHero item."), dimensions: f.optStr() }),
  async (ctx, i) => {
    await linkSpecToBoxheroItem(ctx, i.materialSpecId, i.boxheroItemId, i.dimensions);
    return "BoxHero item linked to the specification.";
  },
  { revalidate: "/materials" },
);

// ───────────── BoxHero ─────────────

export const syncCatalogueAction = action(
  "boxhero.sync_catalogue",
  z.object({}),
  async (ctx) => {
    requirePermission(ctx, "boxhero.sync");
    const r = await syncCatalogue(ctx.db);
    if (!r.ok) return { ok: false, error: `Catalogue sync failed: ${r.error}` };
    return `Synchronised ${r.items} items and ${r.locations} locations from BoxHero.`;
  },
  { revalidate: "/materials" },
);

export const processOutboxAction = action(
  "boxhero.process_outbox",
  z.object({}),
  async (ctx) => {
    requirePermission(ctx, "boxhero.sync");
    const r = await processStockOutbox(ctx.db);
    return `Processed queue: ${r.confirmed} confirmed (${r.reconciled} found already in BoxHero), ${r.uncertain} uncertain — will reconcile, ${r.failed} failed, ${r.manual} awaiting manual confirmation.`;
  },
  { revalidate: "/materials" },
);

export const retryMovementAction = action(
  "boxhero.retry",
  z.object({ id: f.uuid() }),
  async (ctx, { id }) => {
    await retryStockMovement(ctx, id);
    return "Movement re-queued. BoxHero is checked for an existing transaction before anything is re-sent.";
  },
  { revalidate: "/materials" },
);

export const confirmMovementAction = action(
  "boxhero.manual_confirm",
  z.object({ id: f.uuid(), reference: f.str("Enter the BoxHero transaction reference."), note: f.str("Add a note explaining how this was confirmed.") }),
  async (ctx, i) => {
    await confirmStockMovementManually(ctx, i.id, i.reference, i.note);
    return "Movement marked as confirmed in BoxHero.";
  },
  { revalidate: "/materials" },
);

export const cancelMovementAction = action(
  "boxhero.cancel",
  z.object({ id: f.uuid(), reason: f.str("A reason is required.") }),
  async (ctx, i) => {
    await cancelStockMovement(ctx, i.id, i.reason);
    return "Movement cancelled — it will not be sent to BoxHero.";
  },
  { revalidate: "/materials" },
);

// ───────────── Lot inspection & release ─────────────

export const inspectLotAction = action(
  "material.inspect",
  z.object({ lotId: f.uuid(), result: f.enumOf(["pass", "fail"] as const), notes: f.optStr() }),
  async (ctx, i) => {
    await inspectLot(ctx, i.lotId, { result: i.result, notes: i.notes });
    return i.result === "pass" ? "Inspection passed recorded. The lot is still not usable until released." : "Inspection failure recorded — lot quarantined and placed on hold.";
  },
  { revalidate: (i) => lotPath(i.lotId) },
);

export const quarantineLotAction = action(
  "material.quarantine",
  z.object({ lotId: f.uuid(), reason: f.str("A reason is required.") }),
  async (ctx, i) => {
    await quarantineLot(ctx, i.lotId, i.reason);
    return "Lot quarantined and placed on hold.";
  },
  { revalidate: (i) => lotPath(i.lotId) },
);

export const releaseLotAction = action(
  "material.release",
  z.object({ lotId: f.uuid(), password: f.str("Enter your password to sign."), comment: f.optStr() }),
  async (ctx, i) => {
    await releaseLot(ctx, i.lotId, { password: i.password, comment: i.comment });
    return "Lot released for production. It can now be allocated to jobs.";
  },
  { revalidate: (i) => lotPath(i.lotId) },
);

export const rejectLotAction = action(
  "material.reject",
  z.object({ lotId: f.uuid(), reason: f.str("A reason is required.") }),
  async (ctx, i) => {
    await rejectLot(ctx, i.lotId, i.reason);
    return "Lot rejected.";
  },
  { revalidate: (i) => lotPath(i.lotId) },
);

// ───────────── Certificates ─────────────

export const addCertificateAction = action(
  "material.certificate_add",
  z.object({
    lotIds: f.uuids(),
    certType: f.enumOf(["2.1", "2.2", "3.1", "3.2", "coc", "other"] as const),
    certNumber: f.optStr(),
    heatNumber: f.optStr(),
    issuedBy: f.optStr(),
    file: z.instanceof(File, { message: "Attach the certificate." }),
  }),
  async (ctx, i) => {
    await addMaterialCertificate(ctx, { lotIds: i.lotIds, certType: i.certType, certNumber: i.certNumber, heatNumber: i.heatNumber, issuedBy: i.issuedBy }, i.file);
    return "Certificate uploaded. It must be verified against the lot before release.";
  },
  { revalidate: (i) => i.lotIds.flatMap(lotPath) },
);

export const verifyCertificateAction = action(
  "material.certificate_verify",
  z.object({ lotId: f.uuid(), certificateId: f.uuid(), result: f.enumOf(["accepted", "rejected"] as const), notes: f.optStr() }),
  async (ctx, i) => {
    await verifyMaterialCertificate(ctx, i.certificateId, { result: i.result, notes: i.notes });
    return i.result === "accepted" ? "Certificate accepted." : "Certificate rejected.";
  },
  { revalidate: (i) => lotPath(i.lotId) },
);

// ───────────── Allocation ─────────────

export const allocateLotAction = action(
  "material.allocate",
  z.object({ lotId: f.uuid(), jobId: f.uuid("Select a job."), quantity: f.dec({ min: 0, msg: "Enter the quantity to allocate." }) }),
  async (ctx, i) => {
    await allocateLot(ctx, { lotId: i.lotId, jobId: i.jobId, quantity: i.quantity });
    return "Material allocated to the job.";
  },
  { revalidate: (i) => [...lotPath(i.lotId), `/jobs/${i.jobId}`] },
);

export const cancelAllocationAction = action(
  "material.allocation_cancel",
  z.object({ lotId: f.uuid(), allocationId: f.uuid(), reason: f.str("A reason is required.") }),
  async (ctx, i) => {
    await cancelAllocation(ctx, i.allocationId, i.reason);
    return "Allocation cancelled.";
  },
  { revalidate: (i) => lotPath(i.lotId) },
);
