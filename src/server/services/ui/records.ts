import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, lte, notInArray, or, sql } from "drizzle-orm";
import {
  auditEvents,
  calendarExceptions,
  customers,
  downtimeReasons,
  emailOutbox,
  employees,
  enquiries,
  integrationEvents,
  machines,
  parts,
  quotationRevisions,
  quotations,
  releaseChecklistTemplates,
  retentionPolicies,
  roles,
  sessions,
  statusTransitions,
  suppliers,
  userRoles,
  users,
  workCalendars,
} from "../../db/schema";
import { requireAnyPermission, requirePermission, type Ctx } from "../../context";

/**
 * Read-only helpers for the dashboard, reports, documents, account and administration
 * screens. Every function checks its permission; none of them write.
 */


// ───────────── Dashboard: sales ─────────────

export async function salesSummary(ctx: Ctx) {
  requirePermission(ctx, "enquiries.view");
  const [open] = await ctx.db.select({ n: count() }).from(enquiries).where(notInArray(enquiries.status, ["won", "lost", "no_quote", "cancelled"]));
  const [fresh] = await ctx.db.select({ n: count() }).from(enquiries).where(eq(enquiries.status, "new"));
  const awaiting = await ctx.db
    .select({ rev: quotationRevisions, q: quotations, customer: customers.name })
    .from(quotationRevisions)
    .innerJoin(quotations, eq(quotations.id, quotationRevisions.quotationId))
    .innerJoin(customers, eq(customers.id, quotations.customerId))
    .where(inArray(quotationRevisions.status, ["sent", "awaiting_response"]))
    .orderBy(asc(quotationRevisions.validUntil))
    .limit(10);
  const [awaitingCount] = await ctx.db.select({ n: count() }).from(quotationRevisions).where(inArray(quotationRevisions.status, ["sent", "awaiting_response"]));
  const [inReview] = await ctx.db.select({ n: count() }).from(quotationRevisions).where(eq(quotationRevisions.status, "internal_review"));
  return {
    openEnquiries: Number(open?.n ?? 0),
    newEnquiries: Number(fresh?.n ?? 0),
    awaitingResponse: Number(awaitingCount?.n ?? 0),
    inInternalReview: Number(inReview?.n ?? 0),
    awaitingList: awaiting,
  };
}

// ───────────── Select options ─────────────

/** Filter options for the reports screen. */
export async function reportFilterOptions(ctx: Ctx) {
  requireAnyPermission(ctx, "reports.view", "reports.management");
  const [cs, ms, es, ss] = await Promise.all([
    ctx.db.select({ id: customers.id, code: customers.code, name: customers.name }).from(customers).orderBy(asc(customers.name)),
    ctx.db.select({ id: machines.id, code: machines.code, name: machines.name }).from(machines).orderBy(asc(machines.code)),
    ctx.db.select({ id: employees.id, no: employees.employeeNo, firstName: employees.firstName, lastName: employees.lastName }).from(employees).orderBy(asc(employees.lastName)),
    ctx.db.select({ id: suppliers.id, code: suppliers.code, name: suppliers.name }).from(suppliers).orderBy(asc(suppliers.name)),
  ]);
  return { customers: cs, machines: ms, employees: es, suppliers: ss };
}

/** Optional links for a new controlled document. */
export async function documentFormOptions(ctx: Ctx) {
  requirePermission(ctx, "documents.upload");
  const [cs, ps, ms, ss] = await Promise.all([
    ctx.db.select({ id: customers.id, code: customers.code, name: customers.name }).from(customers).where(eq(customers.isActive, true)).orderBy(asc(customers.name)),
    ctx.db.select({ id: parts.id, partNumber: parts.partNumber, description: parts.description }).from(parts).where(eq(parts.isActive, true)).orderBy(asc(parts.partNumber)).limit(1000),
    ctx.db.select({ id: machines.id, code: machines.code, name: machines.name }).from(machines).where(eq(machines.isActive, true)).orderBy(asc(machines.code)),
    ctx.db.select({ id: suppliers.id, code: suppliers.code, name: suppliers.name }).from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name)),
  ]);
  return { customers: cs, parts: ps, machines: ms, suppliers: ss };
}

