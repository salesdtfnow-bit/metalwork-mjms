"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/server/action";
import { f } from "@/server/forms";
import { invalid } from "@/server/errors";
import { cancelDispatch, confirmDispatch, createDispatch, recordDelivery } from "@/server/services/dispatch";
import { dtField } from "../planning/_components/parse";

export const createDispatchAction = action(
  "dispatch.create",
  z.object({
    jobId: f.uuid(),
    lineIds: f.uuids(),
    deliveryAddressId: f.optUuid(),
    deliveryMethod: f.enumOf(["carrier", "own_vehicle", "collection", "courier"] as const),
    carrier: f.optStr(),
    trackingRef: f.optStr(),
    packagingNotes: f.optStr(),
    packageCount: f.optStr(),
    grossWeightKg: f.optStr(),
    certificatesIncluded: f.optStr(),
    notes: f.optStr(),
  }),
  async (ctx, { lineIds, ...head }, fd) => {
    // Per-line inputs are named qty_<lineId>, batch_<lineId>, serial_<lineId> (repeated).
    const lines = [];
    for (const id of lineIds) {
      const qty = String(fd.get(`qty_${id}`) ?? "").trim().replace(/,/g, "");
      if (!qty || Number(qty) === 0) continue;
      if (!/^\d+(\.\d+)?$/.test(qty)) throw invalid("Quantities must be positive numbers.", { field: `qty_${id}` });
      const batchId = String(fd.get(`batch_${id}`) ?? "") || null;
      const serialIds = fd.getAll(`serial_${id}`).map(String).filter(Boolean);
      lines.push({ jobLineId: id, quantity: qty, batchId, serialIds });
    }
    if (!lines.length) throw invalid("Enter a quantity for at least one line.");
    const dsp = await createDispatch(ctx, { ...head, lines });
    redirect(`/dispatch/${dsp.id}`);
  },
);

export const confirmDispatchAction = action(
  "dispatch.confirm",
  z.object({ id: f.uuid(), carrier: f.optStr(), trackingRef: f.optStr() }),
  async (ctx, { id, ...input }) => {
    const r = await confirmDispatch(ctx, id, input);
    return r.jobFullyDispatched ? "Dispatch confirmed and delivery note issued. All job quantities are now dispatched." : "Dispatch confirmed and delivery note issued.";
  },
  { revalidate: (i) => [`/dispatch/${i.id}`, "/dispatch"] },
);

export const recordDeliveryAction = action(
  "dispatch.delivered",
  z.object({ id: f.uuid(), deliveredAt: dtField.opt(), pod: f.file() }),
  async (ctx, { id, deliveredAt, pod }) => {
    await recordDelivery(ctx, id, { deliveredAt: deliveredAt ? deliveredAt.toISOString() : null }, pod ?? null);
    return "Delivery recorded.";
  },
  { revalidate: (i) => [`/dispatch/${i.id}`, "/dispatch"] },
);

export const cancelDispatchAction = action(
  "dispatch.cancel",
  z.object({ id: f.uuid(), reason: f.str("Give a reason for cancelling.") }),
  async (ctx, { id, reason }) => {
    await cancelDispatch(ctx, id, reason);
    return "Draft dispatch cancelled. Its quantities are available to dispatch again.";
  },
  { revalidate: (i) => [`/dispatch/${i.id}`, "/dispatch"] },
);
