"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/server/action";
import { f } from "@/server/forms";
import {
  addAddress,
  addContact,
  addCustomerRequirement,
  attachPartyFile,
  createCustomer,
  setCustomerActive,
  setCustomerRequirementActive,
  updateCustomer,
} from "@/server/services/parties";

const customerForm = z.object({
  code: f.str("Code is required."),
  name: f.str("Name is required."),
  email: f.email(),
  phone: f.optStr(),
  website: f.optStr(),
  vatNumber: f.optStr(),
  accountRef: f.optStr(),
  paymentTerms: f.optStr(),
  currency: f.optStr(),
  deliveryPreferences: f.optStr(),
  qualityRequirements: f.optStr(),
  requiredCertificates: f.optStr(),
  packagingRequirements: f.optStr(),
  notes: f.optStr(),
  creditLimit: f.optStr(),
});

export const createCustomerAction = action("customer.create", customerForm, async (ctx, input) => {
  const c = await createCustomer(ctx, { ...input, currency: input.currency ?? "GBP" });
  redirect(`/customers/${c.id}`);
});

export const updateCustomerAction = action(
  "customer.update",
  customerForm.extend({ id: f.uuid() }),
  async (ctx, { id, ...input }) => {
    await updateCustomer(ctx, id, { ...input, currency: input.currency ?? "GBP" });
    return "Customer details saved.";
  },
  { revalidate: (i) => `/customers/${i.id}` },
);

export const setCustomerActiveAction = action(
  "customer.active",
  z.object({ id: f.uuid(), active: f.bool() }),
  async (ctx, { id, active }) => {
    await setCustomerActive(ctx, id, active);
    return active ? "Customer reactivated." : "Customer deactivated.";
  },
  { revalidate: (i) => `/customers/${i.id}` },
);

export const addContactAction = action(
  "customer.contact",
  z.object({ ownerId: f.uuid(), name: f.str(), jobTitle: f.optStr(), email: f.email(), phone: f.optStr(), isPrimary: f.bool() }),
  async (ctx, { ownerId, ...c }) => {
    await addContact(ctx, { customerId: ownerId }, c);
    return "Contact added.";
  },
  { revalidate: (i) => `/customers/${i.ownerId}` },
);

export const addAddressAction = action(
  "customer.address",
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
    await addAddress(ctx, { customerId: ownerId }, { ...a, country: country ?? "United Kingdom" });
    return "Address added.";
  },
  { revalidate: (i) => `/customers/${i.ownerId}` },
);

export const addRequirementAction = action(
  "customer.requirement",
  z.object({ ownerId: f.uuid(), kind: f.str(), description: f.str("Describe the requirement."), mandatory: f.bool() }),
  async (ctx, { ownerId, ...r }) => {
    await addCustomerRequirement(ctx, ownerId, r);
    return "Requirement added.";
  },
  { revalidate: (i) => `/customers/${i.ownerId}` },
);

export const toggleRequirementAction = action(
  "customer.requirement_toggle",
  z.object({ ownerId: f.uuid(), requirementId: f.uuid(), active: f.bool() }),
  async (ctx, { requirementId, active }) => {
    await setCustomerRequirementActive(ctx, requirementId, active);
  },
  { revalidate: (i) => `/customers/${i.ownerId}` },
);

export const attachCustomerFileAction = action(
  "customer.file",
  z.object({ ownerId: f.uuid(), file: z.instanceof(File, { message: "Choose a file." }), description: f.optStr() }),
  async (ctx, { ownerId, file, description }) => {
    await attachPartyFile(ctx, { customerId: ownerId }, file, description);
    return "File attached.";
  },
  { revalidate: (i) => `/customers/${i.ownerId}` },
);
