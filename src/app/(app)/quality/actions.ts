"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/server/action";
import { f, formToObject } from "@/server/forms";
import { parseDecimalInput } from "@/lib/decimal";
import type { ActionResult } from "@/server/boundary";
import {
  addCharacteristic,
  addInspectionEvidence,
  approveInspectionPlan,
  cancelInspection,
  completeInspection,
  createInspection,
  createInspectionPlan,
  recordCalibration,
  recordResults,
  reviewFlaggedResult,
  saveInstrument,
  setInstrumentStatus,
  STAGES,
} from "@/server/services/inspections";
import { approveRelease, checkReleaseItem, prepareRelease, rejectRelease } from "@/server/services/release";

const CHAR_TYPES = ["dimensional", "visual", "attribute", "document", "functional", "hardness", "surface"] as const;
const MEASURED = ["dimensional", "hardness", "surface"];

// ───────────── Inspections ─────────────

export const createInspectionAction = action(
  "inspection.create",
  z.object({
    stage: f.enumOf(STAGES, "Select the inspection stage."),
    planId: f.optUuid(),
    jobLineId: f.optUuid(),
    jobId: f.optUuid(),
    operationId: f.optUuid(),
    lotId: f.optUuid(),
    sampleQty: f.optDec(),
    notes: f.optStr(),
  }),
  async (ctx, i) => {
    const insp = await createInspection(ctx, i);
    redirect(`/quality/inspections/${insp.id}`);
  },
);

/**
 * Results grid. Field names: v_<charId>_<sample> (measured value), a_… (pass/fail),
 * i_… (instrument), c_… (comment). Blank rows are skipped (they stay "missing").
 */
export const recordResultsAction = action(
  "inspection.results",
  z.object({ inspectionId: f.uuid() }),
  async (ctx, { inspectionId }, fd): Promise<ActionResult | string> => {
    const raw = formToObject(fd);
    const keys = new Map<string, { characteristicId: string; sampleNo: number }>();
    for (const k of Object.keys(raw)) {
      const m = /^([vaic])_([0-9a-f-]{36})_(\d+)$/.exec(k);
      if (m) keys.set(`${m[2]}_${m[3]}`, { characteristicId: m[2], sampleNo: Number(m[3]) });
    }
    const str = (k: string) => {
      const v = raw[k];
      return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
    };
    const rows = [];
    const fieldErrors: Record<string, string> = {};
    for (const [suffix, key] of keys) {
      const value = str(`v_${suffix}`);
      const attr = str(`a_${suffix}`);
      if (!value && !attr) continue;
      let measuredValue: string | null = null;
      if (value) {
        measuredValue = parseDecimalInput(value, { allowNegative: true });
        if (measuredValue === null) {
          fieldErrors[`v_${suffix}`] = "Enter a number.";
          continue;
        }
      }
      rows.push({
        characteristicId: key.characteristicId,
        sampleNo: key.sampleNo,
        measuredValue,
        attributeResult: attr === "pass" || attr === "fail" ? (attr as "pass" | "fail") : null,
        instrumentId: str(`i_${suffix}`),
        comment: str(`c_${suffix}`),
      });
    }
    if (Object.keys(fieldErrors).length) return { ok: false, error: `${Object.keys(fieldErrors).length} measured value(s) are not valid numbers (marked \"Not a number\" in the Check column). Nothing was saved.`, fieldErrors };
    if (!rows.length) return { ok: false, error: "Nothing entered. Type at least one measured value or pass/fail result." };
    const out = await recordResults(ctx, inspectionId, rows);
    const failed = out.filter((o) => o.result === "fail").length;
    return `${out.length} result(s) recorded${failed ? ` — ${failed} out of tolerance` : ""}.`;
  },
  { revalidate: (i) => `/quality/inspections/${i.inspectionId}` },
);

export const addAdhocResultAction = action(
  "inspection.adhoc_result",
  z.object({
    inspectionId: f.uuid(),
    attributeResult: f.enumOf(["pass", "fail"] as const, "Select pass or fail."),
    measuredValue: f.optDec({ allowNegative: true }),
    instrumentId: f.optUuid(),
    comment: f.str("Describe what was checked."),
  }),
  async (ctx, { inspectionId, ...r }) => {
    await recordResults(ctx, inspectionId, [{ characteristicId: null, sampleNo: 1, ...r }]);
    return "Result added.";
  },
  { revalidate: (i) => `/quality/inspections/${i.inspectionId}` },
);

export const addInspectionEvidenceAction = action(
  "inspection.evidence",
  z.object({ inspectionId: f.uuid(), file: z.instanceof(File, { message: "Choose a file." }), caption: f.optStr() }),
  async (ctx, { inspectionId, file, caption }) => {
    await addInspectionEvidence(ctx, inspectionId, file, caption);
    return "Evidence attached.";
  },
  { revalidate: (i) => `/quality/inspections/${i.inspectionId}` },
);

