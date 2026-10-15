/**
 * Runs during every build (`npm run vercel-build`) and locally via `npm run db:migrate`:
 *   1. optional one-off reset of a demonstration database   MJMS_RESET_DEMO_DATABASE=true
 *   2. versioned SQL migrations, then idempotent base data (roles, settings, defaults)
 *   3. optional first administrator                          ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD
 *   4. optional demonstration data                           DEMO_MODE=true (empty databases only)
 * Production: DATABASE_URL_UNPOOLED (direct connection) or DATABASE_URL (see src/server/db/url.ts).
 * Local: embedded PGlite at PGLITE_DIR.
 */
import "dotenv/config";
import { ensureBaseData } from "../src/server/bootstrap";
import { createPgliteDb, migrationsFolder, type DB } from "../src/server/db/client";
import * as schema from "../src/server/db/schema";
import { databaseEnvNames, directDatabaseUrl } from "../src/server/db/url";
import { demoResetCheck, demoSeedAllowed, dropDemoDatabase, provisionAdmin } from "../src/server/provisioning";

const flag = (name: string) => process.env[name]?.trim().toLowerCase() === "true";

async function main() {
  const url = directDatabaseUrl();
  if (url) {
    console.log(`Migrating PostgreSQL at ${new URL(url).hostname}`);
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: url, max: 1 });
    const pdb = drizzle({ client: pool, schema, casing: "snake_case" });
    await provision(pdb as unknown as DB, () => migrate(pdb, { migrationsFolder: migrationsFolder() }));
    await pool.end();
  } else {
    if (process.env.VERCEL) {
      // A Vercel build without a database would otherwise migrate a throwaway embedded database and "succeed".
      throw new Error(`No PostgreSQL URL found in the build environment. Database-like variables present: ${databaseEnvNames().join(", ") || "none"}. Connect Neon to this project for the Production environment, then redeploy.`);
    }
    console.log("Migrating embedded PGlite database");
    const db = await createPgliteDb(process.env.PGLITE_DIR ?? "./.data/pglite", { migrate: false });
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await provision(db, () => migrate(db as never, { migrationsFolder: migrationsFolder() }));
    // Close cleanly so the on-disk database is checkpointed before the process exits.
    await (db as unknown as { $client: { close(): Promise<void> } }).$client.close();
  }
}

async function provision(db: DB, runMigrations: () => Promise<unknown>) {
  if (flag("MJMS_RESET_DEMO_DATABASE")) {
    const check = await demoResetCheck(db);
    if (check.allowed) {
      await dropDemoDatabase(db);
      console.log("MJMS_RESET_DEMO_DATABASE: demonstration data removed. Remove this variable now.");
    } else {
      console.log(`MJMS_RESET_DEMO_DATABASE: reset refused (${check.reason}). Nothing was deleted. Remove this variable.`);
    }
  }

  await runMigrations();
  await ensureBaseData(db);
  console.log("Migrations and base data applied.");

  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (email && password) {
    const result = await provisionAdmin(db, { email, name: process.env.ADMIN_NAME?.trim() || "Administrator", password });
    console.log(
      result === "created"
        ? `Administrator created: ${email} (must change password at first sign-in). Remove ADMIN_PASSWORD from the environment now.`
        : `Administrator ${email} already exists — unchanged. Remove ADMIN_PASSWORD from the environment.`,
    );
  } else if (email || password) {
    throw new Error("Set both ADMIN_EMAIL and ADMIN_PASSWORD (and optionally ADMIN_NAME) to create the first administrator.");
  }

  await maybeSeedDemo(db);
}

/** Demonstration deployments only: never runs on a database with customers or real accounts. */
async function maybeSeedDemo(db: DB) {
  if (!flag("DEMO_MODE")) return;
  const check = await demoSeedAllowed(db);
  if (!check.allowed) {
    console.log(`DEMO_MODE: demo seed skipped (${check.reason}). Remove DEMO_MODE for a live system.`);
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
