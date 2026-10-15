import { PgTransaction } from "drizzle-orm/pg-core";
import type { DB } from "./db/client";
import type { Permission } from "./auth/permissions";
import { AppError, forbidden } from "./errors";

export type Actor = {
  userId: string;
  name: string;
  email: string;
  employeeId: string | null;
  roles: string[];
  permissions: ReadonlySet<string>;
  sessionId?: string;
  ip?: string;
  isSystem?: boolean;
};

/** Execution context passed to every service call. */
export type Ctx = {
  db: DB;
  actor: Actor;
  /** Injected clock (tests can freeze time). */
  now?: () => Date;
};

export const now = (ctx: Ctx) => (ctx.now ? ctx.now() : new Date());

export function can(actor: Actor, permission: Permission): boolean {
  return actor.permissions.has(permission);
}

export function canAny(actor: Actor, ...permissions: Permission[]): boolean {
  return permissions.some((p) => actor.permissions.has(p));
}

/** Throws a `forbidden` AppError (audited as a denied attempt by `runService`). */
export function requirePermission(ctx: Ctx, permission: Permission, target?: { entityType?: string; entityId?: string }) {
  if (!ctx.actor.permissions.has(permission)) {
    throw new AppError(`Permission required: ${permission}`, "forbidden", { permission, ...target });
  }
}

export function requireAnyPermission(ctx: Ctx, ...permissions: Permission[]) {
  if (!permissions.some((p) => ctx.actor.permissions.has(p))) {
    throw new AppError(`Permission required: one of ${permissions.join(", ")}`, "forbidden", { permissions });
  }
}

export function isInTransaction(db: DB): boolean {
  return db instanceof PgTransaction;
}

/**
 * Runs a mutating service body in one transaction. Permission denials are audited at the
 * request boundary (see `runService` in boundary.ts), after any rollback, so none are lost.
 */
export async function mutate<T>(ctx: Ctx, fn: (tx: Ctx) => Promise<T>): Promise<T> {
  return ctx.db.transaction(async (tx) => fn({ ...ctx, db: tx as unknown as DB }));
}

export { forbidden };
