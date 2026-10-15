/**
 * Deployment-time provisioning, run by scripts/migrate.ts during the build:
 *   - resetting a demonstration database before go-live (guarded: refuses any database holding real users),
 *   - creating the first administrator from environment variables set in the hosting dashboard,
 *   - deciding whether the demo seed may run.
 * Credentials never live in source control or chat: the owner sets them as environment variables.
 */
import { eq, sql } from "drizzle-orm";
import type { DB } from "./db/client";
import { queryRows } from "./db/client";
import { users } from "./db/schema";
import { SYSTEM_USER_EMAIL } from "./bootstrap";
import { systemCtx } from "./jobs/scheduled";
import { createUser } from "./services/users";

export const DEMO_EMAIL_DOMAIN = "@demo.test";

/** Accounts other than the internal system user and the fictitious demo users. */
async function realUserCount(db: DB): Promise<number> {
  const [{ n }] = await queryRows<{ n: number }>(
    db,
    sql`select count(*)::int as n from users where email <> ${SYSTEM_USER_EMAIL} and email not like ${"%" + DEMO_EMAIL_DOMAIN}`,
  );
  return n;
}

async function hasSchema(db: DB): Promise<boolean> {
  const [{ t }] = await queryRows<{ t: string | null }>(db, sql`select to_regclass('public.company_settings')::text as t`);
  return !!t;
}

/**
 * A database may be wiped only while it is plainly a demonstration: flagged as demo and holding no
 * accounts except the system user and @demo.test users. Anything else is treated as real records.
 */
export async function demoResetCheck(db: DB): Promise<{ allowed: boolean; reason: string }> {
  if (!(await hasSchema(db))) return { allowed: false, reason: "database is empty — nothing to reset" };
  const [s] = await queryRows<{ is_demo: boolean }>(db, sql`select is_demo from company_settings where id = 1`);
  if (!s?.is_demo) return { allowed: false, reason: "database is not flagged as a demonstration" };
  const real = await realUserCount(db);
  if (real > 0) return { allowed: false, reason: `database has ${real} non-demo user account(s)` };
  return { allowed: true, reason: "demonstration database" };
}

/**
 * Drops every MJMS table, the append-only audit trail included (the triggers that protect it are
 * dropped with it), and the migration journal. The caller re-runs migrations and base data.
 * Only call after demoResetCheck() allowed it.
 */
export async function dropDemoDatabase(db: DB) {
  await db.execute(sql`drop schema public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
}

/** The demo seed runs only on a database with no customers and no real accounts. */
export async function demoSeedAllowed(db: DB): Promise<{ allowed: boolean; reason: string }> {
  const real = await realUserCount(db);
  if (real > 0) return { allowed: false, reason: "real user accounts exist" };
  const [{ n }] = await queryRows<{ n: number }>(db, sql`select count(*)::int as n from customers`);
  if (n > 0) return { allowed: false, reason: "data already present" };
  return { allowed: true, reason: "empty database" };
}

/**
 * Creates the first administrator if no account with that email exists. Never changes an existing
 * account, so leaving the variables set cannot reset a password on later builds. The account must
 * change its password at first sign-in, and creation is recorded in the audit trail.
 */
export async function provisionAdmin(db: DB, input: { email: string; name: string; password: string }): Promise<"created" | "exists"> {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return "exists";
  await createUser(await systemCtx(db), { email, name: input.name, password: input.password, roleKeys: ["admin"], mustChangePassword: true });
  return "created";
}
