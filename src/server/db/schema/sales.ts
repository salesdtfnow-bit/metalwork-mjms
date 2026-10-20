import { boolean, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createdAt, money, pk, qty, rate, ts, updatedAt } from "./_helpers";
import { files, users } from "./core";
import { documentRevisions, parts } from "./documents";
import { addresses, contacts, customers } from "./parties";
import { operationTypes } from "./production";

// ───────────────────────────── Inbound email ─────────────────────────────

export const inboundEmails = pgTable(
  "inbound_emails",
  {
    id: pk(),
    provider: text().notNull(), // resend | eml_upload | graph
    providerMessageId: text().notNull(),
    messageIdHeader: text(),
    fromAddress: text().notNull(),
    fromName: text(),
    toAddresses: text().array().notNull().default([]),
    ccAddresses: text().array().notNull().default([]),
    subject: text().notNull().default(""),
    receivedAt: ts().notNull(),
    textBody: text(),
    htmlBody: text(),
    /** Original .eml preserved as a file when available. */
    rawFileId: uuid().references(() => files.id),
    status: text().notNull().default("unassigned"), // unassigned | linked | ignored
    enquiryId: uuid().references((): AnyPgColumn => enquiries.id),
    linkedBy: uuid().references(() => users.id),
    linkedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("inbound_provider_msg_uq").on(t.provider, t.providerMessageId)],
);

export const inboundEmailAttachments = pgTable("inbound_email_attachments", {
  id: pk(),
  inboundEmailId: uuid()
    .notNull()
    .references(() => inboundEmails.id),
  fileId: uuid()
    .notNull()
    .references(() => files.id),
  filename: text().notNull(),
  contentType: text(),
});

// ───────────────────────────── Enquiries ─────────────────────────────

