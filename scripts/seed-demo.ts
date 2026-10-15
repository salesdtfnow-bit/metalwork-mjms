/**
 * DEMONSTRATION data for Simmonds Engineering Ltd: fictitious customers, suppliers, people and jobs.
 *   npm run db:seed:demo
 * Refuses to run against a database that already contains non-demo data.
 * Every demo account uses the password in DEMO_PASSWORD (default below) — demo only.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, queryRows } from "../src/server/db/client";
import { ensureBaseData } from "../src/server/bootstrap";
import { companySettings } from "../src/server/db/schema";
import { seedDemo } from "../src/server/demo/seed";

async function main() {
  const db = await getDb();
  await ensureBaseData(db);
  const [{ n }] = await queryRows<{ n: number }>(db, sql`select count(*)::int as n from customers`);
  const [settings] = await db.select().from(companySettings);
  if (n > 0 && !settings?.isDemo) throw new Error("Refusing to seed: database contains non-demo data.");
  if (n > 0) {
    console.log("Demo data already present — nothing to do.");
    process.exit(0);
  }
  const summary = await seedDemo(db, { password: process.env.DEMO_PASSWORD ?? "Workshop-Demo-2026!" });
  console.log("Demo data created:", summary);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
