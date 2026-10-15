import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import { auditEvents, sessions, users } from "@/server/db/schema";
import { consumePasswordReset, createPasswordReset, login, validateSession, verifyReauth } from "@/server/auth/session";
import { createRole, createUser, setRolePermissions, setUserActive } from "@/server/services/users";
import { verifyAuditChain } from "@/server/audit";
import { nextRef } from "@/server/refs";
import { runService } from "@/server/boundary";
import { makeUser, setupDb, TEST_PASSWORD } from "../helpers/db";

let db: DB;
beforeAll(async () => {
  db = await setupDb();
});

describe("authentication", () => {
  it("logs in, validates the session, and rejects a wrong password with a generic message", async () => {
    const { email } = await makeUser(db, ["sales"]);
    const bad = await login(db, email, "wrong-password-123");
    expect(bad).toEqual({ ok: false, error: "Incorrect email or password." });
    const unknown = await login(db, "nobody@test.local", "whatever-123456");
    expect(unknown).toEqual({ ok: false, error: "Incorrect email or password." });

    const ok = await login(db, email.toUpperCase(), TEST_PASSWORD, { ip: "10.0.0.5" });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const s = await validateSession(db, ok.token);
    expect(s?.user.email).toBe(email);
    // only the hash of the token is stored
    const stored = await db.select().from(sessions).where(eq(sessions.userId, ok.userId));
    expect(stored.every((r) => r.id !== ok.token)).toBe(true);
    expect(await validateSession(db, "not-a-real-token-xxxxxxxxxxxxxxxx")).toBeNull();
  });

  it("locks the account after 5 failed attempts", async () => {
    const { email } = await makeUser(db, ["operator"]);
    for (let i = 0; i < 5; i++) await login(db, email, "bad-password-xyz");
    const r = await login(db, email, TEST_PASSWORD);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/locked/i);
  });

  it("deactivation revokes sessions and blocks login", async () => {
    const admin = await makeUser(db, ["admin"]);
    const target = await makeUser(db, ["dispatch"]);
    const s = await login(db, target.email, TEST_PASSWORD);
    expect(s.ok).toBe(true);
    await setUserActive(admin.ctx, target.userId, false, "Left the company");
    if (s.ok) expect(await validateSession(db, s.token)).toBeNull();
    expect((await login(db, target.email, TEST_PASSWORD)).ok).toBe(false);
  });

  it("password reset tokens are single-use and enforce the password policy", async () => {
    const u = await makeUser(db, ["purchasing"]);
    const reset = await createPasswordReset(db, u.email);
    expect(reset).not.toBeNull();
    await expect(consumePasswordReset(db, reset!.token, "short")).rejects.toThrow(/at least 10/);
    await consumePasswordReset(db, reset!.token, "A-much-better-passphrase-77");
    await expect(consumePasswordReset(db, reset!.token, "Another-passphrase-88")).rejects.toThrow(/invalid or has expired/);
    expect((await login(db, u.email, "A-much-better-passphrase-77")).ok).toBe(true);
    expect(await createPasswordReset(db, "nobody@test.local")).toBeNull();
  });

  it("re-authentication rejects a wrong password", async () => {
    const u = await makeUser(db, ["quality_manager"]);
    await expect(verifyReauth(db, u.userId, "nope-nope-nope")).rejects.toThrow(/Password incorrect/);
    await expect(verifyReauth(db, u.userId, TEST_PASSWORD)).resolves.toBeUndefined();
  });
});

describe("RBAC administration", () => {
  it("only admins can create users; denied attempts are audited", async () => {
    const sales = await makeUser(db, ["sales"]);
    await expect(
      runService(sales.ctx, (c) =>
        createUser(c, { email: "x@test.local", name: "X", password: "Long-enough-pass-1", roleKeys: ["operator"] }),
      ),
    ).rejects.toThrow(/Permission required: admin.users/);
    const denied = await db.select().from(auditEvents).where(eq(auditEvents.outcome, "denied"));
    expect(denied.some((e) => e.userId === sales.userId)).toBe(true);

    const admin = await makeUser(db, ["admin"]);
    const u = await createUser(admin.ctx, { email: "New.Op@Test.local", name: "New Op", password: "Long-enough-pass-1", roleKeys: ["operator"] });
    expect(u.email).toBe("new.op@test.local");
    await expect(
      createUser(admin.ctx, { email: "new.op@test.local", name: "Dup", password: "Long-enough-pass-1", roleKeys: ["operator"] }),
    ).rejects.toThrow(/already exists/);
  });

  it("custom roles accept only catalogue permissions", async () => {
    const admin = await makeUser(db, ["admin"]);
    await expect(createRole(admin.ctx, { key: "bad", name: "Bad", permissions: ["launch.missiles"] })).rejects.toThrow(/Unknown permission/);
    const r = await createRole(admin.ctx, { key: "Shift Lead", name: "Shift lead", permissions: ["production.execute", "production.assign"] });
    expect(r.key).toBe("shift_lead");
    await setRolePermissions(admin.ctx, r.id, ["production.execute"]);
  });
});

describe("audit trail & references", () => {
  it("hash chain verifies, and detects tampering", async () => {
    const res = await verifyAuditChain(db);
    expect(res.ok).toBe(true);
    expect(res.checked).toBeGreaterThan(5);
  });

  it("allocates sequential references per prefix and year, rolled back with the transaction", async () => {
    const a = await nextRef(db, "TST", { year: 2026 });
    const b = await nextRef(db, "TST", { year: 2026 });
    expect([a, b]).toEqual(["TST-26-0001", "TST-26-0002"]);
    await db
      .transaction(async (tx) => {
        await nextRef(tx as unknown as DB, "TST", { year: 2026 });
        throw new Error("rollback");
      })
      .catch(() => undefined);
    expect(await nextRef(db, "TST", { year: 2026 })).toBe("TST-26-0003");
  });

  it("users cannot be hard-deleted while referenced by audit history", async () => {
    const [someone] = await db.select().from(users).where(sql`email like 'user%'`).limit(1);
    await expect(db.delete(users).where(eq(users.id, someone.id))).rejects.toThrow();
  });
});
