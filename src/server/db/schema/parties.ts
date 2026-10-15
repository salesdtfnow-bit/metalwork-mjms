import { boolean, date, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, ts, updatedAt } from "./_helpers";
import { files, users } from "./core";

export const customers = pgTable(
  "customers",
  {
    id: pk(),
    code: text().notNull(),
    name: text().notNull(),
    email: text(),
    phone: text(),
    website: text(),
    vatNumber: text(),
    accountRef: text(),
    paymentTerms: text(),
    currency: text().notNull().default("GBP"),
    deliveryPreferences: text(),
    qualityRequirements: text(),
    requiredCertificates: text(),
    packagingRequirements: text(),
    notes: text(),
    /** Commercially sensitive: visible only with customers.view_commercial */
    creditLimit: text(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("customers_code_uq").on(t.code)],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: pk(),
    code: text().notNull(),
    name: text().notNull(),
    email: text(),
    phone: text(),
    website: text(),
    vatNumber: text(),
    accountRef: text(),
    paymentTerms: text(),
    currency: text().notNull().default("GBP"),
    /** material | subcontract | tooling | calibration | maintenance | carrier | other */
    categories: text().array().notNull().default([]),
    approvalStatus: text().notNull().default("pending"), // approved | conditional | pending | not_approved | suspended
    approvalScope: text(),
    approvalExpiresOn: date(),
    approvedBy: uuid().references(() => users.id),
    approvedAt: ts(),
    certifications: text(), // e.g. ISO 9001 cert no., expiry
    notes: text(),
    boxheroPartnerId: text(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("suppliers_code_uq").on(t.code)],
);

export const contacts = pgTable(
  "contacts",
  {
    id: pk(),
    customerId: uuid().references(() => customers.id),
    supplierId: uuid().references(() => suppliers.id),
    name: text().notNull(),
    jobTitle: text(),
    email: text(),
    phone: text(),
    isPrimary: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("contacts_cust_idx").on(t.customerId), index("contacts_supp_idx").on(t.supplierId)],
);

export const addresses = pgTable(
  "addresses",
  {
    id: pk(),
    customerId: uuid().references(() => customers.id),
    supplierId: uuid().references(() => suppliers.id),
    kind: text().notNull().default("delivery"), // billing | delivery | site
    label: text(),
    line1: text().notNull(),
    line2: text(),
    city: text(),
    county: text(),
    postcode: text(),
    country: text().notNull().default("United Kingdom"),
    deliveryInstructions: text(),
    isDefault: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("addr_cust_idx").on(t.customerId)],
);

/** Configurable customer-specific requirements copied into final-release checklists. */
export const customerRequirements = pgTable("customer_requirements", {
  id: pk(),
  customerId: uuid()
    .notNull()
    .references(() => customers.id),
  kind: text().notNull(), // inspection | material_cert | packaging | documentation | marking | other
  description: text().notNull(),
  mandatory: boolean().notNull().default(true),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
});

export const partyFiles = pgTable("party_files", {
  id: pk(),
  customerId: uuid().references(() => customers.id),
  supplierId: uuid().references(() => suppliers.id),
  fileId: uuid()
    .notNull()
    .references(() => files.id),
  description: text(),
  createdAt: createdAt(),
});
