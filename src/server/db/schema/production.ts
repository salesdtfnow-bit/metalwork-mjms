import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createdAt, pk, qty, rate, ts, updatedAt } from "./_helpers";
import { users } from "./core";
import { documentRevisions, partRevisions, parts } from "./documents";
import { addresses, customers } from "./parties";
import { customerOrders, quotationLines, quotationRevisions } from "./sales";
import { competencies, downtimeReasons, employees, machineGroups, machines } from "./resources";
import { cncProgramRevisions } from "./programs";
import { materialLots } from "./materials";
import { inspectionPlans } from "./quality";

/** Configurable operation types (CNC milling, turning, sawing, inspection, subcontract...). */
export const operationTypes = pgTable(
  "operation_types",
  {
    id: pk(),
    code: text().notNull(),
    name: text().notNull(),
    category: text().notNull().default("machining"), // machining | cutting | fabrication | finishing | treatment | assembly | inspection | subcontract | logistics | other
    requiresMachine: boolean().notNull().default(true),
    requiresProgramDefault: boolean().notNull().default(false),
    requiresFirstOffDefault: boolean().notNull().default(false),
    isSubcontract: boolean().notNull().default(false),
    isInspection: boolean().notNull().default(false),
    defaultCompetencyId: uuid().references((): AnyPgColumn => competencies.id),
    defaultRatePerHour: rate(),
    sortOrder: integer().notNull().default(100),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("optype_code_uq").on(t.code)],
);

// ───────────────────────────── Jobs ─────────────────────────────

