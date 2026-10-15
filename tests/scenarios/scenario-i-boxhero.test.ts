/** Scenario I — BoxHero unavailable, duplicate requests, failed synchronisation, safe retries. */
import { beforeAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import { boxheroItems, integrationEvents, simulatedBoxheroTransactions, stockSyncTransactions } from "@/server/db/schema";
import { SimulatedInventoryAdapter } from "@/server/integrations/boxhero/simulated";
import { enqueueStockMovement, integrationStatus, processStockOutbox, retryStockMovement, confirmStockMovementManually, syncCatalogue } from "@/server/integrations/boxhero/sync";
import { mutate } from "@/server/context";
import { setupDb } from "../helpers/db";
import { team, type Team } from "../helpers/fixtures";

let db: DB;
let t: Team;
let itemId: string;
beforeAll(async () => {
  db = await setupDb();
  t = await team(db);
  const [item] = await db.insert(boxheroItems).values({ boxheroItemId: "5551", name: "EN24T bar Ø50", quantityTotal: "5", quantities: [{ location_id: "1", quantity: "5" }] }).returning();
  itemId = item.boxheroItemId;
});

const enqueue = (sourceId: string, qty = "-1") =>
  mutate(t.planner.ctx, (tx) => enqueueStockMovement(tx, { kind: "out", boxheroItemId: itemId, quantity: qty, locationId: "1", memo: "ISSUE test", sourceType: "material_transaction", sourceId }));

const simCount = async () => (await db.select().from(simulatedBoxheroTransactions).where(like(simulatedBoxheroTransactions.memo, "%ISSUE test%"))).length;

describe("Scenario I: BoxHero failure handling", () => {
  it("never queues the same business event twice", async () => {
    const id = crypto.randomUUID();
    const a = await enqueue(id);
    const b = await enqueue(id);
    expect(a.id).toBe(b.id);
    expect((await db.select().from(stockSyncTransactions).where(eq(stockSyncTransactions.sourceId, id))).length).toBe(1);
    await processStockOutbox(db, new SimulatedInventoryAdapter(db));
  });

  it("an outage is visible, retried later, and sent exactly once", async () => {
    const before = await simCount();
    const row = await enqueue(crypto.randomUUID());
    const down = new SimulatedInventoryAdapter(db, "unavailable");
    const r1 = await processStockOutbox(db, down, { ids: [row.id] });
    expect(r1.uncertain).toBe(1);
    const [s1] = await db.select().from(stockSyncTransactions).where(eq(stockSyncTransactions.id, row.id));
    expect(s1.status).toBe("needs_reconciliation");
    expect(s1.lastError).toMatch(/outage/);
    const status = await integrationStatus(t.purchasing.ctx);
    expect(status.problems.some((p) => p.id === row.id)).toBe(true);
    expect(status.state?.lastError).toMatch(/outage/);
    const events = await db.select().from(integrationEvents).where(eq(integrationEvents.status, "error"));
    expect(events.length).toBeGreaterThan(0);
    // BoxHero back: reconcile finds nothing, sends once
    await db.update(stockSyncTransactions).set({ nextAttemptAt: new Date(0) }).where(eq(stockSyncTransactions.id, row.id));
    const r2 = await processStockOutbox(db, new SimulatedInventoryAdapter(db), { ids: [row.id] });
    expect(r2.confirmed).toBe(1);
    expect(r2.reconciled).toBe(0);
    expect(await simCount()).toBe(before + 1);
  });

  it("a timeout AFTER BoxHero committed does not cause a duplicate stock movement", async () => {
    const before = await simCount();
    const row = await enqueue(crypto.randomUUID());
    const r1 = await processStockOutbox(db, new SimulatedInventoryAdapter(db, "timeout_after_commit"), { ids: [row.id] });
    expect(r1.uncertain).toBe(1);
    expect(await simCount()).toBe(before + 1); // committed in BoxHero despite the timeout
    await db.update(stockSyncTransactions).set({ nextAttemptAt: new Date(0) }).where(eq(stockSyncTransactions.id, row.id));
    const r2 = await processStockOutbox(db, new SimulatedInventoryAdapter(db), { ids: [row.id] });
    expect(r2.reconciled).toBe(1); // found by memo marker — NOT re-sent
    expect(await simCount()).toBe(before + 1);
    const [s] = await db.select().from(stockSyncTransactions).where(eq(stockSyncTransactions.id, row.id));
    expect(s.status).toBe("confirmed");
    expect(s.boxheroTxId).toMatch(/^SIM-/);
    // Processing again does nothing
    const r3 = await processStockOutbox(db, new SimulatedInventoryAdapter(db), { ids: [row.id] });
    expect(r3.confirmed).toBe(0);
  });

  it("definite rejections stop for a person, who can retry or confirm manually (audited)", async () => {
    const row = await enqueue(crypto.randomUUID());
    const r1 = await processStockOutbox(db, new SimulatedInventoryAdapter(db, "reject"), { ids: [row.id] });
    expect(r1.failed).toBe(1);
    await expect(retryStockMovement(t.opA.ctx, row.id)).rejects.toThrow(/boxhero.reconcile/);
    await retryStockMovement(t.purchasing.ctx, row.id);
    const r2 = await processStockOutbox(db, new SimulatedInventoryAdapter(db), { ids: [row.id] });
    expect(r2.confirmed).toBe(1);
    const row2 = await enqueue(crypto.randomUUID());
    await processStockOutbox(db, new SimulatedInventoryAdapter(db, "reject"), { ids: [row2.id] });
    await expect(confirmStockMovementManually(t.purchasing.ctx, row2.id, "", "x")).rejects.toThrow(/reference/);
    await confirmStockMovementManually(t.purchasing.ctx, row2.id, "BH-TX-9981", "Entered manually in BoxHero during outage");
    const [s] = await db.select().from(stockSyncTransactions).where(eq(stockSyncTransactions.id, row2.id));
    expect(s.status).toBe("manual_confirmed");
  });

  it("catalogue sync failure is recorded, not silent", async () => {
    const res = await syncCatalogue(db, new SimulatedInventoryAdapter(db, "unavailable"));
    expect(res.ok).toBe(false);
    const ok = await syncCatalogue(db, new SimulatedInventoryAdapter(db));
    expect(ok.ok).toBe(true);
  });
});
