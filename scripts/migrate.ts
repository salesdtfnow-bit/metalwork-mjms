/**
 * Applies versioned SQL migrations, then idempotent base data (roles, settings, defaults).
 *   Production: DATABASE_URL_UNPOOLED (direct connection) or DATABASE_URL (see src/server/db/url.ts).
 *   Local: embedded PGlite (migrated automatically on first use anyway).
 */
import "dotenv/config";
import { ensureBaseData } from "../src/server/bootstrap";
import { createPgliteDb, migrationsFolder, type DB } from "../src/server/db/client";
import * as schema from "../src/server/db/schema";
import { databaseEnvNames, directDatabaseUrl } from "../src/server/db/url";

async function main() {
  const url = directDatabaseUrl();
  let db: DB;
  if (url) {
    console.log(`Migrating PostgreSQL at ${new URL(url).hostname}`);
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
    if (process.env.VERCEL) {
      // A Vercel build without a database would otherwise migrate a throwaway embedded database and "succeed".
      throw new Error(`No PostgreSQL URL found in the build environment. Database-like variables present: ${databaseEnvNames().join(", ") || "none"}. Connect Neon to this project for the Production environment, then redeploy.`);
    }
    console.log("Migrating embedded PGlite database");
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
  if (process.env.DEMO_MODE?.trim().toLowerCase() !== "true") {
    console.log(`DEMO_MODE not enabled (${process.env.DEMO_MODE === undefined ? "unset" : "set, not \"true\""}) — demo seed skipped.`);
    return;
  }
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
