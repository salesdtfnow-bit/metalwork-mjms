import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  time,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createdAt, money, pk, qty, rate, ts, updatedAt } from "./_helpers";
import { files, users } from "./core";
import { suppliers } from "./parties";
import { operations, operationTypes } from "./production";
import { boxheroItems } from "./materials";

// ───────────────────────────── Work calendars ─────────────────────────────

export const workCalendars = pgTable("work_calendars", {
  id: pk(),
  name: text().notNull(),
  description: text(),
  createdAt: createdAt(),
});

export const calendarShifts = pgTable("calendar_shifts", {
  id: pk(),
  calendarId: uuid()
    .notNull()
    .references(() => workCalendars.id, { onDelete: "cascade" }),
  dayOfWeek: integer().notNull(), // 0 = Sunday … 6 = Saturday
  startTime: time().notNull(),
  endTime: time().notNull(),
  label: text(),
});

export const calendarExceptions = pgTable("calendar_exceptions", {
  id: pk(),
  calendarId: uuid()
    .notNull()
    .references(() => workCalendars.id, { onDelete: "cascade" }),
  date: date().notNull(),
  isWorking: boolean().notNull().default(false),
  startTime: time(),
  endTime: time(),
  note: text(),
});

// ───────────────────────────── Machines ─────────────────────────────

