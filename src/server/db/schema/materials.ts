import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createdAt, money, pk, qty, rate, ts, updatedAt } from "./_helpers";
import { approvals, files, users } from "./core";
import { suppliers } from "./parties";
import { batches, jobLines, jobs, operations } from "./production";

export const materialSpecs = pgTable(
  "material_specs",
  {
    id: pk(),
    code: text().notNull(),
    grade: text().notNull(), // e.g. 6082-T6, EN24T, 316L, S275JR
    standard: text(), // e.g. BS EN 573-3
    materialFamily: text(), // aluminium | carbon_steel | alloy_steel | stainless | brass | plastic | titanium | other
    form: text().notNull(), // bar | plate | sheet | tube | billet | casting | forging | extrusion | other
    description: text(),
    /** Certificate requirement per EN 10204: none | 2.1 | 2.2 | 3.1 | 3.2 */
    certRequirement: text().notNull().default("3.1"),
    uom: text().notNull().default("mm"),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("matspec_code_uq").on(t.code)],
);

// ───────────────────────────── BoxHero cache & links ─────────────────────────────

/** Local cache of BoxHero items (BoxHero remains system of record for quantities). */
export const boxheroItems = pgTable(
  "boxhero_items",
  {
    id: pk(),
    boxheroItemId: text().notNull(),
    name: text().notNull(),
    sku: text(),
    barcode: text(),
    cost: text(),
    quantityTotal: qty(),
    /** [{ location_id, quantity }] as last returned by BoxHero (cache only). */
    quantities: jsonb().notNull().default([]),
    attrs: jsonb().notNull().default([]),
    deleted: boolean().notNull().default(false),
    lastSyncedAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex("bh_item_uq").on(t.boxheroItemId), index("bh_item_sku_idx").on(t.sku)],
);

export const boxheroLocations = pgTable(
  "boxhero_locations",
  {
    id: pk(),
    boxheroLocationId: text().notNull(),
    name: text().notNull(),
    lastSyncedAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex("bh_loc_uq").on(t.boxheroLocationId)],
);

/** Links BoxHero stock items to manufacturing material specifications. */
export const materialSpecItems = pgTable(
  "material_spec_items",
  {
    materialSpecId: uuid()
      .notNull()
      .references(() => materialSpecs.id),
    boxheroItemId: uuid()
      .notNull()
      .references(() => boxheroItems.id),
    dimensions: text(),
    notes: text(),
    linkedBy: uuid().references(() => users.id),
    linkedAt: ts().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.materialSpecId, t.boxheroItemId] })],
);

/**
 * Outbox of stock-changing requests to BoxHero. Never sent twice:
 * idempotencyKey is unique and embedded in the BoxHero memo; uncertain outcomes are
 * reconciled (search memo) before any retry.
 */
export const stockSyncTransactions = pgTable(
  "stock_sync_transactions",
  {
    id: pk(),
    idempotencyKey: text().notNull(),
    kind: text().notNull(), // in | out | adjust | move
    boxheroItemId: text().notNull(),
    locationId: text(),
    fromLocationId: text(),
    quantity: qty().notNull(),
    memo: text().notNull(),
    /** pending | sending | confirmed | failed | needs_reconciliation | cancelled | manual_confirmed */
    status: text().notNull().default("pending"),
    attempts: integer().notNull().default(0),
    lastError: text(),
    boxheroTxId: text(),
    mode: text().notNull(), // simulated | api | manual
    sourceType: text().notNull(), // material_lot | material_transaction | tool
    sourceId: uuid().notNull(),
    jobId: uuid(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    sentAt: ts(),
    confirmedAt: ts(),
    nextAttemptAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex("stocksync_idem_uq").on(t.idempotencyKey), index("stocksync_status_idx").on(t.status)],
);

/** Simulated BoxHero store (demo / test only; used when boxheroMode = simulated). */
export const simulatedBoxheroTransactions = pgTable("simulated_boxhero_transactions", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  type: text().notNull(),
  itemId: text().notNull(),
  locationId: text(),
  quantity: qty().notNull(),
  memo: text(),
  createdAt: createdAt(),
});

// ───────────────────────────── Purchasing ─────────────────────────────