/** Names of users referenced by document revisions (reviewer / approver). */
export async function userNames(ctx: Ctx, ids: (string | null | undefined)[]) {
  requirePermission(ctx, "documents.view");
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const rows = await ctx.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, list));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Labels of the records a document is linked to. */
export async function documentLinks(ctx: Ctx, doc: { customerId: string | null; supplierId: string | null; machineId: string | null; partId: string | null }) {
  requirePermission(ctx, "documents.view");
  const [c] = doc.customerId ? await ctx.db.select({ id: customers.id, label: customers.name }).from(customers).where(eq(customers.id, doc.customerId)) : [];
  const [s] = doc.supplierId ? await ctx.db.select({ id: suppliers.id, label: suppliers.name }).from(suppliers).where(eq(suppliers.id, doc.supplierId)) : [];
  const [m] = doc.machineId ? await ctx.db.select({ id: machines.id, label: machines.code }).from(machines).where(eq(machines.id, doc.machineId)) : [];
  const [p] = doc.partId ? await ctx.db.select({ id: parts.id, label: parts.partNumber }).from(parts).where(eq(parts.id, doc.partId)) : [];
  return { customer: c ?? null, supplier: s ?? null, machine: m ?? null, part: p ?? null };
}

// ───────────── Account ─────────────

/** The signed-in user's own account record and current session (self only). */
export async function myAccount(ctx: Ctx) {
  const [u] = await ctx.db
    .select({ id: users.id, email: users.email, name: users.name, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt, mustChangePassword: users.mustChangePassword })
    .from(users)
    .where(eq(users.id, ctx.actor.userId))
    .limit(1);
  const [emp] = ctx.actor.employeeId ? await ctx.db.select().from(employees).where(eq(employees.id, ctx.actor.employeeId)).limit(1) : [];
  const [session] = ctx.actor.sessionId
    ? await ctx.db
        .select({ createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt, ipAddress: sessions.ipAddress, userAgent: sessions.userAgent, reauthAt: sessions.reauthAt })
        .from(sessions)
        .where(eq(sessions.id, ctx.actor.sessionId))
        .limit(1)
    : [];
  const [active] = await ctx.db
    .select({ n: count() })
    .from(sessions)
    .where(and(eq(sessions.userId, ctx.actor.userId), isNull(sessions.revokedAt), gte(sessions.expiresAt, new Date())));
  const roleRows = await ctx.db.select({ key: roles.key, name: roles.name, description: roles.description }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, ctx.actor.userId));
  return { user: u ?? null, employee: emp ?? null, session: session ?? null, activeSessions: Number(active?.n ?? 0), roles: roleRows };
}

// ───────────── Administration: users ─────────────

export async function userAdminOptions(ctx: Ctx) {
  requirePermission(ctx, "admin.users");
  const [rs, es, linked] = await Promise.all([
    ctx.db.select({ id: roles.id, key: roles.key, name: roles.name, description: roles.description }).from(roles).orderBy(asc(roles.name)),
    ctx.db.select({ id: employees.id, no: employees.employeeNo, firstName: employees.firstName, lastName: employees.lastName, isActive: employees.isActive }).from(employees).orderBy(asc(employees.lastName)),
    ctx.db.select({ id: users.id, employeeId: users.employeeId }).from(users).where(sql`${users.employeeId} is not null`),
  ]);
  return { roles: rs, employees: es, linkedEmployeeIds: new Map(linked.map((l) => [l.employeeId as string, l.id])) };
}

export async function userSessions(ctx: Ctx, userId: string) {
  requirePermission(ctx, "admin.users");
  return ctx.db
    .select({ createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt, revokedAt: sessions.revokedAt, ipAddress: sessions.ipAddress, userAgent: sessions.userAgent })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.createdAt))
    .limit(20);
}

export async function userAuditEvents(ctx: Ctx, userId: string) {
  requirePermission(ctx, "admin.users");
  return ctx.db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.entityType, "user"), eq(auditEvents.entityId, userId)))
    .orderBy(desc(auditEvents.id))
    .limit(50);
}

// ───────────── Administration: configuration ─────────────

export async function listStatusTransitions(ctx: Ctx, entityType = "job") {
  requirePermission(ctx, "admin.config");
  return ctx.db.select().from(statusTransitions).where(eq(statusTransitions.entityType, entityType)).orderBy(asc(statusTransitions.fromStatus), asc(statusTransitions.toStatus));
}

