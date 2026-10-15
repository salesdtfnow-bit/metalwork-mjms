import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { addresses, contacts, customerRequirements, customers, partyFiles, suppliers } from "../db/schema";
import { audit } from "../audit";
import { can, mutate, requirePermission, type Ctx } from "../context";
import { conflict, invalid, notFound } from "../errors";
import { storeUpload } from "../storage";

// ───────────── Customers ─────────────

export const customerInput = z.object({
  code: z.string().trim().min(2, "Code is required.").max(20).transform((s) => s.toUpperCase()),
  name: z.string().trim().min(2, "Name is required."),
  email: z.string().trim().email().nullish().or(z.literal("").transform(() => null)),
  phone: z.string().trim().nullish(),
  website: z.string().trim().nullish(),
  vatNumber: z.string().trim().nullish(),
  accountRef: z.string().trim().nullish(),
  paymentTerms: z.string().trim().nullish(),
  currency: z.string().trim().length(3).default("GBP"),
  deliveryPreferences: z.string().nullish(),
  qualityRequirements: z.string().nullish(),
  requiredCertificates: z.string().nullish(),
  packagingRequirements: z.string().nullish(),
  notes: z.string().nullish(),
  creditLimit: z.string().nullish(),
});
export type CustomerInput = z.input<typeof customerInput>;

const COMMERCIAL_FIELDS = ["paymentTerms", "creditLimit", "accountRef"] as const;

/** Removes commercially sensitive fields unless the actor may see them. */
export function redactCustomer<T extends Record<string, unknown>>(ctx: Ctx, c: T): T {
  if (can(ctx.actor, "customers.view_commercial")) return c;
  const copy = { ...c };
  for (const f of COMMERCIAL_FIELDS) if (f in copy) (copy as Record<string, unknown>)[f] = null;
  return copy;
}

export async function createCustomer(ctx: Ctx, raw: CustomerInput) {
  requirePermission(ctx, "customers.manage");
  const data = customerInput.parse(raw);
  return mutate(ctx, async (tx) => {
    const [dup] = await tx.db.select({ id: customers.id }).from(customers).where(eq(customers.code, data.code)).limit(1);
    if (dup) throw conflict(`Customer code ${data.code} is already used.`, { field: "code" });
    const [c] = await tx.db.insert(customers).values(data).returning();
    await audit(tx, { action: "customer.create", entityType: "customer", entityId: c.id, entityRef: c.code, after: data });
    return c;
  });
}

export async function updateCustomer(ctx: Ctx, id: string, raw: CustomerInput) {
  requirePermission(ctx, "customers.manage");
  const data = customerInput.parse(raw);
  if (!can(ctx.actor, "customers.view_commercial")) for (const f of COMMERCIAL_FIELDS) delete (data as Record<string, unknown>)[f];
  return mutate(ctx, async (tx) => {
    const [before] = await tx.db.select().from(customers).where(eq(customers.id, id)).limit(1);
    if (!before) throw notFound("Customer");
    if (data.code !== before.code) {
      const [dup] = await tx.db.select({ id: customers.id }).from(customers).where(eq(customers.code, data.code)).limit(1);
      if (dup) throw conflict(`Customer code ${data.code} is already used.`, { field: "code" });
    }
    await tx.db.update(customers).set(data).where(eq(customers.id, id));
    await audit(tx, { action: "customer.update", entityType: "customer", entityId: id, entityRef: data.code, before, after: data });
  });
}

export async function setCustomerActive(ctx: Ctx, id: string, active: boolean) {
  requirePermission(ctx, "customers.manage");
  return mutate(ctx, async (tx) => {
    const [c] = await tx.db.update(customers).set({ isActive: active }).where(eq(customers.id, id)).returning();
    if (!c) throw notFound("Customer");
    await audit(tx, { action: active ? "customer.reactivate" : "customer.deactivate", entityType: "customer", entityId: id, entityRef: c.code });
  });
}

export async function listCustomers(ctx: Ctx, opts: { q?: string; includeInactive?: boolean } = {}) {
  requirePermission(ctx, "customers.view");
  const q = opts.q?.trim();
  const rows = await ctx.db
    .select()
    .from(customers)
    .where(
      and(
        opts.includeInactive ? undefined : eq(customers.isActive, true),
        q ? or(ilike(customers.name, `%${q}%`), ilike(customers.code, `%${q}%`), ilike(customers.email, `%${q}%`)) : undefined,
      ),
    )
    .orderBy(asc(customers.name))
    .limit(500);
  return rows.map((r) => redactCustomer(ctx, r));
}

