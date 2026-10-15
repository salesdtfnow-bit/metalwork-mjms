"use server";

import { z } from "zod";
import { action } from "@/server/action";
import { f } from "@/server/forms";
import { invalid } from "@/server/errors";
import {
  addOperationEvent,
  confirmCheck,
  finishSetup,
  holdOperation,
  operationWorkspace,
  signOffOperation,
  startProduction,
  startSetup,
  stopProduction,
  submitForInspection,
} from "@/server/services/production";
import { endDowntime, startDowntime } from "@/server/services/machines";
import { NCR_CATEGORIES, raiseNcr } from "@/server/services/ncr";

const opPath = (i: { opId: string }) => [`/shopfloor/op/${i.opId}`, "/shopfloor"];

export const confirmDrawingAction = action(
  "shopfloor.check_drawing",
  z.object({ opId: f.uuid() }),
  async (ctx, i) => {
    await confirmCheck(ctx, i.opId, { kind: "drawing_reviewed" });
    return "Drawing review recorded.";
  },
  { revalidate: opPath },
);

export const confirmInstructionsAction = action(
  "shopfloor.check_instructions",
  z.object({ opId: f.uuid() }),
  async (ctx, i) => {
    await confirmCheck(ctx, i.opId, { kind: "instructions_read" });
    return "Work instructions confirmed.";
  },
  { revalidate: opPath },
);

/** Material is confirmed by selecting an allocated lot or scanning/typing its lot number. */
export const confirmMaterialAction = action(
  "shopfloor.check_material",
  z.object({ opId: f.uuid(), materialLotId: f.optUuid(), lotNo: f.optStr() }),
  async (ctx, i) => {
    let lotId = i.materialLotId;
    if (i.lotNo) {
      const ws = await operationWorkspace(ctx, i.opId);
      const scanned = i.lotNo.trim().toLowerCase();
      const match = ws.lots.find((l) => l.lot.lotNo.toLowerCase() === scanned);
      if (!match) throw invalid(`Lot ${i.lotNo} is not allocated to this job. Check the label or contact your supervisor.`, { field: "lotNo" });
      lotId = match.lot.id;
    }
    if (!lotId) throw invalid("Select or scan the material lot you are using.", { field: "materialLotId" });
    await confirmCheck(ctx, i.opId, { kind: "material_confirmed", materialLotId: lotId });
    return "Material lot confirmed.";
  },
  { revalidate: opPath },
);

export const confirmProgramAction = action(
  "shopfloor.check_program",
  z.object({ opId: f.uuid(), programRevisionId: f.uuid(), checksumPrefix: f.optStr() }),
  async (ctx, i) => {
    await confirmCheck(ctx, i.opId, { kind: "program_confirmed", programRevisionId: i.programRevisionId, checksumPrefix: i.checksumPrefix });
    return i.checksumPrefix ? "Program confirmed — checksum matches the released file." : "Program confirmed.";
  },
  { revalidate: opPath },
);

export const startSetupAction = action(
  "shopfloor.setup_start",
  z.object({ opId: f.uuid() }),
  async (ctx, i) => {
    await startSetup(ctx, i.opId);
    return "Setup started. Your setup time is being recorded.";
  },
  { revalidate: opPath },
);

export const finishSetupAction = action(
  "shopfloor.setup_finish",
  z.object({ opId: f.uuid(), notes: f.optStr() }),
  async (ctx, i) => {
    const r = await finishSetup(ctx, i.opId, i.notes);
    return r.firstOffInspection
      ? `Setup finished. First-off inspection ${r.firstOffInspection} has been requested — wait for QC approval before running production.`
      : "Setup finished. You can start production.";
  },
  { revalidate: opPath },
);

export const startProductionAction = action(
  "shopfloor.production_start",
  z.object({ opId: f.uuid(), materialLotId: f.optUuid() }),
  async (ctx, i) => {
    await startProduction(ctx, i.opId, { materialLotId: i.materialLotId });
    return "Production started. Your run time is being recorded.";
  },
  { revalidate: opPath },
);

