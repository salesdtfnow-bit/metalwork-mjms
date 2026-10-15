import { date, index, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, money, pk, qty, ts } from "./_helpers";
import { files, users } from "./core";
import { addresses, customers, suppliers } from "./parties";
import { customerOrders } from "./sales";
import { batches, jobLines, jobs, operations, serials } from "./production";
import { purchaseOrders } from "./materials";
import { inspections } from "./quality";

// ───────────────────────────── Subcontracting ─────────────────────────────

export const subcontractOrders = pgTable(
  "subcontract_orders",
  {
    id: pk(),
    ref: text().notNull(),
    purchaseOrderId: uuid().references(() => purchaseOrders.id),
    supplierId: uuid()
      .notNull()
      .references(() => suppliers.id),
    jobId: uuid()
      .notNull()
      .references(() => jobs.id),
    jobLineId: uuid()
      .notNull()
      .references(() => jobLines.id),
    operationId: uuid()
      .notNull()
      .references(() => operations.id),
    batchId: uuid().references(() => batches.id),
    process: text().notNull(), // heat_treatment | plating | anodising | grinding | machining | painting | other
    specification: text().notNull(),
    /** draft | sent | at_supplier | returned | accepted | rejected | closed | cancelled */
    status: text().notNull().default("draft"),
    qtySent: qty(),
    dispatchedAt: ts(),
    dispatchedBy: uuid().references(() => users.id),
    dispatchNoteRef: text(),
    requiredReturnDate: date(),
    qtyReturned: qty(),
    returnedAt: ts(),
    receivedBy: uuid().references(() => users.id),
    supplierDeliveryNote: text(),
    qtyAccepted: qty(),
    qtyRejected: qty(),
    incomingInspectionId: uuid().references(() => inspections.id),
    estimatedCost: money(),
    actualCost: money(),
    acceptedBy: uuid().references(() => users.id),
    acceptedAt: ts(),
    notes: text(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sco_ref_uq").on(t.ref), index("sco_job_idx").on(t.jobId)],
);

export const subcontractFiles = pgTable("subcontract_files", {
  id: pk(),
  subcontractOrderId: uuid()
    .notNull()
    .references(() => subcontractOrders.id),
  fileId: uuid()
    .notNull()
    .references(() => files.id),
  kind: text().notNull().default("certificate"), // certificate | delivery_note | report | other
  createdAt: createdAt(),
});

// ───────────────────────────── Dispatch ─────────────────────────────

export const dispatches = pgTable(
  "dispatches",
  {
    id: pk(),
    ref: text().notNull(), // delivery note number
    jobId: uuid()
      .notNull()
      .references(() => jobs.id),
    customerOrderId: uuid().references(() => customerOrders.id),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    deliveryAddressId: uuid().references(() => addresses.id),
    /** Address snapshot at dispatch (documents must not change if the address is edited later). */
    deliveryAddressText: text().notNull(),
    customerPoNumber: text(),
    /** draft | dispatched | delivered | cancelled */
    status: text().notNull().default("draft"),
    deliveryMethod: text(), // carrier | own_vehicle | collection | courier
    carrier: text(),
    trackingRef: text(),
    packagingNotes: text(),
    packageCount: text(),
    grossWeightKg: text(),
    certificatesIncluded: text(),
    dispatchedAt: ts(),
    dispatchedBy: uuid().references(() => users.id),
    deliveredAt: ts(),
    proofOfDeliveryFileId: uuid().references(() => files.id),
    deliveryNoteFileId: uuid().references(() => files.id),
    notes: text(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("dsp_ref_uq").on(t.ref), index("dsp_job_idx").on(t.jobId)],
);

export const dispatchLines = pgTable("dispatch_lines", {
  id: pk(),
  dispatchId: uuid()
    .notNull()
    .references(() => dispatches.id),
  jobLineId: uuid()
    .notNull()
    .references(() => jobLines.id),
  batchId: uuid().references(() => batches.id),
  quantity: qty().notNull(),
  description: text().notNull(),
});

export const dispatchSerials = pgTable(
  "dispatch_serials",
  {
    dispatchLineId: uuid()
      .notNull()
      .references(() => dispatchLines.id),
    serialId: uuid()
      .notNull()
      .references(() => serials.id),
  },
  (t) => [primaryKey({ columns: [t.dispatchLineId, t.serialId] })],
);
