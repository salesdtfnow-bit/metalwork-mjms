/**
 * Applies versioned SQL migrations, then idempotent base data (roles, settings, defaults).
 *   Production: DATABASE_URL_UNPOOLED (direct connection) or DATABASE_URL.
 *   Local: embedded PGlite (migrated automatically on first use anyway).
 */
import "dotenv/config";
import { ensureBaseData } from "../src/server/bootstrap";
import { createPgliteDb, migrationsFolder, type DB } from "../src/server/db/client";
import * as schema from "../src/server/db/schema";

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  let db: DB;
  if (url?.startsWith("postgres")) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: url, max: 1 });
    const pdb = drizzle({ client: pool, schema, casing: "snake_case" });
    await migrate(pdb, { migrationsFolder: migrationsFolder() });
    db = pdb as unknown as DB;
    await ensureBaseData(db);
    await maybeSeedDemo(db);
    await pool.end();
  } else {
    db = await createPgliteDb(process.env.PGLITE_DIR ?? "./.data/pglite", { migrate: true });
    await ensureBaseData(db);
  }
  console.log("Migrations and base data applied.");
}

/**
 * Demonstration deployments only: when DEMO_MODE=true and the database has no customers,
 * load the fictitious demo workshop. Never runs against a database with existing data.
 */
async function maybeSeedDemo(db: DB) {
  if (process.env.DEMO_MODE !== "true") return;
  const { sql } = await import("drizzle-orm");
  const { queryRows } = await import("../src/server/db/client");
  const [{ n }] = await queryRows<{ n: number }>(db, sql`select count(*)::int as n from customers`);
  if (n > 0) {
    console.log("DEMO_MODE: data already present — demo seed skipped.");
    return;
  }
  const { seedDemo } = await import("../src/server/demo/seed");
  const summary = await seedDemo(db, { password: process.env.DEMO_PASSWORD ?? "Workshop-Demo-2026!" });
  console.log("DEMO_MODE: demo workshop seeded", summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
