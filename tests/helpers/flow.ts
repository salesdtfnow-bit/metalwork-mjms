import { eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import { jobLines, operations } from "@/server/db/schema";
import { addOperation, assignOperator, releaseRoute } from "@/server/services/routing";
import { authoriseJob } from "@/server/services/jobs";
import { approvePurchaseOrder, createPurchaseOrder, markPurchaseOrderSent } from "@/server/services/purchasing";
import { addMaterialCertificate, allocateLot, inspectLot, receiveMaterial, recordMaterialEvent, releaseLot, verifyMaterialCertificate } from "@/server/services/materials";
import { processStockOutbox } from "@/server/integrations/boxhero/sync";
import { SimulatedInventoryAdapter } from "@/server/integrations/boxhero/simulated";
import { confirmCheck, finishSetup, signOffOperation, startProduction, startSetup, stopProduction } from "@/server/services/production";
import { completeInspection, recordResults } from "@/server/services/inspections";
import { TEST_PASSWORD } from "./db";
import { jobFromScratch, customer, type Team } from "./fixtures";
import { approvedPlan, releasedDrawing, releasedProgram, workshop, file } from "./workshop";

let seq = 0;

/** Builds a job with released drawing, programs, plans and a 2-operation route (mill → turn). */
export async function plannedJob(db: DB, t: Team, opts: { qty?: string } = {}) {
  seq++;
  const ws = await workshop(db, t);
  const cust = await customer(t.sales.ctx);
  const pn = `FLG-${seq}00`;
  const drawing = await releasedDrawing(t, cust.id, pn);
  const qty = opts.qty ?? "50";
  const { job } = await jobFromScratch(t, { customer: cust, qty, lines: [{ partNumber: pn, description: `Flange ${pn}`, drawingRevisionId: drawing.rev.id }] });
  const [line] = await db.select().from(jobLines).where(eq(jobLines.jobId, job.id));
  const foPlan = await approvedPlan(t, "first_off", drawing.part.id, `FO-${pn}`);
  const finalPlan = await approvedPlan(t, "final", drawing.part.id, `FIN-${pn}`);
  const millProg = await releasedProgram(t, `${pn}-OP10`, ws.mill.id, drawing.part.id);
  const turnProg = await releasedProgram(t, `${pn}-OP20`, ws.lathe.id, drawing.part.id);
  const op10 = await addOperation(t.planner.ctx, line.id, {
    operationTypeId: ws.typeId("MILL"),
    title: "Mill flats and drill PCD",
    machineId: ws.mill.id,
    setupMinutesEst: "60",
    cycleMinutesEst: "4",
    programRevisionId: millProg.rev.id,
    inspectionPlanId: foPlan.id,
    requiredCompetencyId: ws.millComp.id,
    requiresMaterial: true,
  });
  const op20 = await addOperation(t.planner.ctx, line.id, {
    operationTypeId: ws.typeId("TURN"),
    title: "Turn OD and face",
    machineId: ws.lathe.id,
    setupMinutesEst: "30",
    cycleMinutesEst: "3",
    programRevisionId: turnProg.rev.id,
    inspectionPlanId: foPlan.id,
    requiredCompetencyId: ws.turnComp.id,
    requiresMaterial: false,
  });
  return { ws, cust, drawing, job, line, foPlan, finalPlan, millProg, turnProg, op10, op20 };
}

/** Purchasing → receipt (heat no.) → BoxHero → cert verify → inspection → release → allocate → issue. */
export async function materialFor(db: DB, t: Team, p: Awaited<ReturnType<typeof plannedJob>>, heatNumber: string, adapter?: SimulatedInventoryAdapter) {
  const inv = adapter ?? new SimulatedInventoryAdapter(db);
  const po = await createPurchaseOrder(t.purchasing.ctx, { supplierId: p.ws.supplier.id, kind: "material" }, [
    { jobId: p.job.id, materialSpecId: p.ws.spec.id, boxheroItemId: p.ws.item.id, description: "6082-T6 Ø25 bar", quantity: "2", uom: "bar", unitPrice: "38.50", certRequirement: "3.1" },
  ]);
  await approvePurchaseOrder(t.manager.ctx, po.id);
  await markPurchaseOrderSent(t.purchasing.ctx, po.id, "SO-55512");
  const { getPurchaseOrder } = await import("@/server/services/purchasing");
  const full = await getPurchaseOrder(t.purchasing.ctx, po.id);
  const { lots } = await receiveMaterial(t.purchasing.ctx, { purchaseOrderId: po.id, deliveryNoteNo: "DN-8812", lines: [{ purchaseOrderLineId: full.lines[0].l.id, quantity: "2", heatNumber, boxheroLocationId: p.ws.locationId }] });
  const lot = lots[0];
  await processStockOutbox(db, inv);
  const cert = await addMaterialCertificate(t.purchasing.ctx, { lotIds: [lot.id], certType: "3.1", certNumber: `CERT-${heatNumber}`, heatNumber }, file("cert.pdf", "%PDF cert"));
  await verifyMaterialCertificate(t.inspector.ctx, cert.id, { result: "accepted" });
  await inspectLot(t.inspector.ctx, lot.id, { result: "pass" });
  await releaseLot(t.qm.ctx, lot.id, { password: TEST_PASSWORD });
  await allocateLot(t.planner.ctx, { lotId: lot.id, jobId: p.job.id, jobLineId: p.line.id, quantity: "2" });
  return { po, lot, cert, inv };
}

export async function issue(db: DB, t: Team, jobId: string, lotId: string, qty: string, key: string, inv?: SimulatedInventoryAdapter) {
  const r = await recordMaterialEvent(t.planner.ctx, { kind: "issue", lotId, jobId, quantity: qty, idempotencyKey: key });
  await processStockOutbox(db, inv ?? new SimulatedInventoryAdapter(db));
  return r;
}

export async function releaseAndAssign(t: Team, p: Awaited<ReturnType<typeof plannedJob>>) {
  await assignOperator(t.planner.ctx, p.op10.id, t.opA.employeeId!);
  await assignOperator(t.planner.ctx, p.op20.id, t.opB.employeeId!);
  await releaseRoute(t.planner.ctx, p.line.id);
  await authoriseJob(t.manager.ctx, p.job.id);
}

/** Operator runs an operation end to end, with an independent first-off inspection. */
export async function runOperation(db: DB, t: Team, opUser: Team["opA"], opId: string, p: Awaited<ReturnType<typeof plannedJob>>, programRevId: string, qty: string, lotId?: string) {
  await confirmCheck(opUser.ctx, opId, { kind: "drawing_reviewed" });
  await confirmCheck(opUser.ctx, opId, { kind: "instructions_read" });
  await confirmCheck(opUser.ctx, opId, { kind: "program_confirmed", programRevisionId: programRevId });
  if (lotId) await confirmCheck(opUser.ctx, opId, { kind: "material_confirmed", materialLotId: lotId });
  await startSetup(opUser.ctx, opId);
  await finishSetup(opUser.ctx, opId);
  const [op] = await db.select().from(operations).where(eq(operations.id, opId));
  const { listInspections, getInspection } = await import("@/server/services/inspections");
  const fo = (await listInspections(t.inspector.ctx, { open: true })).find((i) => i.i.operationId === opId && i.i.stage === "first_off")!;
  const detail = await getInspection(t.inspector.ctx, fo.i.id);
  await recordResults(
    t.inspector.ctx,
    fo.i.id,
    detail.grid.map((g) => (g.characteristic.charType === "dimensional" ? { characteristicId: g.characteristic.id, sampleNo: 1, measuredValue: "20.004", instrumentId: p.ws.instrument.id } : { characteristicId: g.characteristic.id, sampleNo: 1, attributeResult: "pass" as const })),
  );
  await completeInspection(t.inspector.ctx, fo.i.id, { decision: "pass", password: TEST_PASSWORD });
  await startProduction(opUser.ctx, opId, { materialLotId: lotId });
  await stopProduction(opUser.ctx, opId, { qtyGood: qty });
  await signOffOperation(opUser.ctx, opId);
  return op;
}
