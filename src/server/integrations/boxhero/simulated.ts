import { desc, eq, like, sql } from "drizzle-orm";
import type { DB } from "../../db/client";
import { boxheroItems, boxheroLocations, simulatedBoxheroTransactions } from "../../db/schema";
import { d } from "@/lib/decimal";
import {
  InventoryDefiniteError,
  InventoryManualRequired,
  InventoryUncertainError,
  type InvItem,
  type InvTxRequest,
  type InventoryAdapter,
} from "./types";

export type SimFailure = "none" | "unavailable" | "timeout_after_commit" | "reject";

/**
 * In-database stand-in for BoxHero (demo/tests). Clearly labelled "SIMULATED" in the UI.
 * `failure` lets tests reproduce outages and the dangerous "committed but timed out" case.
 */
export class SimulatedInventoryAdapter implements InventoryAdapter {
  readonly mode = "simulated" as const;
  readonly label = "BoxHero (SIMULATED — no real stock is changed)";
  constructor(
    private db: DB,
    public failure: SimFailure = (process.env.BOXHERO_SIM_FAILURE as SimFailure) ?? "none",
  ) {}

  async testConnection() {
    if (this.failure === "unavailable") return { ok: false, message: "Simulated outage: BoxHero unavailable." };
    return { ok: true, message: "Simulated BoxHero is active. Configure BOXHERO_API_TOKEN and set mode to 'api' to connect to your real BoxHero team." };
  }

  async listItems() {
    if (this.failure === "unavailable") throw new InventoryUncertainError("Simulated outage: BoxHero unavailable.");
    const rows = await this.db.select().from(boxheroItems).where(eq(boxheroItems.deleted, false));
    return { items: rows.map(toItem), cursor: null, hasMore: false };
  }

  async getItem(id: string) {
    const [r] = await this.db.select().from(boxheroItems).where(eq(boxheroItems.boxheroItemId, id)).limit(1);
    return r ? toItem(r) : null;
  }

  async listLocations() {
    return (await this.db.select().from(boxheroLocations)).map((l) => ({ id: l.boxheroLocationId, name: l.name }));
  }

  async createTransaction(req: InvTxRequest) {
    if (this.failure === "unavailable") throw new InventoryUncertainError("Simulated outage: connection refused.");
    if (this.failure === "reject") throw new InventoryDefiniteError("Simulated rejection: item not found in BoxHero.", 404);
    const [item] = await this.db.select().from(boxheroItems).where(eq(boxheroItems.boxheroItemId, req.itemId)).limit(1);
    if (!item) throw new InventoryDefiniteError(`Item ${req.itemId} does not exist in BoxHero.`, 404);
    const [tx] = await this.db
      .insert(simulatedBoxheroTransactions)
      .values({ type: req.type, itemId: req.itemId, locationId: req.locationId ?? null, quantity: req.quantity, memo: req.memo })
      .returning();
    // Apply to the cached stock figures so the simulation behaves like real stock.
    const quantities = ((item.quantities as { location_id: string; quantity: string }[]) ?? []).map((q) => ({ ...q }));
    const loc = req.locationId ?? quantities[0]?.location_id ?? "1";
    const entry = quantities.find((q) => q.location_id === loc) ?? (quantities.push({ location_id: loc, quantity: "0" }), quantities[quantities.length - 1]);
    entry.quantity = d(entry.quantity).plus(d(req.quantity)).toString();
    await this.db
      .update(boxheroItems)
      .set({ quantities, quantityTotal: sql`coalesce(${boxheroItems.quantityTotal}, 0) + ${req.quantity}`, lastSyncedAt: new Date() })
      .where(eq(boxheroItems.id, item.id));
    if (this.failure === "timeout_after_commit") {
      // The write happened, but the caller never hears back.
      throw new InventoryUncertainError("Simulated timeout after BoxHero committed the transaction.");
    }
    return { id: `SIM-${tx.id}` };
  }

  async findTransactionByMarker(marker: string) {
    if (this.failure === "unavailable") throw new InventoryUncertainError("Simulated outage: BoxHero unavailable.");
    const [t] = await this.db
      .select()
      .from(simulatedBoxheroTransactions)
      .where(like(simulatedBoxheroTransactions.memo, `%${marker}%`))
      .orderBy(desc(simulatedBoxheroTransactions.id))
      .limit(1);
    return t ? { id: `SIM-${t.id}` } : null;
  }
}

/** Manual mode: every movement is confirmed by a person who records the BoxHero reference. */
export class ManualInventoryAdapter implements InventoryAdapter {
  readonly mode = "manual" as const;
  readonly label = "BoxHero (manual confirmation)";
  constructor(private db: DB) {}
  async testConnection() {
    return { ok: true, message: "Manual mode: staff record each stock movement in BoxHero and enter its reference here." };
  }
  async listItems() {
    const rows = await this.db.select().from(boxheroItems).where(eq(boxheroItems.deleted, false));
    return { items: rows.map(toItem), cursor: null, hasMore: false };
  }
  async getItem(id: string) {
    const [r] = await this.db.select().from(boxheroItems).where(eq(boxheroItems.boxheroItemId, id)).limit(1);
    return r ? toItem(r) : null;
  }
  async listLocations() {
    return (await this.db.select().from(boxheroLocations)).map((l) => ({ id: l.boxheroLocationId, name: l.name }));
  }
  async createTransaction(): Promise<{ id: string }> {
    throw new InventoryManualRequired();
  }
  async findTransactionByMarker() {
    return null;
  }
}

function toItem(r: typeof boxheroItems.$inferSelect): InvItem {
  return {
    id: r.boxheroItemId,
    name: r.name,
    sku: r.sku,
    barcode: r.barcode,
    cost: r.cost,
    quantity: r.quantityTotal,
    quantities: (r.quantities as { location_id: string; quantity: string }[]) ?? [],
    attrs: (r.attrs as unknown[]) ?? [],
  };
}
