import { asc, desc, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { DB } from "./db/client";
import { auditEvents } from "./db/schema";
import { isInTransaction, type Ctx } from "./context";
import type { AppError } from "./errors";

export type AuditInput = {
  action: string;
  entityType: string;
  entityId?: string | null;
  entityRef?: string | null;
  jobId?: string | null;
  operationId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  approvalId?: string | null;
  exceptionId?: string | null;
  outcome?: "success" | "denied" | "failed";
};

const AUDIT_LOCK_KEY = 704_211; // arbitrary constant for pg_advisory_xact_lock

/** Canonical JSON (sorted keys) so the hash is reproducible during verification. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, (v as Record<string, unknown>)[k]]));
    }
    return v;
  });
}

function hashEvent(prevHash: string | null, e: Record<string, unknown>) {
  return createHash("sha256")
    .update(prevHash ?? "GENESIS")
    .update("|")
    .update(canonical(e))
    .digest("hex");
}

function toJson(v: unknown) {
  if (v === undefined) return null;
  return JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val)));
}

type Who = { userId: string | null; name: string | null; ip?: string | null };

async function insert(db: DB, actor: Who | null, input: AuditInput) {
  await db.execute(sql`select pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`);
  const [last] = await db.select({ hash: auditEvents.hash }).from(auditEvents).orderBy(desc(auditEvents.id)).limit(1);
  const occurredAt = new Date();
  const body = {
    occurredAt: occurredAt.toISOString(),
    userId: actor?.userId ?? null,
    userName: actor?.name ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    entityRef: input.entityRef ?? null,
    jobId: input.jobId ?? null,
    operationId: input.operationId ?? null,
    before: toJson(input.before),
    after: toJson(input.after),
    reason: input.reason ?? null,
    approvalId: input.approvalId ?? null,
    exceptionId: input.exceptionId ?? null,
    ipAddress: actor?.ip ?? null,
    outcome: input.outcome ?? "success",
  };
  const prevHash = last?.hash ?? null;
  const hash = hashEvent(prevHash, body);
  await db.insert(auditEvents).values({ ...body, occurredAt, prevHash, hash });
}

/**
 * Records an audit event. Must normally be called inside the same transaction as the
 * change it describes (pass ctx from `mutate`). Outside a transaction it opens its own.
 */
export async function audit(ctx: Ctx, input: AuditInput): Promise<void> {
  const actor: Who = { userId: ctx.actor.userId || null, name: ctx.actor.name, ip: ctx.actor.ip };
  if (isInTransaction(ctx.db)) return insert(ctx.db, actor, input);
  await ctx.db.transaction(async (tx) => insert(tx as unknown as DB, actor, input));
}

export async function auditDenied(ctx: Ctx, err: AppError) {
  await audit(ctx, {
    action: "access.denied",
    entityType: String(err.details?.entityType ?? "permission"),
    entityId: (err.details?.entityId as string) ?? null,
    after: { message: err.message, ...err.details },
    outcome: "denied",
  });
}

/** Security events that are not tied to an actor context (e.g. failed logins). */
export async function auditSecurity(db: DB, input: AuditInput & { userId?: string | null; userName?: string | null; ip?: string | null }) {
  const actor: Who = { userId: input.userId ?? null, name: input.userName ?? "anonymous", ip: input.ip };
  await db.transaction(async (tx) => insert(tx as unknown as DB, actor, input));
}

/** Recomputes the hash chain. Returns the first broken event id, if any. */
export async function verifyAuditChain(db: DB): Promise<{ ok: boolean; checked: number; brokenAtId?: number }> {
  const rows = await db.select().from(auditEvents).orderBy(asc(auditEvents.id));
  let prev: string | null = null;
  for (const r of rows) {
    const body = {
      occurredAt: r.occurredAt.toISOString(),
      userId: r.userId,
      userName: r.userName,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      entityRef: r.entityRef,
      jobId: r.jobId,
      operationId: r.operationId,
      before: r.before,
      after: r.after,
      reason: r.reason,
      approvalId: r.approvalId,
      exceptionId: r.exceptionId,
      ipAddress: r.ipAddress,
      outcome: r.outcome,
    };
    if (r.prevHash !== prev || hashEvent(prev, body) !== r.hash) {
      return { ok: false, checked: rows.length, brokenAtId: r.id };
    }
    prev = r.hash;
  }
  return { ok: true, checked: rows.length };
}
