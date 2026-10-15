/**
 * Scenario A — standard production job, enquiry to traceability record.
 * Scenario B — material traceability (forward from heat number, backward from batch).
 * Scenario C — multiple operators on one job.
 * Scenario F — production gating (material, program, operator, first-off).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import { jobs, operations, simulatedBoxheroTransactions, timeEntries, jobLines, stockSyncTransactions } from "@/server/db/schema";
import { confirmCheck, startProduction, startSetup, myWork } from "@/server/services/production";
import { completeInspection, createInspection, getInspection, recordResults } from "@/server/services/inspections";
import { approveRelease, checkReleaseItem, getRelease, prepareRelease } from "@/server/services/release";
import { confirmDispatch, createDispatch } from "@/server/services/dispatch";
import { transitionJob } from "@/server/services/jobs";
import { jobTrace, traceHeat } from "@/server/services/traceability";
import { jobRoute, assignOperator } from "@/server/services/routing";
import { GateError } from "@/server/errors";
import { setupDb, TEST_PASSWORD, makeUser } from "../helpers/db";
import { team, type Team } from "../helpers/fixtures";
import { issue, materialFor, plannedJob, releaseAndAssign, runOperation } from "../helpers/flow";

let db: DB;
let t: Team;
beforeAll(async () => {
  db = await setupDb();
  t = await team(db);
});

async function gateNames(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e, "expected a gate failure").toBeInstanceOf(GateError);
  return (e as GateError).failures.map((f) => f.gate);
}

describe("Scenario A/B/C/F: standard job with milling and turning", () => {
  it("runs end to end with every gate enforced, and produces a complete traceability record", async () => {
    const p = await plannedJob(db, t, { qty: "50" });

    // F: before route release/authorisation, setup is blocked
    await assignOperator(t.planner.ctx, p.op10.id, t.opA.employeeId!);
    expect(await gateNames(startSetup(t.opA.ctx, p.op10.id))).toEqual(expect.arrayContaining(["route", "material"]));

    // C: operator B (turning) is not qualified for milling → assignment refused
    await expect(assignOperator(t.planner.ctx, p.op10.id, t.opB.employeeId!)).rejects.toThrow(/does not hold a valid/);
    await assignOperator(t.planner.ctx, p.op20.id, t.opB.employeeId!);
    const { releaseRoute } = await import("@/server/services/routing");
    const { authoriseJob } = await import("@/server/services/jobs");
    await releaseRoute(t.planner.ctx, p.line.id);
    await authoriseJob(t.manager.ctx, p.job.id);

    // F: route released but no material yet
    expect(await gateNames(startSetup(t.opA.ctx, p.op10.id))).toContain("material");

    // Materials (B): purchase, receive with heat number, BoxHero stock-in, certify, release, allocate, issue
    const m = await materialFor(db, t, p, "H-77421");
    const [jobAfterReceipt] = await db.select().from(jobs).where(eq(jobs.id, p.job.id));
    expect(jobAfterReceipt.status).toBe("awaiting_material_release");
    expect(await gateNames(startSetup(t.opA.ctx, p.op10.id))).toContain("material"); // allocated but not issued
    await issue(db, t, p.job.id, m.lot.id, "2", "issue-A-1", m.inv);

    // F: op20 cannot start before op10 (dependency)
    expect(await gateNames(startSetup(t.opB.ctx, p.op20.id))).toContain("dependencies");
    // F: an operator not assigned is refused
    const opC = await makeUser(db, ["operator"]);
    expect(await gateNames(startSetup(opC.ctx, p.op10.id))).toContain("operator");

    // Operator A: setup → first-off gate blocks production until approved
    await confirmCheck(t.opA.ctx, p.op10.id, { kind: "drawing_reviewed" });
    await confirmCheck(t.opA.ctx, p.op10.id, { kind: "instructions_read" });
    await expect(confirmCheck(t.opA.ctx, p.op10.id, { kind: "program_confirmed", programRevisionId: p.turnProg.rev.id })).rejects.toThrow(/not the program revision/);
    await startSetup(t.opA.ctx, p.op10.id);
    const { finishSetup } = await import("@/server/services/production");
    const res = await finishSetup(t.opA.ctx, p.op10.id);
    expect(res.firstOffInspection).toMatch(/^INS-/);
    expect(await gateNames(startProduction(t.opA.ctx, p.op10.id))).toEqual(expect.arrayContaining(["first_off", "checks"]));
    // Operator A cannot inspect their own first-off
    const { listInspections } = await import("@/server/services/inspections");
    const fo = (await listInspections(t.inspector.ctx, { open: true })).find((i) => i.i.operationId === p.op10.id)!;
    const opAInspector = { ...t.opA.ctx, actor: { ...t.opA.ctx.actor, permissions: new Set([...t.opA.ctx.actor.permissions, "quality.inspect", "quality.approve_first_off"]) } };
    await expect(recordResults(opAInspector, fo.i.id, [{ attributeResult: "pass" }])).rejects.toThrow(/independent inspector/);
    // Inspector: a missing measurement is never a pass
    const det = await getInspection(t.inspector.ctx, fo.i.id);
    const dim = det.grid.find((g) => g.characteristic.charType === "dimensional")!;
    const vis = det.grid.find((g) => g.characteristic.charType === "visual")!;
    await recordResults(t.inspector.ctx, fo.i.id, [{ characteristicId: vis.characteristic.id, attributeResult: "pass" }]);
    await expect(completeInspection(t.inspector.ctx, fo.i.id, { decision: "pass", password: TEST_PASSWORD })).rejects.toThrow(/missing/);
    await recordResults(t.inspector.ctx, fo.i.id, [{ characteristicId: dim.characteristic.id, measuredValue: "19.995", instrumentId: p.ws.instrument.id }]);
    await completeInspection(t.inspector.ctx, fo.i.id, { decision: "pass", password: TEST_PASSWORD });
    await confirmCheck(t.opA.ctx, p.op10.id, { kind: "program_confirmed", programRevisionId: p.millProg.rev.id });
    await confirmCheck(t.opA.ctx, p.op10.id, { kind: "material_confirmed", materialLotId: m.lot.id });
    await startProduction(t.opA.ctx, p.op10.id);
    const { stopProduction, signOffOperation } = await import("@/server/services/production");
    await stopProduction(t.opA.ctx, p.op10.id, { qtyGood: "50" });
    await signOffOperation(t.opA.ctx, p.op10.id);

    // C: operator B runs op20 with their own records
    const work = await myWork(t.opB.ctx);
    expect(work.ready.map((r) => r.op.id)).toContain(p.op20.id);
    expect((await myWork(t.opA.ctx)).ready.map((r) => r.op.id)).not.toContain(p.op20.id);
    await runOperation(db, t, t.opB, p.op20.id, p, p.turnProg.rev.id, "50");
    const entries = await db.select().from(timeEntries).where(eq(timeEntries.operationId, p.op10.id));
    expect(entries.every((e) => e.employeeId === t.opA.employeeId)).toBe(true);
    expect(entries.find((e) => e.kind === "production")?.programRevisionId).toBe(p.millProg.rev.id);
    expect(entries.find((e) => e.kind === "production")?.materialLotId).toBe(m.lot.id);
    const ops = await db.select().from(operations).where(eq(operations.jobId, p.job.id));
    expect(ops.find((o) => o.id === p.op10.id)?.signedOffBy).toBe(t.opA.userId);
    expect(ops.find((o) => o.id === p.op20.id)?.signedOffBy).toBe(t.opB.userId);
    const route = await jobRoute(t.planner.ctx, p.job.id); // manager sees the whole job
    expect(route).toHaveLength(2);
    expect((await db.select().from(jobs).where(eq(jobs.id, p.job.id)))[0].status).toBe("production_complete");

    // Completion is not just clicking: dispatch is refused before final release
    await expect(transitionJob(t.planner.ctx, p.job.id, "completed")).rejects.toThrow();

    // Final inspection
    const fin = await createInspection(t.inspector.ctx, { stage: "final", planId: p.finalPlan.id, jobLineId: p.line.id, sampleQty: "5" });
    const fd = await getInspection(t.inspector.ctx, fin.id);
    await recordResults(
      t.inspector.ctx,
      fin.id,
      fd.grid.map((g) => (g.characteristic.charType === "dimensional" ? { characteristicId: g.characteristic.id, measuredValue: "20.010", instrumentId: p.ws.instrument.id } : { characteristicId: g.characteristic.id, attributeResult: "pass" as const })),
    );
    await completeInspection(t.inspector.ctx, fin.id, { decision: "pass", qtyInspected: "50", qtyAccepted: "50", qtyRejected: "0", password: TEST_PASSWORD });

    // Final quality release
    const rel = await prepareRelease(t.qm.ctx, p.line.id);
    await expect(approveRelease(t.qm.ctx, rel.id, { qtyReleased: "50", password: TEST_PASSWORD })).rejects.toThrow(/Checklist/);
    const r = await getRelease(t.qm.ctx, rel.id);
    for (const it of r.items) await checkReleaseItem(t.qm.ctx, it.i.id, "pass");
    await expect(approveRelease(t.qm.ctx, rel.id, { qtyReleased: "60", password: TEST_PASSWORD })).rejects.toThrow(/between 1 and 50/);
    const approved = await approveRelease(t.qm.ctx, rel.id, { qtyReleased: "50", password: TEST_PASSWORD });
    expect(approved.fileId).toBeTruthy();
    expect((await db.select().from(jobs).where(eq(jobs.id, p.job.id)))[0].status).toBe("ready_for_dispatch");

    // Dispatch and delivery note
    const dsp = await createDispatch(t.dispatch.ctx, { jobId: p.job.id, lines: [{ jobLineId: p.line.id, quantity: "50" }], carrier: "Express Freight", packageCount: "1" });
    const conf = await confirmDispatch(t.dispatch.ctx, dsp.id);
    expect(conf.jobFullyDispatched).toBe(true);
    await transitionJob(t.planner.ctx, p.job.id, "completed");
    expect((await db.select().from(jobs).where(eq(jobs.id, p.job.id)))[0].status).toBe("completed");

    // A-18: traceability record links every entity, no gaps
    const tr = await jobTrace(t.auditor.ctx, p.job.id);
    expect(tr.gaps).toEqual([]);
    expect(tr.enquiry?.ref).toMatch(/^ENQ-/);
    expect(tr.quote?.rev.status).toBe("accepted");
    expect(tr.order?.status).toBe("converted");
    expect(tr.lines[0].doc?.docNumber).toBe(p.drawing.doc.docNumber);
    expect(tr.materials.lots[0].lot.heatNumber).toBe("H-77421");
    expect(tr.materials.lots[0].certificates[0].verificationResult).toBe("accepted");
    expect(tr.materials.lots[0].stockIn?.status).toBe("confirmed");
    const op10trace = tr.operations.find((o) => o.op.id === p.op10.id)!;
    expect(op10trace.machine).toBe(p.ws.mill.code);
    expect(op10trace.runs.some((x) => x.program === p.millProg.program.programNumber && x.operator.id === t.opA.employeeId)).toBe(true);
    expect(op10trace.inspections.some((i) => i.i.stage === "first_off" && i.i.status === "passed")).toBe(true);
    expect(tr.releases[0].r.status).toBe("approved");
    expect(tr.dispatches[0].status).toBe("dispatched");

    // B: forward trace from the heat number finds this job, the delivery and the customer
    const fwd = await traceHeat(t.auditor.ctx, "H-77421");
    expect(fwd.jobs.map((j) => j.job.id)).toContain(p.job.id);
    expect(fwd.dispatches.map((d) => d.d.jobId)).toContain(p.job.id);
    expect(fwd.customers.map((c) => c.id)).toContain(p.cust.id);
    // BoxHero received exactly one stock-in and one issue (no duplicates)
    const sims = await db.select().from(simulatedBoxheroTransactions).where(eq(simulatedBoxheroTransactions.itemId, p.ws.item.boxheroItemId));
    expect(sims.map((s) => s.type).sort()).toEqual(["in", "out"]);
    // Duplicate issue submission (same key) is not recorded twice
    const again = await issue(db, t, p.job.id, m.lot.id, "2", "issue-A-1", m.inv);
    expect(again.duplicate).toBe(true);
    expect((await db.select().from(stockSyncTransactions).where(and(eq(stockSyncTransactions.jobId, p.job.id)))).length).toBe(2);
    const [line] = await db.select().from(jobLines).where(eq(jobLines.id, p.line.id));
    expect([line.qtyAccepted, line.qtyReleased, line.qtyDispatched]).toEqual(["50.0000", "50.0000", "50.0000"]);
  });

  it("releaseAndAssign helper sets up a second job (smoke)", async () => {
    const p = await plannedJob(db, t, { qty: "10" });
    await releaseAndAssign(t, p);
    expect((await jobRoute(t.planner.ctx, p.job.id)).every((o) => o.assignments.length === 1)).toBe(true);
  });
});
