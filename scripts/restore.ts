/**
 * Restores a logical backup into an EMPTY database, then verifies row counts and the audit
 * hash chain. The target must be freshly migrated (npm run db:migrate on a new database).
 *   RESTORE_FILE=backups/mjms-....json npm run restore
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { getDb } from "../src/server/db/client";
import { importAll, verifyRestore, type Backup } from "../src/server/backup";
import { directDatabaseUrl } from "../src/server/db/url";

async function main() {
  const file = process.env.RESTORE_FILE;
  if (!file) throw new Error("Set RESTORE_FILE to the backup JSON path");
  const direct = directDatabaseUrl();
  if (direct) process.env.DATABASE_URL = direct;
  const backup = JSON.parse(readFileSync(file, "utf8")) as Backup;
  const db = await getDb();
  const r = await importAll(db, backup);
  console.log(`Restored ${r.tables} tables (deferred FK columns: ${r.deferred.join(", ") || "none"})`);
  const v = await verifyRestore(db, backup);
  if (!v.ok) {
    console.error("VERIFICATION FAILED:", v.problems);
    process.exit(2);
  }
  console.log(`Verification passed: row counts match, ${v.auditEventsVerified} audit events with an intact hash chain.`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
