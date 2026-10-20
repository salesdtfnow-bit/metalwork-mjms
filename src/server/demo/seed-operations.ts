import { eq } from "drizzle-orm";
import type { DemoCtx } from "./seed";
import { boxheroItems, boxheroLocations, jobLines, machineTypes, operationTypes } from "../db/schema";
import { saveCalendar, saveMachine, startDowntime, endDowntime, downtimeReasonsList } from "../services/machines";
import { grantCompetency, saveCompetency, addTrainingRecord } from "../services/employees";
import { approveAndReleaseRevision, createDocument, submitRevisionForReview } from "../services/documents";
import { findOrCreatePart, setPartDrawing } from "../services/parts";
import { approveInspectionPlan, completeInspection, createInspection, getInspection, listInspections, recordCalibration, recordResults, saveInstrument } from "../services/inspections";
import { approveProgramRevision, createProgram, recordProgramVerification, releaseProgramRevision, submitProgramRevision } from "../services/programs";
import { saveMaterialSpec, linkSpecToBoxheroItem, receiveMaterial, addMaterialCertificate, verifyMaterialCertificate, inspectLot, releaseLot, allocateLot, recordMaterialEvent } from "../services/materials";
import { approvePurchaseOrder, createPurchaseOrder, getPurchaseOrder, markPurchaseOrderSent } from "../services/purchasing";
import { createEnquiry, addEnquiryAttachments } from "../services/enquiries";
import { createQuotation, markQuotationSent, recordCustomerResponse, reviewQuotation, saveQuoteLine, submitForReview, verifyAcceptance } from "../services/quotations";
import { convertOrderToJob, registerCustomerOrder, verifyCustomerOrder } from "../services/orders";
import { addOperation, assignOperator, releaseRoute } from "../services/routing";
import { authoriseJob, transitionJob } from "../services/jobs";
import { confirmCheck, finishSetup, signOffOperation, startProduction, startSetup, stopProduction } from "../services/production";
import { approveRelease, checkReleaseItem, getRelease, prepareRelease } from "../services/release";
import { confirmDispatch, createDispatch, recordDelivery } from "../services/dispatch";
import { raiseNcr, updateNcrInvestigation, createCorrectiveAction } from "../services/ncr";
import { createSubcontractOrder } from "../services/subcontract";
import { saveMaintenancePlan, raiseWorkOrder } from "../services/maintenance";
import { saveTool } from "../services/tooling";
import { scheduleOperation } from "../services/planning";
import { processStockOutbox } from "../integrations/boxhero/sync";
import { SimulatedInventoryAdapter } from "../integrations/boxhero/simulated";
import { mutate } from "../context";

type Rec = { id: string };
const PW = () => process.env.DEMO_PASSWORD ?? "Workshop-Demo-2026!";
const txt = (name: string, body: string, type = "text/plain") => new File([body], name, { type });
const pdf = (name: string, title: string) =>
  new File([`%PDF-1.4\n% DEMONSTRATION FILE — ${title}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF`], name, { type: "application/pdf" });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const days = (n: number) => new Date(Date.now() + n * 86_400_000);

