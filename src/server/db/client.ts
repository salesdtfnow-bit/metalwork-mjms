import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/**
 * Database handle used by every service. Both the PGlite (local/test) and node-postgres
 * (production) drivers implement PgDatabase, and a transaction object is also a PgDatabase,
 * so services accept `DB` and can be handed either the root handle or a transaction.
 */
export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;
export { schema };

export const DRIZZLE_CASING = "snake_case" as const;

type GlobalWithDb = typeof globalThis & { __mjmsDb?: Promise<DB> };
const g = globalThis as GlobalWithDb;

/**
 * Lazily creates a single DB handle per process.
 * - DATABASE_URL set (postgres://…)  → node-postgres Pool (Neon on Vercel)
 * - otherwise                        → embedded PGlite at PGLITE_DIR (default ./.data/pglite),
 *                                      migrated automatically on first use.
 */
export function getDb(): Promise<DB> {
  if (!g.__mjmsDb) {
    g.__mjmsDb = createDb().catch((err) => {
      g.__mjmsDb = undefined;
      throw err;
    });
  }
  return g.__mjmsDb;
}

async function createDb(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url && url.startsWith("postgres")) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({
      connectionString: url,
      max: Number(process.env.DB_POOL_MAX ?? 10),
      idleTimeoutMillis: 5_000,
    });
    if (process.env.VERCEL) {
      const { attachDatabasePool } = await import("@vercel/functions");
      attachDatabasePool(pool);
    }
    return drizzle({ client: pool, schema, casing: DRIZZLE_CASING }) as unknown as DB;
  }
  if (process.env.VERCEL || process.env.NODE_ENV === "production" && !process.env.ALLOW_PGLITE_IN_PRODUCTION) {
    // Serverless filesystems are ephemeral: never silently fall back to an embedded database.
    throw new Error("DATABASE_URL is not configured. Connect a PostgreSQL database (e.g. Neon via the Vercel Marketplace).");
  }
  const dir = process.env.PGLITE_DIR ?? "./.data/pglite";
  return createPgliteDb(dir, { migrate: true });
}

/** Creates a PGlite-backed DB. `dataDir` undefined or "memory://" → in-memory (tests). */
export async function createPgliteDb(dataDir: string | undefined, opts: { migrate: boolean }): Promise<DB> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const persistent = !!dataDir && dataDir !== "memory://";
  if (persistent) {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dataDir, { recursive: true });
  }
  const client = persistent ? new PGlite(dataDir) : new PGlite();
  const db = drizzle({ client, schema, casing: DRIZZLE_CASING });
  if (opts.migrate) {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db, { migrationsFolder: migrationsFolder() });
  }
  return db as unknown as DB;
}

export function migrationsFolder() {
  return process.env.MIGRATIONS_DIR ?? `${process.cwd()}/drizzle`;
}

/** Runs raw SQL and returns typed rows (both drivers expose `.rows`). */
export async function queryRows<T>(db: DB, query: import("drizzle-orm").SQL): Promise<T[]> {
  const res = (await db.execute(query)) as unknown as { rows: T[] };
  return res.rows;
}
