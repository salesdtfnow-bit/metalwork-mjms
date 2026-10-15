/**
 * Logical backup → backups/mjms-<timestamp>.json (+ .sha256). Run against production with
 * DATABASE_URL_UNPOOLED set. Store the output OFF-SITE and encrypted (it contains business data).
 *   npm run backup
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { getDb } from "../src/server/db/client";
import { exportAll } from "../src/server/backup";

async function main() {
  if (process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
  const db = await getDb();
  const b = await exportAll(db);
  mkdirSync("backups", { recursive: true });
  const name = `backups/mjms-${b.createdAt.replace(/[:.]/g, "-")}.json`;
  writeFileSync(name, JSON.stringify(b));
  writeFileSync(`${name}.sha256`, `${b.sha256}  ${name}\n`);
  console.log(`Backup written: ${name}`);
  console.table(b.manifest.filter((m) => m.rows > 0));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
