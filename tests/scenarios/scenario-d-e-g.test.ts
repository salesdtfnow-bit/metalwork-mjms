/**
 * Scenario D — drawing & CNC program revision control.
 * Scenario E — non-conformance, hold, disposition, rework, reinspection, closure.
 * Scenario G — dispatch controls.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import { cncProgramRevisions, documentRevisions, holds, jobLines, jobs, ncrs, operations } from "@/server/db/schema";
import { addRevision, approveAndReleaseRevision, submitRevisionForReview } from "@/server/services/documents";
import { addProgramRevision, approveProgramRevision, recordProgramVerification, releaseProgramRevision, submitProgramRevision } from "@/server/services/programs";
import { authorizeFileAccess } from "@/server/services/files";
import { clearOperationReview, assignOperator } from "@/server/services/routing";
import { startSetup, submitForInspection, signOffOperation, stopProduction, startProduction, confirmCheck } from "@/server/services/production";
import { completeInspection, createInspection, getInspection, listInspections, recordResults } from "@/server/services/inspections";
import { approveDisposition, closeNcr, releaseHold } from "@/server/services/ncr";
import { approveRelease, checkReleaseItem, getRelease, prepareRelease } from "@/server/services/release";
import { createDispatch, confirmDispatch } from "@/server/services/dispatch";
import { holdJob, releaseJobHold } from "@/server/services/jobs";
import { GateError } from "@/server/errors";
import { setupDb, TEST_PASSWORD } from "../helpers/db";
import { team, type Team } from "../helpers/fixtures";
import { issue, materialFor, plannedJob, releaseAndAssign, runOperation } from "../helpers/flow";
import { file } from "../helpers/workshop";

let db: DB;
let t: Team;
beforeAll(async () => {
  db = await setupDb();
  t = await team(db);
});

async function failingGates(p: Promise<unknown>) {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(GateError);
  return (e as GateError).failures.map((f) => f.gate);
}

describe("Scenario D: drawing and CNC program revisions", () => {
  it("keeps old revisions, flags affected operations, and stops operators using obsolete revisions", async () => {
    const p = await plannedJob(db, t);
    await releaseAndAssign(t, p);
    const m = await materialFor(db, t, p, "H-D1");
    await issue(db, t, p.job.id, m.lot.id, "2", "issue-D-1", m.inv);

    // New program revision B released while op10 is not yet complete
    const revB = await addProgramRevision(t.programmer.ctx, p.millProg.program.id, { revision: "B", changeDescription: "Reduced stepover for finish" }, file("op10-b.nc", "%\nO1000 rev B\n%"));
    await submitProgramRevision(t.programmer.ctx, revB.id);
    await recordProgramVerification(t.programmer.ctx, revB.id, "simulated", "OK");
    // Programmer cannot approve their own revision (segregation of duties)
    const progAsApprover = { ...t.programmer.ctx, actor: { ...t.programmer.ctx.actor, permissions: new Set([...t.programmer.ctx.actor.permissions, "programs.approve"]) } };
    await expect(approveProgramRevision(progAsApprover, revB.id, { password: TEST_PASSWORD })).rejects.toThrow(/Independent approval/);
    await approveProgramRevision(t.qm.ctx, revB.id, { password: TEST_PASSWORD });
    const rel = await releaseProgramRevision(t.qm.ctx, revB.id, { password: TEST_PASSWORD });
    expect(rel.flagged).toBe(1);
    const revs = await db.select().from(cncProgramRevisions).where(eq(cncProgramRevisions.programId, p.millProg.program.id));
    expect(revs.find((r) => r.revision === "A")?.status).toBe("superseded");
    expect(revs.find((r) => r.revision === "B")?.status).toBe("released");

    // Operator cannot open the superseded program file; QA/programmers can
    const revA = revs.find((r) => r.revision === "A")!;
    await expect(authorizeFileAccess(t.opA.ctx, revA.fileId)).rejects.toThrow(/only the current released revision/);
    await expect(authorizeFileAccess(t.programmer.ctx, revA.fileId)).resolves.toBeTruthy();
    await expect(authorizeFileAccess(t.opA.ctx, revB.fileId)).resolves.toBeTruthy();

    // Op10 is flagged and blocked until a supervisor reviews it
    const [op10] = await db.select().from(operations).where(eq(operations.id, p.op10.id));
    expect(op10.reviewRequired).toBe(true);
    expect(await failingGates(startSetup(t.opA.ctx, p.op10.id))).toEqual(expect.arrayContaining(["review", "program"]));
    await expect(clearOperationReview(t.planner.ctx, p.op10.id, { reason: "Keep rev A" })).rejects.toThrow(/superseded/);
    await clearOperationReview(t.planner.ctx, p.op10.id, { programRevisionId: revB.id, reason: "Use rev B — finish improvement" });
    await expect(confirmCheck(t.opA.ctx, p.op10.id, { kind: "program_confirmed", programRevisionId: revA.id })).rejects.toThrow(/not the program revision/);

    // Drawing revision B released → open job line and operations flagged, not auto-switched
    const drB = await addRevision(t.planner.ctx, p.drawing.doc.id, { revision: "B", changeDescription: "Customer ECN-114: chamfer added" }, file("drg-b.pdf", "%PDF B"));
    await submitRevisionForReview(t.planner.ctx, drB.id);
    await expect(approveAndReleaseRevision(t.planner.ctx, drB.id, { password: TEST_PASSWORD })).rejects.toThrow();
    const out = await approveAndReleaseRevision(t.qm.ctx, drB.id, { password: TEST_PASSWORD });
    expect(out.impact.operations).toBe(2);
    const [line] = await db.select().from(jobLines).where(eq(jobLines.id, p.line.id));
    expect(line.drawingReviewRequired).toBe(true);
    expect(line.drawingRevisionId).toBe(p.drawing.rev.id); // not silently replaced
    const [drA] = await db.select().from(documentRevisions).where(eq(documentRevisions.id, p.drawing.rev.id));
    expect(drA.status).toBe("superseded");
    expect(drA.fileId).toBeTruthy(); // previous revision still accessible to document controllers
    await expect(authorizeFileAccess(t.opA.ctx, drA.fileId)).rejects.toThrow(/superseded/);
    expect(await failingGates(startSetup(t.opA.ctx, p.op10.id))).toEqual(expect.arrayContaining(["drawing", "review"]));
    await clearOperationReview(t.planner.ctx, p.op10.id, { drawingRevisionId: drB.id, reason: "ECN-114 accepted by customer PO amendment" });
    const gatesAfter = await startSetup(t.opA.ctx, p.op10.id).then(() => "started", (e) => (e instanceof GateError ? e.failures.map((f) => f.gate) : String(e)));
    expect(gatesAfter).toBe("started");
  });
});

describe("Scenario E: non-conformance with rework", () => {
  it("fails an inspection, holds the work, reworks, reinspects and closes with full history", async () => {
    const p = await plannedJob(db, t);
    await releaseAndAssign(t, p);
    const m = await materialFor(db, t, p, "H-E1");
    await issue(db, t, p.job.id, m.lot.id, "2", "issue-E-1", m.inv);
    await runOperation(db, t, t.opA, p.op10.id, p, p.millProg.rev.id, "50", m.lot.id);
    // op20: first-off passes, then an in-process inspection fails
    await confirmCheck(t.opB.ctx, p.op20.id, { kind: "drawing_reviewed" });
    await confirmCheck(t.opB.ctx, p.op20.id, { kind: "instructions_read" });
    await confirmCheck(t.opB.ctx, p.op20.id, { kind: "program_confirmed", programRevisionId: p.turnProg.rev.id });
    await startSetup(t.opB.ctx, p.op20.id);
    const { finishSetup } = await import("@/server/services/production");
    await finishSetup(t.opB.ctx, p.op20.id);
    const fo = (await listInspections(t.inspector.ctx, { open: true })).find((i) => i.i.operationId === p.op20.id)!;
    const fod = await getInspection(t.inspector.ctx, fo.i.id);
    await recordResults(t.inspector.ctx, fo.i.id, fod.grid.map((g) => (g.characteristic.charType === "dimensional" ? { characteristicId: g.characteristic.id, measuredValue: "20.000", instrumentId: p.ws.instrument.id } : { characteristicId: g.characteristic.id, attributeResult: "pass" as const })));
    await completeInspection(t.inspector.ctx, fo.i.id, { decision: "pass", password: TEST_PASSWORD });
    await startProduction(t.opB.ctx, p.op20.id);
    await stopProduction(t.opB.ctx, p.op20.id, { qtyGood: "50" });
    const ipi = await submitForInspection(t.opB.ctx, p.op20.id);
    // in-process inspection with a plan: diameter out of tolerance
    const { createInspectionPlan, approveInspectionPlan } = await import("@/server/services/inspections");
    const plan = await createInspectionPlan(t.qm.ctx, { code: `IP-${p.line.id.slice(0, 6)}`, name: "In-process", stage: "in_process", partId: p.drawing.part.id }, [{ name: "OD", charType: "dimensional", nominal: "20", tolMinus: "-0.02", tolPlus: "0.02", unit: "mm" }]);
    await approveInspectionPlan(t.qm.ctx, plan.id, TEST_PASSWORD);
    const { inspections } = await import("@/server/db/schema");
    await db.update(inspections).set({ planId: plan.id }).where(eq(inspections.id, ipi.id));
    const ipd = await getInspection(t.inspector.ctx, ipi.id);
    await recordResults(t.inspector.ctx, ipi.id, [{ characteristicId: ipd.grid[0].characteristic.id, measuredValue: "20.060", instrumentId: p.ws.instrument.id }]);
    expect((await getInspection(t.inspector.ctx, ipi.id)).failed).toBe(1);
    await expect(completeInspection(t.inspector.ctx, ipi.id, { decision: "pass" })).rejects.toThrow(/out of tolerance/);
    const failed = await completeInspection(t.inspector.ctx, ipi.id, { decision: "fail", qtyInspected: "50", qtyRejected: "12", notes: "OD oversize on 12 parts" });
    expect(failed.ncrId).toBeTruthy();
    const [ncr] = await db.select().from(ncrs).where(eq(ncrs.id, failed.ncrId!));
    expect(ncr.heatNumber).toBeNull();
    const [heldOp] = await db.select().from(operations).where(eq(operations.id, p.op20.id));
    expect(heldOp.status).toBe("on_hold");
    expect(await failingGates(startProduction(t.opB.ctx, p.op20.id))).toContain("hold");
    expect((await db.select().from(jobs).where(eq(jobs.id, p.job.id)))[0].status).toBe("non_conformance");

    // Disposition: rework (signed), creates a rework operation linked to the NCR
    await expect(approveDisposition(t.qm.ctx, ncr.id, { disposition: "use_as_is", notes: "x", password: TEST_PASSWORD })).rejects.toThrow(/concession/);
    const disp = await approveDisposition(t.qm.ctx, ncr.id, { disposition: "rework", notes: "Re-turn OD to size on 12 parts", password: TEST_PASSWORD });
    expect(disp.reworkOperationIds).toHaveLength(1);
    const rwId = disp.reworkOperationIds[0];
    // NCR cannot close before rework + reinspection
    await expect(closeNcr(t.qm.ctx, ncr.id, "done")).rejects.toThrow(/not complete/);
    // Release the operation hold (quality) and complete op20 for the good parts
    const opHolds = await db.select().from(holds).where(eq(holds.ncrId, ncr.id));
    await expect(releaseHold(t.planner.ctx, opHolds[0].id, "ok")).rejects.toThrow(/Permission required: holds.release/);
    await releaseHold(t.qm.ctx, opHolds[0].id, "Good parts segregated; 12 parts tagged for rework");
    await signOffOperation(t.opB.ctx, p.op20.id, { shortfallReason: "12 parts to rework under NCR" }).catch(async (e) => {
      throw e;
    });
    // Rework operation
    await assignOperator(t.planner.ctx, rwId, t.opB.employeeId!);
    const { refreshReadiness } = await import("@/server/services/routing");
    await refreshReadiness(t.planner.ctx, p.job.id);
    await db.update(operations).set({ status: "ready", setupStatus: "complete", requiresFirstOff: false, firstOffStatus: "not_required" }).where(eq(operations.id, rwId));
    await confirmCheck(t.opB.ctx, rwId, { kind: "drawing_reviewed" });
    await confirmCheck(t.opB.ctx, rwId, { kind: "instructions_read" });
    await confirmCheck(t.opB.ctx, rwId, { kind: "program_confirmed", programRevisionId: p.turnProg.rev.id });
    await startProduction(t.opB.ctx, rwId);
    await stopProduction(t.opB.ctx, rwId, { qtyGood: "12" });
    await signOffOperation(t.opB.ctx, rwId);
    const [afterRw] = await db.select().from(ncrs).where(eq(ncrs.id, ncr.id));
    expect(afterRw.status).toBe("awaiting_reinspection");
    // Reinspection passes → NCR closes; history retained
    await recordResults(t.inspector.ctx, afterRw.reinspectionId!, [{ attributeResult: "pass", comment: "12/12 OD in tolerance" }]);
    await completeInspection(t.inspector.ctx, afterRw.reinspectionId!, { decision: "pass" });
    await closeNcr(t.qm.ctx, ncr.id, "Reworked and reinspected; root cause: worn insert");
    const [closed] = await db.select().from(ncrs).where(eq(ncrs.id, ncr.id));
    expect(closed.status).toBe("closed");
    const { getNcr } = await import("@/server/services/ncr");
    const hist = await getNcr(t.qm.ctx, ncr.id);
    expect(hist.inspection?.status).toBe("failed");
    expect(hist.reinspection?.status).toBe("passed");
    expect(hist.rework[0].status).toBe("complete");
  });
});

describe("Scenario G: dispatch controls", () => {
  it("refuses unreleased, excess, held and on-hold-job quantities", async () => {
    const p = await plannedJob(db, t, { qty: "20" });
    await releaseAndAssign(t, p);
    const m = await materialFor(db, t, p, "H-G1");
    await issue(db, t, p.job.id, m.lot.id, "2", "issue-G-1", m.inv);
    await runOperation(db, t, t.opA, p.op10.id, p, p.millProg.rev.id, "20", m.lot.id);
    await runOperation(db, t, t.opB, p.op20.id, p, p.turnProg.rev.id, "20");
    // No final release → no dispatch
    await expect(createDispatch(t.dispatch.ctx, { jobId: p.job.id, lines: [{ jobLineId: p.line.id, quantity: "20" }] })).rejects.toThrow(/no approved final quality release/);
    // Final inspection accepts 18, rejects 2 (NCR raised automatically)
    const fin = await createInspection(t.inspector.ctx, { stage: "final", jobLineId: p.line.id, sampleQty: "20" });
    await recordResults(t.inspector.ctx, fin.id, [{ attributeResult: "pass" }]);
    await completeInspection(t.inspector.ctx, fin.id, { decision: "pass", qtyInspected: "20", qtyAccepted: "18", qtyRejected: "2", password: TEST_PASSWORD });
    const rel = await prepareRelease(t.qm.ctx, p.line.id);
    for (const it of (await getRelease(t.qm.ctx, rel.id)).items) await checkReleaseItem(t.qm.ctx, it.i.id, "pass");
    // An open NCR on the line blocks release
    await expect(approveRelease(t.qm.ctx, rel.id, { qtyReleased: "18", password: TEST_PASSWORD })).rejects.toThrow(/non-conformances/);
    const openNcr = (await db.select().from(ncrs).where(eq(ncrs.jobLineId, p.line.id))).find((n) => n.status !== "closed")!;
    await approveDisposition(t.qm.ctx, openNcr.id, { disposition: "scrap", notes: "2 parts scrapped", password: TEST_PASSWORD });
    await closeNcr(t.qm.ctx, openNcr.id, "Scrapped");
    // A production operator cannot release parts they made
    const operatorQm = { ...t.opA.ctx, actor: { ...t.opA.ctx.actor, permissions: new Set([...t.opA.ctx.actor.permissions, "quality.release"]) } };
    await expect(approveRelease(operatorQm, rel.id, { qtyReleased: "18", password: TEST_PASSWORD })).rejects.toThrow(/independent of production/);
    await approveRelease(t.qm.ctx, rel.id, { qtyReleased: "18", password: TEST_PASSWORD });
    // Cannot dispatch more than released (18), nor the rejected parts
    await expect(createDispatch(t.dispatch.ctx, { jobId: p.job.id, lines: [{ jobLineId: p.line.id, quantity: "20" }] })).rejects.toThrow(/only 18/);
    // Job on hold → no dispatch
    await holdJob(t.planner.ctx, p.job.id, "Customer requested stop pending ECN");
    await expect(createDispatch(t.dispatch.ctx, { jobId: p.job.id, lines: [{ jobLineId: p.line.id, quantity: "10" }] })).rejects.toThrow(/on hold/);
    await releaseJobHold(t.planner.ctx, p.job.id, "Customer confirmed proceed");
    // Partial dispatches: 10 then 8; a third is refused
    const d1 = await createDispatch(t.dispatch.ctx, { jobId: p.job.id, lines: [{ jobLineId: p.line.id, quantity: "10" }] });
    await expect(createDispatch(t.dispatch.ctx, { jobId: p.job.id, lines: [{ jobLineId: p.line.id, quantity: "10" }] })).rejects.toThrow(/only 8/);
    await confirmDispatch(t.dispatch.ctx, d1.id);
    const d2 = await createDispatch(t.dispatch.ctx, { jobId: p.job.id, lines: [{ jobLineId: p.line.id, quantity: "8" }] });
    await confirmDispatch(t.dispatch.ctx, d2.id);
    await expect(createDispatch(t.dispatch.ctx, { jobId: p.job.id, lines: [{ jobLineId: p.line.id, quantity: "1" }] })).rejects.toThrow(/only 0/);
    const [line] = await db.select().from(jobLines).where(eq(jobLines.id, p.line.id));
    expect(line.qtyDispatched).toBe("18.0000");
  });
});
