import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { DB } from "../../db/client";
import { boxheroItems, boxheroLocations, integrationEvents, integrationState, stockSyncTransactions } from "../../db/schema";
import type { Ctx } from "../../context";
import { mutate, requirePermission } from "../../context";
import { audit } from "../../audit";
import { invalid, notFound } from "../../errors";
import { getSettings } from "../../services/settings";
import { BoxHeroApiAdapter } from "./api";
import { ManualInventoryAdapter, SimulatedInventoryAdapter } from "./simulated";
import { InventoryDefiniteError, InventoryManualRequired, InventoryUncertainError, type InventoryAdapter, type InvTxType } from "./types";

/** Picks the adapter from settings/env. Secrets come only from environment variables. */
export async function getInventoryAdapter(db: DB): Promise<InventoryAdapter> {
  const settings = await getSettings(db);
  const mode = (process.env.BOXHERO_MODE as string | undefined) ?? settings.boxheroMode;
  if (mode === "api") {
    const token = process.env.BOXHERO_API_TOKEN;
    if (!token) return new SimulatedInventoryAdapter(db, "unavailable"); // misconfigured → visible failure, never silent success
    return new BoxHeroApiAdapter(token);
  }
  if (mode === "manual") return new ManualInventoryAdapter(db);
  return new SimulatedInventoryAdapter(db);
}

export function markerFor(key: string) {
  return `[MJMS:${key}]`;
}

/**
 * Queues a stock movement in the SAME transaction as the business event. The idempotency key
 * is derived from the source record, so the same event can never be queued twice.
 */
export async function enqueueStockMovement(
  ctx: Ctx,
  input: { kind: InvTxType; boxheroItemId: string; quantity: string; locationId?: string | null; fromLocationId?: string | null; memo: string; sourceType: string; sourceId: string; jobId?: string | null },
) {
  const key = `${input.sourceType}:${input.sourceId}:${input.kind}`;
  const settings = await getSettings(ctx.db);
  const mode = (process.env.BOXHERO_MODE as string | undefined) ?? settings.boxheroMode;
  const [row] = await ctx.db
    .insert(stockSyncTransactions)
    .values({
      idempotencyKey: key,
      kind: input.kind,
      boxheroItemId: input.boxheroItemId,
      locationId: input.locationId ?? null,
      fromLocationId: input.fromLocationId ?? null,
      quantity: input.quantity,
      memo: `${input.memo} ${markerFor(key)}`.slice(0, 2000),
      mode,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      jobId: input.jobId ?? null,
      createdBy: ctx.actor.userId,
    })
    .onConflictDoNothing({ target: stockSyncTransactions.idempotencyKey })
    .returning();
  if (row) return row;
  const [existing] = await ctx.db.select().from(stockSyncTransactions).where(eq(stockSyncTransactions.idempotencyKey, key));
  return existing;
}

async function logEvent(db: DB, status: "success" | "error" | "warning", action: string, message: string, detail?: Record<string, unknown>) {
  await db.insert(integrationEvents).values({ integration: "boxhero", direction: "outbound", action, status, message: message.slice(0, 1000), detail: detail ?? null });
  await db
    .insert(integrationState)
    .values({ key: "boxhero", ...(status === "success" ? { lastSuccessAt: new Date() } : { lastErrorAt: new Date(), lastError: message.slice(0, 1000) }) })
    .onConflictDoUpdate({
      target: integrationState.key,
      set: status === "success" ? { lastSuccessAt: new Date() } : { lastErrorAt: new Date(), lastError: message.slice(0, 1000) },
    });
}

const MAX_ATTEMPTS = 8;

/**
 * Sends queued movements. Guarantees:
 *  - a row is claimed with a conditional update before sending (no concurrent double send);
 *  - after any uncertain outcome, BoxHero is searched for our memo marker BEFORE re-sending;
 *  - definite failures stop and surface an error for a person to resolve.
 */
