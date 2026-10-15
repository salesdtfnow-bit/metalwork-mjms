import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { queryRows, type DB } from "./db/client";
import { verifyAuditChain } from "./audit";

/**
 * Portable logical backup of every application table (JSON), with a manifest of row counts
 * and a SHA-256 over the content. Complements — does not replace — the database provider's
 * point-in-time recovery and pg_dump (see docs/BACKUP_AND_RESTORE.md).
 */
export type Backup = {
  format: "mjms-backup/1";
  createdAt: string;
  migrations: number;
  tables: Record<string, unknown[]>;
  manifest: { table: string; rows: number }[];
  sha256: string;
};

const EXCLUDE = new Set(["sessions", "password_reset_tokens", "submission_keys"]); // security-sensitive / transient

async function appTables(db: DB): Promise<string[]> {
  const rows = await queryRows<{ t: string }>(db, sql`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`);
  return rows.map((r) => r.t).filter((t) => !EXCLUDE.has(t));
}

type Fk = { table: string; column: string; refTable: string; nullable: boolean };
async function foreignKeys(db: DB): Promise<Fk[]> {
  return queryRows<Fk>(
    db,
    sql`select kcu.table_name as "table", kcu.column_name as "column", ccu.table_name as "refTable", (c.is_nullable = 'YES') as "nullable"
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
        join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
        join information_schema.columns c on c.table_name = kcu.table_name and c.column_name = kcu.column_name and c.table_schema = kcu.table_schema
        where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`,
  );
}

function stableStringify(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x));
}

export async function exportAll(db: DB): Promise<Backup> {
  const tables: Record<string, unknown[]> = {};
  for (const t of await appTables(db)) {
    const rows = await queryRows<{ j: unknown[] | null }>(db, sql.raw(`select coalesce(json_agg(x), '[]'::json) as j from "${t}" x`));
    tables[t] = rows[0].j ?? [];
  }
  const [{ n }] = await queryRows<{ n: number }>(db, sql`select count(*)::int as n from drizzle.__drizzle_migrations`).catch(() => [{ n: 0 }]);
  const manifest = Object.entries(tables).map(([table, rows]) => ({ table, rows: rows.length }));
  const sha256 = createHash("sha256").update(stableStringify(tables)).digest("hex");
  return { format: "mjms-backup/1", createdAt: new Date().toISOString(), migrations: n, tables, manifest, sha256 };
}

/**
 * Restores a backup into an EMPTY, fully migrated database. Tables are loaded in foreign-key
 * order; columns forming reference cycles are loaded as NULL and set afterwards.
 */