export async function getCustomer(ctx: Ctx, id: string) {
  requirePermission(ctx, "customers.view");
  const [c] = await ctx.db.select().from(customers).where(eq(customers.id, id)).limit(1);
  if (!c) throw notFound("Customer");
  const [cs, as, reqs] = await Promise.all([
    ctx.db.select().from(contacts).where(eq(contacts.customerId, id)).orderBy(desc(contacts.isPrimary), asc(contacts.name)),
    ctx.db.select().from(addresses).where(eq(addresses.customerId, id)).orderBy(desc(addresses.isDefault)),
    ctx.db.select().from(customerRequirements).where(eq(customerRequirements.customerId, id)).orderBy(asc(customerRequirements.kind)),
  ]);
  return { customer: redactCustomer(ctx, c), contacts: cs, addresses: as, requirements: reqs };
}

// ───────────── Contacts & addresses (shared) ─────────────

export const contactInput = z.object({
  name: z.string().trim().min(1, "Name is required."),
  jobTitle: z.string().trim().nullish(),
  email: z.string().trim().email("Enter a valid email.").nullish(),
  phone: z.string().trim().nullish(),
  isPrimary: z.boolean().default(false),
});

export async function addContact(ctx: Ctx, owner: { customerId?: string; supplierId?: string }, raw: z.input<typeof contactInput>) {
  requirePermission(ctx, owner.customerId ? "customers.manage" : "suppliers.manage");
  const data = contactInput.parse(raw);
  return mutate(ctx, async (tx) => {
    if (data.isPrimary) {
      await tx.db
        .update(contacts)
        .set({ isPrimary: false })
        .where(owner.customerId ? eq(contacts.customerId, owner.customerId) : eq(contacts.supplierId, owner.supplierId!));
    }
    const [c] = await tx.db.insert(contacts).values({ ...data, customerId: owner.customerId ?? null, supplierId: owner.supplierId ?? null }).returning();
    await audit(tx, { action: "contact.add", entityType: owner.customerId ? "customer" : "supplier", entityId: owner.customerId ?? owner.supplierId, after: data });
    return c;
  });
}

export const addressInput = z.object({
  kind: z.enum(["billing", "delivery", "site"]).default("delivery"),
  label: z.string().trim().nullish(),
  line1: z.string().trim().min(1, "Address line 1 is required."),
  line2: z.string().trim().nullish(),
  city: z.string().trim().nullish(),
  county: z.string().trim().nullish(),
  postcode: z.string().trim().nullish(),
  country: z.string().trim().default("United Kingdom"),
  deliveryInstructions: z.string().nullish(),
  isDefault: z.boolean().default(false),
});

export async function addAddress(ctx: Ctx, owner: { customerId?: string; supplierId?: string }, raw: z.input<typeof addressInput>) {
  requirePermission(ctx, owner.customerId ? "customers.manage" : "suppliers.manage");
  const data = addressInput.parse(raw);
  return mutate(ctx, async (tx) => {
    if (data.isDefault) {
      await tx.db
        .update(addresses)
        .set({ isDefault: false })
        .where(and(owner.customerId ? eq(addresses.customerId, owner.customerId) : eq(addresses.supplierId, owner.supplierId!), eq(addresses.kind, data.kind)));
    }
    const [a] = await tx.db.insert(addresses).values({ ...data, customerId: owner.customerId ?? null, supplierId: owner.supplierId ?? null }).returning();
    await audit(tx, { action: "address.add", entityType: owner.customerId ? "customer" : "supplier", entityId: owner.customerId ?? owner.supplierId, after: data });
    return a;
  });
}

export function formatAddress(a: Pick<typeof addresses.$inferSelect, "line1" | "line2" | "city" | "county" | "postcode" | "country"> | null | undefined): string {
  if (!a) return "";
  return [a.line1, a.line2, a.city, a.county, a.postcode, a.country].filter(Boolean).join("\n");
}