export const purchaseRequisitions = pgTable(
  "purchase_requisitions",
  {
    id: pk(),
    ref: text().notNull(),
    jobId: uuid().references(() => jobs.id),
    jobLineId: uuid().references(() => jobLines.id),
    materialSpecId: uuid().references(() => materialSpecs.id),
    description: text().notNull(),
    dimensions: text(),
    quantity: qty().notNull(),
    uom: text().notNull().default("pcs"),
    requiredDate: date(),
    status: text().notNull().default("open"), // open | ordered | cancelled
    purchaseOrderLineId: uuid().references((): AnyPgColumn => purchaseOrderLines.id),
    requestedBy: uuid().references(() => users.id),
    notes: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("pr_ref_uq").on(t.ref)],
);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: pk(),
    ref: text().notNull(),
    supplierId: uuid()
      .notNull()
      .references(() => suppliers.id),
    kind: text().notNull().default("material"), // material | subcontract | tooling | service
    /** draft | approved | sent | partially_received | received | closed | cancelled */
    status: text().notNull().default("draft"),
    orderDate: date(),
    requiredDate: date(),
    supplierReference: text(),
    currency: text().notNull().default("GBP"),
    total: money().notNull().default("0"),
    deliveryInstructions: text(),
    notes: text(),
    createdBy: uuid().references(() => users.id),
    approvedBy: uuid().references(() => users.id),
    approvedAt: ts(),
    sentAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("po_ref_uq").on(t.ref), index("po_supplier_idx").on(t.supplierId)],
);

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: pk(),
    purchaseOrderId: uuid()
      .notNull()
      .references(() => purchaseOrders.id),
    lineNo: integer().notNull(),
    jobId: uuid().references(() => jobs.id),
    materialSpecId: uuid().references(() => materialSpecs.id),
    boxheroItemId: uuid().references(() => boxheroItems.id),
    description: text().notNull(),
    form: text(),
    dimensions: text(),
    quantity: qty().notNull(),
    uom: text().notNull().default("pcs"),
    unitPrice: rate().notNull().default("0"),
    requiredDate: date(),
    certRequirement: text(),
    qtyReceived: qty().notNull().default("0"),
    status: text().notNull().default("open"), // open | partially_received | received | cancelled
  },
  (t) => [uniqueIndex("pol_uq").on(t.purchaseOrderId, t.lineNo)],
);

// ───────────────────────────── Receipts, lots, certificates ─────────────────────────────

export const materialReceipts = pgTable(
  "material_receipts",
  {
    id: pk(),
    ref: text().notNull(),
    purchaseOrderId: uuid()
      .notNull()
      .references(() => purchaseOrders.id),
    supplierId: uuid()
      .notNull()
      .references(() => suppliers.id),
    deliveryNoteNo: text(),
    deliveryNoteFileId: uuid().references(() => files.id),
    receivedAt: ts().notNull().defaultNow(),
    receivedBy: uuid()
      .notNull()
      .references(() => users.id),
    notes: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("grn_ref_uq").on(t.ref)],
);

/**
 * A material lot = one received line with one heat/cast number.
 * Lifecycle (each a separate, recorded step):
 *   received → (recorded in BoxHero) → awaiting_inspection | quarantined → released | rejected → (returned)
 */
export const materialLots = pgTable(
  "material_lots",
  {
    id: pk(),
    lotNo: text().notNull(),
    receiptId: uuid()
      .notNull()
      .references(() => materialReceipts.id),
    purchaseOrderLineId: uuid()
      .notNull()
      .references(() => purchaseOrderLines.id),
    materialSpecId: uuid().references(() => materialSpecs.id),
    supplierId: uuid()
      .notNull()
      .references(() => suppliers.id),
    heatNumber: text().notNull(),
    supplierBatchNo: text(),
    form: text(),
    dimensions: text(),
    qtyReceived: qty().notNull(),
    uom: text().notNull().default("pcs"),
    /** received | awaiting_inspection | quarantined | released | rejected | returned | consumed */
    status: text().notNull().default("awaiting_inspection"),
    certificateStatus: text().notNull().default("pending"), // pending | received | verified | rejected | not_required
    inspectionResult: text(), // pass | fail
    inspectedBy: uuid().references(() => users.id),
    inspectedAt: ts(),
    releasedBy: uuid().references(() => users.id),
    releasedAt: ts(),
    releaseApprovalId: uuid().references(() => approvals.id),
    quarantineReason: text(),
    boxheroItemId: uuid().references(() => boxheroItems.id),
    boxheroLocationId: text(),
    /** BoxHero stock-in outbox entry for this receipt. */
    stockInSyncId: uuid().references(() => stockSyncTransactions.id),
    storageLocation: text(),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("lot_no_uq").on(t.lotNo), index("lot_heat_idx").on(t.heatNumber), index("lot_status_idx").on(t.status)],
);