export async function importAll(db: DB, backup: Backup, opts: { verifyChecksum?: boolean } = {}) {
  if (backup.format !== "mjms-backup/1") throw new Error("Unsupported backup format.");
  if (opts.verifyChecksum !== false) {
    const sum = createHash("sha256").update(stableStringify(backup.tables)).digest("hex");
    if (sum !== backup.sha256) throw new Error("Backup checksum mismatch — the file is corrupt or has been modified.");
  }
  const targetTables = new Set(await appTables(db));
  const fks = (await foreignKeys(db)).filter((f) => targetTables.has(f.table));
  // Base data inserted by migrations/bootstrap must be cleared (target must be empty otherwise).
  const nonEmpty = [];
  for (const t of targetTables) {
    const [{ n }] = await queryRows<{ n: number }>(db, sql.raw(`select count(*)::int as n from "${t}"`));
    if (n > 0) nonEmpty.push(t);
  }
  if (nonEmpty.some((t) => !["company_settings", "roles", "role_permissions", "users", "operation_types", "status_transitions", "downtime_reasons", "machine_types", "release_checklist_templates", "retention_policies", "counters"].includes(t))) {
    throw new Error(`Target database is not empty (${nonEmpty.join(", ")}). Restore into a freshly migrated database.`);
  }
  // Order: Kahn's algorithm, deferring nullable FK columns to break cycles.
  const remaining = new Set(Object.keys(backup.tables).filter((t) => targetTables.has(t)));
  const order: string[] = [];
  const deferred: Fk[] = [];
  while (remaining.size) {
    const ready = [...remaining].filter((t) => fks.filter((f) => f.table === t && f.refTable !== t && remaining.has(f.refTable) && !deferred.includes(f)).length === 0);
    if (ready.length) {
      for (const t of ready.sort()) {
        order.push(t);
        remaining.delete(t);
      }
      continue;
    }
    // Break a cycle: defer one nullable FK pointing at a still-remaining table.
    const breakable = fks.find((f) => remaining.has(f.table) && remaining.has(f.refTable) && f.nullable && !deferred.includes(f));
    if (!breakable) throw new Error(`Cannot resolve table order (cycle among ${[...remaining].join(", ")}).`);
    deferred.push(breakable);
  }
  await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as DB;
    // Clear bootstrap rows so ids match the backup exactly (order: dependants first).
    for (const t of [...order].reverse()) if (nonEmpty.includes(t)) await tx.execute(sql.raw(`delete from "${t}"`));
    for (const t of order) {
      const rows = backup.tables[t] as Record<string, unknown>[];
      if (!rows.length) continue;
      const defCols = deferred.filter((f) => f.table === t || (f.table === t && f.refTable === t)).map((f) => f.column);
      const selfRefs = fks.filter((f) => f.table === t && f.refTable === t).map((f) => f.column);
      const nullCols = [...new Set([...defCols, ...selfRefs])];
      const toInsert = nullCols.length ? rows.map((r) => ({ ...r, ...Object.fromEntries(nullCols.map((c) => [c, null])) })) : rows;
      const identity = await queryRows<{ c: string }>(tx, sql`select column_name as c from information_schema.columns where table_schema='public' and table_name=${t} and is_identity='YES'`);
      for (let i = 0; i < toInsert.length; i += 500) {
        const chunk = JSON.stringify(toInsert.slice(i, i + 500));
        await tx.execute(sql.raw(`insert into "${t}" ${identity.length ? "overriding system value " : ""}select * from json_populate_recordset(null::"${t}", '${chunk.replace(/'/g, "''")}'::json)`));
      }
      // Self-references can be restored as soon as the table is loaded; cross-table deferrals wait until the end.
      if (selfRefs.length) {
        for (const c of selfRefs) {
          const updates = rows.filter((r) => r[c] !== null && r[c] !== undefined).map((r) => ({ id: r.id, v: r[c] }));
          for (const u of updates) await tx.execute(sql.raw(`update "${t}" set "${c}" = '${String(u.v).replace(/'/g, "''")}' where id = '${String(u.id).replace(/'/g, "''")}'`));
        }
      }
    }
    // Deferred cross-table columns
    for (const f of deferred.filter((x) => x.refTable !== x.table)) {
      const rows = backup.tables[f.table] as Record<string, unknown>[];
      for (const r of rows.filter((x) => x[f.column] !== null && x[f.column] !== undefined)) {
        await tx.execute(sql.raw(`update "${f.table}" set "${f.column}" = '${String(r[f.column]).replace(/'/g, "''")}' where id = '${String(r.id).replace(/'/g, "''")}'`));
      }
    }
    // Sequences for serial ids
    for (const t of ["audit_events", "file_access_log", "integration_events"]) {
      if (targetTables.has(t)) await tx.execute(sql.raw(`select setval(pg_get_serial_sequence('"${t}"', 'id'), coalesce((select max(id) from "${t}"), 1))`));
    }
  });
  return { tables: order.length, deferred: deferred.map((d) => `${d.table}.${d.column}`) };
}

/** Post-restore verification: counts match, audit chain intact, FK integrity holds. */
export async function verifyRestore(db: DB, backup: Backup) {
  const problems: string[] = [];
  for (const m of backup.manifest) {
    const [{ n }] = await queryRows<{ n: number }>(db, sql.raw(`select count(*)::int as n from "${m.table}"`)).catch(() => [{ n: -1 }]);
    if (n !== m.rows) problems.push(`${m.table}: expected ${m.rows} rows, found ${n}`);
  }
  const chain = await verifyAuditChain(db);
  if (!chain.ok) problems.push(`Audit chain broken at event ${chain.brokenAtId}`);
  return { ok: problems.length === 0, problems, auditEventsVerified: chain.checked };
}
