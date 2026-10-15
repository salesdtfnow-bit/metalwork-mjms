/**
 * Read-only query helpers for the Materials and Purchasing UI pages. No writes happen here;
 * every function checks permissions before reading.
 */
import { and, asc, desc, eq, inArray, isNotNull, notInArray, or } from "drizzle-orm";
import {
  auditEvents,
  boxheroLocations as boxheroLocationsTable,
  customers,
  files,
  jobs,
  materialLotCertificates,
  materialLots,
  materialReceipts,
  materialSpecs,
  materialTransactions,
  purchaseOrders,
  stockSyncTransactions,
  suppliers,
  users,
} from "../../db/schema";
import { requireAnyPermission, requirePermission, type Ctx } from "../../context";
import { lotReleaseChecks } from "../materials";
import { supplierUsable } from "../parties";
import { todayISO } from "@/lib/format";

/** Cached BoxHero locations (for receipt location selects and per-location quantity labels). */
export async function boxheroLocations(ctx: Ctx) {
  requireAnyPermission(ctx, "materials.view", "boxhero.view", "materials.receive");
  return ctx.db.select().from(boxheroLocationsTable).orderBy(asc(boxheroLocationsTable.name));
}

/** Goods receipts against a purchase order, with the lots each created. */
export async function receiptsForPurchaseOrder(ctx: Ctx, purchaseOrderId: string) {
  requireAnyPermission(ctx, "purchasing.view", "materials.view");
  const receipts = await ctx.db
    .select({ r: materialReceipts, receivedBy: users.name, file: { id: files.id, originalName: files.originalName } })
    .from(materialReceipts)
    .leftJoin(users, eq(users.id, materialReceipts.receivedBy))
    .leftJoin(files, eq(files.id, materialReceipts.deliveryNoteFileId))
    .where(eq(materialReceipts.purchaseOrderId, purchaseOrderId))
    .orderBy(desc(materialReceipts.receivedAt));
  const ids = receipts.map((r) => r.r.id);
  const lots = ids.length
    ? await ctx.db
        .select({ lot: materialLots, sync: stockSyncTransactions })
        .from(materialLots)
        .leftJoin(stockSyncTransactions, eq(stockSyncTransactions.id, materialLots.stockInSyncId))
        .where(inArray(materialLots.receiptId, ids))
        .orderBy(asc(materialLots.lotNo))
    : [];
  return receipts.map((r) => ({ ...r, deliveryNote: r.file?.id ? r.file : null, lots: lots.filter((l) => l.lot.receiptId === r.r.id) }));
}

/** Audit history for a lot, including its certificates and BoxHero movements. */
export async function lotHistory(ctx: Ctx, lotId: string) {
  requirePermission(ctx, "materials.view");
  const [lot] = await ctx.db.select({ stockInSyncId: materialLots.stockInSyncId }).from(materialLots).where(eq(materialLots.id, lotId)).limit(1);
  const certs = await ctx.db.select({ id: materialLotCertificates.certificateId }).from(materialLotCertificates).where(eq(materialLotCertificates.lotId, lotId));
  const txSyncs = await ctx.db
    .select({ id: materialTransactions.stockSyncId })
    .from(materialTransactions)
    .where(and(eq(materialTransactions.lotId, lotId), isNotNull(materialTransactions.stockSyncId)));
  const syncIds = [lot?.stockInSyncId, ...txSyncs.map((t) => t.id)].filter((x): x is string => !!x);
  const certIds = certs.map((c) => c.id);
  return ctx.db
    .select()
    .from(auditEvents)
    .where(
      or(
        and(eq(auditEvents.entityType, "material_lot"), eq(auditEvents.entityId, lotId)),
        certIds.length ? and(eq(auditEvents.entityType, "material_certificate"), inArray(auditEvents.entityId, certIds)) : undefined,
        syncIds.length ? and(eq(auditEvents.entityType, "stock_sync"), inArray(auditEvents.entityId, syncIds)) : undefined,
      ),
    )
    .orderBy(desc(auditEvents.occurredAt))
    .limit(300);
}

/** id → display name for the given user ids. */
export async function userNames(ctx: Ctx, ids: (string | null | undefined)[]) {
  requireAnyPermission(ctx, "materials.view", "purchasing.view");
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map<string, string>();
  const rows = await ctx.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Open jobs for select inputs (allocation, requisitions, PO lines). */
export async function jobOptions(ctx: Ctx, opts: { authorisedOnly?: boolean } = {}) {
  requireAnyPermission(ctx, "materials.allocate", "purchasing.manage", "jobs.view", "production.view_all");
  return ctx.db
    .select({ id: jobs.id, jobNumber: jobs.jobNumber, title: jobs.title, status: jobs.status, authorisedAt: jobs.authorisedAt, customer: customers.name })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .where(and(notInArray(jobs.status, ["completed", "cancelled"]), opts.authorisedOnly ? isNotNull(jobs.authorisedAt) : undefined))
    .orderBy(desc(jobs.createdAt))
    .limit(500);
}

/** Active suppliers with their approval state, for purchase order supplier selects. */
export async function supplierOptions(ctx: Ctx) {
  requireAnyPermission(ctx, "purchasing.manage", "purchasing.view");
  const rows = await ctx.db
    .select({
      id: suppliers.id,
      code: suppliers.code,
      name: suppliers.name,
      currency: suppliers.currency,
      categories: suppliers.categories,
      approvalStatus: suppliers.approvalStatus,
      approvalExpiresOn: suppliers.approvalExpiresOn,
      isActive: suppliers.isActive,
    })
    .from(suppliers)
    .where(eq(suppliers.isActive, true))
    .orderBy(asc(suppliers.name));
  const today = todayISO();
  return rows.map((s) => ({ ...s, usable: supplierUsable(s, today) }));
}

/** Lots awaiting inspection or quarantined, each with its release-check summary. */
export async function lotsAwaitingRelease(ctx: Ctx) {
  requirePermission(ctx, "materials.view");
  const rows = await ctx.db
    .select({ lot: materialLots, supplier: suppliers.name, spec: materialSpecs.code, grade: materialSpecs.grade, poRef: purchaseOrders.ref, poId: purchaseOrders.id })
    .from(materialLots)
    .innerJoin(suppliers, eq(suppliers.id, materialLots.supplierId))
    .innerJoin(materialReceipts, eq(materialReceipts.id, materialLots.receiptId))
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, materialReceipts.purchaseOrderId))
    .leftJoin(materialSpecs, eq(materialSpecs.id, materialLots.materialSpecId))
    .where(inArray(materialLots.status, ["received", "awaiting_inspection", "quarantined"]))
    .orderBy(asc(materialLots.createdAt))
    .limit(200);
  const out = [];
  for (const r of rows) {
    const { checks, ready } = await lotReleaseChecks(ctx, r.lot.id);
    out.push({ ...r, checks, ready });
  }
  return out;
}