export const materialCertificates = pgTable(
  "material_certificates",
  {
    id: pk(),
    certNumber: text(),
    certType: text().notNull(), // 2.1 | 2.2 | 3.1 | 3.2 | coc | other
    heatNumber: text(),
    issuedBy: text(),
    fileId: uuid()
      .notNull()
      .references(() => files.id),
    verificationResult: text(), // accepted | rejected
    verifiedBy: uuid().references(() => users.id),
    verifiedAt: ts(),
    verificationNotes: text(),
    uploadedBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("cert_heat_idx").on(t.heatNumber)],
);

export const materialLotCertificates = pgTable(
  "material_lot_certificates",
  {
    lotId: uuid()
      .notNull()
      .references(() => materialLots.id),
    certificateId: uuid()
      .notNull()
      .references(() => materialCertificates.id),
  },
  (t) => [primaryKey({ columns: [t.lotId, t.certificateId] })],
);

// ───────────────────────────── Allocation, issue, consumption ─────────────────────────────

export const materialAllocations = pgTable(
  "material_allocations",
  {
    id: pk(),
    lotId: uuid()
      .notNull()
      .references(() => materialLots.id),
    jobId: uuid()
      .notNull()
      .references(() => jobs.id),
    jobLineId: uuid().references(() => jobLines.id),
    quantity: qty().notNull(),
    status: text().notNull().default("active"), // active | cancelled | fully_issued
    allocatedBy: uuid().references(() => users.id),
    allocatedAt: ts().notNull().defaultNow(),
    cancelledAt: ts(),
    cancelReason: text(),
  },
  (t) => [index("alloc_lot_idx").on(t.lotId), index("alloc_job_idx").on(t.jobId)],
);

/**
 * Distinct material events against a job: issue | consume | remnant | return | scrap | adjust.
 * issue/return/adjust create a BoxHero outbox entry; consume/remnant/scrap are traceability records.
 */
export const materialTransactions = pgTable(
  "material_transactions",
  {
    id: pk(),
    ref: text().notNull(),
    kind: text().notNull(),
    lotId: uuid()
      .notNull()
      .references(() => materialLots.id),
    jobId: uuid().references(() => jobs.id),
    jobLineId: uuid().references(() => jobLines.id),
    operationId: uuid().references(() => operations.id),
    batchId: uuid().references(() => batches.id),
    allocationId: uuid().references(() => materialAllocations.id),
    quantity: qty().notNull(),
    uom: text().notNull().default("pcs"),
    reason: text(),
    /** Client-supplied key — duplicate submissions return the original record. */
    idempotencyKey: text().notNull(),
    stockSyncId: uuid().references(() => stockSyncTransactions.id),
    approvalId: uuid().references(() => approvals.id),
    performedBy: uuid()
      .notNull()
      .references(() => users.id),
    performedAt: ts().notNull().defaultNow(),
    /** Reversal: points to the transaction this one reverses. */
    reversesId: uuid().references((): AnyPgColumn => materialTransactions.id),
  },
  (t) => [
    uniqueIndex("mattx_ref_uq").on(t.ref),
    uniqueIndex("mattx_idem_uq").on(t.idempotencyKey),
    index("mattx_lot_idx").on(t.lotId),
    index("mattx_job_idx").on(t.jobId),
  ],
);

/** Which material lots went into which production batch (forward/backward trace). */
export const batchMaterials = pgTable(
  "batch_materials",
  {
    batchId: uuid()
      .notNull()
      .references(() => batches.id),
    lotId: uuid()
      .notNull()
      .references(() => materialLots.id),
    quantity: qty(),
  },
  (t) => [primaryKey({ columns: [t.batchId, t.lotId] })],
);
