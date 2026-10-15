import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  calibrationRecords,
  documentRevisions,
  employees,
  files,
  inspectionCharacteristics,
  inspectionEvidence,
  inspectionPlans,
  inspectionResults,
  inspections,
  jobLines,
  jobs,
  machines,
  materialLots,
  measuringInstruments,
  operations,
  timeEntries,
  users,
} from "../db/schema";
import { audit } from "../audit";
import { can, mutate, requirePermission, requireAnyPermission, type Ctx } from "../context";
import { forbidden, invalid, notFound } from "../errors";
import { nextRef, REF } from "../refs";
import { d } from "@/lib/decimal";
import { addDaysISO, todayISO } from "@/lib/format";
import { storeUpload } from "../storage";
import { signApproval } from "./approvals";
import { getSettings } from "./settings";
import { notify } from "./notifications";

export const STAGES = ["incoming", "first_off", "in_process", "final", "subcontract_return", "other"] as const;

// ───────────── Plans ─────────────

export const characteristicInput = z.object({
  balloonNo: z.string().nullish(),
  name: z.string().trim().min(1, "Characteristic name is required."),
  charType: z.enum(["dimensional", "visual", "attribute", "document", "functional", "hardness", "surface"]).default("dimensional"),
  specification: z.string().nullish(),
  nominal: z.string().nullish(),
  tolMinus: z.string().nullish(),
  tolPlus: z.string().nullish(),
  unit: z.string().nullish(),
  method: z.string().nullish(),
  instrumentType: z.string().nullish(),
  sampleSize: z.string().default("1"),
  frequency: z.string().nullish(),
  acceptanceCriteria: z.string().nullish(),
  evidenceRequired: z.boolean().default(false),
  isCritical: z.boolean().default(false),
});
export const planInput = z.object({
  code: z.string().trim().min(2).max(40).transform((s) => s.toUpperCase()),
  name: z.string().trim().min(2),
  stage: z.enum(STAGES),
  partId: z.string().uuid().nullish(),
  customerId: z.string().uuid().nullish(),
  materialSpecId: z.string().uuid().nullish(),
  operationTypeId: z.string().uuid().nullish(),
  jobId: z.string().uuid().nullish(),
  drawingRevisionId: z.string().uuid().nullish(),
  inspectorRole: z.string().nullish(),
  notes: z.string().nullish(),
});

function validateChar(c: z.output<typeof characteristicInput>) {
  if (c.charType === "dimensional" || c.charType === "hardness" || c.charType === "surface") {
    if (c.nominal == null || c.nominal === "") throw invalid(`"${c.name}": a nominal value is required for measured characteristics.`);
    for (const v of [c.nominal, c.tolMinus ?? "0", c.tolPlus ?? "0"]) if (!/^-?\d+(\.\d+)?$/.test(String(v))) throw invalid(`"${c.name}": tolerance values must be numbers.`);
    if (d(c.tolMinus ?? 0).greaterThan(d(c.tolPlus ?? 0))) throw invalid(`"${c.name}": lower tolerance must not exceed upper tolerance.`);
  }
}

export async function createInspectionPlan(ctx: Ctx, raw: z.input<typeof planInput>, chars: z.input<typeof characteristicInput>[]) {
  requirePermission(ctx, "quality.plans");
  const data = planInput.parse(raw);
  const cs = chars.map((c) => characteristicInput.parse(c));
  cs.forEach(validateChar);
  return mutate(ctx, async (tx) => {
    const existing = await tx.db.select({ v: inspectionPlans.version }).from(inspectionPlans).where(eq(inspectionPlans.code, data.code));
    const version = Math.max(0, ...existing.map((e) => e.v)) + 1;
    const [plan] = await tx.db.insert(inspectionPlans).values({ ...data, version }).returning();
    if (cs.length) await tx.db.insert(inspectionCharacteristics).values(cs.map((c, i) => ({ ...c, planId: plan.id, seq: (i + 1) * 10 })));
    await audit(tx, { action: "inspection_plan.create", entityType: "inspection_plan", entityId: plan.id, entityRef: `${plan.code} v${version}`, after: { ...data, characteristics: cs.length } });
    return plan;
  });
}