export async function addCustomerRequirement(ctx: Ctx, customerId: string, raw: { kind: string; description: string; mandatory: boolean }) {
  requirePermission(ctx, "customers.manage");
  const kind = z.enum(["inspection", "material_cert", "packaging", "documentation", "marking", "other"]).parse(raw.kind);
  if (!raw.description?.trim()) throw invalid("Description is required.", { field: "description" });
  return mutate(ctx, async (tx) => {
    const [r] = await tx.db.insert(customerRequirements).values({ customerId, kind, description: raw.description.trim(), mandatory: raw.mandatory }).returning();
    await audit(tx, { action: "customer.requirement_add", entityType: "customer", entityId: customerId, after: r });
    return r;
  });
}

export async function setCustomerRequirementActive(ctx: Ctx, requirementId: string, active: boolean) {
  requirePermission(ctx, "customers.manage");
  return mutate(ctx, async (tx) => {
    const [r] = await tx.db.update(customerRequirements).set({ isActive: active }).where(eq(customerRequirements.id, requirementId)).returning();
    if (!r) throw notFound("Requirement");
    await audit(tx, { action: active ? "customer.requirement_enable" : "customer.requirement_disable", entityType: "customer", entityId: r.customerId, after: r });
  });
}

// ───────────── Suppliers ─────────────

export const supplierInput = z.object({
  code: z.string().trim().min(2, "Code is required.").max(20).transform((s) => s.toUpperCase()),
  name: z.string().trim().min(2, "Name is required."),
  email: z.string().trim().email().nullish().or(z.literal("").transform(() => null)),
  phone: z.string().trim().nullish(),
  website: z.string().trim().nullish(),
  vatNumber: z.string().trim().nullish(),
  accountRef: z.string().trim().nullish(),
  paymentTerms: z.string().trim().nullish(),
  currency: z.string().trim().length(3).default("GBP"),
  categories: z.array(z.enum(["material", "subcontract", "tooling", "calibration", "maintenance", "carrier", "other"])).default([]),
  certifications: z.string().nullish(),
  notes: z.string().nullish(),
  boxheroPartnerId: z.string().trim().nullish(),
});

export async function createSupplier(ctx: Ctx, raw: z.input<typeof supplierInput>) {
  requirePermission(ctx, "suppliers.manage");
  const data = supplierInput.parse(raw);
  return mutate(ctx, async (tx) => {
    const [dup] = await tx.db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.code, data.code)).limit(1);
    if (dup) throw conflict(`Supplier code ${data.code} is already used.`, { field: "code" });
    const [s] = await tx.db.insert(suppliers).values(data).returning();
    await audit(tx, { action: "supplier.create", entityType: "supplier", entityId: s.id, entityRef: s.code, after: data });
    return s;
  });
}

export async function updateSupplier(ctx: Ctx, id: string, raw: z.input<typeof supplierInput>) {
  requirePermission(ctx, "suppliers.manage");
  const data = supplierInput.parse(raw);
  return mutate(ctx, async (tx) => {
    const [before] = await tx.db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
    if (!before) throw notFound("Supplier");
    await tx.db.update(suppliers).set(data).where(eq(suppliers.id, id));
    await audit(tx, { action: "supplier.update", entityType: "supplier", entityId: id, entityRef: data.code, before, after: data });
  });
}

/** Approved-supplier status is a quality decision (separate permission, reason required). */
export async function setSupplierApproval(
  ctx: Ctx,
  id: string,
  raw: { status: string; scope?: string | null; expiresOn?: string | null; reason: string },
) {
  requirePermission(ctx, "suppliers.approve");
  const status = z.enum(["approved", "conditional", "pending", "not_approved", "suspended"]).parse(raw.status);
  if (!raw.reason?.trim()) throw invalid("A reason is required.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const [before] = await tx.db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
    if (!before) throw notFound("Supplier");
    const after = { approvalStatus: status, approvalScope: raw.scope ?? null, approvalExpiresOn: raw.expiresOn ?? null, approvedBy: ctx.actor.userId, approvedAt: new Date() };
    await tx.db.update(suppliers).set(after).where(eq(suppliers.id, id));
    await audit(tx, {
      action: "supplier.approval_change",
      entityType: "supplier",
      entityId: id,
      entityRef: before.code,
      before: { approvalStatus: before.approvalStatus, approvalScope: before.approvalScope, approvalExpiresOn: before.approvalExpiresOn },
      after,
      reason: raw.reason,
    });
  });
}