export async function processStockOutbox(db: DB, adapter?: InventoryAdapter, opts: { limit?: number; ids?: string[] } = {}) {
  const inv = adapter ?? (await getInventoryAdapter(db));
  const due = await db
    .select()
    .from(stockSyncTransactions)
    .where(
      and(
        inArray(stockSyncTransactions.status, ["pending", "needs_reconciliation"]),
        lte(stockSyncTransactions.nextAttemptAt, new Date()),
        opts.ids?.length ? inArray(stockSyncTransactions.id, opts.ids) : undefined,
      ),
    )
    .limit(opts.limit ?? 25);
  const result = { confirmed: 0, failed: 0, uncertain: 0, manual: 0, reconciled: 0 };
  for (const row of due) {
    const claimed = await db
      .update(stockSyncTransactions)
      .set({ status: "sending", attempts: sql`${stockSyncTransactions.attempts} + 1`, sentAt: new Date() })
      .where(and(eq(stockSyncTransactions.id, row.id), eq(stockSyncTransactions.status, row.status), eq(stockSyncTransactions.attempts, row.attempts)))
      .returning();
    if (!claimed.length) continue;
    const marker = markerFor(row.idempotencyKey);
    try {
      if (row.status === "needs_reconciliation" || row.attempts > 0) {
        const found = await inv.findTransactionByMarker(marker);
        if (found) {
          await db.update(stockSyncTransactions).set({ status: "confirmed", boxheroTxId: found.id, confirmedAt: new Date(), lastError: null }).where(eq(stockSyncTransactions.id, row.id));
          await logEvent(db, "success", "reconcile", `Found existing BoxHero transaction ${found.id} for ${row.idempotencyKey} — not re-sent.`, { id: row.id });
          result.reconciled++;
          result.confirmed++;
          continue;
        }
      }
      const res = await inv.createTransaction({ type: row.kind as InvTxType, itemId: row.boxheroItemId, quantity: row.quantity, locationId: row.locationId, fromLocationId: row.fromLocationId, memo: row.memo });
      await db.update(stockSyncTransactions).set({ status: "confirmed", boxheroTxId: res.id, confirmedAt: new Date(), lastError: null }).where(eq(stockSyncTransactions.id, row.id));
      await logEvent(db, "success", `tx_${row.kind}`, `BoxHero transaction ${res.id} recorded (${row.kind} ${row.quantity}).`, { id: row.id });
      result.confirmed++;
    } catch (e) {
      const msg = (e as Error).message;
      if (e instanceof InventoryManualRequired) {
        await db.update(stockSyncTransactions).set({ status: "pending", lastError: msg, nextAttemptAt: new Date(Date.now() + 365 * 86_400_000) }).where(eq(stockSyncTransactions.id, row.id));
        result.manual++;
      } else if (e instanceof InventoryDefiniteError) {
        await db.update(stockSyncTransactions).set({ status: "failed", lastError: msg }).where(eq(stockSyncTransactions.id, row.id));
        await logEvent(db, "error", `tx_${row.kind}`, msg, { id: row.id, key: row.idempotencyKey });
        result.failed++;
      } else {
        const attempts = row.attempts + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        await db
          .update(stockSyncTransactions)
          .set({
            status: giveUp ? "failed" : "needs_reconciliation",
            lastError: e instanceof InventoryUncertainError ? msg : `Unexpected: ${msg}`,
            nextAttemptAt: new Date(Date.now() + Math.min(2 ** attempts, 60) * 60_000),
          })
          .where(eq(stockSyncTransactions.id, row.id));
        await logEvent(db, "error", `tx_${row.kind}`, `${msg} — will reconcile before retrying.`, { id: row.id, key: row.idempotencyKey, attempts });
        result.uncertain++;
      }
    }
  }
  return result;
}

/** Re-queues a failed movement (after the cause has been fixed). Reconciliation still runs first. */
export async function retryStockMovement(ctx: Ctx, id: string) {
  requirePermission(ctx, "boxhero.reconcile");
  return mutate(ctx, async (tx) => {
    const [row] = await tx.db.select().from(stockSyncTransactions).where(eq(stockSyncTransactions.id, id)).limit(1);
    if (!row) throw notFound("Stock movement");
    if (!["failed", "needs_reconciliation"].includes(row.status)) throw invalid(`Movement is ${row.status}.`);
    await tx.db.update(stockSyncTransactions).set({ status: "needs_reconciliation", nextAttemptAt: new Date() }).where(eq(stockSyncTransactions.id, id));
    await audit(tx, { action: "boxhero.retry", entityType: "stock_sync", entityId: id, entityRef: row.idempotencyKey, jobId: row.jobId });
  });
}