export async function addCharacteristic(ctx: Ctx, planId: string, raw: z.input<typeof characteristicInput>) {
  requirePermission(ctx, "quality.plans");
  const c = characteristicInput.parse(raw);
  validateChar(c);
  return mutate(ctx, async (tx) => {
    const [plan] = await tx.db.select().from(inspectionPlans).where(eq(inspectionPlans.id, planId)).limit(1);
    if (!plan) throw notFound("Inspection plan");
    if (plan.status !== "draft") throw invalid("Approved plans cannot be edited — create a new version.");
    const existing = await tx.db.select({ s: inspectionCharacteristics.seq }).from(inspectionCharacteristics).where(eq(inspectionCharacteristics.planId, planId));
    const [row] = await tx.db.insert(inspectionCharacteristics).values({ ...c, planId, seq: Math.max(0, ...existing.map((e) => e.s)) + 10 }).returning();
    await audit(tx, { action: "inspection_plan.char_add", entityType: "inspection_plan", entityId: planId, entityRef: plan.code, after: row });
    return row;
  });
}

export async function approveInspectionPlan(ctx: Ctx, planId: string, password: string) {
  requirePermission(ctx, "quality.plans");
  return mutate(ctx, async (tx) => {
    const [plan] = await tx.db.select().from(inspectionPlans).where(eq(inspectionPlans.id, planId)).limit(1);
    if (!plan) throw notFound("Inspection plan");
    if (plan.status !== "draft") throw invalid(`Plan is ${plan.status}.`);
    const chars = await tx.db.select().from(inspectionCharacteristics).where(eq(inspectionCharacteristics.planId, planId));
    if (!chars.length) throw invalid("Add at least one characteristic before approval.");
    const approval = await signApproval(tx, { kind: "inspection_plan.approve", entityType: "inspection_plan", entityId: planId, decision: "approved", meaning: `I approve inspection plan ${plan.code} version ${plan.version} for use.`, password });
    await tx.db.update(inspectionPlans).set({ status: "obsolete" }).where(and(eq(inspectionPlans.code, plan.code), eq(inspectionPlans.status, "approved")));
    await tx.db.update(inspectionPlans).set({ status: "approved", approvedBy: ctx.actor.userId, approvedAt: new Date() }).where(eq(inspectionPlans.id, planId));
    await audit(tx, { action: "inspection_plan.approve", entityType: "inspection_plan", entityId: planId, entityRef: `${plan.code} v${plan.version}`, approvalId: approval.id });
  });
}

// ───────────── Inspection records ─────────────

/** Internal: opens an inspection record (called by production, materials, subcontract, release flows). */
export async function openInspection(
  ctx: Ctx,
  input: {
    stage: (typeof STAGES)[number];
    planId?: string | null;
    jobId?: string | null;
    jobLineId?: string | null;
    operationId?: string | null;
    batchId?: string | null;
    serialId?: string | null;
    lotId?: string | null;
    subcontractOrderId?: string | null;
    drawingRevisionId?: string | null;
    programRevisionId?: string | null;
    machineId?: string | null;
    setupOperatorId?: string | null;
    sampleQty?: string | null;
    notes?: string | null;
  },
) {
  const ref = await nextRef(ctx.db, REF.inspection);
  const [insp] = await ctx.db.insert(inspections).values({ ...input, ref, requestedBy: ctx.actor.userId }).returning();
  await audit(ctx, { action: "inspection.open", entityType: "inspection", entityId: insp.id, entityRef: ref, jobId: input.jobId, operationId: input.operationId, after: input });
  if (input.stage === "first_off") {
    await notify(ctx, { type: "first_off.required", title: `First-off inspection required (${ref})`, link: `/quality/inspections/${insp.id}`, permission: "quality.approve_first_off", dedupeKey: `fo:${insp.id}` });
  }
  return insp;
}

/** Manual creation from the quality screens (e.g. final inspection, ad-hoc). */
export async function createInspection(ctx: Ctx, raw: Parameters<typeof openInspection>[1]) {
  requireAnyPermission(ctx, "quality.inspect", "quality.final_inspect");
  if (raw.stage === "final" && !can(ctx.actor, "quality.final_inspect")) throw forbidden("Final inspection requires the final-inspection permission.");
  return mutate(ctx, async (tx) => {
    if (raw.jobLineId && !raw.drawingRevisionId) {
      const [jl] = await tx.db.select().from(jobLines).where(eq(jobLines.id, raw.jobLineId)).limit(1);
      raw.drawingRevisionId = jl?.drawingRevisionId ?? null;
      raw.jobId = raw.jobId ?? jl?.jobId ?? null;
    }
    return openInspection(tx, raw);
  });
}

/** Calibration validity of an instrument today. */
export function instrumentValid(i: typeof measuringInstruments.$inferSelect, today = todayISO()) {
  if (i.status !== "in_service") return { ok: false, reason: `Instrument ${i.assetNo} is ${i.status.replace(/_/g, " ")}.` };
  if (i.calibrationRequired && (!i.calibrationDueOn || i.calibrationDueOn < today)) return { ok: false, reason: `Instrument ${i.assetNo} calibration ${i.calibrationDueOn ? `expired on ${i.calibrationDueOn}` : "has no record"}.` };
  return { ok: true, reason: "" };
}