export const enquiries = pgTable(
  "enquiries",
  {
    id: pk(),
    ref: text().notNull(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    contactId: uuid().references(() => contacts.id),
    subject: text().notNull(),
    description: text(),
    receivedAt: ts().notNull(),
    receivedVia: text().notNull().default("email"), // email | phone | portal | in_person | other
    customerReference: text(),
    requestedDeliveryDate: date(),
    ownerId: uuid().references(() => users.id),
    /** new | under_review | quoting | quoted | won | lost | no_quote | cancelled */
    status: text().notNull().default("new"),
    closedReason: text(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("enq_ref_uq").on(t.ref), index("enq_cust_idx").on(t.customerId), index("enq_status_idx").on(t.status)],
);

export const enquiryLines = pgTable("enquiry_lines", {
  id: pk(),
  enquiryId: uuid()
    .notNull()
    .references(() => enquiries.id),
  lineNo: integer().notNull(),
  partId: uuid().references(() => parts.id),
  partNumber: text().notNull(),
  description: text().notNull(),
  quantity: qty().notNull(),
  drawingNumber: text(),
  drawingRevision: text(),
  materialGrade: text(),
  tolerances: text(),
  surfaceFinish: text(),
  specialRequirements: text(),
  createdAt: createdAt(),
});

export const enquiryAttachments = pgTable(
  "enquiry_attachments",
  {
    id: pk(),
    enquiryId: uuid()
      .notNull()
      .references(() => enquiries.id),
    fileId: uuid()
      .notNull()
      .references(() => files.id),
    kind: text().notNull().default("other"), // email | drawing | cad | step | dxf | spreadsheet | photo | specification | other
    inboundEmailId: uuid().references(() => inboundEmails.id),
    /** Set when the attachment has been registered as a controlled document revision. */
    documentRevisionId: uuid().references(() => documentRevisions.id),
    note: text(),
    addedBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("enq_att_enq_idx").on(t.enquiryId)],
);

// ───────────────────────────── Quotations ─────────────────────────────

export const quotations = pgTable(
  "quotations",
  {
    id: pk(),
    ref: text().notNull(),
    enquiryId: uuid().references(() => enquiries.id),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    contactId: uuid().references(() => contacts.id),
    title: text().notNull(),
    ownerId: uuid().references(() => users.id),
    /** Mirrors the latest revision status for list views. */
    status: text().notNull().default("draft"),
    latestRevisionNo: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("quo_ref_uq").on(t.ref), index("quo_cust_idx").on(t.customerId)],
);

export const quotationRevisions = pgTable(
  "quotation_revisions",
  {
    id: pk(),
    quotationId: uuid()
      .notNull()
      .references(() => quotations.id),
    revisionNo: integer().notNull(),
    /** draft | internal_review | sent | awaiting_response | accepted | rejected | expired | superseded */
    status: text().notNull().default("draft"),
    currency: text().notNull().default("GBP"),
    taxTreatment: text().notNull().default("standard"), // standard | zero | exempt | reverse_charge
    taxRate: rate().notNull().default("20"),
    defaultMarginPct: rate().notNull().default("25"),
    validityDays: integer().notNull().default(30),
    validUntil: date(),
    leadTime: text(),
    commercialTerms: text(),
    deliveryTerms: text(),
    notes: text(),
    internalNotes: text(),
    subtotal: money().notNull().default("0"),
    taxAmount: money().notNull().default("0"),
    total: money().notNull().default("0"),
    totalCost: money().notNull().default("0"),
    preparedBy: uuid().references(() => users.id),
    submittedForReviewAt: ts(),
    reviewedBy: uuid().references(() => users.id),
    reviewedAt: ts(),
    reviewApprovalId: uuid(),
    sentAt: ts(),
    sentBy: uuid().references(() => users.id),
    sentTo: text(),
    pdfFileId: uuid().references(() => files.id),
    customerFeedback: text(),
    respondedAt: ts(),
    /** Acceptance must be recorded with evidence, then verified by a second step. */
    acceptanceEvidenceFileId: uuid().references(() => files.id),
    acceptanceRecordedBy: uuid().references(() => users.id),
    acceptanceRecordedAt: ts(),
    acceptanceVerifiedBy: uuid().references(() => users.id),
    acceptanceVerifiedAt: ts(),
    acceptanceReference: text(),
    /** How the acceptance arrived: staff (recorded from evidence) | customer_link (customer accepted online). */
    acceptanceChannel: text(),
    /** Customer-declared signatory for an online acceptance (click-to-accept, not a qualified e-signature). */
    acceptedByName: text(),
    acceptedByPosition: text(),
    acceptedByEmail: text(),
    acceptanceIp: text(),
    acceptanceUserAgent: text(),
    /** SHA-256 of the issued PDF the customer was shown when accepting. */
    acceptedPdfSha256: text(),
    /** Acceptance confirmation (customer acceptance + our countersignature), produced on verification. */
    acceptanceConfirmationFileId: uuid().references(() => files.id),
    /** Once sent, a revision is locked — changes require a new revision. */
    isLocked: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("quorev_uq").on(t.quotationId, t.revisionNo)],
);

/**
 * Secure link that lets a customer review and accept, reject or query one issued revision without an
 * account. Only the SHA-256 of the token is stored; issuing a new link revokes earlier ones for the quotation.
 */
export const quoteAcceptanceLinks = pgTable(
  "quote_acceptance_links",
  {
    id: pk(),
    revisionId: uuid()
      .notNull()
      .references(() => quotationRevisions.id),
    tokenHash: text().notNull(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    /** Responses are refused after this; read-only viewing continues until viewUntil. */
    expiresAt: ts().notNull(),
    viewUntil: ts().notNull(),
    revokedAt: ts(),
    respondedAt: ts(),
    lastViewedAt: ts(),
    viewCount: integer().notNull().default(0),
  },
  (t) => [uniqueIndex("qal_token_uq").on(t.tokenHash), index("qal_rev_idx").on(t.revisionId)],
);

export const quotationLines = pgTable("quotation_lines", {
  id: pk(),
  revisionId: uuid()
    .notNull()
    .references(() => quotationRevisions.id),
  lineNo: integer().notNull(),
  partId: uuid().references(() => parts.id),
  partNumber: text().notNull(),
  description: text().notNull(),
  drawingNumber: text(),
  drawingRevision: text(),
  drawingRevisionId: uuid().references(() => documentRevisions.id),
  materialSpec: text(),
  quantity: qty().notNull(),
  batchSize: qty(),
  // Cost inputs
  materialCostPerUnit: rate().notNull().default("0"),
  materialWastagePct: rate().notNull().default("0"),
  programmingCost: money().notNull().default("0"),
  setupCostPerBatch: money().notNull().default("0"),
  labourCost: money().notNull().default("0"),
  toolingCost: money().notNull().default("0"),
  consumablesCost: money().notNull().default("0"),
  subcontractCost: money().notNull().default("0"),
  finishingCost: money().notNull().default("0"),
  inspectionCost: money().notNull().default("0"),
  certificationCost: money().notNull().default("0"),
  packagingCost: money().notNull().default("0"),
  deliveryCost: money().notNull().default("0"),
  otherCost: money().notNull().default("0"),
  marginPct: rate(),
  priceOverridePerUnit: rate(),
  priceOverrideReason: text(),
  // Computed (stored at save for immutability of issued quotes)
  machiningCost: money().notNull().default("0"),
  totalCost: money().notNull().default("0"),
  unitCost: rate().notNull().default("0"),
  unitPrice: rate().notNull().default("0"),
  lineTotal: money().notNull().default("0"),
  notes: text(),
});

/** Estimated operations per quote line (setup/cycle time × hourly rate). */
export const quotationLineOperations = pgTable("quotation_line_operations", {
  id: pk(),
  lineId: uuid()
    .notNull()
    .references(() => quotationLines.id, { onDelete: "cascade" }),
  seq: integer().notNull(),
  operationTypeId: uuid().references((): AnyPgColumn => operationTypes.id),
  description: text().notNull(),
  setupMinutes: qty().notNull().default("0"),
  cycleMinutes: qty().notNull().default("0"),
  ratePerHour: rate().notNull().default("0"),
});

// ───────────────────────────── Customer purchase orders ─────────────────────────────

export const customerOrders = pgTable(
  "customer_orders",
  {
    id: pk(),
    ref: text().notNull(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    customerPoNumber: text().notNull(),
    poDate: date(),
    poFileId: uuid().references(() => files.id),
    quotationRevisionId: uuid().references(() => quotationRevisions.id),
    deliveryAddressId: uuid().references(() => addresses.id),
    requiredDate: date(),
    currency: text().notNull().default("GBP"),
    orderValue: money(),
    commercialTerms: text(),
    /** received | verified | converted | cancelled */
    status: text().notNull().default("received"),
    discrepancies: text(),
    receivedBy: uuid().references(() => users.id),
    receivedAt: ts().notNull().defaultNow(),
    verifiedBy: uuid().references(() => users.id),
    verifiedAt: ts(),
    notes: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("co_ref_uq").on(t.ref), uniqueIndex("co_cust_po_uq").on(t.customerId, t.customerPoNumber)],
);

/** Lines of a PO received without a quotation (repeat or call-off orders): what the customer ordered. */
export const customerOrderLines = pgTable(
  "customer_order_lines",
  {
    id: pk(),
    orderId: uuid()
      .notNull()
      .references(() => customerOrders.id),
    lineNo: integer().notNull(),
    partNumber: text().notNull(),
    description: text().notNull(),
    drawingRevision: text(),
    materialSpec: text(),
    quantity: qty().notNull(),
    unitPrice: rate(),
    lineTotal: money(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("col_order_line_uq").on(t.orderId, t.lineNo)],
);

/**
 * A document read by the AI assistant (a customer PO, or drawings for a quote). Keeps what was
 * proposed, by which model, and what it became once a person checked and confirmed it.
 */
export const aiExtractions = pgTable(
  "ai_extractions",
  {
    id: pk(),
    /** purchase_order | drawing_quote */
    kind: text().notNull(),
    sourceFileIds: uuid().array().notNull(),
    model: text().notNull(),
    /** The structured result exactly as returned (after schema validation). */
    result: jsonb().notNull(),
    inputTokens: integer(),
    outputTokens: integer(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    customerOrderId: uuid().references(() => customerOrders.id),
    quotationId: uuid().references(() => quotations.id),
  },
  (t) => [index("aix_created_idx").on(t.createdAt)],
);
