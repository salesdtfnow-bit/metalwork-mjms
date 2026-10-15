"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/server/action";
import { f } from "@/server/forms";
import { addAddress, addContact, attachPartyFile, createSupplier, setSupplierApproval, updateSupplier } from "@/server/services/parties";

const supplierForm = z.object({
  code: f.str("Code is required."),
  name: f.str("Name is required."),
  email: f.email(),
  phone: f.optStr(),
  website: f.optStr(),
  vatNumber: f.optStr(),
  accountRef: f.optStr(),
  paymentTerms: f.optStr(),
  currency: f.optStr(),
  categories: f.strs(),
  certifications: f.optStr(),
  notes: f.optStr(),
  boxheroPartnerId: f.optStr(),
});

type Cat = "material" | "subcontract" | "tooling" | "calibration" | "maintenance" | "carrier" | "other";

export const createSupplierAction = action("supplier.create", supplierForm, async (ctx, input) => {
  const s = await createSupplier(ctx, { ...input, currency: (input.currency ?? "GBP").toUpperCase(), categories: input.categories as Cat[] });
  redirect(`/suppliers/${s.id}`);
});

export const updateSupplierAction = action(
  "supplier.update",
  supplierForm.extend({ id: f.uuid() }),
  async (ctx, { id, ...input }) => {
    await updateSupplier(ctx, id, { ...input, currency: (input.currency ?? "GBP").toUpperCase(), categories: input.categories as Cat[] });
    return "Supplier details saved.";
  },
  { revalidate: (i) => [`/suppliers/${i.id}`, "/suppliers"] },
);

export const setApprovalAction = action(
  "supplier.approval",
  z.object({
    id: f.uuid(),
    status: f.enumOf(["approved", "conditional", "pending", "not_approved", "suspended"] as const),
    scope: f.optStr(),
    expiresOn: f.optDate(),
    reason: f.str("A reason is required."),
  }),
  async (ctx, { id, ...a }) => {
    await setSupplierApproval(ctx, id, a);
    return "Approval status updated.";
  },
  { revalidate: (i) => [`/suppliers/${i.id}`, "/suppliers"] },
);

export const addSupplierContactAction = action(
  "supplier.contact",
  z.object({ ownerId: f.uuid(), name: f.str(), jobTitle: f.optStr(), email: f.email(), phone: f.optStr(), isPrimary: f.bool() }),
  async (ctx, { ownerId, ...c }) => {
    await addContact(ctx, { supplierId: ownerId }, c);
    return "Contact added.";
  },
  { revalidate: (i) => `/suppliers/${i.ownerId}` },
);

export const addSupplierAddressAction = action(
  "supplier.address",
  z.object({
    ownerId: f.uuid(),
    kind: f.enumOf(["billing", "delivery", "site"] as const),
    label: f.optStr(),
    line1: f.str("Address line 1 is required."),
    line2: f.optStr(),
    city: f.optStr(),
    county: f.optStr(),
    postcode: f.optStr(),
    country: f.optStr(),
    deliveryInstructions: f.optStr(),
    isDefault: f.bool(),
  }),
  async (ctx, { ownerId, country, ...a }) => {
    await addAddress(ctx, { supplierId: ownerId }, { ...a, country: country ?? "United Kingdom" });
    return "Address added.";
  },
  { revalidate: (i) => `/suppliers/${i.ownerId}` },
);

export const attachSupplierFileAction = action(
  "supplier.file",
  z.object({ ownerId: f.uuid(), file: z.instanceof(File, { message: "Choose a file." }), description: f.optStr() }),
  async (ctx, { ownerId, file, description }) => {
    await attachPartyFile(ctx, { supplierId: ownerId }, file, description);
    return "File attached.";
  },
  { revalidate: (i) => `/suppliers/${i.ownerId}` },
);
