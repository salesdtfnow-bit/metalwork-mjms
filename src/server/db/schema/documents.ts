import { boolean, date, index, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createdAt, pk, ts } from "./_helpers";
import { files, users } from "./core";
import { customers, suppliers } from "./parties";
import { machines } from "./resources";

/**
 * Controlled documents: drawings, specifications, setup sheets, work instructions,
 * procedures, safety docs. The document holds identity; content lives in revisions.
 */
export const controlledDocuments = pgTable(
  "controlled_documents",
  {
    id: pk(),
    docNumber: text().notNull(),
    title: text().notNull(),
    docType: text().notNull(), // drawing | specification | setup_sheet | work_instruction | procedure | form | safety | certificate | other
    customerId: uuid().references(() => customers.id),
    supplierId: uuid().references(() => suppliers.id),
    machineId: uuid().references((): AnyPgColumn => machines.id),
    partId: uuid().references((): AnyPgColumn => parts.id),
    isCustomerSupplied: boolean().notNull().default(false),
    /** Points at the single currently released revision (null if none released). */
    currentRevisionId: uuid().references((): AnyPgColumn => documentRevisions.id),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    isActive: boolean().notNull().default(true),
  },
  (t) => [uniqueIndex("cdoc_number_uq").on(t.docNumber), index("cdoc_part_idx").on(t.partId)],
);

export const documentRevisions = pgTable(
  "document_revisions",
  {
    id: pk(),
    documentId: uuid()
      .notNull()
      .references(() => controlledDocuments.id),
    revision: text().notNull(),
    fileId: uuid()
      .notNull()
      .references(() => files.id),
    /** draft | in_review | approved | released | superseded | rejected | obsolete */
    status: text().notNull().default("draft"),
    changeDescription: text(),
    authorId: uuid().references(() => users.id),
    reviewerId: uuid().references(() => users.id),
    reviewedAt: ts(),
    approverId: uuid().references(() => users.id),
    approvedAt: ts(),
    releasedBy: uuid().references(() => users.id),
    releasedAt: ts(),
    effectiveDate: date(),
    supersedesId: uuid().references((): AnyPgColumn => documentRevisions.id),
    supersededById: uuid().references((): AnyPgColumn => documentRevisions.id),
    supersededAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("docrev_doc_rev_uq").on(t.documentId, t.revision), index("docrev_status_idx").on(t.status)],
);

// ───────────────────────────── Parts ─────────────────────────────

export const parts = pgTable(
  "parts",
  {
    id: pk(),
    partNumber: text().notNull(),
    customerId: uuid().references(() => customers.id),
    description: text().notNull(),
    materialSpecId: uuid(),
    /** Default traceability level for this part: job | batch | piece */
    traceabilityLevel: text().notNull().default("job"),
    drawingDocumentId: uuid().references((): AnyPgColumn => controlledDocuments.id),
    notes: text(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("parts_cust_pn_uq").on(t.customerId, t.partNumber)],
);

export const partRevisions = pgTable(
  "part_revisions",
  {
    id: pk(),
    partId: uuid()
      .notNull()
      .references(() => parts.id),
    revision: text().notNull(),
    drawingRevisionId: uuid().references(() => documentRevisions.id),
    isCurrent: boolean().notNull().default(true),
    notes: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("partrev_uq").on(t.partId, t.revision)],
);