export const jobs = pgTable(
  "jobs",
  {
    id: pk(),
    /** Permanent, never reused. */
    jobNumber: text().notNull(),
    title: text().notNull(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    customerOrderId: uuid().references(() => customerOrders.id),
    quotationRevisionId: uuid().references(() => quotationRevisions.id),
    repeatOfJobId: uuid().references((): AnyPgColumn => jobs.id),
    status: text().notNull().default("order_confirmed"),
    /** Status before going on hold, for resume. */
    statusBeforeHold: text(),
    priority: integer().notNull().default(3), // 1 urgent, 2 high, 3 normal, 4 low
    ownerId: uuid().references(() => users.id),
    requiredDate: date(),
    promisedDate: date(),
    deliveryAddressId: uuid().references(() => addresses.id),
    materialRequirements: text(),
    inspectionRequirements: text(),
    certificationRequirements: text(),
    packagingRequirements: text(),
    deliveryRequirements: text(),
    commercialTerms: text(),
    nextAction: text(),
    holdReason: text(),
    notes: text(),
    authorisedBy: uuid().references(() => users.id),
    authorisedAt: ts(),
    completedAt: ts(),
    cancelledAt: ts(),
    cancelReason: text(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("jobs_number_uq").on(t.jobNumber), index("jobs_status_idx").on(t.status), index("jobs_cust_idx").on(t.customerId)],
);

export const jobLines = pgTable(
  "job_lines",
  {
    id: pk(),
    jobId: uuid()
      .notNull()
      .references(() => jobs.id),
    lineNo: integer().notNull(),
    partId: uuid()
      .notNull()
      .references(() => parts.id),
    partRevisionId: uuid().references(() => partRevisions.id),
    partNumber: text().notNull(),
    description: text().notNull(),
    /** Drawing revision pinned at order; changes go through a controlled review. */
    drawingRevisionId: uuid().references(() => documentRevisions.id),
    quotationLineId: uuid().references(() => quotationLines.id),
    quantity: qty().notNull(),
    unitPrice: rate(),
    materialSpec: text(),
    traceabilityLevel: text().notNull().default("job"), // job | batch | piece
    routeStatus: text().notNull().default("draft"), // draft | released
    routeReleasedBy: uuid().references(() => users.id),
    routeReleasedAt: ts(),
    qtyGood: qty().notNull().default("0"),
    qtyRejected: qty().notNull().default("0"),
    qtyScrapped: qty().notNull().default("0"),
    /** Accepted at final inspection; only this can be released and dispatched. */
    qtyAccepted: qty().notNull().default("0"),
    qtyReleased: qty().notNull().default("0"),
    qtyDispatched: qty().notNull().default("0"),
    drawingReviewRequired: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("jobline_uq").on(t.jobId, t.lineNo)],
);

/** Production batches / lots of manufactured parts. */
export const batches = pgTable(
  "batches",
  {
    id: pk(),
    jobLineId: uuid()
      .notNull()
      .references(() => jobLines.id),
    batchNo: text().notNull(),
    quantity: qty().notNull(),
    status: text().notNull().default("planned"), // planned | in_progress | on_hold | quarantined | complete | accepted | rejected | dispatched
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("batch_no_uq").on(t.batchNo)],
);

/** Individual pieces when piece-level traceability is required. */
export const serials = pgTable(
  "serials",
  {
    id: pk(),
    jobLineId: uuid()
      .notNull()
      .references(() => jobLines.id),
    batchId: uuid().references(() => batches.id),
    serialNo: text().notNull(),
    status: text().notNull().default("in_process"), // in_process | accepted | rejected | scrapped | dispatched
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("serial_no_uq").on(t.serialNo)],
);

// ───────────────────────────── Routing & operations ─────────────────────────────

export const operations = pgTable(
  "operations",
  {
    id: pk(),
    jobId: uuid()
      .notNull()
      .references(() => jobs.id),
    jobLineId: uuid()
      .notNull()
      .references(() => jobLines.id),
    batchId: uuid().references(() => batches.id),
    /** Sort order within the route. */
    sequence: integer().notNull(),
    /** Workshop label, e.g. "10", "20A". */
    opNumber: text().notNull(),
    operationTypeId: uuid()
      .notNull()
      .references(() => operationTypes.id),
    title: text().notNull(),
    instructions: text(),
    machineGroupId: uuid().references(() => machineGroups.id),
    machineId: uuid().references(() => machines.id),
    plannedStart: ts(),
    plannedEnd: ts(),
    setupMinutesEst: qty().notNull().default("0"),
    cycleMinutesEst: qty().notNull().default("0"),
    plannedQty: qty().notNull(),
    qtyGood: qty().notNull().default("0"),
    qtyRejected: qty().notNull().default("0"),
    qtyScrapped: qty().notNull().default("0"),
    /** pending | ready | in_setup | awaiting_first_off | in_production | paused | on_hold | awaiting_inspection | subcontracted | complete | cancelled */
    status: text().notNull().default("pending"),
    statusBeforeHold: text(),
    setupStatus: text().notNull().default("not_started"), // not_started | in_setup | complete
    requiresMaterial: boolean().notNull().default(false),
    requiresProgram: boolean().notNull().default(false),
    requiresFirstOff: boolean().notNull().default(false),
    firstOffStatus: text().notNull().default("not_required"), // not_required | required | requested | approved | rejected
    requiredCompetencyId: uuid().references(() => competencies.id),
    /** Program revision pinned to this operation. */
    programRevisionId: uuid().references(() => cncProgramRevisions.id),
    /** Drawing revision pinned to this operation (defaults from job line). */
    drawingRevisionId: uuid().references(() => documentRevisions.id),
    inspectionPlanId: uuid().references(() => inspectionPlans.id),
    toolingRequirements: text(),
    fixtureRequirements: text(),
    /** True when an upstream revision changed and this op must be reviewed before work continues. */
    reviewRequired: boolean().notNull().default(false),
    reviewReason: text(),
    allowParallel: boolean().notNull().default(false),
    isRework: boolean().notNull().default(false),
    ncrId: uuid(),
    splitFromId: uuid().references((): AnyPgColumn => operations.id),
    repeatOfId: uuid().references((): AnyPgColumn => operations.id),
    actualStart: ts(),
    actualEnd: ts(),
    signedOffBy: uuid().references(() => users.id),
    signedOffAt: ts(),
    signOffNote: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("ops_job_idx").on(t.jobId),
    index("ops_line_idx").on(t.jobLineId, t.sequence),
    index("ops_machine_idx").on(t.machineId, t.plannedStart),
    index("ops_status_idx").on(t.status),
  ],
);

export const operationDependencies = pgTable(
  "operation_dependencies",
  {
    operationId: uuid()
      .notNull()
      .references(() => operations.id, { onDelete: "cascade" }),
    dependsOnId: uuid()
      .notNull()
      .references(() => operations.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.operationId, t.dependsOnId] })],
);

export const operationAssignments = pgTable(
  "operation_assignments",
  {
    id: pk(),
    operationId: uuid()
      .notNull()
      .references(() => operations.id),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    role: text().notNull().default("operator"), // operator | setter | inspector
    isActive: boolean().notNull().default(true),
    assignedBy: uuid().references(() => users.id),
    assignedAt: ts().notNull().defaultNow(),
    unassignedAt: ts(),
  },
  (t) => [index("opassign_op_idx").on(t.operationId), index("opassign_emp_idx").on(t.employeeId)],
);