/** Evaluates a measured value against nominal ± tolerance. Missing ≠ pass. */
export function evaluate(c: Pick<typeof inspectionCharacteristics.$inferSelect, "charType" | "nominal" | "tolMinus" | "tolPlus">, measured: string | null | undefined, attribute: string | null | undefined): "pass" | "fail" | "missing" {
  const measuredType = ["dimensional", "hardness", "surface"].includes(c.charType) && c.nominal !== null;
  if (measuredType) {
    if (measured === null || measured === undefined || measured === "") return "missing";
    if (!/^-?\d+(\.\d+)?$/.test(measured)) return "missing";
    const v = d(measured);
    const lo = d(c.nominal).plus(d(c.tolMinus ?? 0));
    const hi = d(c.nominal).plus(d(c.tolPlus ?? 0));
    return v.greaterThanOrEqualTo(lo) && v.lessThanOrEqualTo(hi) ? "pass" : "fail";
  }
  if (attribute === "pass" || attribute === "fail") return attribute;
  return "missing";
}

async function loadInspection(ctx: Ctx, id: string) {
  const [i] = await ctx.db.select().from(inspections).where(eq(inspections.id, id)).limit(1);
  if (!i) throw notFound("Inspection");
  return i;
}

/** Segregation: the person who set up / ran the operation may not inspect it (unless configured). */
async function assertIndependentInspector(ctx: Ctx, insp: typeof inspections.$inferSelect) {
  const settings = await getSettings(ctx.db);
  if (settings.allowSelfInspection || !ctx.actor.employeeId) return;
  if (insp.setupOperatorId && insp.setupOperatorId === ctx.actor.employeeId) throw forbidden("You set up this operation — an independent inspector must record and approve this inspection.");
  if (insp.operationId) {
    const mine = await ctx.db.select({ id: timeEntries.id }).from(timeEntries).where(and(eq(timeEntries.operationId, insp.operationId), eq(timeEntries.employeeId, ctx.actor.employeeId))).limit(1);
    if (mine.length && ["first_off", "final"].includes(insp.stage)) throw forbidden("You worked on this operation — an independent inspector must approve this inspection.");
  }
}

export const resultInput = z.object({
  characteristicId: z.string().uuid().nullish(),
  sampleNo: z.number().int().min(1).default(1),
  measuredValue: z.string().nullish(),
  attributeResult: z.enum(["pass", "fail"]).nullish(),
  instrumentId: z.string().uuid().nullish(),
  serialId: z.string().uuid().nullish(),
  comment: z.string().nullish(),
});

/** Records (or corrects, while the inspection is open) measurement results. */
export async function recordResults(ctx: Ctx, inspectionId: string, rows: z.input<typeof resultInput>[]) {
  requireAnyPermission(ctx, "quality.inspect", "quality.final_inspect", "materials.inspect");
  const results = rows.map((r) => resultInput.parse(r));
  return mutate(ctx, async (tx) => {
    const insp = await loadInspection(tx, inspectionId);
    if (!["open", "in_progress"].includes(insp.status)) throw invalid(`Inspection ${insp.ref} is ${insp.status} — results can no longer be changed.`);
    await assertIndependentInspector(tx, insp);
    const chars = insp.planId ? await tx.db.select().from(inspectionCharacteristics).where(eq(inspectionCharacteristics.planId, insp.planId)) : [];
    const instruments = await tx.db.select().from(measuringInstruments).where(inArray(measuringInstruments.id, results.map((r) => r.instrumentId).filter((x): x is string => !!x).concat(["00000000-0000-0000-0000-000000000000"])));
    const out = [];
    for (const r of results) {
      const c = chars.find((x) => x.id === r.characteristicId);
      if (r.characteristicId && !c) throw invalid("Characteristic does not belong to this inspection's plan.");
      const blank = (r.measuredValue === null || r.measuredValue === undefined || r.measuredValue === "") && !r.attributeResult;
      if (blank) continue; // nothing entered → stays missing
      let calibrationValid: boolean | null = null;
      if (r.instrumentId) {
        const inst = instruments.find((i) => i.id === r.instrumentId);
        if (!inst) throw invalid("Unknown instrument.");
        const v = instrumentValid(inst);
        if (!v.ok) throw invalid(`${v.reason} It cannot be used for inspection.`, { field: "instrumentId" });
        calibrationValid = true;
      } else if (c && ["dimensional", "hardness", "surface"].includes(c.charType)) {
        throw invalid(`Select the measuring instrument used for "${c.name}".`, { field: "instrumentId" });
      }
      const result = c ? evaluate(c, r.measuredValue, r.attributeResult) : r.attributeResult ?? "missing";
      // One live result per characteristic+sample: corrections replace, with audit of old value.
      const [prev] = c
        ? await tx.db
            .select()
            .from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.characteristicId, c.id), eq(inspectionResults.sampleNo, r.sampleNo)))
            .limit(1)
        : [];
      const values = {
        inspectionId,
        characteristicId: c?.id ?? null,
        sampleNo: r.sampleNo,
        serialId: r.serialId ?? null,
        measuredValue: r.measuredValue || null,
        attributeResult: r.attributeResult ?? null,
        result,
        instrumentId: r.instrumentId ?? null,
        instrumentCalibrationValid: calibrationValid,
        comment: r.comment ?? null,
        recordedBy: ctx.actor.userId,
        recordedAt: new Date(),
      };
      if (prev) {
        await tx.db.update(inspectionResults).set(values).where(eq(inspectionResults.id, prev.id));
        await audit(tx, { action: "inspection.result_correct", entityType: "inspection", entityId: inspectionId, entityRef: insp.ref, jobId: insp.jobId, operationId: insp.operationId, before: prev, after: values });
      } else {
        await tx.db.insert(inspectionResults).values(values);
      }
      out.push({ characteristic: c?.name, sampleNo: r.sampleNo, result });
    }
    if (insp.status === "open") await tx.db.update(inspections).set({ status: "in_progress", inspectorId: ctx.actor.userId }).where(eq(inspections.id, inspectionId));
    await audit(tx, { action: "inspection.results", entityType: "inspection", entityId: inspectionId, entityRef: insp.ref, jobId: insp.jobId, operationId: insp.operationId, after: out });
    return out;
  });
}

