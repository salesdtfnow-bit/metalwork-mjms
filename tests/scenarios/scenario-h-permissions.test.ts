/** Scenario H — users cannot access restricted records, bypass approvals, alter released records, or act via direct API calls. */
import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import { auditEvents, cncProgramRevisions, documentRevisions } from "@/server/db/schema";
import { login } from "@/server/auth/session";
import { setupDb, TEST_PASSWORD } from "../helpers/db";
import { customer, team, type Team } from "../helpers/fixtures";
import { plannedJob } from "../helpers/flow";
import { file } from "../helpers/workshop";
import { addProgramRevision, approveProgramRevision, recordProgramVerification, submitProgramRevision } from "@/server/services/programs";
import { pgError } from "@/server/errors";

let db: DB;
let t: Team;
const tokens: Record<string, string> = {};

beforeAll(async () => {
  db = await setupDb();
  (globalThis as { __mjmsDb?: Promise<DB> }).__mjmsDb = Promise.resolve(db); // route handlers use the test DB
  t = await team(db);
  for (const k of ["opA", "purchasing", "qm", "sales", "auditor", "planner"] as const) {
    const r = await login(db, t[k].email, TEST_PASSWORD);
    if (!r.ok) throw new Error("login failed");
    tokens[k] = r.token;
  }
});

function req(path: string, opts: { method?: string; token?: string; body?: unknown; origin?: string } = {}) {
  const headers: Record<string, string> = { host: "mjms.test", "content-type": "application/json" };
  if (opts.token) headers.cookie = `mjms_session=${opts.token}`;
  if (opts.origin) headers.origin = opts.origin;
  return new Request(`http://mjms.test${path}`, { method: opts.method ?? "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
}
const params = <T extends object>(p: T) => ({ params: Promise.resolve(p) });

describe("Scenario H: permissions through direct API requests", () => {
  it("rejects unauthenticated and cross-site requests", async () => {
    const { GET } = await import("@/app/api/v1/audit/route");
    expect((await GET(req("/api/v1/audit"), params({}))).status).toBe(401);
    const { POST } = await import("@/app/api/v1/jobs/[id]/status/route");
    const r = await POST(req(`/api/v1/jobs/${crypto.randomUUID()}/status`, { method: "POST", token: tokens.planner, origin: "https://evil.example", body: { status: "cancelled" } }), params({ id: "x" }));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/Cross-site/);
  });

  it("an operator cannot release a CNC program, release material, read the audit trail or cancel a job", async () => {
    const p = await plannedJob(db, t);
    const revB = await addProgramRevision(t.programmer.ctx, p.millProg.program.id, { revision: "B", changeDescription: "change" }, file("b.nc", "%B%"));
    await submitProgramRevision(t.programmer.ctx, revB.id);
    await recordProgramVerification(t.programmer.ctx, revB.id, "simulated", null);
    await approveProgramRevision(t.qm.ctx, revB.id, { password: TEST_PASSWORD });

    const rel = await import("@/app/api/v1/programs/revisions/[id]/release/route");
    const r1 = await rel.POST(req(`/x`, { method: "POST", token: tokens.opA, body: { password: TEST_PASSWORD } }), params({ id: revB.id }));
    expect(r1.status).toBe(403);
    expect((await db.select().from(cncProgramRevisions).where(eq(cncProgramRevisions.id, revB.id)))[0].status).toBe("approved");
    // An authorised user without re-authentication cannot sign either
    const r2 = await rel.POST(req(`/x`, { method: "POST", token: tokens.qm, body: { password: "wrong" } }), params({ id: revB.id }));
    expect(r2.status).toBe(403);
    const r3 = await rel.POST(req(`/x`, { method: "POST", token: tokens.qm, body: { password: TEST_PASSWORD } }), params({ id: revB.id }));
    expect(r3.status).toBe(200);

    const audit = await import("@/app/api/v1/audit/route");
    expect((await audit.GET(req("/api/v1/audit", { token: tokens.opA }), params({}))).status).toBe(403);
    expect((await audit.GET(req("/api/v1/audit", { token: tokens.auditor }), params({}))).status).toBe(200);

    const status = await import("@/app/api/v1/jobs/[id]/status/route");
    const r4 = await status.POST(req("/x", { method: "POST", token: tokens.opA, body: { status: "cancelled", reason: "x" } }), params({ id: p.job.id }));
    expect(r4.status).toBe(403);
    const r5 = await status.POST(req("/x", { method: "POST", token: tokens.planner, body: { status: "ready_for_dispatch" } }), params({ id: p.job.id }));
    expect([400, 409]).toContain(r5.status); // not allowed from current status / gates

    // Denied attempts are recorded in the audit trail
    const denied = await db.select().from(auditEvents).where(eq(auditEvents.outcome, "denied"));
    expect(denied.filter((d) => d.userId === t.opA.userId).length).toBeGreaterThanOrEqual(3);
  });

  it("purchasing cannot complete inspections; sales cannot start production", async () => {
    const insp = await import("@/app/api/v1/inspections/[id]/complete/route");
    const r = await insp.POST(req("/x", { method: "POST", token: tokens.purchasing, body: { decision: "pass", password: TEST_PASSWORD } }), params({ id: crypto.randomUUID() }));
    expect([403, 404]).toContain(r.status);
    const p = await plannedJob(db, t);
    const ss = await import("@/app/api/v1/operations/[id]/start-setup/route");
    const r2 = await ss.POST(req("/x", { method: "POST", token: tokens.sales }), params({ id: p.op10.id }));
    expect(r2.status).toBe(403);
  });

  it("commercially sensitive customer data is redacted for roles without commercial access", async () => {
    const c = await customer(t.sales.ctx);
    const { updateCustomer } = await import("@/server/services/parties");
    await updateCustomer(t.sales.ctx, c.id, { code: c.code, name: c.name, paymentTerms: "30 days EOM", creditLimit: "50000", currency: "GBP" });
    const cu = await import("@/app/api/v1/customers/[id]/route");
    const asSales = await (await cu.GET(req("/x", { token: tokens.sales }), params({ id: c.id }))).json();
    expect(asSales.customer.creditLimit).toBe("50000");
    const asAuditor = await (await cu.GET(req("/x", { token: tokens.auditor }), params({ id: c.id }))).json();
    expect(asAuditor.customer.creditLimit).toBeNull();
    expect(asAuditor.customer.paymentTerms).toBeNull();
    const asOperator = await cu.GET(req("/x", { token: tokens.opA }), params({ id: c.id }));
    expect(asOperator.status).toBe(403);
  });

  it("released records cannot be altered even with direct database writes from the app role", async () => {
    const p = await plannedJob(db, t);
    const err = await db
      .update(documentRevisions)
      .set({ fileId: p.millProg.rev.fileId })
      .where(eq(documentRevisions.id, p.drawing.rev.id))
      .then(() => null, (e: unknown) => e);
    expect(pgError(err)?.message).toMatch(/non-draft revision cannot be replaced/);
    const del = await db.execute(sql`delete from cnc_program_revisions where id = ${p.millProg.rev.id}`).then(() => null, (e: unknown) => e);
    expect(pgError(del)?.message).toMatch(/DELETE is not permitted/);
    const tamper = await db.execute(sql`update approvals set decision = 'approved'`).then(() => null, (e: unknown) => e);
    expect(pgError(tamper)?.message).toMatch(/append-only/);
  });
});
