/**
 * Bootstraps base data and creates (or resets) an administrator account.
 *   ADMIN_EMAIL=you@company.co.uk ADMIN_PASSWORD='long passphrase' npx tsx scripts/create-admin.ts
 * The password must satisfy the policy; the account is flagged to change it at first login.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb } from "../src/server/db/client";
import { ensureBaseData } from "../src/server/bootstrap";
import { roles, userRoles, users } from "../src/server/db/schema";
import { hashPassword, passwordPolicyError } from "../src/server/auth/password";

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD");
  const err = passwordPolicyError(password, email);
  if (err) throw new Error(err);
  const db = await getDb();
  await ensureBaseData(db);
  const hash = await hashPassword(password);
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  const userId =
    existing?.id ??
    (await db.insert(users).values({ email, name: process.env.ADMIN_NAME ?? "Administrator", passwordHash: hash, mustChangePassword: true }).returning())[0].id;
  if (existing) await db.update(users).set({ passwordHash: hash, isActive: true, failedLoginCount: 0, lockedUntil: null, mustChangePassword: true }).where(eq(users.id, userId));
  const [admin] = await db.select().from(roles).where(eq(roles.key, "admin"));
  await db.insert(userRoles).values({ userId, roleId: admin.id }).onConflictDoNothing();
  console.log(`Administrator ready: ${email} (must change password at first sign-in)`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