export const stopProductionAction = action(
  "shopfloor.production_stop",
  z.object({ opId: f.uuid(), qtyGood: f.dec({ msg: "Enter the number of good parts (0 if none)." }), qtyRejected: f.optDec(), qtyScrapped: f.optDec(), notes: f.optStr() }),
  async (ctx, i) => {
    const r = await stopProduction(ctx, i.opId, { qtyGood: i.qtyGood, qtyRejected: i.qtyRejected ?? "0", qtyScrapped: i.qtyScrapped ?? "0", notes: i.notes });
    return r.suggestNcr ? "Run stopped and quantities recorded. You recorded rejected or scrapped parts — please raise a non-conformance below." : "Run stopped and quantities recorded.";
  },
  { revalidate: opPath },
);

export const addEventAction = action(
  "shopfloor.event",
  z.object({ opId: f.uuid(), kind: f.enumOf(["note", "issue", "assist_request"] as const), message: f.str("Enter a message.") }),
  async (ctx, i) => {
    await addOperationEvent(ctx, i.opId, i.kind, i.message);
    return i.kind === "assist_request" ? "Assistance requested. A supervisor has been notified." : i.kind === "issue" ? "Issue reported. A supervisor has been notified." : "Note added.";
  },
  { revalidate: opPath },
);

export const holdOperationAction = action(
  "shopfloor.hold",
  z.object({ opId: f.uuid(), reason: f.str("Give a reason for the hold.") }),
  async (ctx, i) => {
    await holdOperation(ctx, i.opId, i.reason);
    return "Operation placed on hold. A supervisor has been notified.";
  },
  { revalidate: opPath },
);

export const submitInspectionAction = action(
  "shopfloor.submit_inspection",
  z.object({ opId: f.uuid() }),
  async (ctx, i) => {
    const insp = await submitForInspection(ctx, i.opId);
    return `Submitted for inspection — ${insp.ref}.`;
  },
  { revalidate: opPath },
);

export const signOffAction = action(
  "shopfloor.sign_off",
  z.object({ opId: f.uuid(), note: f.optStr(), shortfallReason: f.optStr() }),
  async (ctx, i) => {
    await signOffOperation(ctx, i.opId, { note: i.note, shortfallReason: i.shortfallReason });
    return "Operation signed off.";
  },
  { revalidate: opPath },
);

export const startDowntimeAction = action(
  "shopfloor.downtime_start",
  z.object({ opId: f.uuid(), machineId: f.uuid(), reasonId: f.uuid("Select a downtime reason."), notes: f.optStr() }),
  async (ctx, i) => {
    await startDowntime(ctx, { machineId: i.machineId, reasonId: i.reasonId, operationId: i.opId, notes: i.notes });
    return "Downtime started. The machine status has been updated.";
  },
  { revalidate: (i) => [...opPath(i), `/machines/${i.machineId}`] },
);

export const endDowntimeAction = action(
  "shopfloor.downtime_end",
  z.object({ opId: f.uuid(), machineId: f.uuid(), downtimeId: f.uuid(), notes: f.optStr() }),
  async (ctx, i) => {
    await endDowntime(ctx, i.downtimeId, i.notes);
    return "Downtime ended. The machine is reported available.";
  },
  { revalidate: (i) => [...opPath(i), `/machines/${i.machineId}`] },
);

export const raiseOpNcrAction = action(
  "shopfloor.ncr",
  z.object({
    opId: f.uuid(),
    jobId: f.uuid(),
    jobLineId: f.uuid(),
    batchId: f.optUuid(),
    category: f.enumOf(NCR_CATEGORIES),
    qtyAffected: f.dec({ msg: "Enter the affected quantity." }),
    description: f.str("Describe the non-conformance."),
    holdOperation: f.bool(),
  }),
  async (ctx, i) => {
    const n = await raiseNcr(ctx, {
      source: "internal",
      category: i.category,
      jobId: i.jobId,
      jobLineId: i.jobLineId,
      operationId: i.opId,
      batchId: i.batchId,
      qtyAffected: i.qtyAffected,
      description: i.description,
      holdOperation: i.holdOperation,
      holdBatch: i.holdOperation,
    });
    return `Non-conformance ${n.ref} raised${i.holdOperation ? " and the operation is on hold" : ""}. Quality has been notified.`;
  },
  { revalidate: opPath },
);
