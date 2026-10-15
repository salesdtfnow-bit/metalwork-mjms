/** Scenario J — backup and restore preserve critical relationships and the audit history. */
import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createPgliteDb, queryRows, type DB } from "@/server/db/client";
import { auditEvents, jobs, materialLots } from "@/server/db/schema";
import { exportAll, importAll, verifyRestore } from "@/server/backup";
import { verifyAuditChain } from "@/server/audit";
import { jobTrace } from "@/server/services/traceability";
import { loadActor } from "@/server/auth/session";
import { setupDb } from "../helpers/db";
import { team, type Team } from "../helpers/fixtures";
import { issue, materialFor, plannedJob, releaseAndAssign, runOperation } from "../helpers/flow";

let db: DB;
let t: Team;
let jobId: string;
beforeAll(async () => {
  db = await setupDb();
  t = await team(db);
  const p = await plannedJob(db, t, { qty: "10" });
  await releaseAndAssign(t, p);
  const m = await materialFor(db, t, p, "H-J1");
  await issue(db, t, p.job.id, m.lot.id, "1", "issue-J-1", m.inv);
  await runOperation(db, t, t.opA, p.op10.id, p, p.millProg.rev.id, "10", m.lot.id);
  jobId = p.job.id;
});

describe("Scenario J: backup and restore", () => {
  it("restores into a fresh database with identical data, intact relationships and a valid audit chain", async () => {
    const before = await jobTrace(t.auditor.ctx, jobId);
    const backup = JSON.parse(JSON.stringify(await exportAll(db))); // simulate writing to and reading from a file
    expect(backup.manifest.find((m: { table: string }) => m.table === "audit_events").rows).toBeGreaterThan(50);

    const restored = await createPgliteDb(undefined, { migrate: true });
    const res = await importAll(restored, backup);
    expect(res.deferred.length).toBeGreaterThan(0); // reference cycles were handled
    const check = await verifyRestore(restored, backup);
    expect(check.problems).toEqual([]);
    expect(check.ok).toBe(true);

    // Relationships survive: the same traceability record is produced from the restored data
    const auditor = (await loadActor(restored, t.auditor.userId))!;
    const after = await jobTrace({ db: restored, actor: auditor }, jobId);
    expect(after.job.jobNumber).toBe(before.job.jobNumber);
    expect(after.materials.lots.map((l) => l.lot.heatNumber)).toEqual(before.materials.lots.map((l) => l.lot.heatNumber));
    expect(after.operations.map((o) => o.runs.length)).toEqual(before.operations.map((o) => o.runs.length));
    expect(after.quote?.rev.id).toBe(before.quote?.rev.id);
    expect(after.gaps).toEqual(before.gaps);

    // Audit trail restored, append-only protection and hash chain intact
    const chain = await verifyAuditChain(restored);
    expect(chain.ok).toBe(true);
    const [{ n }] = await queryRows<{ n: number }>(restored, sql`select count(*)::int as n from audit_events`);
    expect(n).toBe(backup.manifest.find((m: { table: string }) => m.table === "audit_events").rows);
    await expect(restored.execute(sql`delete from audit_events`)).rejects.toThrow();
    // New events continue the chain after restore
    const { audit } = await import("@/server/audit");
    await audit({ db: restored, actor: auditor }, { action: "restore.verified", entityType: "system" });
    expect((await verifyAuditChain(restored)).ok).toBe(true);
    expect((await restored.select().from(jobs).where(eq(jobs.id, jobId))).length).toBe(1);
    expect((await restored.select().from(materialLots)).length).toBe((await db.select().from(materialLots)).length);
  });

  it("refuses a tampered backup and a non-empty target", async () => {
    const backup = await exportAll(db);
    const tampered = JSON.parse(JSON.stringify(backup));
    (tampered.tables.jobs[0] as { title: string }).title = "changed";
    const fresh = await createPgliteDb(undefined, { migrate: true });
    await expect(importAll(fresh, tampered)).rejects.toThrow(/checksum mismatch/);
    await expect(importAll(db, backup)).rejects.toThrow(/not empty/);
    expect((await db.select().from(auditEvents)).length).toBeGreaterThan(0);
  });
});