/** Completeness check: every characteristic × sample must have a passing result (missing is not a pass). */
export async function inspectionSummary(ctx: Ctx, inspectionId: string) {
  const insp = await loadInspection(ctx, inspectionId);
  const chars = insp.planId ? await ctx.db.select().from(inspectionCharacteristics).where(eq(inspectionCharacteristics.planId, insp.planId)).orderBy(asc(inspectionCharacteristics.seq)) : [];
  const results = await ctx.db.select().from(inspectionResults).where(eq(inspectionResults.inspectionId, inspectionId));
  const samples = (c: typeof chars[number]) => {
    const n = Number.parseInt(c.sampleSize, 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  };
  const grid = chars.map((c) => {
    const cells = Array.from({ length: samples(c) }, (_, i) => {
      const r = results.find((x) => x.characteristicId === c.id && x.sampleNo === i + 1);
      return { sampleNo: i + 1, result: r?.result ?? "missing", value: r?.measuredValue ?? r?.attributeResult ?? null, row: r ?? null };
    });
    return { characteristic: c, cells };
  });
  const adhoc = results.filter((r) => !r.characteristicId);
  const all = [...grid.flatMap((g) => g.cells.map((c) => c.result)), ...adhoc.map((a) => a.result)];
  const missing = all.filter((r) => r === "missing").length;
  const failed = all.filter((r) => r === "fail").length;
  const evidence = await ctx.db.select({ e: inspectionEvidence, f: files }).from(inspectionEvidence).innerJoin(files, eq(files.id, inspectionEvidence.fileId)).where(eq(inspectionEvidence.inspectionId, inspectionId));
  const needEvidence = chars.some((c) => c.evidenceRequired) && evidence.length === 0;
  return { inspection: insp, grid, adhoc, missing, failed, total: all.length, evidence, needEvidence, canPass: all.length > 0 && missing === 0 && failed === 0 && !needEvidence };
}

export async function addInspectionEvidence(ctx: Ctx, inspectionId: string, file: File, caption?: string | null) {
  requireAnyPermission(ctx, "quality.inspect", "quality.final_inspect");
  return mutate(ctx, async (tx) => {
    const insp = await loadInspection(tx, inspectionId);
    if (!["open", "in_progress"].includes(insp.status)) throw invalid("Inspection is closed.");
    const f = await storeUpload(tx.db, file, ctx.actor.userId);
    await tx.db.insert(inspectionEvidence).values({ inspectionId, fileId: f.id, caption: caption ?? null });
    await audit(tx, { action: "inspection.evidence_add", entityType: "inspection", entityId: inspectionId, entityRef: insp.ref, after: { file: f.originalName, sha256: f.sha256 } });
  });
}

/**
 * Completes an inspection. PASS requires every characteristic × sample recorded and passing.
 * First-off and final decisions are signed approvals. A FAIL raises an NCR and holds the work.
 */
export async function completeInspection(
  ctx: Ctx,
  inspectionId: string,
  input: { decision: "pass" | "fail"; qtyInspected?: string | null; qtyAccepted?: string | null; qtyRejected?: string | null; notes?: string | null; password?: string | null },
) {
  const insp0 = await loadInspection(ctx, inspectionId);
  const perm = insp0.stage === "first_off" ? "quality.approve_first_off" : insp0.stage === "final" ? "quality.final_inspect" : insp0.stage === "incoming" ? "materials.inspect" : "quality.inspect";
  requirePermission(ctx, perm);
  return mutate(ctx, async (tx) => {
    const insp = await loadInspection(tx, inspectionId);
    if (!["open", "in_progress"].includes(insp.status)) throw invalid(`Inspection is ${insp.status}.`);
    await assertIndependentInspector(tx, insp);
    const sum = await inspectionSummary(tx, inspectionId);
    if (input.decision === "pass" && !sum.canPass) {
      const why = [sum.total === 0 && "no results recorded", sum.missing && `${sum.missing} measurement(s) missing`, sum.failed && `${sum.failed} out of tolerance`, sum.needEvidence && "required evidence not attached"].filter(Boolean).join(", ");
      throw invalid(`Cannot pass inspection: ${why}.`);
    }
    if (input.decision === "fail" && !input.notes?.trim() && sum.failed === 0) throw invalid("Describe why the inspection failed.", { field: "notes" });
    if (insp.stage === "final" && input.decision === "pass") {
      if (!input.qtyAccepted || !d(input.qtyAccepted).greaterThan(0)) throw invalid("Enter the quantity accepted at final inspection.", { field: "qtyAccepted" });
    }
    let approvalId: string | null = null;
    if (["first_off", "final"].includes(insp.stage)) {
      const label = insp.stage === "first_off" ? "first-off" : "final";
      const a = await signApproval(tx, {
        kind: `inspection.${insp.stage}`,
        entityType: "inspection",
        entityId: insp.id,
        decision: input.decision === "pass" ? "approved" : "rejected",
        meaning: input.decision === "pass" ? `I confirm ${label} inspection ${insp.ref} meets the drawing and specification requirements.` : `I reject ${label} inspection ${insp.ref}.`,
        comment: input.notes,
        password: input.password,
      });
      approvalId = a.id;
    }
    await tx.db
      .update(inspections)
      .set({
        status: input.decision === "pass" ? "passed" : "failed",
        result: input.decision,
        qtyInspected: input.qtyInspected || null,
        qtyAccepted: input.qtyAccepted || null,
        qtyRejected: input.qtyRejected || null,
        notes: input.notes ?? insp.notes,
        inspectorId: ctx.actor.userId,
        completedAt: new Date(),
        approvalId,
      })
      .where(eq(inspections.id, inspectionId));
    await audit(tx, { action: `inspection.${input.decision}`, entityType: "inspection", entityId: insp.id, entityRef: insp.ref, jobId: insp.jobId, operationId: insp.operationId, approvalId, reason: input.notes, after: { stage: insp.stage, missing: sum.missing, failed: sum.failed, qtyAccepted: input.qtyAccepted } });

    // ── Consequences ──
    if (insp.operationId) {
      const [op] = await tx.db.select().from(operations).where(eq(operations.id, insp.operationId)).limit(1);
      if (insp.stage === "first_off") {
        await tx.db
          .update(operations)
          .set(input.decision === "pass" ? { firstOffStatus: "approved", status: "paused" } : { firstOffStatus: "rejected", status: "in_setup", setupStatus: "in_setup" })
          .where(eq(operations.id, insp.operationId));
      } else if (insp.stage === "in_process" && op?.status === "awaiting_inspection" && input.decision === "pass") {
        await tx.db.update(operations).set({ status: "paused" }).where(eq(operations.id, insp.operationId));
      }
    }
    if (insp.stage === "final" && insp.jobLineId && input.decision === "pass") {
      const [jl] = await tx.db.select().from(jobLines).where(eq(jobLines.id, insp.jobLineId)).limit(1);
      await tx.db
        .update(jobLines)
        .set({ qtyAccepted: d(jl.qtyAccepted).plus(d(input.qtyAccepted)).toString(), qtyRejected: d(jl.qtyRejected).plus(d(input.qtyRejected ?? 0)).toString() })
        .where(eq(jobLines.id, insp.jobLineId));
    }
    if (insp.stage === "subcontract_return" && insp.subcontractOrderId) {
      const { onSubcontractInspection } = await import("./subcontract");
      await onSubcontractInspection(tx, insp.subcontractOrderId, input.decision, input.qtyAccepted ?? null, input.qtyRejected ?? null);
    }
    let ncrId: string | null = null;
    const rejectedQty = input.qtyRejected && d(input.qtyRejected).greaterThan(0) ? input.qtyRejected : null;
    if (input.decision === "fail" || rejectedQty) {
      const { raiseNcrInternal } = await import("./ncr");
      const ncr = await raiseNcrInternal(tx, {
        source: insp.stage === "incoming" || insp.stage === "subcontract_return" ? "supplier" : "internal",
        category: sum.failed ? "dimension" : "other",
        jobId: insp.jobId,
        jobLineId: insp.jobLineId,
        operationId: insp.operationId,
        batchId: insp.batchId,
        lotId: insp.lotId,
        inspectionId: insp.id,
        qtyAffected: rejectedQty ?? input.qtyInspected ?? insp.sampleQty ?? "1",
        description: `${insp.stage.replace("_", " ")} inspection ${insp.ref} ${input.decision === "fail" ? "failed" : "rejected parts"}: ${input.notes ?? `${sum.failed} characteristic(s) out of tolerance`}`,
        holdOperation: !!insp.operationId,
        holdLot: !!insp.lotId,
        holdBatch: !!insp.batchId,
      });
      ncrId = ncr.id;
    }
    if (insp.jobId) {
      const { refreshJobStatus } = await import("./jobs");
      await refreshJobStatus(tx, insp.jobId);
    }
    return { approvalId, ncrId };
  });
}

export async function cancelInspection(ctx: Ctx, inspectionId: string, reason: string) {
  requireAnyPermission(ctx, "quality.inspect", "materials.inspect");
  if (!reason?.trim()) throw invalid("A reason is required.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const insp = await loadInspection(tx, inspectionId);
    if (!["open", "in_progress"].includes(insp.status)) throw invalid(`Inspection is ${insp.status}.`);
    await tx.db.update(inspections).set({ status: "cancelled", notes: reason }).where(eq(inspections.id, inspectionId));
    await audit(tx, { action: "inspection.cancel", entityType: "inspection", entityId: inspectionId, entityRef: insp.ref, jobId: insp.jobId, operationId: insp.operationId, reason });
  });
}

