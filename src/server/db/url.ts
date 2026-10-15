/**
 * Resolves the PostgreSQL connection string from the environment.
 *
 * Vercel Marketplace integrations (Neon, Supabase, Prisma Postgres) inject different names, and the
 * install dialog lets the owner add a custom prefix (e.g. `STORAGE_DATABASE_URL`). Accept the common
 * names in order of preference so a connected database is found without renaming variables.
 */
const POOLED = ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL"];
const DIRECT = ["DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING", "DIRECT_URL"];

function isPg(v: string | undefined): v is string {
  return !!v && /^postgres(ql)?:\/\//.test(v);
}

function find(names: string[]): string | undefined {
  for (const n of names) if (isPg(process.env[n])) return process.env[n];
  // Prefixed variants, e.g. STORAGE_DATABASE_URL / MJMS_POSTGRES_URL.
  for (const n of names) {
    const key = Object.keys(process.env).find((k) => k.endsWith(`_${n}`) && isPg(process.env[k]));
    if (key) return process.env[key];
  }
  return undefined;
}

/** Pooled URL for the running app. */
export function databaseUrl(): string | undefined {
  return find(POOLED) ?? find(DIRECT);
}

/** Direct (unpooled) URL for migrations, backup and restore; falls back to the pooled URL. */
export function directDatabaseUrl(): string | undefined {
  return find(DIRECT) ?? find(POOLED);
}

/** Names only (never values) of database-looking variables, for deployment diagnostics. */
export function databaseEnvNames(): string[] {
  return Object.keys(process.env)
    .filter((k) => /DATABASE|POSTGRES|^PG/.test(k))
    .sort();
}
