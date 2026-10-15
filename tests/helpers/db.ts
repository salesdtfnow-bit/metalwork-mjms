import { eq } from "drizzle-orm";
import { createPgliteDb, type DB } from "@/server/db/client";
import { ensureBaseData, getSystemUserId } from "@/server/bootstrap";
import { employees, roles, userRoles, users } from "@/server/db/schema";
import { hashPassword } from "@/server/auth/password";
import { loadActor } from "@/server/auth/session";
import type { Actor, Ctx } from "@/server/context";

export const TEST_PASSWORD = "Workshop-Test-Pass-2026";
let pwHash: string | undefined;

export async function setupDb(): Promise<DB> {
  const db = await createPgliteDb(undefined, { migrate: true });
  await ensureBaseData(db);
  return db;
}

let seq = 0;

/** Creates an active user (and optionally an employee record) holding the given system roles. */
export async function makeUser(
  db: DB,
  roleKeys: string[],
  opts: { name?: string; email?: string; employee?: boolean } = {},
): Promise<{ actor: Actor; ctx: Ctx; userId: string; employeeId: string | null; email: string }> {
  seq++;
  pwHash ??= await hashPassword(TEST_PASSWORD);
  const name = opts.name ?? `${roleKeys.join("+")} user ${seq}`;
  const email = opts.email ?? `user${seq}.${roleKeys[0]}@test.local`;
  let employeeId: string | null = null;
  if (opts.employee ?? roleKeys.includes("operator")) {
    const [e] = await db
      .insert(employees)
      .values({ employeeNo: `E${1000 + seq}`, firstName: name.split(" ")[0], lastName: `T${seq}` })
      .returning();
    employeeId = e.id;
  }
  const [u] = await db.insert(users).values({ email, name, passwordHash: pwHash, employeeId }).returning();
  for (const key of roleKeys) {
    const [r] = await db.select().from(roles).where(eq(roles.key, key));
    if (!r) throw new Error(`unknown role ${key}`);
    await db.insert(userRoles).values({ userId: u.id, roleId: r.id });
  }
  const actor = (await loadActor(db, u.id))!;
  return { actor, ctx: { db, actor }, userId: u.id, employeeId, email };
}

export async function systemCtx(db: DB): Promise<Ctx> {
  const id = await getSystemUserId(db);
  return {
    db,
    actor: { userId: id, name: "System", email: "system", employeeId: null, roles: ["system"], permissions: new Set(), isSystem: true },
  };
}
