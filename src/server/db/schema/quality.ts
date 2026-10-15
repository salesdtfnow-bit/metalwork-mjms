import { boolean, date, index, integer, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createdAt, measure, pk, qty, ts, updatedAt } from "./_helpers";
import { approvals, files, users } from "./core";
import { documentRevisions, parts } from "./documents";
import { customers, suppliers } from "./parties";
import { batches, jobLines, jobs, operations, operationTypes, serials } from "./production";
import { employees, machines } from "./resources";
import { cncProgramRevisions } from "./programs";
import { materialLots, materialSpecs } from "./materials";

// ───────────────────────────── Inspection planning ─────────────────────────────

export const inspectionPlans = pgTable(
  "inspection_plans",
  {
    id: pk(),
    code: text().notNull(),
    name: text().notNull(),
    /** incoming | first_off | in_process | final | subcontract_return | other */
    stage: text().notNull(),
    partId: uuid().references((): AnyPgColumn => parts.id),
    customerId: uuid().references(() => customers.id),
    materialSpecId: uuid().references((): AnyPgColumn => materialSpecs.id),
    operationTypeId: uuid().references((): AnyPgColumn => operationTypes.id),
    jobId: uuid().references((): AnyPgColumn => jobs.id),
    drawingRevisionId: uuid().references(() => documentRevisions.id),
    version: integer().notNull().default(1),
    status: text().notNull().default("draft"), // draft | approved | obsolete
    approvedBy: uuid().references(() => users.id),
    approvedAt: ts(),
    inspectorRole: text(), // role key required to record against this plan, e.g. quality_inspector
    notes: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("iplan_code_ver_uq").on(t.code, t.version)],
);