// ───────────── Queries ─────────────

export async function getInspection(ctx: Ctx, id: string) {
  requireAnyPermission(ctx, "quality.view", "quality.inspect", "materials.inspect");
  const summary = await inspectionSummary(ctx, id);
  const i = summary.inspection;
  const [plan, job, op, line, lot, machine, setupOp, drawing, inspector] = await Promise.all([
    i.planId ? ctx.db.select().from(inspectionPlans).where(eq(inspectionPlans.id, i.planId)) : Promise.resolve([]),
    i.jobId ? ctx.db.select().from(jobs).where(eq(jobs.id, i.jobId)) : Promise.resolve([]),
    i.operationId ? ctx.db.select().from(operations).where(eq(operations.id, i.operationId)) : Promise.resolve([]),
    i.jobLineId ? ctx.db.select().from(jobLines).where(eq(jobLines.id, i.jobLineId)) : Promise.resolve([]),
    i.lotId ? ctx.db.select().from(materialLots).where(eq(materialLots.id, i.lotId)) : Promise.resolve([]),
    i.machineId ? ctx.db.select().from(machines).where(eq(machines.id, i.machineId)) : Promise.resolve([]),
    i.setupOperatorId ? ctx.db.select().from(employees).where(eq(employees.id, i.setupOperatorId)) : Promise.resolve([]),
    i.drawingRevisionId ? ctx.db.select().from(documentRevisions).where(eq(documentRevisions.id, i.drawingRevisionId)) : Promise.resolve([]),
    i.inspectorId ? ctx.db.select({ name: users.name }).from(users).where(eq(users.id, i.inspectorId)) : Promise.resolve([]),
  ]);
  return { ...summary, plan: plan[0] ?? null, job: job[0] ?? null, operation: op[0] ?? null, line: line[0] ?? null, lot: lot[0] ?? null, machine: machine[0] ?? null, setupOperator: setupOp[0] ?? null, drawing: drawing[0] ?? null, inspectorName: inspector[0]?.name ?? null };
}