export async function seedDemoOperations(demo: DemoCtx, refs: { customers: Record<string, Rec>; suppliers: Record<string, Rec> }): Promise<Record<string, number>> {
  const { db } = demo;
  const u = (email: string) => demo.byEmail.get(email)!;
  const admin = demo.admin;
  const sales = u("sales@demo.test").ctx;
  const manager = u("manager@demo.test").ctx;
  const planner = u("planner@demo.test").ctx;
  const programmer = u("programmer@demo.test").ctx;
  const purchasing = u("purchasing@demo.test").ctx;
  const inspector = u("inspector@demo.test").ctx;
  const qm = u("quality@demo.test").ctx;
  const dispatchCtx = u("dispatch@demo.test").ctx;
  const dan = u("operator1@demo.test");
  const aisha = u("operator2@demo.test");
  const lee = u("operator3@demo.test");
  const inv = new SimulatedInventoryAdapter(db);

  // ── Calendar & machines ──
  const cal = await saveCalendar(admin, {
    name: "Day shift (Mon–Fri 07:00–15:30)",
    shifts: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startTime: "07:00", endTime: "15:30" })),
  });
  const types = await db.select().from(operationTypes);
  const T = (code: string) => types.find((x) => x.code === code)!.id;
  const mtypes = await db.select().from(machineTypes);
  const MT = (code: string) => mtypes.find((x) => x.code === code)!.id;
  const machine = (code: string, name: string, type: string, ops: string[], extra: Record<string, unknown> = {}) =>
    saveMachine(admin, { code, name, machineTypeId: MT(type), operationTypeIds: ops.map(T), calendarId: cal.id, ...extra } as never);
  const m01 = await machine("M01", "Haas VF-2 vertical machining centre", "CNC_MILL", ["MILL", "DRILL", "BORE"], { manufacturer: "Haas", model: "VF-2", controller: "Haas NGC", axes: "3-axis + 4th", workEnvelope: "762 × 406 × 508 mm", location: "Bay 1", hourlyRate: "65" });
  const m02 = await machine("M02", "DMG Mori DMU 50 5-axis", "CNC_MILL", ["MILL", "DRILL", "BORE"], { manufacturer: "DMG Mori", model: "DMU 50 3rd gen", controller: "Siemens 840D sl", axes: "5-axis simultaneous", workEnvelope: "650 × 520 × 475 mm", location: "Bay 1", hourlyRate: "95" });
  const m03 = await machine("M03", "Haas VF-4 vertical machining centre", "CNC_MILL", ["MILL", "DRILL"], { manufacturer: "Haas", model: "VF-4", controller: "Haas NGC", axes: "3-axis", location: "Bay 2", hourlyRate: "65" });
  const t01 = await machine("T01", "Doosan Lynx 220 CNC lathe", "CNC_LATHE", ["TURN"], { manufacturer: "Doosan", model: "Lynx 220LSYC", controller: "Fanuc 0i-TF", axes: "2-axis + C + Y, live tooling", location: "Bay 2", hourlyRate: "55" });
  const t02 = await machine("T02", "Mazak QT-200 CNC lathe", "CNC_LATHE", ["TURN"], { manufacturer: "Mazak", model: "Quick Turn 200", controller: "Mazatrol SmoothG", location: "Bay 2", hourlyRate: "55" });
  await machine("T03", "Colchester Triumph manual lathe", "MANUAL_LATHE", ["MTURN"], { manufacturer: "Colchester", model: "Triumph 2000", location: "Bay 3", hourlyRate: "40" });
  const s01 = await machine("S01", "Kasto bandsaw", "SAW", ["SAW"], { manufacturer: "Kasto", model: "SBA 260", location: "Goods-in", hourlyRate: "30", allowsConcurrent: false });
  const g01 = await machine("G01", "Jones & Shipman surface grinder", "GRINDER", ["GRIND"], { manufacturer: "Jones & Shipman", model: "540", location: "Bay 3", hourlyRate: "50" });

  // ── Competencies ──
  const comp = async (code: string, name: string, op: string, months?: number) => saveCompetency(admin, { code, name, operationTypeId: T(op), requiresExpiry: !!months, validityMonths: months });
  const cMill = await comp("CNC-MILL", "CNC milling (3-axis)", "MILL", 24);
  const cTurn = await comp("CNC-TURN", "CNC turning", "TURN", 24);
  const cSaw = await comp("SAW", "Bandsaw operation", "SAW");
  const cMturn = await comp("MAN-TURN", "Manual turning", "MTURN");
  const cGrind = await comp("GRIND", "Surface grinding", "GRIND", 12);
  for (const [emp, cs] of [
    [dan, [cMill, cSaw]],
    [aisha, [cTurn, cMturn]],
    [lee, [cSaw, cMturn, cGrind]],
  ] as const) {
    for (const c of cs) await grantCompetency(planner, { employeeId: emp.employeeId!, competencyId: c.id });
  }
  await addTrainingRecord(planner, { employeeId: dan.employeeId!, title: "Haas NGC operator course", provider: "Haas Factory Outlet", completedOn: iso(days(-400)) });
  await addTrainingRecord(planner, { employeeId: aisha.employeeId!, title: "Fanuc turning — programming at the control", provider: "In-house", completedOn: iso(days(-200)) });

  // ── Instruments ──
  const inst = async (assetNo: string, description: string, instrumentType: string, calibratedDaysAgo: number) => {
    const i = await saveInstrument(qm, { assetNo, description, instrumentType, calibrationIntervalDays: 365, location: "Inspection room" });
    await recordCalibration(qm, i.id, { calibratedOn: iso(days(-calibratedDaysAgo)), result: "pass", asFoundInTolerance: true, certificateNo: `PCL-${assetNo}`, providerId: refs.suppliers.pcal.id });
    return i;
  };
  const mic = await inst("MIC-001", "Mitutoyo micrometer 0–25 mm", "micrometer", 60);
  await inst("MIC-002", "Mitutoyo micrometer 25–50 mm", "micrometer", 120);
  const cal150 = await inst("CAL-001", "Digital caliper 150 mm", "caliper", 30);
  await inst("HG-001", "Height gauge 300 mm", "height_gauge", 380); // overdue — shows blocked instrument
  await inst("BG-001", "Bore gauge 18–35 mm", "bore_gauge", 200);

  // ── Materials & simulated BoxHero stock ──
  await db.insert(boxheroLocations).values([
    { boxheroLocationId: "1", name: "Main stores rack A" },
    { boxheroLocationId: "2", name: "Offcut rack" },
  ]);
  const bh = async (id: string, name: string, sku: string, qty: string) =>
    (await db.insert(boxheroItems).values({ boxheroItemId: id, name, sku, quantityTotal: qty, quantities: [{ location_id: "1", quantity: qty }] }).returning())[0];
  const bhAl = await bh("1001", "6082-T6 round bar Ø50 × 3 m", "AL6082-50", "6");
  const bhEn24 = await bh("1002", "EN24T round bar Ø40 × 3 m", "EN24T-40", "4");
  const bh316 = await bh("1003", "316L round bar Ø16 × 3 m", "316L-16", "8");
  const bhAlOff = await bh("1090", "6082-T6 offcuts (remnants)", "AL6082-REM", "0");
  const spec = (code: string, grade: string, standard: string, form: "bar" | "plate", fam: string) => saveMaterialSpec(purchasing, { code, grade, standard, form, materialFamily: fam, certRequirement: "3.1" });
  const sAl = await spec("AL6082-T6-RB", "6082-T6", "BS EN 755-2", "bar", "aluminium");
  const sEn = await spec("EN24T-RB", "EN24T (817M40)", "BS 970", "bar", "alloy_steel");
  const s316 = await spec("316L-RB", "316L (1.4404)", "BS EN 10088-3", "bar", "stainless");
  await linkSpecToBoxheroItem(purchasing, sAl.id, bhAl.id, "Ø50");
  await linkSpecToBoxheroItem(purchasing, sEn.id, bhEn24.id, "Ø40");
  await linkSpecToBoxheroItem(purchasing, s316.id, bh316.id, "Ø16");

  // ── Tooling & maintenance ──
  await saveTool(programmer, { assetNo: "FX-0101", description: "Soft-jaw fixture for KAC-4471", toolType: "fixture", location: "Tool crib A3", machineIds: [m01.id], inspectionRequired: true, inspectionIntervalDays: 180 });
  await saveTool(programmer, { assetNo: "EM-1206", description: "Ø12 carbide end mill 3-flute (AlTiN)", toolType: "cutting_tool", lifeUnit: "minutes", lifeLimit: "240", machineIds: [m01.id, m03.id] });
  await saveTool(programmer, { assetNo: "GA-M8", description: "M8×1.25 6H thread plug gauge", toolType: "gauge", location: "Inspection room", inspectionRequired: true, inspectionIntervalDays: 365 });
  await saveMaintenancePlan(planner, { machineId: m01.id, title: "M01 monthly — way lube, coolant concentration, chip conveyor", intervalDays: 30, lastDoneOn: iso(days(-27)) });
  await saveMaintenancePlan(planner, { machineId: t01.id, title: "T01 quarterly — turret alignment check", intervalDays: 90, lastDoneOn: iso(days(-60)) });
  await raiseWorkOrder(planner, { machineId: g01.id, kind: "preventive", title: "Spindle bearing inspection", scheduledStart: days(5), scheduledEnd: new Date(days(5).getTime() + 4 * 3_600_000), locksMachine: true });

  // ── Helpers for the commercial → job chain ──
  const drawing = async (customerId: string, pn: string, desc: string, level = "batch") => {
    const part = await mutate(planner, (tx) => findOrCreatePart(tx, { customerId, partNumber: pn, description: desc, traceabilityLevel: level }));
    const { doc, rev } = await createDocument(sales, { docNumber: `DRG-${pn}`, title: `${pn} ${desc}`, docType: "drawing", revision: "B", customerId, partId: part.id, isCustomerSupplied: true, changeDescription: "Customer issue" }, pdf(`${pn}-B.pdf`, `${pn} drawing rev B`));
    await submitRevisionForReview(sales, rev.id);
    await approveAndReleaseRevision(qm, rev.id, { password: PW() });
    await setPartDrawing(planner, part.id, doc.id);
    return { part, doc, rev };
  };
  const plans = async (pn: string, partId: string, chars: { name: string; nominal: string; tol: string }[]) => {
    const mk = async (stage: "first_off" | "final") => {
      const { createInspectionPlan } = await import("../services/inspections");
      const p = await createInspectionPlan(qm, { code: `${stage === "first_off" ? "FO" : "FIN"}-${pn}`, name: `${stage === "first_off" ? "First-off" : "Final"} inspection ${pn}`, stage, partId }, [
        ...chars.map((c) => ({ name: c.name, charType: "dimensional" as const, nominal: c.nominal, tolMinus: `-${c.tol}`, tolPlus: c.tol, unit: "mm", instrumentType: "micrometer", sampleSize: stage === "first_off" ? "1" : "3" })),
        { name: "Visual: burr-free, no tool marks on datum faces", charType: "visual" as const },
      ]);
      await approveInspectionPlan(qm, p.id, PW());
      return p;
    };
    return { fo: await mk("first_off"), fin: await mk("final") };
  };
  const program = async (number: string, name: string, machineIds: string[], partId: string) => {
    const { program, revision } = await createProgram(programmer, { programNumber: number, name, partId, machineIds }, { revision: "A", changeDescription: "First release from CAM (Fusion 360)" }, txt(`${number}.nc`, `%\nO${number.replace(/\D/g, "").slice(-4)} (${name})\n(DEMO PROGRAM — NOT FOR MACHINE USE)\nG90 G54 G17\nM30\n%`));
    await submitProgramRevision(programmer, revision.id);
    await recordProgramVerification(programmer, revision.id, "simulated", "Simulated in CAM — no collisions");
    await approveProgramRevision(qm, revision.id, { password: PW() });
    await releaseProgramRevision(qm, revision.id, { password: PW() });
    return { program, rev: revision };
  };
  const quoteToJob = async (opts: { customerId: string; pn: string; desc: string; qty: string; drawingRevId: string; material: string; title: string; required: string; mat: string; price: { setup: string; cycle: string; rate: string }[] }) => {
    const enq = await createEnquiry(sales, { customerId: opts.customerId, subject: `RFQ ${opts.pn} × ${opts.qty}`, receivedAt: days(-40), receivedVia: "email", customerReference: `RFQ-${opts.pn}` }, [{ partNumber: opts.pn, description: opts.desc, quantity: opts.qty, materialGrade: opts.material, drawingNumber: `DRG-${opts.pn}`, drawingRevision: "B" }]);
    const { quotation, revision } = await createQuotation(sales, { customerId: opts.customerId, enquiryId: enq.id, title: opts.title, defaultMarginPct: "28", leadTime: "4–5 weeks" });
    await saveQuoteLine(sales, revision.id, {
      partNumber: opts.pn,
      description: opts.desc,
      quantity: opts.qty,
      drawingNumber: `DRG-${opts.pn}`,
      drawingRevision: "B",
      drawingRevisionId: opts.drawingRevId,
      materialSpec: opts.material,
      materialCostPerUnit: opts.mat,
      materialWastagePct: "12",
      programmingCost: "240",
      inspectionCost: "60",
      certificationCost: "25",
      packagingCost: "15",
      operations: opts.price.map((p, i) => ({ description: `Op ${(i + 1) * 10}`, setupMinutes: p.setup, cycleMinutes: p.cycle, ratePerHour: p.rate })),
    });
    await submitForReview(sales, revision.id);
    await reviewQuotation(manager, revision.id, { decision: "approved", password: PW() });
    await markQuotationSent(sales, revision.id, { sentTo: "buyer@customer.test" });
    const res = await recordCustomerResponse(sales, revision.id, { decision: "accepted", reference: `Customer email accepting ${quotation.ref}`, evidence: pdf("acceptance.pdf", "acceptance email") });
    // Under the one-step acceptance setting it is already accepted; otherwise a second person verifies.
    if (!res?.accepted) await verifyAcceptance(manager, revision.id, { password: PW() });
    const po = await registerCustomerOrder(sales, { customerId: opts.customerId, customerPoNumber: `PO-${opts.pn}-${Math.floor(Math.random() * 9000 + 1000)}`, quotationRevisionId: revision.id, requiredDate: opts.required, poDate: iso(days(-30)) }, pdf("customer-po.pdf", "customer purchase order"));
    await verifyCustomerOrder(manager, po.id, { password: PW() });
    const job = await convertOrderToJob(sales, po.id, { title: opts.title, ownerId: u("planner@demo.test").userId, requiredDate: opts.required });
    const [line] = await db.select().from(jobLines).where(eq(jobLines.jobId, job.id));
    return { job, line };
  };
  const buyAndRelease = async (jobId: string, lineId: string, supplierId: string, specId: string, itemId: string, desc: string, qty: string, heat: string) => {
    const po = await createPurchaseOrder(purchasing, { supplierId, kind: "material", requiredDate: iso(days(-20)) }, [{ jobId, materialSpecId: specId, boxheroItemId: itemId, description: desc, quantity: qty, uom: "bar", unitPrice: "42.00", certRequirement: "3.1" }]);
    await approvePurchaseOrder(manager, po.id);
    await markPurchaseOrderSent(purchasing, po.id, `SO-${heat}`);
    const full = await getPurchaseOrder(purchasing, po.id);
    const { lots } = await receiveMaterial(purchasing, { purchaseOrderId: po.id, deliveryNoteNo: `DN-${heat}`, lines: [{ purchaseOrderLineId: full.lines[0].l.id, quantity: qty, heatNumber: heat, boxheroLocationId: "1", storageLocation: "Rack A" }] });
    await processStockOutbox(db, inv);
    const cert = await addMaterialCertificate(purchasing, { lotIds: [lots[0].id], certType: "3.1", certNumber: `MC-${heat}`, heatNumber: heat, issuedBy: "Mill" }, pdf(`cert-${heat}.pdf`, `EN 10204 3.1 certificate heat ${heat}`));
    await verifyMaterialCertificate(inspector, cert.id, { result: "accepted", notes: "Chemistry and mechanicals checked against spec" });
    await inspectLot(inspector, lots[0].id, { result: "pass", notes: "Dimensions and condition OK" });
    await releaseLot(qm, lots[0].id, { password: PW() });
    await allocateLot(planner, { lotId: lots[0].id, jobId, jobLineId: lineId, quantity: qty });
    await recordMaterialEvent(planner, { kind: "issue", lotId: lots[0].id, jobId, quantity: qty, idempotencyKey: `seed-issue-${heat}` });
    await processStockOutbox(db, inv);
    return { po, lot: lots[0] };
  };
  const runOp = async (op: Rec, who: typeof dan, programRevId: string | null, lotId: string | null, good: string, opts: { stopAfter?: "first_off" | "production" } = {}) => {
    await confirmCheck(who.ctx, op.id, { kind: "drawing_reviewed" });
    await confirmCheck(who.ctx, op.id, { kind: "instructions_read" });
    if (programRevId) await confirmCheck(who.ctx, op.id, { kind: "program_confirmed", programRevisionId: programRevId });
    if (lotId) await confirmCheck(who.ctx, op.id, { kind: "material_confirmed", materialLotId: lotId });
    await startSetup(who.ctx, op.id);
    await finishSetup(who.ctx, op.id, "Setup complete, tools touched off");
    if (opts.stopAfter === "first_off") return;
    const fo = (await listInspections(inspector, { open: true })).find((i) => i.i.operationId === op.id && i.i.stage === "first_off");
    if (fo) {
      const d = await getInspection(inspector, fo.i.id);
      await recordResults(inspector, fo.i.id, d.grid.flatMap((g) => g.cells.map((c) => (g.characteristic.charType === "dimensional" ? { characteristicId: g.characteristic.id, sampleNo: c.sampleNo, measuredValue: g.characteristic.nominal!, instrumentId: mic.id } : { characteristicId: g.characteristic.id, sampleNo: c.sampleNo, attributeResult: "pass" as const }))));
      await completeInspection(inspector, fo.i.id, { decision: "pass", password: PW() });
    }
    await startProduction(who.ctx, op.id, { materialLotId: lotId });
    if (opts.stopAfter === "production") return;
    await stopProduction(who.ctx, op.id, { qtyGood: good });
    await signOffOperation(who.ctx, op.id);
  };

  const { kestrel, northfield, severn, ardent } = refs.customers;
  const { midmet, westal, covht } = refs.suppliers;

  // ═══ JOB 1 — Kestrel bracket: complete, released, dispatched, delivered (full traceability) ═══
  const k = await drawing(kestrel.id, "KAC-4471", "Mounting bracket, machined");
  const kPlans = await plans("KAC-4471", k.part.id, [{ name: "Bore Ø12H7", nominal: "12.009", tol: "0.009" }, { name: "Overall length 85", nominal: "85.000", tol: "0.050" }]);
  const kMill = await program("PRG-KAC-OP20", "KAC-4471 Op20 mill complete", [m01.id, m03.id], k.part.id);
  const j1 = await quoteToJob({ customerId: kestrel.id, pn: "KAC-4471", desc: "Mounting bracket, 6082-T6", qty: "120", drawingRevId: k.rev.id, material: "6082-T6", title: "KAC-4471 brackets — call-off 1", required: iso(days(-3)), mat: "3.80", price: [{ setup: "20", cycle: "1", rate: "30" }, { setup: "90", cycle: "6", rate: "65" }] });
  const j1op10 = await addOperation(planner, j1.line.id, { operationTypeId: T("SAW"), title: "Saw blanks 92 mm long", machineId: s01.id, setupMinutesEst: "15", cycleMinutesEst: "1", requiredCompetencyId: cSaw.id, requiresMaterial: true, requiresFirstOff: false });
  const j1op20 = await addOperation(planner, j1.line.id, { operationTypeId: T("MILL"), title: "Mill complete in soft jaws (FX-0101)", machineId: m01.id, setupMinutesEst: "90", cycleMinutesEst: "6", programRevisionId: kMill.rev.id, inspectionPlanId: kPlans.fo.id, requiredCompetencyId: cMill.id, requiresMaterial: false, toolingRequirements: "EM-1206, Ø11.8 drill, Ø12H7 reamer", fixtureRequirements: "FX-0101 soft jaws" });
  await assignOperator(planner, j1op10.id, dan.employeeId!);
  await assignOperator(planner, j1op20.id, dan.employeeId!);
  await releaseRoute(planner, j1.line.id);
  await authoriseJob(manager, j1.job.id);
  const j1mat = await buyAndRelease(j1.job.id, j1.line.id, midmet.id, sAl.id, bhAl.id, "6082-T6 Ø50 bar × 3 m", "4", "A7731-22");
  await runOp(j1op10, dan, null, j1mat.lot.id, "120");
  await runOp(j1op20, dan, kMill.rev.id, null, "120");
  await recordMaterialEvent(planner, { kind: "consume", lotId: j1mat.lot.id, jobId: j1.job.id, quantity: "3", idempotencyKey: "seed-consume-j1" });
  await recordMaterialEvent(planner, { kind: "remnant", lotId: j1mat.lot.id, jobId: j1.job.id, quantity: "1", idempotencyKey: "seed-remnant-j1", remnantBoxheroItemId: bhAlOff.id, reason: "Offcut 1.1 m returned to offcut rack" });
  const fin = await createInspection(inspector, { stage: "final", planId: kPlans.fin.id, jobLineId: j1.line.id, sampleQty: "3" });
  const finD = await getInspection(inspector, fin.id);
  await recordResults(inspector, fin.id, finD.grid.flatMap((g) => g.cells.map((c) => (g.characteristic.charType === "dimensional" ? { characteristicId: g.characteristic.id, sampleNo: c.sampleNo, measuredValue: g.characteristic.nominal!, instrumentId: cal150.id } : { characteristicId: g.characteristic.id, sampleNo: c.sampleNo, attributeResult: "pass" as const }))));
  await completeInspection(inspector, fin.id, { decision: "pass", qtyInspected: "120", qtyAccepted: "120", qtyRejected: "0", password: PW() });
  const rel = await prepareRelease(qm, j1.line.id);
  for (const it of (await getRelease(qm, rel.id)).items) await checkReleaseItem(qm, it.i.id, "pass", "Checked");
  await approveRelease(qm, rel.id, { qtyReleased: "120", password: PW(), comments: "All records reviewed" });
  const d1 = await createDispatch(dispatchCtx, { jobId: j1.job.id, lines: [{ jobLineId: j1.line.id, quantity: "120" }], carrier: "Express Freight UK", trackingRef: "EF123456789GB", packageCount: "2", grossWeightKg: "14", certificatesIncluded: "Certificate of Conformity; EN 10204 3.1 material certificate" });
  await confirmDispatch(dispatchCtx, d1.id);
  await recordDelivery(dispatchCtx, d1.id, {}, pdf("pod.pdf", "proof of delivery"));
  await transitionJob(planner, j1.job.id, "completed");

  // ═══ JOB 2 — Northfield manifold: op10 done, op20 running, op30 heat treat subcontract, NCR open ═══
  const n = await drawing(northfield.id, "NH-220", "Hydraulic manifold block");
  const nPlans = await plans("NH-220", n.part.id, [{ name: "Port bore Ø18H8", nominal: "18.014", tol: "0.013" }]);
  const nMill = await program("PRG-NH220-OP10", "NH-220 Op10 mill ports", [m02.id], n.part.id);
  const nTurn = await program("PRG-NH220-OP20", "NH-220 Op20 turn spigot", [t01.id, t02.id], n.part.id);
  const j2 = await quoteToJob({ customerId: northfield.id, pn: "NH-220", desc: "Manifold block, EN24T", qty: "40", drawingRevId: n.rev.id, material: "EN24T", title: "NH-220 manifolds", required: iso(days(9)), mat: "18.50", price: [{ setup: "120", cycle: "22", rate: "95" }, { setup: "45", cycle: "6", rate: "55" }] });
  const j2op10 = await addOperation(planner, j2.line.id, { operationTypeId: T("MILL"), title: "Mill ports and faces (5-axis)", machineId: m02.id, setupMinutesEst: "120", cycleMinutesEst: "22", programRevisionId: nMill.rev.id, inspectionPlanId: nPlans.fo.id, requiredCompetencyId: cMill.id, requiresMaterial: true });
  const j2op20 = await addOperation(planner, j2.line.id, { operationTypeId: T("TURN"), title: "Turn spigot and face", machineId: t01.id, setupMinutesEst: "45", cycleMinutesEst: "6", programRevisionId: nTurn.rev.id, inspectionPlanId: nPlans.fo.id, requiredCompetencyId: cTurn.id });
  const j2op30 = await addOperation(planner, j2.line.id, { operationTypeId: T("SUBCON"), title: "Harden & temper to 28–32 HRC (Coventry HT)", setupMinutesEst: "0", cycleMinutesEst: "0", requiresFirstOff: false });
  await assignOperator(planner, j2op10.id, dan.employeeId!);
  await assignOperator(planner, j2op20.id, aisha.employeeId!);
  await releaseRoute(planner, j2.line.id);
  await authoriseJob(manager, j2.job.id);
  const j2mat = await buyAndRelease(j2.job.id, j2.line.id, midmet.id, sEn.id, bhEn24.id, "EN24T Ø40 bar × 3 m", "3", "H2219-47");
  await runOp(j2op10, dan, nMill.rev.id, j2mat.lot.id, "40");
  await runOp(j2op20, aisha, nTurn.rev.id, null, "", { stopAfter: "production" }); // running now
  const reasons = await downtimeReasonsList(planner);
  const dt = await startDowntime(aisha.ctx, { machineId: m03.id, reasonId: reasons.find((r) => r.code === "TOOL")!.id, notes: "Insert breakage — replaced", startedAt: days(-1) });
  await endDowntime(aisha.ctx, dt.id, "Back running");
  const ncr = await raiseNcr(u("inspector@demo.test").ctx, { category: "dimension", jobId: j2.job.id, operationId: j2op10.id, qtyAffected: "2", description: "Port bore Ø18H8 measured 18.034 on 2 parts (upper limit 18.027).", containmentAction: "2 parts segregated in red quarantine bin; remaining 38 checked 100% — conforming.", holdOperation: false, holdBatch: false, holdLot: false });
  await updateNcrInvestigation(qm, ncr.id, { rootCause: "Reamer wear beyond tool-life limit; tool life counter not reset after regrind." });
  await createCorrectiveAction(qm, { ncrId: ncr.id, title: "Tool-life control for reamers", problem: "Reamer used beyond its life after regrind", ownerId: u("planner@demo.test").userId, dueDate: iso(days(14)) });
  const sco = await createSubcontractOrder(planner, { operationId: j2op30.id, supplierId: covht.id, process: "heat_treatment", specification: "Harden & temper to 28–32 HRC per NH spec MS-12; certificate required", requiredReturnDate: iso(days(6)), estimatedCost: "180" });
  void sco;

  // ═══ JOB 3 — Severn implant blank: piece-level traceability, awaiting first-off ═══
  const s = await drawing(severn.id, "SMD-118", "Bone screw blank", "piece");
  const sPlans = await plans("SMD-118", s.part.id, [{ name: "Shank Ø4.50", nominal: "4.500", tol: "0.010" }]);
  const sTurn = await program("PRG-SMD118-OP10", "SMD-118 Op10 turn complete", [t02.id], s.part.id);
  const j3 = await quoteToJob({ customerId: severn.id, pn: "SMD-118", desc: "Bone screw blank, 316L", qty: "25", drawingRevId: s.rev.id, material: "316L", title: "SMD-118 implant blanks (serialised)", required: iso(days(16)), mat: "6.20", price: [{ setup: "60", cycle: "8", rate: "55" }] });
  const j3op10 = await addOperation(planner, j3.line.id, { operationTypeId: T("TURN"), title: "Turn complete from bar (sub-spindle part-off)", machineId: t02.id, setupMinutesEst: "60", cycleMinutesEst: "8", programRevisionId: sTurn.rev.id, inspectionPlanId: sPlans.fo.id, requiredCompetencyId: cTurn.id, requiresMaterial: true });
  await assignOperator(planner, j3op10.id, aisha.employeeId!);
  await releaseRoute(planner, j3.line.id);
  await authoriseJob(manager, j3.job.id);
  const { generateSerials } = await import("../services/routing");
  await generateSerials(planner, j3.line.id, 25);
  const j3mat = await buyAndRelease(j3.job.id, j3.line.id, westal.id, s316.id, bh316.id, "316L Ø16 bar × 3 m", "2", "S88124-03");
  await runOp(j3op10, aisha, sTurn.rev.id, j3mat.lot.id, "", { stopAfter: "first_off" });

  // ═══ JOB 4 — Ardent spacer: material ordered, awaiting delivery ═══
  const a = await drawing(ardent.id, "AM-31", "Wheel spacer 20 mm");
  const aMill = await program("PRG-AM31-OP20", "AM-31 Op20 mill PCD", [m03.id], a.part.id);
  const j4 = await quoteToJob({ customerId: ardent.id, pn: "AM-31", desc: "Wheel spacer, 6082-T6 hard anodised", qty: "60", drawingRevId: a.rev.id, material: "6082-T6", title: "AM-31 wheel spacers", required: iso(days(21)), mat: "5.10", price: [{ setup: "40", cycle: "4", rate: "55" }, { setup: "60", cycle: "5", rate: "65" }] });
  const j4op10 = await addOperation(planner, j4.line.id, { operationTypeId: T("TURN"), title: "Turn OD/ID and face to 20.00", machineId: t01.id, setupMinutesEst: "40", cycleMinutesEst: "4", requiredCompetencyId: cTurn.id, requiresMaterial: true, requiresFirstOff: false });
  const j4op20 = await addOperation(planner, j4.line.id, { operationTypeId: T("MILL"), title: "Drill & chamfer PCD", machineId: m03.id, setupMinutesEst: "60", cycleMinutesEst: "5", programRevisionId: aMill.rev.id, requiredCompetencyId: cMill.id, requiresFirstOff: false });
  await assignOperator(planner, j4op10.id, aisha.employeeId!);
  await assignOperator(planner, j4op20.id, dan.employeeId!);
  await releaseRoute(planner, j4.line.id);
  await authoriseJob(manager, j4.job.id);
  const po4 = await createPurchaseOrder(purchasing, { supplierId: midmet.id, kind: "material", requiredDate: iso(days(4)) }, [{ jobId: j4.job.id, materialSpecId: sAl.id, boxheroItemId: bhAl.id, description: "6082-T6 Ø50 bar × 3 m", quantity: "2", uom: "bar", unitPrice: "42.00", certRequirement: "3.1" }]);
  await approvePurchaseOrder(manager, po4.id);
  await markPurchaseOrderSent(purchasing, po4.id, "MM-SO-88211");
  // Schedule future work so the planning board has content
  const nextMorning = (d: number, h = 7) => {
    const x = days(d);
    x.setUTCHours(h, 0, 0, 0);
    return x;
  };
  await scheduleOperation(planner, j4op10.id, { machineId: t01.id, start: nextMorning(6) }).catch(() => undefined);
  await scheduleOperation(planner, j4op20.id, { machineId: m03.id, start: nextMorning(8) }).catch(() => undefined);

  // ── Open commercial pipeline ──
  const e1 = await createEnquiry(sales, { customerId: kestrel.id, subject: "RFQ: KAC-5002 hinge pins × 500", receivedVia: "email", customerReference: "KAE-RFQ-2291", requestedDeliveryDate: iso(days(35)) }, [{ partNumber: "KAC-5002", description: "Hinge pin, 17-4PH H1150", quantity: "500", materialGrade: "17-4PH", tolerances: "Ø6 g6", surfaceFinish: "Ra 0.8" }]);
  await addEnquiryAttachments(sales, e1.id, [pdf("KAC-5002-A.pdf", "KAC-5002 drawing rev A"), txt("KAC-5002.step", "ISO-10303-21; DEMO STEP")]);
  const e2 = await createEnquiry(sales, { customerId: ardent.id, subject: "Uprights — 2 off prototype", receivedVia: "phone" }, [{ partNumber: "AM-77", description: "Front upright, 7075-T6", quantity: "2" }]);
  const { revision: draftRev } = await createQuotation(sales, { customerId: ardent.id, enquiryId: e2.id, title: "AM-77 front upright prototypes" });
  await saveQuoteLine(sales, draftRev.id, { partNumber: "AM-77", description: "Front upright, 7075-T6 (5-axis)", quantity: "2", materialCostPerUnit: "145", programmingCost: "480", operations: [{ description: "5-axis mill op 1", setupMinutes: "180", cycleMinutes: "240", ratePerHour: "95" }] });

  return { machines: 8, competencies: 5, instruments: 5, jobs: 4, enquiries: 2 + 4 };
}

