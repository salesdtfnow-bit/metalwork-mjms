import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createPgliteDb, queryRows } from "@/server/db/client";
import { pgError } from "@/server/errors";

async function expectPgReject(p: Promise<unknown>, re: RegExp) {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err, "expected the statement to be rejected").toBeDefined();
  expect(pgError(err)?.message).toMatch(re);
}

describe("migrations", () => {
  it("apply to a fresh database and enforce append-only guards", async () => {
    const db = await createPgliteDb(undefined, { migrate: true });
    const tables = await queryRows<{ n: number }>(
      db,
      sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
    );
    expect(tables[0].n).toBeGreaterThan(90);

    await db.execute(sql`insert into audit_events (action, entity_type, hash) values ('test', 'x', 'h')`);
    await expectPgReject(db.execute(sql`update audit_events set action = 'tampered'`), /append-only/);
    await expectPgReject(db.execute(sql`delete from audit_events`), /append-only/);
    await expectPgReject(db.execute(sql`truncate audit_events`), /append-only/);
    const left = await queryRows(db, sql`select action from audit_events`);
    expect(left).toEqual([{ action: "test" }]);
  });
});