export async function listInspections(ctx: Ctx, opts: { status?: string; stage?: string; jobId?: string; open?: boolean } = {}) {
  requireAnyPermission(ctx, "quality.view", "quality.inspect");
  return ctx.db
    .select({ i: inspections, job: jobs.jobNumber, opNumber: operations.opNumber, lotNo: materialLots.lotNo, inspector: users.name })
    .from(inspections)
    .leftJoin(jobs, eq(jobs.id, inspections.jobId))
    .leftJoin(operations, eq(operations.id, inspections.operationId))
    .leftJoin(materialLots, eq(materialLots.id, inspections.lotId))
    .leftJoin(users, eq(users.id, inspections.inspectorId))
    .where(
      and(
        opts.status ? eq(inspections.status, opts.status) : undefined,
        opts.open ? inArray(inspections.status, ["open", "in_progress"]) : undefined,
        opts.stage ? eq(inspections.stage, opts.stage) : undefined,
        opts.jobId ? eq(inspections.jobId, opts.jobId) : undefined,
      ),
    )
    .orderBy(desc(inspections.requestedAt))
    .limit(300);
}

export async function listPlans(ctx: Ctx) {
  requireAnyPermission(ctx, "quality.view", "quality.plans");
  const plans = await ctx.db.select().from(inspectionPlans).orderBy(asc(inspectionPlans.code), desc(inspectionPlans.version));
  const counts = await ctx.db.select({ planId: inspectionCharacteristics.planId, n: sql<number>`count(*)::int` }).from(inspectionCharacteristics).groupBy(inspectionCharacteristics.planId);
  return plans.map((p) => ({ ...p, characteristics: counts.find((c) => c.planId === p.id)?.n ?? 0 }));
}