export const completeInspectionAction = action(
  "inspection.complete",
  z.object({
    inspectionId: f.uuid(),
    decision: f.enumOf(["pass", "fail"] as const, "Select the decision."),
    qtyInspected: f.optDec(),
    qtyAccepted: f.optDec(),
    qtyRejected: f.optDec(),
    notes: f.optStr(),
    password: f.optStr(),
  }),
  async (ctx, { inspectionId, ...input }) => {
    const res = await completeInspection(ctx, inspectionId, input);
    if (res.ncrId) redirect(`/quality/inspections/${inspectionId}?ncr=${res.ncrId}`);
    return input.decision === "pass" ? "Inspection passed." : "Inspection failed.";
  },
  { revalidate: (i) => [`/quality/inspections/${i.inspectionId}`, "/quality"] },
);

export const cancelInspectionAction = action(
  "inspection.cancel",
  z.object({ inspectionId: f.uuid(), reason: f.str("A reason is required.") }),
  async (ctx, { inspectionId, reason }) => {
    await cancelInspection(ctx, inspectionId, reason);
    return "Inspection cancelled.";
  },
  { revalidate: (i) => [`/quality/inspections/${i.inspectionId}`, "/quality"] },
);

// ───────────── Plans ─────────────

type CharRow = {
  balloonNo: string | null;
  name: string;
  charType: (typeof CHAR_TYPES)[number];
  specification: string | null;
  nominal: string | null;
  tolMinus: string | null;
  tolPlus: string | null;
  unit: string | null;
  method: string | null;
  instrumentType: string | null;
  sampleSize: string;
  frequency: string | null;
  acceptanceCriteria: string | null;
  evidenceRequired: boolean;
  isCritical: boolean;
};