export async function listChecklistTemplates(ctx: Ctx) {
  requirePermission(ctx, "admin.config");
  return ctx.db.select().from(releaseChecklistTemplates).orderBy(asc(releaseChecklistTemplates.sortOrder), asc(releaseChecklistTemplates.label));
}

export async function listRetentionPolicies(ctx: Ctx) {
  requirePermission(ctx, "admin.config");
  return ctx.db.select().from(retentionPolicies).orderBy(asc(retentionPolicies.recordType));
}

/** All downtime reasons including inactive ones (the machines helper lists active only). */
export async function listAllDowntimeReasons(ctx: Ctx) {
  requirePermission(ctx, "admin.config");
  return ctx.db.select().from(downtimeReasons).orderBy(asc(downtimeReasons.category), asc(downtimeReasons.name));
}

export async function listCalendarExceptions(ctx: Ctx) {
  requirePermission(ctx, "admin.config");
  return ctx.db
    .select({ x: calendarExceptions, calendar: workCalendars.name })
    .from(calendarExceptions)
    .innerJoin(workCalendars, eq(workCalendars.id, calendarExceptions.calendarId))
    .orderBy(desc(calendarExceptions.date))
    .limit(200);
}

// ───────────── Administration: audit trail ─────────────

export type AuditFilter = {
  entityType?: string;
  q?: string;
  userId?: string;
  action?: string;
  from?: string;
  to?: string;
  outcome?: string;
  before?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function searchAudit(ctx: Ctx, f: AuditFilter, pageSize = 100) {
  requirePermission(ctx, "audit.view");
  const q = f.q?.trim();
  const rows = await ctx.db
    .select()
    .from(auditEvents)
    .where(
      and(
        f.entityType ? eq(auditEvents.entityType, f.entityType) : undefined,
        q ? or(ilike(auditEvents.entityRef, `%${q}%`), eq(auditEvents.entityId, q), UUID.test(q) ? or(eq(auditEvents.jobId, q), eq(auditEvents.operationId, q)) : undefined) : undefined,
        f.userId && UUID.test(f.userId) ? eq(auditEvents.userId, f.userId) : undefined,
        f.action ? ilike(auditEvents.action, `%${f.action.trim()}%`) : undefined,
        f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from) ? gte(auditEvents.occurredAt, new Date(`${f.from}T00:00:00Z`)) : undefined,
        f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to) ? lte(auditEvents.occurredAt, new Date(`${f.to}T23:59:59Z`)) : undefined,
        f.outcome ? eq(auditEvents.outcome, f.outcome) : undefined,
        f.before && Number.isFinite(f.before) ? lt(auditEvents.id, f.before) : undefined,
      ),
    )
    .orderBy(desc(auditEvents.id))
    .limit(pageSize + 1);
  const more = rows.length > pageSize;
  const page = more ? rows.slice(0, pageSize) : rows;
  return { rows: page, nextBefore: more ? page[page.length - 1].id : null };
}

export async function auditFilterOptions(ctx: Ctx) {
  requirePermission(ctx, "audit.view");
  const [types, us] = await Promise.all([
    ctx.db.selectDistinct({ t: auditEvents.entityType }).from(auditEvents).orderBy(asc(auditEvents.entityType)),
    ctx.db.select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(asc(users.name)),
  ]);
  return { entityTypes: types.map((t) => t.t), users: us };
}

// ───────────── Administration: integrations ─────────────

export async function recentEmailOutbox(ctx: Ctx, limit = 50) {
  requirePermission(ctx, "integrations.view");
  const rows = await ctx.db
    .select({ id: emailOutbox.id, to: emailOutbox.to, subject: emailOutbox.subject, status: emailOutbox.status, attempts: emailOutbox.attempts, lastError: emailOutbox.lastError, createdAt: emailOutbox.createdAt, sentAt: emailOutbox.sentAt })
    .from(emailOutbox)
    .orderBy(desc(emailOutbox.createdAt))
    .limit(limit);
  const counts = await ctx.db.select({ status: emailOutbox.status, n: sql<number>`count(*)::int` }).from(emailOutbox).groupBy(emailOutbox.status);
  return { rows, counts };
}

export async function recentIntegrationEvents(ctx: Ctx, integration: string, limit = 30) {
  requirePermission(ctx, "integrations.view");
  return ctx.db.select().from(integrationEvents).where(eq(integrationEvents.integration, integration)).orderBy(desc(integrationEvents.at)).limit(limit);
}
