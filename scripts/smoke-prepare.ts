/**
 * Smoke-test preparation (local demo DB): creates a session per demo role and collects
 * record ids, written to .data/smoke.json. Run with the app server STOPPED (PGlite is single-process).
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getDb } from "../src/server/db/client";
import { createSession } from "../src/server/auth/session";
import * as s from "../src/server/db/schema";

async function main() {
  const db = await getDb();
  const emails = ["admin", "manager", "sales", "purchasing", "planner", "programmer", "operator1", "inspector", "quality", "dispatch", "auditor"].map((e) => `${e}@demo.test`);
  const tokens: Record<string, string> = {};
  for (const email of emails) {
    const [u] = await db.select().from(s.users).where(eq(s.users.email, email));
    if (!u) throw new Error(`missing ${email} — run npm run db:seed:demo`);
    tokens[email] = (await createSession(db, u.id)).token;
  }
  const first = async <T extends { id: string }>(rows: Promise<T[]>) => (await rows)[0]?.id ?? null;
  const ids = {
    customer: await first(db.select({ id: s.customers.id }).from(s.customers)),
    supplier: await first(db.select({ id: s.suppliers.id }).from(s.suppliers)),
    enquiry: await first(db.select({ id: s.enquiries.id }).from(s.enquiries)),
    quotation: await first(db.select({ id: s.quotations.id }).from(s.quotations)),
    order: await first(db.select({ id: s.customerOrders.id }).from(s.customerOrders)),
    jobs: (await db.select({ id: s.jobs.id }).from(s.jobs)).map((r) => r.id),
    part: await first(db.select({ id: s.parts.id }).from(s.parts)),
    machine: await first(db.select({ id: s.machines.id }).from(s.machines)),
    employee: await first(db.select({ id: s.employees.id }).from(s.employees)),
    program: await first(db.select({ id: s.cncPrograms.id }).from(s.cncPrograms)),
    lot: await first(db.select({ id: s.materialLots.id }).from(s.materialLots)),
    po: await first(db.select({ id: s.purchaseOrders.id }).from(s.purchaseOrders)),
    inspection: await first(db.select({ id: s.inspections.id }).from(s.inspections)),
    plan: await first(db.select({ id: s.inspectionPlans.id }).from(s.inspectionPlans)),
    instrument: await first(db.select({ id: s.measuringInstruments.id }).from(s.measuringInstruments)),
    release: await first(db.select({ id: s.finalReleases.id }).from(s.finalReleases)),
    ncr: await first(db.select({ id: s.ncrs.id }).from(s.ncrs)),
    tool: await first(db.select({ id: s.tools.id }).from(s.tools)),
    workOrder: await first(db.select({ id: s.maintenanceWorkOrders.id }).from(s.maintenanceWorkOrders)),
    subcontract: await first(db.select({ id: s.subcontractOrders.id }).from(s.subcontractOrders)),
    dispatch: await first(db.select({ id: s.dispatches.id }).from(s.dispatches)),
    document: await first(db.select({ id: s.controlledDocuments.id }).from(s.controlledDocuments)),
    operation: await first(db.select({ id: s.operations.id }).from(s.operations)),
    user: await first(db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, "sales@demo.test"))),
    inbound: null as string | null,
  };
  writeFileSync(".data/smoke.json", JSON.stringify({ tokens, ids }, null, 2));
  console.log("prepared", Object.keys(tokens).length, "sessions");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
