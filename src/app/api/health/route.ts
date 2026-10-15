import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";

/** Liveness/readiness for monitoring. Reveals no data. */
export async function GET() {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok", time: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    // Logged server-side only; the response reveals nothing.
    console.error("[health] database check failed:", err instanceof Error ? err.message : err);
    return Response.json({ status: "error" }, { status: 503 });
  }
}
