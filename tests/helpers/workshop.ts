import { eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import { boxheroItems, boxheroLocations, machineTypes, operationTypes } from "@/server/db/schema";
import { saveMachine } from "@/server/services/machines";
import { saveCompetency, grantCompetency } from "@/server/services/employees";
import { createSupplier, setSupplierApproval } from "@/server/services/parties";
import { approveAndReleaseRevision, createDocument, submitRevisionForReview } from "@/server/services/documents";
import { findOrCreatePart, setPartDrawing } from "@/server/services/parts";
import { approveInspectionPlan, createInspectionPlan, recordCalibration, saveInstrument } from "@/server/services/inspections";
import { approveProgramRevision, createProgram, recordProgramVerification, releaseProgramRevision, submitProgramRevision } from "@/server/services/programs";
import { saveMaterialSpec } from "@/server/services/materials";
import { mutate } from "@/server/context";
import { TEST_PASSWORD } from "./db";
import type { Team } from "./fixtures";

const file = (name: string, content = "content") => new File([content], name, { type: name.endsWith(".pdf") ? "application/pdf" : "text/plain" });

let n = 0;

/** Sets up the reusable shop: machines, competencies, supplier, spec, instrument, BoxHero item. */
export async function workshop(db: DB, t: Team) {
  n++;
  const types = await db.select().from(operationTypes);
  const typeId = (code: string) => types.find((x) => x.code === code)!.id;
  const mtypes = await db.select().from(machineTypes);
  const mt = (code: string) => mtypes.find((x) => x.code === code)!.id;
  const mill = await saveMachine(t.admin.ctx, { code: `M0${n}`, name: `Haas VF-2 #${n}`, machineTypeId: mt("CNC_MILL"), operationTypeIds: [typeId("MILL"), typeId("DRILL")] });
  const lathe = await saveMachine(t.admin.ctx, { code: `T0${n}`, name: `Doosan Lynx #${n}`, machineTypeId: mt("CNC_LATHE"), operationTypeIds: [typeId("TURN")] });
  const millComp = await saveCompetency(t.admin.ctx, { code: `CNC-MILL-${n}`, name: "CNC milling (Haas NGC)", operationTypeId: typeId("MILL"), requiresExpiry: true, validityMonths: 24 });
  const turnComp = await saveCompetency(t.admin.ctx, { code: `CNC-TURN-${n}`, name: "CNC turning (Fanuc)", operationTypeId: typeId("TURN") });
  await grantCompetency(t.planner.ctx, { employeeId: t.opA.employeeId!, competencyId: millComp.id });
  await grantCompetency(t.planner.ctx, { employeeId: t.opB.employeeId!, competencyId: turnComp.id });

  const supplier = await createSupplier(t.purchasing.ctx, { code: `MET${n}`, name: `Metals Stockholder ${n}`, categories: ["material"] });
  await setSupplierApproval(t.qm.ctx, supplier.id, { status: "approved", reason: "Approved supplier list" });
  const subcon = await createSupplier(t.purchasing.ctx, { code: `HT${n}`, name: `Heat Treaters ${n}`, categories: ["subcontract"] });
  await setSupplierApproval(t.qm.ctx, subcon.id, { status: "approved", reason: "Approved subcontractor" });
  const spec = await saveMaterialSpec(t.purchasing.ctx, { code: `AL6082-RB-${n}`, grade: "6082-T6", form: "bar", certRequirement: "3.1" });

  const instrument = await saveInstrument(t.qm.ctx, { assetNo: `MIC-${n}`, description: "Micrometer 0-25 mm", instrumentType: "micrometer" });
  await recordCalibration(t.qm.ctx, instrument.id, { calibratedOn: new Date().toISOString().slice(0, 10), result: "pass", asFoundInTolerance: true, certificateNo: "CAL-1" });

  // Simulated BoxHero stock item + location
  const [loc] = await db.insert(boxheroLocations).values({ boxheroLocationId: `L${n}`, name: "Main store" }).onConflictDoNothing().returning();
  const [item] = await db.insert(boxheroItems).values({ boxheroItemId: `90${n}`, name: "6082-T6 Round bar Ø25 x 3m", sku: `AL6082-25-${n}`, quantityTotal: "10", quantities: [{ location_id: loc?.boxheroLocationId ?? `L${n}`, quantity: "10" }] }).returning();
  return { mill, lathe, millComp, turnComp, supplier, subcon, spec, instrument, item, locationId: loc?.boxheroLocationId ?? `L${n}`, typeId };
}

/** Part with a released controlled drawing (author ≠ approver). */
export async function releasedDrawing(t: Team, customerId: string, partNumber: string) {
  const part = await mutate(t.planner.ctx, (tx) => findOrCreatePart(tx, { customerId, partNumber, description: `Part ${partNumber}`, traceabilityLevel: "batch" }));
  const { doc, rev } = await createDocument(t.planner.ctx, { docNumber: `DRG-${partNumber}`, title: `${partNumber} drawing`, docType: "drawing", revision: "A", customerId, partId: part.id, isCustomerSupplied: true }, file(`${partNumber}-A.pdf`, "%PDF drawing A"));
  await submitRevisionForReview(t.planner.ctx, rev.id);
  await approveAndReleaseRevision(t.qm.ctx, rev.id, { password: TEST_PASSWORD });
  await setPartDrawing(t.planner.ctx, part.id, doc.id);
  return { part, doc, rev };
}

export async function approvedPlan(t: Team, stage: "first_off" | "final" | "in_process", partId: string, code: string) {
  const plan = await createInspectionPlan(t.qm.ctx, { code, name: `${stage} plan`, stage, partId }, [
    { name: "Diameter Ø20", charType: "dimensional", nominal: "20.000", tolMinus: "-0.020", tolPlus: "0.020", unit: "mm", instrumentType: "micrometer" },
    { name: "Visual — burrs and finish", charType: "visual" },
  ]);
  await approveInspectionPlan(t.qm.ctx, plan.id, TEST_PASSWORD);
  return plan;
}

export async function releasedProgram(t: Team, name: string, machineId: string, partId: string, revision = "A") {
  const { program, revision: rev } = await createProgram(t.programmer.ctx, { name, partId, machineIds: [machineId] }, { revision, changeDescription: "Initial program" }, file(`${name}.nc`, `%\nO1000 (${name})\nG90 G54\nM30\n%`));
  await submitProgramRevision(t.programmer.ctx, rev.id);
  await recordProgramVerification(t.programmer.ctx, rev.id, "simulated", "Vericut OK");
  await approveProgramRevision(t.qm.ctx, rev.id, { password: TEST_PASSWORD });
  await releaseProgramRevision(t.qm.ctx, rev.id, { password: TEST_PASSWORD });
  return { program, rev };
}

export { file };
export const _u = { eq };