export const machineTypes = pgTable(
  "machine_types",
  {
    id: pk(),
    code: text().notNull(),
    name: text().notNull(),
    /** Custom field definitions: [{ key, label, type: text|number|boolean|date, unit? }] */
    customFieldDefs: jsonb().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mtype_code_uq").on(t.code)],
);

export const machineGroups = pgTable(
  "machine_groups",
  {
    id: pk(),
    code: text().notNull(),
    name: text().notNull(),
    description: text(),
  },
  (t) => [uniqueIndex("mgroup_code_uq").on(t.code)],
);

export const machines = pgTable(
  "machines",
  {
    id: pk(),
    code: text().notNull(),
    name: text().notNull(),
    machineTypeId: uuid()
      .notNull()
      .references(() => machineTypes.id),
    machineGroupId: uuid().references(() => machineGroups.id),
    manufacturer: text(),
    model: text(),
    serialNumber: text(),
    yearOfManufacture: integer(),
    controller: text(),
    axes: text(),
    capabilities: text(),
    workEnvelope: text(),
    maxWeightKg: qty(),
    spindleSpeedMax: integer(),
    permittedMaterials: text(),
    accessories: text(),
    location: text(),
    responsibleEmployeeId: uuid().references((): AnyPgColumn => employees.id),
    calendarId: uuid().references(() => workCalendars.id),
    hourlyRate: rate(),
    /** Can more than one operation be booked at the same time? */
    allowsConcurrent: boolean().notNull().default(false),
    /** Latest reported status: available | running | setup | blocked | maintenance | offline */
    currentStatus: text().notNull().default("available"),
    currentStatusSource: text().notNull().default("manual"), // manual | telemetry
    currentStatusAt: ts(),
    currentStatusBy: uuid().references(() => users.id),
    safetyNotes: text(),
    setupRequirements: text(),
    customFields: jsonb().notNull().default({}),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("machines_code_uq").on(t.code)],
);

export const machineCapabilities = pgTable(
  "machine_capabilities",
  {
    machineId: uuid()
      .notNull()
      .references(() => machines.id, { onDelete: "cascade" }),
    operationTypeId: uuid()
      .notNull()
      .references((): AnyPgColumn => operationTypes.id),
  },
  (t) => [primaryKey({ columns: [t.machineId, t.operationTypeId] })],
);

export const machineStatusEvents = pgTable(
  "machine_status_events",
  {
    id: pk(),
    machineId: uuid()
      .notNull()
      .references(() => machines.id),
    status: text().notNull(),
    /** manual = reported by a person; telemetry = verified machine data (not implemented). */
    source: text().notNull().default("manual"),
    reason: text(),
    operationId: uuid().references((): AnyPgColumn => operations.id),
    userId: uuid().references(() => users.id),
    at: ts().notNull().defaultNow(),
  },
  (t) => [index("mstatus_machine_idx").on(t.machineId, t.at)],
);

export const downtimeReasons = pgTable(
  "downtime_reasons",
  {
    id: pk(),
    code: text().notNull(),
    name: text().notNull(),
    category: text().notNull().default("unplanned"), // planned | unplanned
    isActive: boolean().notNull().default(true),
  },
  (t) => [uniqueIndex("dtreason_code_uq").on(t.code)],
);

// ───────────────────────────── Employees & competencies ─────────────────────────────

export const employees = pgTable(
  "employees",
  {
    id: pk(),
    employeeNo: text().notNull(),
    firstName: text().notNull(),
    lastName: text().notNull(),
    email: text(),
    phone: text(),
    jobTitle: text(),
    department: text(),
    supervisorId: uuid().references((): AnyPgColumn => employees.id),
    calendarId: uuid().references(() => workCalendars.id),
    shift: text(),
    /** Shop-floor badge for barcode login lookup (not a password). */
    badgeCode: text(),
    isActive: boolean().notNull().default(true),
    startDate: date(),
    leftDate: date(),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("emp_no_uq").on(t.employeeNo)],
);

export const competencies = pgTable(
  "competencies",
  {
    id: pk(),
    code: text().notNull(),
    name: text().notNull(),
    description: text(),
    operationTypeId: uuid().references((): AnyPgColumn => operationTypes.id),
    machineTypeId: uuid().references(() => machineTypes.id),
    machineId: uuid().references(() => machines.id),
    requiresExpiry: boolean().notNull().default(false),
    validityMonths: integer(),
    isActive: boolean().notNull().default(true),
  },
  (t) => [uniqueIndex("comp_code_uq").on(t.code)],
);

export const employeeCompetencies = pgTable(
  "employee_competencies",
  {
    id: pk(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    competencyId: uuid()
      .notNull()
      .references(() => competencies.id),
    level: text().notNull().default("competent"), // trainee | competent | trainer
    status: text().notNull().default("active"), // active | suspended | revoked
    verifiedBy: uuid().references(() => users.id),
    verifiedAt: ts(),
    expiresOn: date(),
    evidenceFileId: uuid().references(() => files.id),
    notes: text(),
    createdAt: createdAt(),
  },
  (t) => [index("empcomp_emp_idx").on(t.employeeId)],
);

export const trainingRecords = pgTable("training_records", {
  id: pk(),
  employeeId: uuid()
    .notNull()
    .references(() => employees.id),
  title: text().notNull(),
  provider: text(),
  completedOn: date().notNull(),
  expiresOn: date(),
  fileId: uuid().references(() => files.id),
  notes: text(),
  recordedBy: uuid().references(() => users.id),
  createdAt: createdAt(),
});

// ───────────────────────────── Tooling ─────────────────────────────

export const tools = pgTable(
  "tools",
  {
    id: pk(),
    assetNo: text().notNull(),
    description: text().notNull(),
    toolType: text().notNull(), // cutting_tool | insert | holder | fixture | jig | gauge | other
    location: text(),
    status: text().notNull().default("available"), // available | in_use | maintenance | quarantined | scrapped | lost
    /** Which system owns this record: mjms | boxhero (consumables managed in BoxHero). */
    ownership: text().notNull().default("mjms"),
    boxheroItemId: uuid().references((): AnyPgColumn => boxheroItems.id),
    lifeUnit: text().notNull().default("none"), // none | minutes | cycles | parts
    lifeLimit: qty(),
    lifeUsed: qty().notNull().default("0"),
    inspectionRequired: boolean().notNull().default(false),
    inspectionIntervalDays: integer(),
    nextInspectionDue: date(),
    notes: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tools_asset_uq").on(t.assetNo)],
);

export const toolMachines = pgTable(
  "tool_machines",
  {
    toolId: uuid()
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
    machineId: uuid()
      .notNull()
      .references(() => machines.id),
  },
  (t) => [primaryKey({ columns: [t.toolId, t.machineId] })],
);

export const operationTools = pgTable("operation_tools", {
  id: pk(),
  operationId: uuid()
    .notNull()
    .references((): AnyPgColumn => operations.id),
  toolId: uuid()
    .notNull()
    .references(() => tools.id),
  notes: text(),
});

export const toolEvents = pgTable(
  "tool_events",
  {
    id: pk(),
    toolId: uuid()
      .notNull()
      .references(() => tools.id),
    kind: text().notNull(), // usage | inspection | maintenance | regrind | replacement | status_change
    operationId: uuid().references((): AnyPgColumn => operations.id),
    quantity: qty(),
    notes: text(),
    userId: uuid().references(() => users.id),
    at: ts().notNull().defaultNow(),
  },
  (t) => [index("toolev_tool_idx").on(t.toolId)],
);

// ───────────────────────────── Maintenance ─────────────────────────────

export const maintenancePlans = pgTable("maintenance_plans", {
  id: pk(),
  machineId: uuid()
    .notNull()
    .references(() => machines.id),
  title: text().notNull(),
  intervalDays: integer().notNull(),
  checklist: text(),
  estimatedHours: qty(),
  responsibleEmployeeId: uuid().references(() => employees.id),
  serviceProviderId: uuid().references(() => suppliers.id),
  lastDoneOn: date(),
  nextDueOn: date(),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
});

export const maintenanceWorkOrders = pgTable(
  "maintenance_work_orders",
  {
    id: pk(),
    ref: text().notNull(),
    machineId: uuid()
      .notNull()
      .references(() => machines.id),
    planId: uuid().references(() => maintenancePlans.id),
    kind: text().notNull(), // preventive | breakdown | corrective | inspection | calibration
    status: text().notNull().default("open"), // open | scheduled | in_progress | completed | cancelled
    priority: integer().notNull().default(3),
    title: text().notNull(),
    description: text(),
    reportedBy: uuid().references(() => users.id),
    reportedAt: ts().notNull().defaultNow(),
    scheduledStart: ts(),
    scheduledEnd: ts(),
    /** While true and within the window (or in progress), the machine cannot be scheduled/started. */
    locksMachine: boolean().notNull().default(true),
    startedAt: ts(),
    completedAt: ts(),
    completedBy: uuid().references(() => users.id),
    serviceProviderId: uuid().references(() => suppliers.id),
    findings: text(),
    cost: money(),
    reportFileId: uuid().references(() => files.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mwo_ref_uq").on(t.ref), index("mwo_machine_idx").on(t.machineId)],
);