/** A person confirms the movement was made in BoxHero (manual mode or after an outage). */
export async function confirmStockMovementManually(ctx: Ctx, id: string, boxheroReference: string, note: string) {
  requirePermission(ctx, "boxhero.reconcile");
  if (!boxheroReference?.trim()) throw invalid("Enter the BoxHero transaction reference.", { field: "reference" });
  return mutate(ctx, async (tx) => {
    const [row] = await tx.db.select().from(stockSyncTransactions).where(eq(stockSyncTransactions.id, id)).limit(1);
    if (!row) throw notFound("Stock movement");
    if (["confirmed", "manual_confirmed", "cancelled"].includes(row.status)) throw invalid(`Movement is already ${row.status}.`);
    await tx.db.update(stockSyncTransactions).set({ status: "manual_confirmed", boxheroTxId: boxheroReference.trim(), confirmedAt: new Date(), lastError: null }).where(eq(stockSyncTransactions.id, id));
    await audit(tx, { action: "boxhero.manual_confirm", entityType: "stock_sync", entityId: id, entityRef: row.idempotencyKey, jobId: row.jobId, after: { boxheroReference }, reason: note });
  });
}

/** Cancels a movement that must not be sent (e.g. the source record was reversed). */
export async function cancelStockMovement(ctx: Ctx, id: string, reason: string) {
  requirePermission(ctx, "boxhero.reconcile");
  if (!reason?.trim()) throw invalid("A reason is required.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const [row] = await tx.db.select().from(stockSyncTransactions).where(eq(stockSyncTransactions.id, id)).limit(1);
    if (!row) throw notFound("Stock movement");
    if (["confirmed", "manual_confirmed"].includes(row.status)) throw invalid("Confirmed movements cannot be cancelled — record a reversing movement instead.");
    await tx.db.update(stockSyncTransactions).set({ status: "cancelled", lastError: reason }).where(eq(stockSyncTransactions.id, id));
    await audit(tx, { action: "boxhero.cancel", entityType: "stock_sync", entityId: id, entityRef: row.idempotencyKey, jobId: row.jobId, reason });
  });
}

/** Refreshes the local item/location cache (BoxHero offers no text search, so search runs locally). */
export async function syncCatalogue(db: DB, adapter?: InventoryAdapter) {
  const inv = adapter ?? (await getInventoryAdapter(db));
  try {
    let cursor: string | null = null;
    let count = 0;
    for (let page = 0; page < 200; page++) {
      const r = await inv.listItems(cursor);
      for (const it of r.items) {
        await db
          .insert(boxheroItems)
          .values({ boxheroItemId: it.id, name: it.name, sku: it.sku, barcode: it.barcode, cost: it.cost, quantityTotal: it.quantity, quantities: it.quantities, attrs: it.attrs, deleted: false, lastSyncedAt: new Date() })
          .onConflictDoUpdate({
            target: boxheroItems.boxheroItemId,
            set: { name: it.name, sku: it.sku, barcode: it.barcode, cost: it.cost, quantityTotal: it.quantity, quantities: it.quantities, attrs: it.attrs, deleted: false, lastSyncedAt: new Date() },
          });
        count++;
      }
      if (!r.hasMore) break;
      cursor = r.cursor;
    }
    const locs = await inv.listLocations();
    for (const l of locs) {
      await db.insert(boxheroLocations).values({ boxheroLocationId: l.id, name: l.name }).onConflictDoUpdate({ target: boxheroLocations.boxheroLocationId, set: { name: l.name, lastSyncedAt: new Date() } });
    }
    await logEvent(db, "success", "catalogue_sync", `Synchronised ${count} items and ${locs.length} locations (${inv.label}).`);
    return { ok: true as const, items: count, locations: locs.length };
  } catch (e) {
    await logEvent(db, "error", "catalogue_sync", `Catalogue sync failed: ${(e as Error).message}`);
    return { ok: false as const, error: (e as Error).message };
  }
}

export async function integrationStatus(ctx: Ctx) {
  if (!ctx.actor.permissions.has("boxhero.view") && !ctx.actor.permissions.has("integrations.view")) requirePermission(ctx, "boxhero.view");
  const inv = await getInventoryAdapter(ctx.db);
  const [state] = await ctx.db.select().from(integrationState).where(eq(integrationState.key, "boxhero"));
  const counts = await ctx.db
    .select({ status: stockSyncTransactions.status, n: sql<number>`count(*)::int` })
    .from(stockSyncTransactions)
    .groupBy(stockSyncTransactions.status);
  const problems = await ctx.db
    .select()
    .from(stockSyncTransactions)
    .where(inArray(stockSyncTransactions.status, ["failed", "needs_reconciliation", "pending", "sending"]))
    .orderBy(desc(stockSyncTransactions.createdAt))
    .limit(100);
  const events = await ctx.db.select().from(integrationEvents).where(eq(integrationEvents.integration, "boxhero")).orderBy(desc(integrationEvents.at)).limit(50);
  return { mode: inv.mode, label: inv.label, state: state ?? null, counts, problems, events };
}