/** Documents (pinned revisions) attached to an operation: drawing, setup sheet, work instruction. */
export const operationDocuments = pgTable("operation_documents", {
  id: pk(),
  operationId: uuid()
    .notNull()
    .references(() => operations.id),
  documentRevisionId: uuid()
    .notNull()
    .references(() => documentRevisions.id),
  purpose: text().notNull().default("reference"), // drawing | setup_sheet | work_instruction | reference
  pinnedBy: uuid().references(() => users.id),
  pinnedAt: ts().notNull().defaultNow(),
});

/** Operator pre-start confirmations: drawing reviewed, instructions read, material and program confirmed. */
export const operationChecks = pgTable(
  "operation_checks",
  {
    id: pk(),
    operationId: uuid()
      .notNull()
      .references(() => operations.id),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    kind: text().notNull(), // drawing_reviewed | instructions_read | material_confirmed | program_confirmed
    materialLotId: uuid().references(() => materialLots.id),
    programRevisionId: uuid().references(() => cncProgramRevisions.id),
    drawingRevisionId: uuid().references(() => documentRevisions.id),
    value: text(),
    at: ts().notNull().defaultNow(),
  },
  (t) => [index("opcheck_op_idx").on(t.operationId)],
);

/**
 * Operator and machine time. kind = setup | production | rework | inspection.
 * Each production entry records the exact program revision and material lot used.
 */
export const timeEntries = pgTable(
  "time_entries",
  {
    id: pk(),
    operationId: uuid()
      .notNull()
      .references(() => operations.id),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    machineId: uuid().references(() => machines.id),
    kind: text().notNull(),
    startedAt: ts().notNull(),
    endedAt: ts(),
    qtyGood: qty().notNull().default("0"),
    qtyRejected: qty().notNull().default("0"),
    qtyScrapped: qty().notNull().default("0"),
    programRevisionId: uuid().references(() => cncProgramRevisions.id),
    materialLotId: uuid().references(() => materialLots.id),
    batchId: uuid().references(() => batches.id),
    /** manual (entered by a person) | telemetry (machine data; not implemented) */
    source: text().notNull().default("manual"),
    notes: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index("time_op_idx").on(t.operationId),
    index("time_emp_idx").on(t.employeeId, t.startedAt),
    index("time_machine_idx").on(t.machineId, t.startedAt),
  ],
);

/** Notes, issues, assistance requests, hold/resume events on an operation. */
export const operationEvents = pgTable(
  "operation_events",
  {
    id: pk(),
    operationId: uuid()
      .notNull()
      .references(() => operations.id),
    kind: text().notNull(), // note | issue | assist_request | hold | resume | review_cleared | split | reassigned
    message: text().notNull(),
    userId: uuid().references(() => users.id),
    employeeId: uuid().references(() => employees.id),
    at: ts().notNull().defaultNow(),
    resolvedBy: uuid().references(() => users.id),
    resolvedAt: ts(),
  },
  (t) => [index("opevent_op_idx").on(t.operationId)],
);

export const downtimeEvents = pgTable(
  "downtime_events",
  {
    id: pk(),
    machineId: uuid()
      .notNull()
      .references(() => machines.id),
    operationId: uuid().references(() => operations.id),
    reasonId: uuid()
      .notNull()
      .references(() => downtimeReasons.id),
    startedAt: ts().notNull(),
    endedAt: ts(),
    reportedBy: uuid().references(() => users.id),
    notes: text(),
    maintenanceWorkOrderId: uuid(),
    source: text().notNull().default("manual"),
    createdAt: createdAt(),
  },
  (t) => [index("downtime_machine_idx").on(t.machineId, t.startedAt)],
);

export const scheduleChanges = pgTable(
  "schedule_changes",
  {
    id: pk(),
    operationId: uuid()
      .notNull()
      .references(() => operations.id),
    oldMachineId: uuid(),
    newMachineId: uuid(),
    oldStart: ts(),
    newStart: ts(),
    oldEnd: ts(),
    newEnd: ts(),
    reason: text(),
    changedBy: uuid().references(() => users.id),
    changedAt: ts().notNull().defaultNow(),
  },
  (t) => [index("sched_op_idx").on(t.operationId)],
);