/** Reads one characteristic row (fields named `<prefix><field>`). Returns null for a blank row. */
function readChar(raw: Record<string, unknown>, prefix: string, errors: Record<string, string>): CharRow | null {
  const s = (k: string) => {
    const v = raw[`${prefix}${k}`];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  const name = s("name");
  if (!name) return null;
  const typeRaw = s("charType") ?? "dimensional";
  const charType = (CHAR_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as CharRow["charType"]) : "dimensional";
  const num = (k: string) => {
    const v = s(k);
    if (v === null) return null;
    const n = parseDecimalInput(v, { allowNegative: true });
    if (n === null) errors[`${prefix}${k}`] = "Enter a number.";
    return n;
  };
  const nominal = num("nominal");
  if (MEASURED.includes(charType) && nominal === null && !errors[`${prefix}nominal`]) errors[`${prefix}nominal`] = "Nominal is required for measured characteristics.";
  const sample = s("sampleSize") ?? "1";
  if (!/^\d+$/.test(sample) || Number(sample) < 1) errors[`${prefix}sampleSize`] = "Whole number of samples.";
  const flag = (k: string) => {
    const v = raw[`${prefix}${k}`];
    return v === "on" || v === "true";
  };
  return {
    balloonNo: s("balloonNo"),
    name,
    charType,
    specification: s("specification"),
    nominal,
    tolMinus: num("tolMinus"),
    tolPlus: num("tolPlus"),
    unit: s("unit"),
    method: s("method"),
    instrumentType: s("instrumentType"),
    sampleSize: sample,
    frequency: s("frequency"),
    acceptanceCriteria: s("acceptanceCriteria"),
    evidenceRequired: flag("evidenceRequired"),
    isCritical: flag("isCritical"),
  };
}

export const createPlanAction = action(
  "inspection_plan.create",
  z.object({
    code: f.str("Plan code is required."),
    name: f.str("Plan name is required."),
    stage: f.enumOf(STAGES, "Select the stage."),
    partId: f.optUuid(),
    customerId: f.optUuid(),
    operationTypeId: f.optUuid(),
    notes: f.optStr(),
    rows: f.optInt(),
  }),
  async (ctx, { rows, ...plan }, fd): Promise<ActionResult | void> => {
    const raw = formToObject(fd);
    const errors: Record<string, string> = {};
    const chars: CharRow[] = [];
    const n = Math.min(Math.max(rows ?? 10, 1), 200);
    for (let i = 0; i < n; i++) {
      const c = readChar(raw, `ch${i}_`, errors);
      if (c) chars.push(c);
    }
    if (Object.keys(errors).length) return { ok: false, error: "Correct the highlighted characteristic fields.", fieldErrors: errors };
    const p = await createInspectionPlan(ctx, plan, chars);
    redirect(`/quality/plans/${p.id}`);
  },
);

export const addCharacteristicAction = action(
  "inspection_plan.char_add",
  z.object({ planId: f.uuid() }),
  async (ctx, { planId }, fd): Promise<ActionResult | string> => {
    const errors: Record<string, string> = {};
    const c = readChar(formToObject(fd), "ch0_", errors);
    if (!c) return { ok: false, error: "Characteristic name is required.", fieldErrors: { ch0_name: "Required." } };
    if (Object.keys(errors).length) return { ok: false, error: "Correct the highlighted fields.", fieldErrors: errors };
    await addCharacteristic(ctx, planId, c);
    return `Characteristic "${c.name}" added.`;
  },
  { revalidate: (i) => `/quality/plans/${i.planId}` },
);

export const approvePlanAction = action(
  "inspection_plan.approve",
  z.object({ planId: f.uuid(), password: f.str("Enter your password to sign.") }),
  async (ctx, { planId, password }) => {
    await approveInspectionPlan(ctx, planId, password);
    return "Plan approved. Any previously approved version of this code is now obsolete.";
  },
  { revalidate: (i) => [`/quality/plans/${i.planId}`, "/quality"] },
);

// ───────────── Instruments ─────────────

const instrumentForm = z.object({
  id: f.optUuid(),
  assetNo: f.str("Asset number is required."),
  description: f.str("Description is required."),
  instrumentType: f.str("Select the instrument type."),
  manufacturer: f.optStr(),
  serialNumber: f.optStr(),
  range: f.optStr(),
  resolution: f.optStr(),
  location: f.optStr(),
  calibrationRequired: f.bool(),
  calibrationIntervalDays: f.int({ min: 1, max: 3650 }),
  notes: f.optStr(),
});

export const saveInstrumentAction = action("instrument.save", instrumentForm, async (ctx, { id, ...data }) => {
  const i = await saveInstrument(ctx, data, id ?? undefined);
  if (!id) redirect(`/quality/instruments/${i.id}`);
  return "Instrument details saved.";
}, { revalidate: (i) => (i.id ? [`/quality/instruments/${i.id}`, "/quality"] : "/quality") });

export const setInstrumentStatusAction = action(
  "instrument.status",
  z.object({ id: f.uuid(), status: f.enumOf(["in_service", "out_of_calibration", "quarantined", "retired", "lost"] as const), reason: f.str("A reason is required.") }),
  async (ctx, { id, status, reason }) => {
    await setInstrumentStatus(ctx, id, status, reason);
    return "Instrument status changed.";
  },
  { revalidate: (i) => [`/quality/instruments/${i.id}`, "/quality"] },
);

export const recordCalibrationAction = action(
  "calibration.record",
  z.object({
    instrumentId: f.uuid(),
    calibratedOn: f.date("Enter the calibration date."),
    result: f.enumOf(["pass", "fail", "adjusted"] as const, "Select the result."),
    asFoundInTolerance: f.bool(),
    certificateNo: f.optStr(),
    providerId: f.optUuid(),
    performedBy: f.optStr(),
    notes: f.optStr(),
    dueOn: f.optDate(),
    file: f.file(),
  }),
  async (ctx, { instrumentId, file, ...input }) => {
    const res = await recordCalibration(ctx, instrumentId, input, file ?? null);
    return res.flagged ? `Calibration recorded. ${res.flagged} result(s) measured with this instrument are now flagged for review.` : "Calibration recorded.";
  },
  { revalidate: (i) => [`/quality/instruments/${i.instrumentId}`, "/quality"] },
);

export const reviewFlaggedResultAction = action(
  "inspection.result_review",
  z.object({ instrumentId: f.uuid(), resultId: f.uuid(), outcome: f.str("Record the review outcome.") }),
  async (ctx, { resultId, outcome }) => {
    await reviewFlaggedResult(ctx, resultId, outcome);
    return "Review recorded.";
  },
  { revalidate: (i) => [`/quality/instruments/${i.instrumentId}`, "/quality"] },
);

// ───────────── Final release ─────────────

export const prepareReleaseAction = action("release.prepare", z.object({ jobLineId: f.uuid() }), async (ctx, { jobLineId }) => {
  const rel = await prepareRelease(ctx, jobLineId);
  redirect(`/quality/releases/${rel.id}`);
});

export const checkReleaseItemAction = action(
  "release.item_check",
  z.object({ releaseId: f.uuid(), itemId: f.uuid(), status: f.enumOf(["pass", "fail", "na"] as const), detail: f.optStr() }),
  async (ctx, { itemId, status, detail }) => {
    await checkReleaseItem(ctx, itemId, status, detail);
    return status === "pass" ? "Item confirmed." : status === "fail" ? "Item marked as failed." : "Item marked not applicable.";
  },
  { revalidate: (i) => `/quality/releases/${i.releaseId}` },
);

export const approveReleaseAction = action(
  "release.approve",
  z.object({ releaseId: f.uuid(), qtyReleased: f.dec({ msg: "Enter the quantity to release." }), comments: f.optStr(), password: f.str("Enter your password to sign.") }),
  async (ctx, { releaseId, ...input }) => {
    await approveRelease(ctx, releaseId, input);
    return "Release approved. The Certificate of Conformity has been generated.";
  },
  { revalidate: (i) => [`/quality/releases/${i.releaseId}`, "/quality"] },
);

export const rejectReleaseAction = action(
  "release.reject",
  z.object({ releaseId: f.uuid(), comments: f.str("Explain why the release is rejected."), password: f.str("Enter your password to sign.") }),
  async (ctx, { releaseId, ...input }) => {
    await rejectRelease(ctx, releaseId, input);
    return "Release rejected.";
  },
  { revalidate: (i) => [`/quality/releases/${i.releaseId}`, "/quality"] },
);
