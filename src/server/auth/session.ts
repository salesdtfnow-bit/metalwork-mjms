import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { passwordResetTokens, rolePermissions, roles, sessions, userRoles, users } from "../db/schema";
import { auditSecurity } from "../audit";
import type { Actor } from "../context";
import { hashPassword, newToken, passwordPolicyError, sha256, verifyPassword } from "./password";
import { AppError } from "../errors";

const hours = (h: number) => h * 3_600_000;
export const SESSION_IDLE_MS = hours(Number(process.env.SESSION_IDLE_HOURS ?? 12));
export const SESSION_ABSOLUTE_MS = hours(Number(process.env.SESSION_ABSOLUTE_HOURS ?? 24 * 7));
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60_000;
const RESET_TTL_MS = 60 * 60_000;

export type LoginMeta = { ip?: string | null; userAgent?: string | null };

export async function createSession(db: DB, userId: string, meta: LoginMeta = {}) {
  const { token, hash } = newToken(32);
  const now = Date.now();
  await db.insert(sessions).values({
    id: hash,
    userId,
    expiresAt: new Date(now + SESSION_ABSOLUTE_MS),
    lastSeenAt: new Date(now),
    ipAddress: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt: new Date(now + SESSION_ABSOLUTE_MS) };
}

/**
 * Validates a raw session token. Returns null if missing, revoked, expired (absolute
 * or idle) or the user is inactive. Slides lastSeenAt at most once a minute.
 */
export async function validateSession(db: DB, token: string | undefined | null) {
  if (!token || token.length < 20) return null;
  const id = sha256(token);
  const [row] = await db
    .select({ s: sessions, u: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
    .limit(1);
  if (!row) return null;
  const now = Date.now();
  if (row.s.expiresAt.getTime() <= now || row.s.lastSeenAt.getTime() + SESSION_IDLE_MS <= now || !row.u.isActive) {
    if (!row.s.revokedAt) await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, id));
    return null;
  }
  if (now - row.s.lastSeenAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeenAt: new Date(now) }).where(eq(sessions.id, id));
  }
  return { session: row.s, user: row.u };
}

export async function revokeSession(db: DB, token: string) {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sha256(token)));
}

export async function revokeAllSessions(db: DB, userId: string) {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/** Loads roles + permissions for a user into an Actor. */
export async function loadActor(db: DB, userId: string, extra: { sessionId?: string; ip?: string } = {}): Promise<Actor | null> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u || !u.isActive) return null;
  const roleRows = await db
    .select({ key: roles.key, id: roles.id })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
  const perms = roleRows.length
    ? await db
        .select({ p: rolePermissions.permission })
        .from(rolePermissions)
        .where(inArray(rolePermissions.roleId, roleRows.map((r) => r.id)))
    : [];
  return {
    userId: u.id,
    name: u.name,
    email: u.email,
    employeeId: u.employeeId,
    roles: roleRows.map((r) => r.key),
    permissions: new Set(perms.map((p) => p.p)),
    sessionId: extra.sessionId,
    ip: extra.ip,
  };
}

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; userId: string; mustChangePassword: boolean }
  | { ok: false; error: string };

const GENERIC = "Incorrect email or password.";

export async function login(db: DB, emailRaw: string, password: string, meta: LoginMeta = {}): Promise<LoginResult> {
  const email = emailRaw.trim().toLowerCase();
  const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const valid = await verifyPassword(password, u?.passwordHash);
  if (!u) {
    await auditSecurity(db, { action: "auth.login_failed", entityType: "user", after: { email }, outcome: "failed", ip: meta.ip });
    return { ok: false, error: GENERIC };
  }
  if (u.lockedUntil && u.lockedUntil.getTime() > Date.now()) {
    await auditSecurity(db, { action: "auth.login_locked", entityType: "user", entityId: u.id, userId: u.id, userName: u.name, outcome: "denied", ip: meta.ip });
    return { ok: false, error: "Account temporarily locked after repeated failed attempts. Try again later or contact an administrator." };
  }
  if (!valid || !u.isActive) {
    const failed = u.failedLoginCount + 1;
    await db
      .update(users)
      .set({ failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MS) : null })
      .where(eq(users.id, u.id));
    await auditSecurity(db, {
      action: u.isActive ? "auth.login_failed" : "auth.login_inactive",
      entityType: "user",
      entityId: u.id,
      userId: u.id,
      userName: u.name,
      outcome: "failed",
      after: { failedCount: failed },
      ip: meta.ip,
    });
    return { ok: false, error: GENERIC };
  }
  await db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, u.id));
  const s = await createSession(db, u.id, meta);
  await auditSecurity(db, { action: "auth.login", entityType: "user", entityId: u.id, userId: u.id, userName: u.name, ip: meta.ip });
  return { ok: true, token: s.token, expiresAt: s.expiresAt, userId: u.id, mustChangePassword: u.mustChangePassword };
}

/** Re-authentication for critical approvals: the user re-enters their own password. */
export async function verifyReauth(db: DB, userId: string, password: string | undefined | null): Promise<void> {
  if (!password) throw new AppError("Re-enter your password to sign this approval.", "validation", { field: "password" });
  const [u] = await db.select({ h: users.passwordHash, name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  const ok = await verifyPassword(password, u?.h);
  if (!ok) {
    await auditSecurity(db, { action: "auth.reauth_failed", entityType: "user", entityId: userId, userId, userName: u?.name, outcome: "failed" }).catch(() => undefined);
    throw new AppError("Password incorrect — approval not recorded.", "forbidden", { field: "password", entityType: "approval" });
  }
}

export async function setPassword(db: DB, userId: string, newPassword: string, email?: string) {
  const err = passwordPolicyError(newPassword, email);
  if (err) throw new AppError(err, "validation", { field: "password" });
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), mustChangePassword: false, failedLoginCount: 0, lockedUntil: null })
    .where(eq(users.id, userId));
  await revokeAllSessions(db, userId);
}

/** Creates a reset token. Always behaves the same whether or not the email exists. */
export async function createPasswordReset(db: DB, emailRaw: string): Promise<{ token: string; userId: string; email: string; name: string } | null> {
  const email = emailRaw.trim().toLowerCase();
  const [u] = await db.select().from(users).where(and(eq(users.email, email), eq(users.isActive, true))).limit(1);
  if (!u) return null;
  const { token, hash } = newToken(32);
  await db.insert(passwordResetTokens).values({ id: hash, userId: u.id, expiresAt: new Date(Date.now() + RESET_TTL_MS) });
  await auditSecurity(db, { action: "auth.password_reset_requested", entityType: "user", entityId: u.id, userId: u.id, userName: u.name });
  return { token, userId: u.id, email: u.email, name: u.name };
}

export async function consumePasswordReset(db: DB, token: string, newPassword: string) {
  const id = sha256(token);
  const [t] = await db
    .select()
    .from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.id, id), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, sql`now()`)))
    .limit(1);
  if (!t) throw new AppError("This reset link is invalid or has expired.", "validation");
  const [u] = await db.select().from(users).where(eq(users.id, t.userId)).limit(1);
  await setPassword(db, t.userId, newPassword, u?.email);
  await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, id));
  await auditSecurity(db, { action: "auth.password_reset_completed", entityType: "user", entityId: t.userId, userId: t.userId, userName: u?.name });
}
