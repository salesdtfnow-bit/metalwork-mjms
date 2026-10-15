import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  addresses,
  auditEvents,
  contacts,
  controlledDocuments,
  customers,
  documentRevisions,
  quotationRevisions,
  quotations,
  users,
} from "../../db/schema";
import { requireAnyPermission, requirePermission, type Ctx } from "../../context";
import type { Permission } from "../../auth/permissions";

/**
 * Read-only helpers for the enquiry, quotation, customer-order and supplier pages.
 * Each function checks a permission before reading. Nothing here writes to the database.
 */

const HISTORY_PERMS: Record<string, Permission[]> = {
  enquiry: ["enquiries.view"],
  quotation: ["quotations.view"],
  customer_order: ["orders.view"],
  supplier: ["suppliers.view"],
  inbound_email: ["email.import"],
};

/** Audit events recorded against one record (newest first). */
export async function entityHistory(ctx: Ctx, entityType: keyof typeof HISTORY_PERMS, entityId: string, limit = 200) {
  const perms = HISTORY_PERMS[entityType];
  if (!perms) throw new Error(`No history permission configured for ${entityType}`);
  requireAnyPermission(ctx, ...perms);
  return ctx.db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.entityType, entityType), eq(auditEvents.entityId, entityId)))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(limit);
}

/** Quotations raised from an enquiry, with their latest revision. */
export async function quotationsForEnquiry(ctx: Ctx, enquiryId: string) {
  requirePermission(ctx, "quotations.view");
  const rows = await ctx.db
    .select({ quote: quotations, owner: users.name })
    .from(quotations)
    .leftJoin(users, eq(users.id, quotations.ownerId))
    .where(eq(quotations.enquiryId, enquiryId))
    .orderBy(desc(quotations.createdAt));
  const revs = rows.length ? await ctx.db.select().from(quotationRevisions).where(inArray(quotationRevisions.quotationId, rows.map((r) => r.quote.id))) : [];
  return rows.map((r) => ({ ...r, latest: revs.filter((x) => x.quotationId === r.quote.id).sort((a, b) => b.revisionNo - a.revisionNo)[0] ?? null }));
}

/** Active users, for owner pickers on enquiries and jobs. */
export async function listActiveUsers(ctx: Ctx) {
  requireAnyPermission(ctx, "enquiries.manage", "quotations.manage", "jobs.create", "orders.manage");
  return ctx.db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.isActive, true)).orderBy(asc(users.name));
}

/** Display names for a set of user ids (including inactive users). */
export async function userNames(ctx: Ctx, ids: (string | null | undefined)[]) {
  requireAnyPermission(ctx, "suppliers.view", "orders.view", "enquiries.view", "quotations.view");
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return {} as Record<string, string>;
  const rows = await ctx.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, list));
  return Object.fromEntries(rows.map((r) => [r.id, r.name])) as Record<string, string>;
}

/** Active customers for pickers (enquiries, quotations, orders, inbox). */
export async function customerOptions(ctx: Ctx) {
  requireAnyPermission(ctx, "customers.view", "enquiries.manage", "quotations.manage", "orders.manage", "email.import");
  return ctx.db
    .select({ id: customers.id, code: customers.code, name: customers.name, email: customers.email, currency: customers.currency })
    .from(customers)
    .where(eq(customers.isActive, true))
    .orderBy(asc(customers.name));
}

/** Contacts of active customers, for contact pickers that filter by the chosen customer. */
export async function customerContactOptions(ctx: Ctx, customerId?: string) {
  requireAnyPermission(ctx, "customers.view", "enquiries.manage", "quotations.manage", "orders.manage");
  return ctx.db
    .select({ id: contacts.id, customerId: contacts.customerId, name: contacts.name, email: contacts.email, jobTitle: contacts.jobTitle, isPrimary: contacts.isPrimary })
    .from(contacts)
    .innerJoin(customers, eq(customers.id, contacts.customerId))
    .where(and(eq(customers.isActive, true), customerId ? eq(contacts.customerId, customerId) : undefined))
    .orderBy(desc(contacts.isPrimary), asc(contacts.name));
}

/** Delivery/site addresses of one customer, for the PO registration form. */
export async function customerAddressOptions(ctx: Ctx, customerId: string) {
  requireAnyPermission(ctx, "customers.view", "orders.manage");
  return ctx.db.select().from(addresses).where(eq(addresses.customerId, customerId)).orderBy(desc(addresses.isDefault), asc(addresses.kind));
}

/** Controlled documents created from enquiry attachments (revision id → document). */
export async function documentsForRevisions(ctx: Ctx, revisionIds: (string | null | undefined)[]) {
  requirePermission(ctx, "enquiries.view");
  const ids = [...new Set(revisionIds.filter((x): x is string => !!x))];
  if (!ids.length) return {} as Record<string, { documentId: string; docNumber: string; revision: string; status: string }>;
  const rows = await ctx.db
    .select({ revId: documentRevisions.id, documentId: controlledDocuments.id, docNumber: controlledDocuments.docNumber, revision: documentRevisions.revision, status: documentRevisions.status })
    .from(documentRevisions)
    .innerJoin(controlledDocuments, eq(controlledDocuments.id, documentRevisions.documentId))
    .where(inArray(documentRevisions.id, ids));
  return Object.fromEntries(rows.map((r) => [r.revId, r])) as Record<string, { documentId: string; docNumber: string; revision: string; status: string }>;
}
