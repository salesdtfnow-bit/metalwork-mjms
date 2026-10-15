import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { boxheroItems, integrationEvents, stockSyncTransactions } from "@/server/db/schema";
import { getInventoryAdapter } from "@/server/integrations/boxhero/sync";

/**
 * BoxHero webhook. BoxHero does not sign webhooks, so: (1) the URL contains a long secret
 * (BOXHERO_WEBHOOK_SECRET), and (2) payload content is never trusted — items are re-fetched
 * from the API. A 2xx is returned for anything accepted (BoxHero retries 5xx/429).
 */
export async function POST(req: Request, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  const want = process.env.BOXHERO_WEBHOOK_SECRET ?? "";
  if (want.length < 24 || secret.length !== want.length || !timingSafeEqual(Buffer.from(secret), Buffer.from(want))) return new Response("Not found", { status: 404 });
  const body = (await req.json().catch(() => null)) as { id?: string; topic?: string; payload?: { id?: number | string; memo?: string } } | null;
  if (!body?.topic) return new Response("Bad request", { status: 400 });
  const db = await getDb();
  const adapter = await getInventoryAdapter(db);
  try {
    if (body.topic.startsWith("item/") && body.payload?.id !== undefined) {
      const id = String(body.payload.id);
      if (body.topic === "item/delete") await db.update(boxheroItems).set({ deleted: true }).where(eq(boxheroItems.boxheroItemId, id));
      else {
        const item = await adapter.getItem(id); // re-fetch: never trust webhook content
        if (item) {
          await db
            .insert(boxheroItems)
            .values({ boxheroItemId: item.id, name: item.name, sku: item.sku, barcode: item.barcode, cost: item.cost, quantityTotal: item.quantity, quantities: item.quantities, attrs: item.attrs })
            .onConflictDoUpdate({ target: boxheroItems.boxheroItemId, set: { name: item.name, sku: item.sku, barcode: item.barcode, quantityTotal: item.quantity, quantities: item.quantities, lastSyncedAt: new Date(), deleted: false } });
        }
      }
    }
    if (body.topic === "txs/new" && body.payload?.memo) {
      // If the memo contains our marker, confirm the matching outbox row (reconciliation shortcut).
      const m = /\[MJMS:([^\]]+)\]/.exec(body.payload.memo);
      if (m) {
        const [row] = await db.select().from(stockSyncTransactions).where(eq(stockSyncTransactions.idempotencyKey, m[1])).limit(1);
        if (row && ["sending", "needs_reconciliation", "pending"].includes(row.status)) {
          await db.update(stockSyncTransactions).set({ status: "needs_reconciliation", nextAttemptAt: new Date() }).where(eq(stockSyncTransactions.id, row.id));
        }
      }
    }
    await db.insert(integrationEvents).values({ integration: "boxhero", direction: "inbound", action: body.topic, status: "success", message: `Webhook ${body.topic}`, detail: { eventId: body.id } });
    return Response.json({ ok: true });
  } catch (e) {
    await db.insert(integrationEvents).values({ integration: "boxhero", direction: "inbound", action: body.topic, status: "error", message: String((e as Error).message).slice(0, 500) });
    return new Response("Error", { status: 500 });
  }
}
