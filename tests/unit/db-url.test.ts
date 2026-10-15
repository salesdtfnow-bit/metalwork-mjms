import { afterEach, describe, expect, it } from "vitest";
import { databaseUrl, directDatabaseUrl } from "@/server/db/url";

const KEYS = ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "STORAGE_DATABASE_URL", "STORAGE_DATABASE_URL_UNPOOLED"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function only(env: Record<string, string>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
}

describe("database URL resolution", () => {
  it("prefers DATABASE_URL for the app and the unpooled URL for migrations", () => {
    only({ DATABASE_URL: "postgres://pooled/db", DATABASE_URL_UNPOOLED: "postgres://direct/db" });
    expect(databaseUrl()).toBe("postgres://pooled/db");
    expect(directDatabaseUrl()).toBe("postgres://direct/db");
  });

  it("accepts POSTGRES_URL and prefixed Marketplace variables", () => {
    only({ POSTGRES_URL: "postgresql://p/db" });
    expect(databaseUrl()).toBe("postgresql://p/db");
    only({ STORAGE_DATABASE_URL: "postgres://s/db", STORAGE_DATABASE_URL_UNPOOLED: "postgres://sd/db" });
    expect(databaseUrl()).toBe("postgres://s/db");
    expect(directDatabaseUrl()).toBe("postgres://sd/db");
  });

  it("ignores non-postgres values and returns undefined when nothing is set", () => {
    only({ DATABASE_URL: "file:./local.db" });
    expect(databaseUrl()).toBeUndefined();
  });
});