export async function getPlan(ctx: Ctx, id: string) {
  requireAnyPermission(ctx, "quality.view", "quality.plans");
  const [plan] = await ctx.db.select().from(inspectionPlans).where(eq(inspectionPlans.id, id)).limit(1);
  if (!plan) throw notFound("Inspection plan");
  const chars = await ctx.db.select().from(inspectionCharacteristics).where(eq(inspectionCharacteristics.planId, id)).orderBy(asc(inspectionCharacteristics.seq));
  return { plan, characteristics: chars };
}

/** Approved plan applicable to a context (job > part > customer > operation type), most specific first. */
export async function findApplicablePlan(ctx: Ctx, input: { stage: string; jobId?: string | null; partId?: string | null; customerId?: string | null; operationTypeId?: string | null }) {
  const plans = await ctx.db.select().from(inspectionPlans).where(and(eq(inspectionPlans.stage, input.stage), eq(inspectionPlans.status, "approved")));
  const score = (p: typeof plans[number]) => {
    if (p.jobId && p.jobId !== input.jobId) return -1;
    if (p.partId && p.partId !== input.partId) return -1;
    if (p.customerId && p.customerId !== input.customerId) return -1;
    if (p.operationTypeId && p.operationTypeId !== input.operationTypeId) return -1;
    return (p.jobId ? 8 : 0) + (p.partId ? 4 : 0) + (p.customerId ? 2 : 0) + (p.operationTypeId ? 1 : 0);
  };
  return plans.map((p) => ({ p, s: score(p) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s)[0]?.p ?? null;
}

// ───────────── Instruments & calibration ─────────────

export const instrumentInput = z.object({
  assetNo: z.string().trim().min(1).transform((s) => s.toUpperCase()),
  description: z.string().trim().min(2),
  instrumentType: z.string().min(2),
  manufacturer: z.string().nullish(),
  serialNumber: z.string().nullish(),
  range: z.string().nullish(),
  resolution: z.string().nullish(),
  location: z.string().nullish(),
  calibrationRequired: z.boolean().default(true),
  calibrationIntervalDays: z.number().int().min(1).max(3650).default(365),
  notes: z.string().nullish(),
});

export async function saveInstrument(ctx: Ctx, raw: z.input<typeof instrumentInput>, id?: string) {
  requirePermission(ctx, "quality.instruments");
  const data = instrumentInput.parse(raw);
  return mutate(ctx, async (tx) => {
    const [i] = id ? await tx.db.update(measuringInstruments).set(data).where(eq(measuringInstruments.id, id)).returning() : await tx.db.insert(measuringInstruments).values(data).returning();
    await audit(tx, { action: id ? "instrument.update" : "instrument.create", entityType: "instrument", entityId: i.id, entityRef: i.assetNo, after: data });
    return i;
  });
}

export async function setInstrumentStatus(ctx: Ctx, id: string, status: "in_service" | "out_of_calibration" | "quarantined" | "retired" | "lost", reason: string) {
  requirePermission(ctx, "quality.instruments");
  if (!reason?.trim()) throw invalid("A reason is required.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const [i] = await tx.db.update(measuringInstruments).set({ status }).where(eq(measuringInstruments.id, id)).returning();
    if (!i) throw notFound("Instrument");
    await audit(tx, { action: "instrument.status", entityType: "instrument", entityId: id, entityRef: i.assetNo, after: { status }, reason });
  });
}

/**
 * Records a calibration. If the instrument was found OUT of tolerance (as-found), every
 * inspection result measured with it since its last good calibration is flagged for review.
 */
export async function recordCalibration(
  ctx: Ctx,
  instrumentId: string,
  input: { calibratedOn: string; result: "pass" | "fail" | "adjusted"; asFoundInTolerance: boolean; certificateNo?: string | null; providerId?: string | null; performedBy?: string | null; notes?: string | null; dueOn?: string | null },
  file?: File | null,
) {
  requirePermission(ctx, "quality.instruments");
  return mutate(ctx, async (tx) => {
    const [inst] = await tx.db.select().from(measuringInstruments).where(eq(measuringInstruments.id, instrumentId)).limit(1);
    if (!inst) throw notFound("Instrument");
    const dueOn = input.dueOn || addDaysISO(input.calibratedOn, inst.calibrationIntervalDays);
    const fileId = file && file.size ? (await storeUpload(tx.db, file, ctx.actor.userId)).id : null;
    // Review window starts at the last calibration that was found in tolerance and passed.
    const [prev] = await tx.db.select().from(calibrationRecords).where(and(eq(calibrationRecords.instrumentId, instrumentId), eq(calibrationRecords.asFoundInTolerance, true), sql`${calibrationRecords.result} <> 'fail'`)).orderBy(desc(calibrationRecords.calibratedOn)).limit(1);
    const [rec] = await tx.db.insert(calibrationRecords).values({ instrumentId, ...input, dueOn, fileId, recordedBy: ctx.actor.userId }).returning();
    const usable = input.result !== "fail";
    await tx.db
      .update(measuringInstruments)
      .set({ lastCalibratedOn: input.calibratedOn, calibrationDueOn: usable ? dueOn : inst.calibrationDueOn, status: usable ? "in_service" : "out_of_calibration" })
      .where(eq(measuringInstruments.id, instrumentId));
    let flagged = 0;
    if (!input.asFoundInTolerance) {
      const since = prev?.calibratedOn ?? "1900-01-01";
      const affected = await tx.db
        .select({ id: inspectionResults.id })
        .from(inspectionResults)
        .where(and(eq(inspectionResults.instrumentId, instrumentId), sql`${inspectionResults.recordedAt} >= ${since}::date`));
      if (affected.length) {
        await tx.db.update(inspectionResults).set({ underReview: true }).where(inArray(inspectionResults.id, affected.map((a) => a.id)));
        flagged = affected.length;
        await notify(tx, { type: "maintenance.due", title: `Instrument ${inst.assetNo} found out of tolerance — ${flagged} result(s) to review`, link: `/quality/instruments/${instrumentId}`, permission: "quality.instruments", dedupeKey: `calfail:${rec.id}` });
      }
    }
    await audit(tx, { action: "calibration.record", entityType: "instrument", entityId: instrumentId, entityRef: inst.assetNo, after: { ...input, dueOn, resultsFlagged: flagged } });
    return { record: rec, flagged };
  });
}

export async function reviewFlaggedResult(ctx: Ctx, resultId: string, outcome: string) {
  requirePermission(ctx, "quality.instruments");
  if (!outcome?.trim()) throw invalid("Record the review outcome.", { field: "outcome" });
  return mutate(ctx, async (tx) => {
    const [r] = await tx.db.update(inspectionResults).set({ underReview: false, reviewOutcome: outcome }).where(eq(inspectionResults.id, resultId)).returning();
    if (!r) throw notFound("Result");
    await audit(tx, { action: "inspection.result_review", entityType: "inspection", entityId: r.inspectionId, reason: outcome });
  });
}

export async function listInstruments(ctx: Ctx) {
  requireAnyPermission(ctx, "quality.view", "quality.inspect", "quality.instruments", "materials.inspect", "quality.final_inspect");
  const today = todayISO();
  const rows = await ctx.db.select().from(measuringInstruments).orderBy(asc(measuringInstruments.assetNo));
  return rows.map((i) => ({ ...i, validity: instrumentValid(i, today) }));
}

export async function getInstrument(ctx: Ctx, id: string) {
  requireAnyPermission(ctx, "quality.view", "quality.instruments");
  const [i] = await ctx.db.select().from(measuringInstruments).where(eq(measuringInstruments.id, id)).limit(1);
  if (!i) throw notFound("Instrument");
  const recs = await ctx.db.select().from(calibrationRecords).where(eq(calibrationRecords.instrumentId, id)).orderBy(desc(calibrationRecords.calibratedOn));
  const flagged = await ctx.db
    .select({ r: inspectionResults, insp: inspections })
    .from(inspectionResults)
    .innerJoin(inspections, eq(inspections.id, inspectionResults.inspectionId))
    .where(and(eq(inspectionResults.instrumentId, id), or(eq(inspectionResults.underReview, true), sql`${inspectionResults.reviewOutcome} is not null`)));
  return { instrument: i, validity: instrumentValid(i), records: recs, flagged };
}

