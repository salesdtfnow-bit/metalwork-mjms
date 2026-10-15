import { describe, expect, it } from "vitest";
import { createPgliteDb } from "@/server/db/client";
import { ensureBaseData } from "@/server/bootstrap";
import { seedDemo } from "@/server/demo/seed";
import { verifyAuditChain } from "@/server/audit";

describe("demo seed", () => {
  it("builds the demonstration workshop through the real services", async () => {
    const db = await createPgliteDb(undefined, { migrate: true });
    await ensureBaseData(db);
    const summary = await seedDemo(db, { password: "Workshop-Demo-2026!" });
    expect((summary as Record<string, number>).jobs).toBe(4);
    expect((await verifyAuditChain(db)).ok).toBe(true);
  }, 180_000);
});