export async function listSuppliers(ctx: Ctx, opts: { q?: string; category?: string; includeInactive?: boolean } = {}) {
  requirePermission(ctx, "suppliers.view");
  const q = opts.q?.trim();
  return ctx.db
    .select()
    .from(suppliers)
    .where(
      and(
        opts.includeInactive ? undefined : eq(suppliers.isActive, true),
        q ? or(ilike(suppliers.name, `%${q}%`), ilike(suppliers.code, `%${q}%`)) : undefined,
        opts.category ? sql`${opts.category} = any(${suppliers.categories})` : undefined,
      ),
    )
    .orderBy(asc(suppliers.name))
    .limit(500);
}

export async function getSupplier(ctx: Ctx, id: string) {
  requirePermission(ctx, "suppliers.view");
  const [s] = await ctx.db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
  if (!s) throw notFound("Supplier");
  const [cs, as] = await Promise.all([
    ctx.db.select().from(contacts).where(eq(contacts.supplierId, id)).orderBy(desc(contacts.isPrimary)),
    ctx.db.select().from(addresses).where(eq(addresses.supplierId, id)),
  ]);
  return { supplier: s, contacts: cs, addresses: as };
}

/** True when a supplier may be used for the given category today (approved/conditional and not expired). */
export function supplierUsable(s: Pick<typeof suppliers.$inferSelect, "approvalStatus" | "approvalExpiresOn" | "isActive">, today = new Date().toISOString().slice(0, 10)) {
  if (!s.isActive) return false;
  if (!["approved", "conditional"].includes(s.approvalStatus)) return false;
  return !s.approvalExpiresOn || s.approvalExpiresOn >= today;
}

export async function attachPartyFile(ctx: Ctx, owner: { customerId?: string; supplierId?: string }, file: File, description?: string | null) {
  requirePermission(ctx, owner.customerId ? "customers.manage" : "suppliers.manage");
  return mutate(ctx, async (tx) => {
    const f = await storeUpload(tx.db, file, ctx.actor.userId);
    await tx.db.insert(partyFiles).values({ customerId: owner.customerId ?? null, supplierId: owner.supplierId ?? null, fileId: f.id, description: description ?? null });
    await audit(tx, { action: "party.file_attach", entityType: owner.customerId ? "customer" : "supplier", entityId: owner.customerId ?? owner.supplierId, after: { fileId: f.id, name: f.originalName } });
    return f;
  });
}

// ───────────── History read model ─────────────

export async function customerHistory(ctx: Ctx, customerId: string) {
  requirePermission(ctx, "customers.view");
  const { enquiries, quotations, jobs, auditEvents } = await import("../db/schema");
  const [enqs, quotes, js, events] = await Promise.all([
    can(ctx.actor, "enquiries.view")
      ? ctx.db.select().from(enquiries).where(eq(enquiries.customerId, customerId)).orderBy(desc(enquiries.receivedAt)).limit(100)
      : Promise.resolve([]),
    can(ctx.actor, "quotations.view")
      ? ctx.db.select().from(quotations).where(eq(quotations.customerId, customerId)).orderBy(desc(quotations.createdAt)).limit(100)
      : Promise.resolve([]),
    can(ctx.actor, "jobs.view") ? ctx.db.select().from(jobs).where(eq(jobs.customerId, customerId)).orderBy(desc(jobs.createdAt)).limit(100) : Promise.resolve([]),
    ctx.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityType, "customer"), eq(auditEvents.entityId, customerId)))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(100),
  ]);
  return { enquiries: enqs, quotations: quotes, jobs: js, events };
}

export async function listPartyFiles(ctx: Ctx, owner: { customerId?: string; supplierId?: string }) {
  const { files } = await import("../db/schema");
  return ctx.db
    .select({ pf: partyFiles, file: files })
    .from(partyFiles)
    .innerJoin(files, eq(files.id, partyFiles.fileId))
    .where(owner.customerId ? eq(partyFiles.customerId, owner.customerId) : eq(partyFiles.supplierId, owner.supplierId!))
    .orderBy(desc(partyFiles.createdAt));
}
