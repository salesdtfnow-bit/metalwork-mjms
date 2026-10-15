/**
 * Inventory adapter interface. BoxHero is the current implementation; another inventory
 * system can be supported by implementing this interface without touching manufacturing code.
 */
export type InvItem = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  cost: string | null;
  quantity: string | null;
  quantities: { location_id: string; quantity: string }[];
  attrs: unknown[];
};
export type InvLocation = { id: string; name: string };
export type InvTxType = "in" | "out" | "adjust" | "move";
export type InvTxRequest = {
  type: InvTxType;
  itemId: string;
  /** Signed: + for in/move, − for out; adjust is a relative change. */
  quantity: string;
  locationId?: string | null;
  fromLocationId?: string | null;
  memo: string;
};

export interface InventoryAdapter {
  readonly mode: "simulated" | "api" | "manual";
  readonly label: string;
  testConnection(): Promise<{ ok: boolean; message: string; detail?: Record<string, unknown> }>;
  listItems(cursor?: string | null): Promise<{ items: InvItem[]; cursor: string | null; hasMore: boolean }>;
  getItem(id: string): Promise<InvItem | null>;
  listLocations(): Promise<InvLocation[]>;
  createTransaction(req: InvTxRequest): Promise<{ id: string }>;
  /** Searches recent transactions for our idempotency marker in the memo (reconciliation). */
  findTransactionByMarker(marker: string, maxPages?: number): Promise<{ id: string } | null>;
}

/** The request definitely failed (e.g. 4xx validation) — safe to retry after fixing data. */
export class InventoryDefiniteError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "InventoryDefiniteError";
  }
}

/** Outcome unknown (timeout, 5xx, network) — must reconcile before any retry. */
export class InventoryUncertainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryUncertainError";
  }
}

/** Manual mode: a person must perform the movement in BoxHero and record the reference. */
export class InventoryManualRequired extends Error {
  constructor() {
    super("Manual mode: perform this movement in BoxHero and record the transaction reference.");
    this.name = "InventoryManualRequired";
  }
}
