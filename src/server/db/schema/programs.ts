import { boolean, index, pgTable, primaryKey, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createdAt, pk, ts } from "./_helpers";
import { files, users } from "./core";
import { documentRevisions, parts } from "./documents";
import { machines } from "./resources";
import { jobs, operationTypes } from "./production";

export const cncPrograms = pgTable(
  "cnc_programs",
  {
    id: pk(),
    programNumber: text().notNull(),
    name: text().notNull(),
    partId: uuid().references((): AnyPgColumn => parts.id),
    jobId: uuid().references((): AnyPgColumn => jobs.id),
    operationTypeId: uuid().references((): AnyPgColumn => operationTypes.id),
    opNumber: text(),
    description: text(),
    /** The single released revision operators may use (null until first release). */
    currentReleasedRevisionId: uuid().references((): AnyPgColumn => cncProgramRevisions.id),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    isActive: boolean().notNull().default(true),
  },
  (t) => [uniqueIndex("prog_number_uq").on(t.programNumber)],
);

export const cncProgramMachines = pgTable(
  "cnc_program_machines",
  {
    programId: uuid()
      .notNull()
      .references(() => cncPrograms.id, { onDelete: "cascade" }),
    machineId: uuid()
      .notNull()
      .references((): AnyPgColumn => machines.id),
  },
  (t) => [primaryKey({ columns: [t.programId, t.machineId] })],
);

export const cncProgramRevisions = pgTable(
  "cnc_program_revisions",
  {
    id: pk(),
    programId: uuid()
      .notNull()
      .references(() => cncPrograms.id),
    revision: text().notNull(),
    fileId: uuid()
      .notNull()
      .references(() => files.id),
    /** Copied from the file for quick operator verification of the exact revision. */
    checksum: text(),
    /** draft | submitted | approved | released | superseded | rejected | obsolete */
    status: text().notNull().default("draft"),
    changeDescription: text().notNull(),
    programmerId: uuid().references(() => users.id),
    submittedAt: ts(),
    approvedBy: uuid().references(() => users.id),
    approvedAt: ts(),
    approvalId: uuid(),
    releasedBy: uuid().references(() => users.id),
    releasedAt: ts(),
    rejectedBy: uuid().references(() => users.id),
    rejectedAt: ts(),
    rejectionReason: text(),
    /** not_required | pending | simulated | proved_out | failed */
    verificationStatus: text().notNull().default("pending"),
    verificationNotes: text(),
    drawingRevisionId: uuid().references(() => documentRevisions.id),
    setupSheetRevisionId: uuid().references(() => documentRevisions.id),
    previousRevisionId: uuid().references((): AnyPgColumn => cncProgramRevisions.id),
    supersededAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("progrev_uq").on(t.programId, t.revision), index("progrev_status_idx").on(t.status)],
);
