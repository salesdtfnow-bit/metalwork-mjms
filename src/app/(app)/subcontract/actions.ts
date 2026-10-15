"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/server/action";
import { f } from "@/server/forms";
import { createSubcontractOrder, receiveFromSubcontractor, sendToSubcontractor } from "@/server/services/subcontract";

export const createSubcontractAction = action(
  "subcontract.create",
  z.object({
    operationId: f.uuid("Select the subcontract operation."),
    supplierId: f.uuid("Select the subcontractor."),
    process: f.enumOf(["heat_treatment", "plating", "anodising", "grinding", "machining", "painting", "other"] as const),
    specification: f.str("State the process specification."),
    requiredReturnDate: f.optDate(),
    estimatedCost: f.optDec({ min: 0 }),
    notes: f.optStr(),
  }),
  async (ctx, input) => {
    const sco = await createSubcontractOrder(ctx, input);
    redirect(`/subcontract/${sco.id}`);
  },
);

export const sendSubcontractAction = action(
  "subcontract.send",
  z.object({ id: f.uuid(), qtySent: f.dec({ min: 0, msg: "Enter the quantity sent." }), dispatchNoteRef: f.optStr() }),
  async (ctx, { id, ...input }) => {
    await sendToSubcontractor(ctx, id, input);
    return "Recorded as sent to the subcontractor. The operation is now at the subcontractor.";
  },
  { revalidate: (i) => [`/subcontract/${i.id}`, "/subcontract"] },
);

export const receiveSubcontractAction = action(
  "subcontract.receive",
  z.object({ id: f.uuid(), qtyReturned: f.dec({ min: 0, msg: "Enter the quantity returned." }), supplierDeliveryNote: f.optStr(), actualCost: f.optDec({ min: 0 }), certificates: f.files() }),
  async (ctx, { id, certificates, ...input }) => {
    const insp = await receiveFromSubcontractor(ctx, id, input, certificates);
    return `Parts received. Incoming inspection ${insp.ref} opened — the operation completes only when that inspection is accepted.`;
  },
  { revalidate: (i) => [`/subcontract/${i.id}`, "/subcontract"] },
);
