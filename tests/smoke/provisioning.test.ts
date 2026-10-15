import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createPgliteDb, migrationsFolder, queryRows, type DB } from "@/server/db/client";
import { ensureBaseData } from "@/server/bootstrap";
import { seedDemo } from "@/server/demo/seed";
import { verifyAuditChain } from "@/server/audit";
import { roles, userRoles, users } from "@/server/db/schema";
import { demoResetCheck, demoSeedAllowed, dropDemoDatabase, provisionAdmin } from "@/server/provisioning";

const count = async (db: DB, table: string) =>
  (await queryRows<{ n: number }>(db, sql.raw(`select count(*)::int as n from ${table}`)))[0].n;

describe("go-live provisioning", () => {
  it("resets a demo database, creates the first administrator, and then refuses to reset or re-seed", async () => {
    const db = await createPgliteDb(undefined, { migrate: true });
    await ensureBaseData(db);
    await seedDemo(db, { password: "Workshop-Demo-2026!" });
    expect(await count(db, "customers")).toBeGreaterThan(0);

    expect((await demoResetCheck(db)).allowed).toBe(true);
    await dropDemoDatabase(db);
    await migrate(db as never, { migrationsFolder: migrationsFolder() });
    await ensureBaseData(db);

    for (const t of ["customers", "suppliers", "jobs", "machines", "enquiries", "audit_events", "approvals"]) {
      expect(await count(db, t), t).toBe(0);
    }
    expect(await count(db, "users")).toBe(1); // the internal system user only
    const [s] = await queryRows<{ is_demo: boolean }>(db, sql`select is_demo from company_settings`);
    expect(s.is_demo).toBe(false);

    const admin = { email: "Owner@Example.test", name: "Workshop Owner", password: "Lathe-Spindle-Turret-91" };
    expect(await provisionAdmin(db, admin)).toBe("created");
    expect(await provisionAdmin(db, { ...admin, password: "Another-Long-Passphrase-77" })).toBe("exists");

    const [u] = await db.select().from(users).where(eq(users.email, "owner@example.test"));
    expect(u.mustChangePassword).toBe(true);
    expect(u.isActive).toBe(true);
    const roleKeys = (await db.select({ key: roles.key }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, u.id))).map((r) => r.key);
    expect(roleKeys).toEqual(["admin"]);
    expect(await count(db, "audit_events")).toBeGreaterThan(0);
    expect((await verifyAuditChain(db)).ok).toBe(true);

    expect(await demoResetCheck(db)).toMatchObject({ allowed: false });
    expect(await demoSeedAllowed(db)).toMatchObject({ allowed: false });
  }, 180_000);

  it("refuses to reset a database that is not flagged as a demonstration", async () => {
    const db = await createPgliteDb(undefined, { migrate: true });
    await ensureBaseData(db);
    expect(await demoResetCheck(db)).toMatchObject({ allowed: false, reason: "database is not flagged as a demonstration" });
  });

  it("rejects an administrator password that fails the policy", async () => {
    const db = await createPgliteDb(undefined, { migrate: true });
    await ensureBaseData(db);
    await expect(provisionAdmin(db, { email: "owner@example.test", name: "Owner", password: "short" })).rejects.toThrow();
    expect(await count(db, "users")).toBe(1);
  });
});
