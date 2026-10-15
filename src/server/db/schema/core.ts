import {
  bigserial,
  boolean,
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
import { createdAt, pk, ts, updatedAt } from "./_helpers";
import { employees } from "./resources";

// ───────────────────────────── Users, sessions, RBAC ─────────────────────────────

export const users = pgTable(
  "users",
  {
    id: pk(),
    email: text().notNull(),
    name: text().notNull(),
    passwordHash: text(),
    isActive: boolean().notNull().default(true),
    employeeId: uuid().references((): AnyPgColumn => employees.id),
    mustChangePassword: boolean().notNull().default(false),
    failedLoginCount: integer().notNull().default(0),
    lockedUntil: ts(),
    lastLoginAt: ts(),
    deactivatedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 hex of the session token. The raw token only exists in the cookie. */
    id: text().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    lastSeenAt: ts().notNull().defaultNow(),
    expiresAt: ts().notNull(),
    revokedAt: ts(),
    ipAddress: text(),
    userAgent: text(),
    /** Last time the user re-entered their password (for critical approvals). */
    reauthAt: ts(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: text().primaryKey(), // SHA-256 of token
  userId: uuid()
    .notNull()
    .references(() => users.id),
  expiresAt: ts().notNull(),
  usedAt: ts(),
  createdAt: createdAt(),
});

export const roles = pgTable(
  "roles",
  {
    id: pk(),
    key: text().notNull(),
    name: text().notNull(),
    description: text(),
    isSystem: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("roles_key_uq").on(t.key)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permission: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid()
      .notNull()
      .references(() => roles.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

// ───────────────────────────── Settings & counters ─────────────────────────────

export const companySettings = pgTable("company_settings", {
  id: integer().primaryKey().default(1),
  companyName: text().notNull().default("Your Company Ltd"),
  addressLines: text().notNull().default(""),
  phone: text(),
  email: text(),
  website: text(),
  vatNumber: text(),
  companyNumber: text(),
  timezone: text().notNull().default("Europe/London"),
  currency: text().notNull().default("GBP"),
  defaultTaxRate: text().notNull().default("20"),
  quoteValidityDays: integer().notNull().default(30),
  defaultQuoteTerms: text().notNull().default(""),
  logoFileId: uuid(),
  /** Default retention (years) for manufacturing/quality records. */
  retentionYears: integer().notNull().default(10),
  /** Allow an operator to sign off an inspection on their own operation (default: no). */
  allowSelfInspection: boolean().notNull().default(false),
  /** Require approver ≠ author for documents and programs (segregation of duties). */
  requireIndependentApproval: boolean().notNull().default(true),
  boxheroMode: text().notNull().default("simulated"), // simulated | api | manual
  isDemo: boolean().notNull().default(false),
  updatedAt: updatedAt(),
});

export const counters = pgTable("counters", {
  key: text().primaryKey(),
  value: integer().notNull().default(0),
});

export const retentionPolicies = pgTable("retention_policies", {
  id: pk(),
  recordType: text().notNull(),
  years: integer().notNull(),
  basis: text().notNull().default("from record closure"),
  notes: text(),
  createdAt: createdAt(),
});

// ───────────────────────────── Audit, approvals, exceptions ─────────────────────────────

/**
 * Append-only. A DB trigger (see migration) rejects UPDATE / DELETE / TRUNCATE.
 * hash = sha256(prevHash + canonical event JSON) gives a tamper-evident chain.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    occurredAt: ts().notNull().defaultNow(),
    userId: uuid().references(() => users.id),
    userName: text(),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text(),
    entityRef: text(),
    jobId: uuid(),
    operationId: uuid(),
    before: jsonb(),
    after: jsonb(),
    reason: text(),
    approvalId: uuid(),
    exceptionId: uuid(),
    ipAddress: text(),
    outcome: text().notNull().default("success"), // success | denied | failed
    prevHash: text(),
    hash: text().notNull(),
  },
  (t) => [
    index("audit_entity_idx").on(t.entityType, t.entityId),
    index("audit_job_idx").on(t.jobId),
    index("audit_user_idx").on(t.userId),
    index("audit_time_idx").on(t.occurredAt),
  ],
);

/** Electronic approval records (authenticated, re-verified, with stated meaning). */
export const approvals = pgTable(
  "approvals",
  {
    id: pk(),
    kind: text().notNull(), // e.g. quotation.approve, program.release, material.release, first_off, final_release, ncr.disposition, gate_exception
    entityType: text().notNull(),
    entityId: uuid().notNull(),
    decision: text().notNull(), // approved | rejected
    meaning: text().notNull(), // human statement, e.g. "I approve this program revision for production use"
    userId: uuid()
      .notNull()
      .references(() => users.id),
    userName: text().notNull(),
    reauthenticated: boolean().notNull().default(false),
    comment: text(),
    decidedAt: ts().notNull().defaultNow(),
  },
  (t) => [index("approvals_entity_idx").on(t.entityType, t.entityId)],
);

/** Formally recorded exception allowing a gate to be passed. */
export const gateExceptions = pgTable(
  "gate_exceptions",
  {
    id: pk(),
    ref: text().notNull(),
    gate: text().notNull(),
    jobId: uuid().notNull(),
    operationId: uuid(),
    reason: text().notNull(),
    requestedBy: uuid()
      .notNull()
      .references(() => users.id),
    status: text().notNull().default("approved"), // approved | revoked | used
    approvedBy: uuid().references(() => users.id),
    approvalId: uuid().references(() => approvals.id),
    validUntil: ts(),
    createdAt: createdAt(),
    revokedAt: ts(),
  },
  (t) => [index("gate_exc_op_idx").on(t.operationId), uniqueIndex("gate_exc_ref_uq").on(t.ref)],
);

/** Configurable status transitions (critical gates are additionally enforced in code). */
export const statusTransitions = pgTable(
  "status_transitions",
  {
    id: pk(),
    entityType: text().notNull(), // job | operation | enquiry | quotation | ...
    fromStatus: text().notNull(),
    toStatus: text().notNull(),
    permission: text().notNull(),
    requiresReason: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
  },
  (t) => [uniqueIndex("status_tr_uq").on(t.entityType, t.fromStatus, t.toStatus)],
);

// ───────────────────────────── Files ─────────────────────────────

export const files = pgTable(
  "files",
  {
    id: pk(),
    storage: text().notNull(), // local | blob
    storageKey: text().notNull(),
    originalName: text().notNull(),
    mimeType: text().notNull(),
    sizeBytes: integer().notNull(),
    sha256: text(),
    /** Customer-supplied originals are preserved and never replaced. */
    isCustomerOriginal: boolean().notNull().default(false),
    uploadedBy: uuid().references(() => users.id),
    uploadedAt: createdAt(),
  },
  (t) => [uniqueIndex("files_key_uq").on(t.storage, t.storageKey)],
);

export const fileAccessLog = pgTable(
  "file_access_log",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    fileId: uuid()
      .notNull()
      .references(() => files.id),
    userId: uuid().references(() => users.id),
    action: text().notNull().default("download"), // download | view | denied
    context: text(), // e.g. program_revision:<id>, operation:<id>
    at: ts().notNull().defaultNow(),
    ipAddress: text(),
  },
  (t) => [index("file_access_file_idx").on(t.fileId)],
);

// ───────────────────────────── Notifications & outbox ─────────────────────────────

export const notifications = pgTable(
  "notifications",
  {
    id: pk(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    type: text().notNull(),
    title: text().notNull(),
    body: text(),
    link: text(),
    entityType: text(),
    entityId: text(),
    /** Prevents duplicate notifications for the same event and user. */
    dedupeKey: text(),
    createdAt: createdAt(),
    readAt: ts(),
  },
  (t) => [
    index("notif_user_idx").on(t.userId, t.readAt),
    uniqueIndex("notif_dedupe_uq").on(t.userId, t.dedupeKey),
  ],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text().notNull(),
    inApp: boolean().notNull().default(true),
    email: boolean().notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.type] })],
);

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: pk(),
    idempotencyKey: text().notNull(),
    to: text().array().notNull(),
    subject: text().notNull(),
    html: text().notNull(),
    text: text(),
    attachmentFileIds: uuid().array(),
    status: text().notNull().default("pending"), // pending | sent | failed | cancelled
    attempts: integer().notNull().default(0),
    lastError: text(),
    providerMessageId: text(),
    createdAt: createdAt(),
    sentAt: ts(),
    nextAttemptAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex("email_outbox_idem_uq").on(t.idempotencyKey)],
);

export const integrationEvents = pgTable(
  "integration_events",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    integration: text().notNull(), // boxhero | email
    direction: text().notNull(), // outbound | inbound | sync
    action: text().notNull(),
    status: text().notNull(), // success | error | warning
    message: text(),
    detail: jsonb(),
    at: ts().notNull().defaultNow(),
  },
  (t) => [index("integ_events_idx").on(t.integration, t.at)],
);

export const integrationState = pgTable("integration_state", {
  key: text().primaryKey(), // boxhero | email
  lastSuccessAt: ts(),
  lastErrorAt: ts(),
  lastError: text(),
  lastSyncCursor: text(),
  updatedAt: updatedAt(),
});