export const inspectionCharacteristics = pgTable(
  "inspection_characteristics",
  {
    id: pk(),
    planId: uuid()
      .notNull()
      .references(() => inspectionPlans.id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    balloonNo: text(),
    name: text().notNull(),
    /** dimensional | visual | attribute | document | functional | hardness | surface */
    charType: text().notNull().default("dimensional"),
    specification: text(),
    nominal: measure(),
    /** Lower/upper tolerance as deviations from nominal (e.g. -0.02 / +0.02). */
    tolMinus: measure(),
    tolPlus: measure(),
    unit: text(),
    method: text(),
    instrumentType: text(),
    sampleSize: text().notNull().default("1"),
    frequency: text(),
    acceptanceCriteria: text(),
    evidenceRequired: boolean().notNull().default(false),
    isCritical: boolean().notNull().default(false),
  },
  (t) => [index("ichar_plan_idx").on(t.planId)],
);

// ───────────────────────────── Measuring instruments & calibration ─────────────────────────────

export const measuringInstruments = pgTable(
  "measuring_instruments",
  {
    id: pk(),
    assetNo: text().notNull(),
    description: text().notNull(),
    instrumentType: text().notNull(), // micrometer | caliper | height_gauge | bore_gauge | cmm | thread_gauge | surface_tester | hardness_tester | other
    manufacturer: text(),
    serialNumber: text(),
    range: text(),
    resolution: text(),
    location: text(),
    /** in_service | out_of_calibration | quarantined | retired | lost */
    status: text().notNull().default("in_service"),
    calibrationRequired: boolean().notNull().default(true),
    calibrationIntervalDays: integer().notNull().default(365),
    lastCalibratedOn: date(),
    calibrationDueOn: date(),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("instr_asset_uq").on(t.assetNo)],
);

export const calibrationRecords = pgTable(
  "calibration_records",
  {
    id: pk(),
    instrumentId: uuid()
      .notNull()
      .references(() => measuringInstruments.id),
    calibratedOn: date().notNull(),
    dueOn: date().notNull(),
    result: text().notNull(), // pass | fail | adjusted
    /** False when found out of tolerance before adjustment — triggers review of results since last good calibration. */
    asFoundInTolerance: boolean().notNull().default(true),
    certificateNo: text(),
    providerId: uuid().references(() => suppliers.id),
    performedBy: text(),
    fileId: uuid().references(() => files.id),
    notes: text(),
    recordedBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("calrec_instr_idx").on(t.instrumentId)],
);

// ───────────────────────────── Inspection records ─────────────────────────────

export const inspections = pgTable(
  "inspections",
  {
    id: pk(),
    ref: text().notNull(),
    stage: text().notNull(),
    planId: uuid().references(() => inspectionPlans.id),
    jobId: uuid().references(() => jobs.id),
    jobLineId: uuid().references(() => jobLines.id),
    operationId: uuid().references(() => operations.id),
    batchId: uuid().references(() => batches.id),
    serialId: uuid().references(() => serials.id),
    lotId: uuid().references(() => materialLots.id),
    subcontractOrderId: uuid(),
    /** Revision context captured at inspection time. */
    drawingRevisionId: uuid().references(() => documentRevisions.id),
    programRevisionId: uuid().references(() => cncProgramRevisions.id),
    machineId: uuid().references(() => machines.id),
    setupOperatorId: uuid().references(() => employees.id),
    /** open | in_progress | passed | failed | cancelled */
    status: text().notNull().default("open"),
    result: text(), // pass | fail
    sampleQty: qty(),
    qtyInspected: qty(),
    qtyAccepted: qty(),
    qtyRejected: qty(),
    requestedBy: uuid().references(() => users.id),
    requestedAt: ts().notNull().defaultNow(),
    inspectorId: uuid().references(() => users.id),
    completedAt: ts(),
    approvalId: uuid().references(() => approvals.id),
    notes: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("insp_ref_uq").on(t.ref),
    index("insp_op_idx").on(t.operationId),
    index("insp_job_idx").on(t.jobId),
    index("insp_lot_idx").on(t.lotId),
  ],
);

export const inspectionResults = pgTable(
  "inspection_results",
  {
    id: pk(),
    inspectionId: uuid()
      .notNull()
      .references(() => inspections.id),
    characteristicId: uuid().references(() => inspectionCharacteristics.id),
    sampleNo: integer().notNull().default(1),
    serialId: uuid().references(() => serials.id),
    measuredValue: measure(),
    attributeResult: text(), // pass | fail (non-numeric checks)
    /** Evaluated on the server: pass | fail | missing. A missing value is never a pass. */
    result: text().notNull(),
    instrumentId: uuid().references(() => measuringInstruments.id),
    /** Snapshot of instrument calibration validity at the time of measurement. */
    instrumentCalibrationValid: boolean(),
    comment: text(),
    recordedBy: uuid()
      .notNull()
      .references(() => users.id),
    recordedAt: ts().notNull().defaultNow(),
    /** Set when a later calibration failure puts this result under review. */
    underReview: boolean().notNull().default(false),
    reviewOutcome: text(),
  },
  (t) => [index("iresult_insp_idx").on(t.inspectionId), index("iresult_instr_idx").on(t.instrumentId)],
);

export const inspectionEvidence = pgTable("inspection_evidence", {
  id: pk(),
  inspectionId: uuid()
    .notNull()
    .references(() => inspections.id),
  fileId: uuid()
    .notNull()
    .references(() => files.id),
  caption: text(),
  createdAt: createdAt(),
});

// ───────────────────────────── Non-conformance & CAPA ─────────────────────────────

export const ncrs = pgTable(
  "ncrs",
  {
    id: pk(),
    ref: text().notNull(),
    source: text().notNull().default("internal"), // internal | supplier | customer_complaint | audit
    /** dimension | wrong_material | wrong_revision | surface | tooling | machine | supplier | documentation | customer_complaint | other */
    category: text().notNull(),
    /** open | contained | awaiting_disposition | disposition_approved | in_rework | awaiting_reinspection | closed | cancelled */
    status: text().notNull().default("open"),
    jobId: uuid().references(() => jobs.id),
    jobLineId: uuid().references(() => jobLines.id),
    operationId: uuid().references(() => operations.id),
    batchId: uuid().references(() => batches.id),
    lotId: uuid().references(() => materialLots.id),
    inspectionId: uuid().references(() => inspections.id),
    supplierId: uuid().references(() => suppliers.id),
    customerId: uuid().references(() => customers.id),
    partId: uuid().references(() => parts.id),
    heatNumber: text(),
    qtyAffected: qty().notNull(),
    description: text().notNull(),
    containmentAction: text(),
    /** rework | repair | use_as_is | scrap | return_to_supplier | awaiting_investigation */
    disposition: text(),
    dispositionNotes: text(),
    customerConcessionRef: text(),
    dispositionBy: uuid().references(() => users.id),
    dispositionAt: ts(),
    dispositionApprovalId: uuid().references(() => approvals.id),
    rootCause: text(),
    raisedBy: uuid()
      .notNull()
      .references(() => users.id),
    raisedAt: ts().notNull().defaultNow(),
    ownerId: uuid().references(() => users.id),
    reinspectionId: uuid().references(() => inspections.id),
    closedBy: uuid().references(() => users.id),
    closedAt: ts(),
    closureNotes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("ncr_ref_uq").on(t.ref), index("ncr_job_idx").on(t.jobId), index("ncr_status_idx").on(t.status)],
);

export const ncrFiles = pgTable("ncr_files", {
  id: pk(),
  ncrId: uuid()
    .notNull()
    .references(() => ncrs.id),
  fileId: uuid()
    .notNull()
    .references(() => files.id),
  caption: text(),
  createdAt: createdAt(),
});

export const correctiveActions = pgTable(
  "corrective_actions",
  {
    id: pk(),
    ref: text().notNull(),
    ncrId: uuid().references(() => ncrs.id),
    title: text().notNull(),
    problem: text().notNull(),
    rootCause: text(),
    action: text(),
    ownerId: uuid().references(() => users.id),
    dueDate: date(),
    /** open | in_progress | implemented | verified_effective | verified_ineffective | closed | cancelled */
    status: text().notNull().default("open"),
    implementedAt: ts(),
    verificationMethod: text(),
    verificationDueDate: date(),
    verifiedBy: uuid().references(() => users.id),
    verifiedAt: ts(),
    effective: boolean(),
    verificationNotes: text(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("ca_ref_uq").on(t.ref)],
);

/** Explicit hold records on jobs, operations, batches or material lots. */
export const holds = pgTable(
  "holds",
  {
    id: pk(),
    targetType: text().notNull(), // job | operation | batch | lot
    jobId: uuid().references(() => jobs.id),
    operationId: uuid().references(() => operations.id),
    batchId: uuid().references(() => batches.id),
    lotId: uuid().references(() => materialLots.id),
    ncrId: uuid().references(() => ncrs.id),
    reason: text().notNull(),
    qtyHeld: qty(),
    placedBy: uuid()
      .notNull()
      .references(() => users.id),
    placedAt: ts().notNull().defaultNow(),
    releasedBy: uuid().references(() => users.id),
    releasedAt: ts(),
    releaseReason: text(),
  },
  (t) => [index("holds_job_idx").on(t.jobId), index("holds_op_idx").on(t.operationId), index("holds_lot_idx").on(t.lotId)],
);

// ───────────────────────────── Final release ─────────────────────────────

export const releaseChecklistTemplates = pgTable("release_checklist_templates", {
  id: pk(),
  label: text().notNull(),
  guidance: text(),
  required: boolean().notNull().default(true),
  sortOrder: integer().notNull().default(100),
  isActive: boolean().notNull().default(true),
});

export const finalReleases = pgTable(
  "final_releases",
  {
    id: pk(),
    jobId: uuid()
      .notNull()
      .references(() => jobs.id),
    jobLineId: uuid()
      .notNull()
      .references(() => jobLines.id),
    status: text().notNull().default("draft"), // draft | approved | rejected | revoked
    qtyReleased: qty(),
    decidedBy: uuid().references(() => users.id),
    decidedAt: ts(),
    approvalId: uuid().references(() => approvals.id),
    comments: text(),
    cocFileId: uuid().references(() => files.id),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("frel_job_idx").on(t.jobId)],
);

export const finalReleaseItems = pgTable("final_release_items", {
  id: pk(),
  releaseId: uuid()
    .notNull()
    .references(() => finalReleases.id, { onDelete: "cascade" }),
  source: text().notNull(), // system | template | customer
  key: text().notNull(),
  label: text().notNull(),
  required: boolean().notNull().default(true),
  /** pass | fail | na | pending */
  status: text().notNull().default("pending"),
  detail: text(),
  checkedBy: uuid().references(() => users.id),
  checkedAt: ts(),
});
