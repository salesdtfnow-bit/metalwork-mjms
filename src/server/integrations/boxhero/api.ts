import {
  InventoryDefiniteError,
  InventoryUncertainError,
  type InvItem,
  type InvLocation,
  type InvTxRequest,
  type InventoryAdapter,
} from "./types";

/**
 * BoxHero REST API adapter (https://www.boxhero.io/docs — developers/api).
 * Base https://rest.boxhero-app.com/v1, Bearer token per team, team must be in Location mode.
 * Rate limit 5 req/s & 300 req/min per team → client-side throttle + Retry-After handling.
 * POST /transactions has NO idempotency key: callers must use the outbox + memo marker.
 */
export class BoxHeroApiAdapter implements InventoryAdapter {
  readonly mode = "api" as const;
  readonly label = "BoxHero API";
  private lastCall = 0;
  constructor(
    private token: string,
    private base = process.env.BOXHERO_API_BASE ?? "https://rest.boxhero-app.com/v1",
    private timeoutMs = Number(process.env.BOXHERO_TIMEOUT_MS ?? 15_000),
  ) {}

  private async throttle() {
    const wait = this.lastCall + 220 - Date.now(); // ≤ ~4.5 req/s
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCall = Date.now();
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, attempt = 0): Promise<T> {
    await this.throttle();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", Accept: "application/json", "X-Correlation-Id": crypto.randomUUID() },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ac.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      // For writes the request may have reached BoxHero — outcome unknown.
      if (method === "GET" && attempt < 2) return this.request(method, path, body, attempt + 1);
      throw new InventoryUncertainError(`BoxHero request failed: ${(e as Error).message}`);
    }
    clearTimeout(timer);
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "1");
      // 429 means the request was rejected before processing — safe to retry, also for POST.
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, Math.min(retryAfter, 30) * 1000));
        return this.request(method, path, body, attempt + 1);
      }
      throw new InventoryDefiniteError("BoxHero rate limit exceeded.", 429);
    }
    const text = await res.text();
    const json = text ? safeJson(text) : null;
    if (res.ok) return json as T;
    const msg = (json as { title?: string; type?: string } | null)?.title ?? text.slice(0, 300);
    if (res.status >= 500) {
      if (method === "GET" && attempt < 2) return this.request(method, path, body, attempt + 1);
      throw new InventoryUncertainError(`BoxHero ${res.status}: ${msg}`);
    }
    if (res.status === 402) throw new InventoryDefiniteError(`BoxHero plan limit reached (402): ${msg}`, 402);
    if (res.status === 400 && /invalid-team-mode/.test(text)) throw new InventoryDefiniteError("BoxHero team is not in Location mode — switch the team to Location mode.", 400);
    throw new InventoryDefiniteError(`BoxHero ${res.status}: ${msg}`, res.status);
  }

  async testConnection() {
    try {
      const team = await this.request<{ id: number; name: string; mode: number }>("GET", "/teams/linked");
      if (team.mode !== 2) return { ok: false, message: `Connected to team "${team.name}", but it is not in Location mode (mode ${team.mode}). Location mode is required.`, detail: team };
      return { ok: true, message: `Connected to BoxHero team "${team.name}" (Location mode).`, detail: team };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async listItems(cursor?: string | null) {
    const q = new URLSearchParams({ limit: "100" });
    if (cursor) q.set("cursor", cursor);
    const r = await this.request<{ items: RawItem[]; cursor?: string | null; has_more: boolean }>("GET", `/items?${q}`);
    return { items: r.items.map(mapItem), cursor: r.cursor ?? null, hasMore: !!r.has_more };
  }

  async getItem(id: string) {
    try {
      return mapItem(await this.request<RawItem>("GET", `/items/${encodeURIComponent(id)}`));
    } catch (e) {
      if (e instanceof InventoryDefiniteError && e.status === 404) return null;
      throw e;
    }
  }

  async listLocations(): Promise<InvLocation[]> {
    const out: InvLocation[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const q = new URLSearchParams({ limit: "100" });
      if (cursor) q.set("cursor", cursor);
      const r: { items: { id: number | string; name: string }[]; cursor?: string | null; has_more: boolean } = await this.request("GET", `/locations?${q}`);
      out.push(...r.items.map((l) => ({ id: String(l.id), name: l.name })));
      if (!r.has_more) break;
      cursor = r.cursor ?? null;
    }
    return out;
  }

  async createTransaction(req: InvTxRequest) {
    const body: Record<string, unknown> = {
      type: req.type,
      memo: req.memo.slice(0, 2000),
      items: [{ item_id: Number(req.itemId) || req.itemId, quantity: Number(req.quantity) }],
    };
    if (req.type === "move") {
      body.from_location_id = Number(req.fromLocationId);
      body.to_location_id = Number(req.locationId);
    } else if (req.locationId) body.to_location_id = Number(req.locationId);
    const r = await this.request<{ id: number | string }>("POST", "/transactions", body);
    return { id: String(r.id) };
  }

  async findTransactionByMarker(marker: string, maxPages = 5) {
    let cursor: string | null = null;
    for (let i = 0; i < maxPages; i++) {
      const q = new URLSearchParams({ limit: "100" });
      if (cursor) q.set("cursor", cursor);
      const r: { items: { id: number | string; memo?: string | null }[]; cursor?: string | null; has_more: boolean } = await this.request("GET", `/transactions?${q}`);
      const hit = r.items.find((t) => t.memo?.includes(marker));
      if (hit) return { id: String(hit.id) };
      if (!r.has_more) break;
      cursor = r.cursor ?? null;
    }
    return null;
  }
}

type RawItem = {
  id: number | string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  cost?: string | null;
  quantity?: number | string | null;
  quantities?: { location_id: number | string; quantity: number | string }[];
  attrs?: unknown[];
};

function mapItem(r: RawItem): InvItem {
  return {
    id: String(r.id),
    name: r.name,
    sku: r.sku ?? null,
    barcode: r.barcode ?? null,
    cost: r.cost ?? null,
    quantity: r.quantity === null || r.quantity === undefined ? null : String(r.quantity),
    quantities: (r.quantities ?? []).map((q) => ({ location_id: String(q.location_id), quantity: String(q.quantity) })),
    attrs: r.attrs ?? [],
  };
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}
