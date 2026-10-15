import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/server/db/client";
import { runDaily, runOutboxes } from "@/server/jobs/scheduled";
import { syncCatalogue } from "@/server/integrations/boxhero/sync";

export const maxDuration = 300;

function authorised(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  return !!secret && secret.length >= 16 && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/**
 * Scheduled tasks (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`).
 *   /api/cron/daily     expiries, preventive maintenance, alerts, outboxes
 *   /api/cron/outbox    email + BoxHero outboxes
 *   /api/cron/boxhero-sync  item/location catalogue refresh
 * Vercel cron delivery is best-effort; every task is idempotent.
 */
export async function GET(req: Request, { params }: { params: Promise<{ task: string }> }) {
  if (!authorised(req)) return new Response("Unauthorized", { status: 401 });
  const { task } = await params;
  const db = await getDb();
  try {
    if (task === "daily") return Response.json(await runDaily(db));
    if (task === "outbox") return Response.json(await runOutboxes(db));
    if (task === "boxhero-sync") return Response.json(await syncCatalogue(db));
    return new Response("Unknown task", { status: 404 });
  } catch (e) {
    console.error("[cron]", task, e);
    return Response.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
