"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/server/action";
import { f } from "@/server/forms";
import { invalid } from "@/server/errors";
import { recordToolEvent, saveTool } from "@/server/services/tooling";

const toolForm = z.object({
  assetNo: f.str("Asset number is required."),
  description: f.str("Describe the tool."),
  toolType: f.enumOf(["cutting_tool", "insert", "holder", "fixture", "jig", "gauge", "other"] as const),
  location: f.optStr(),
  ownership: f.enumOf(["mjms", "boxhero"] as const),
  boxheroItemId: f.optUuid(),
  lifeUnit: f.enumOf(["none", "minutes", "cycles", "parts"] as const),
  lifeLimit: f.optDec({ min: 0 }),
  inspectionRequired: f.bool(),
  inspectionIntervalDays: f.optInt(),
  nextInspectionDue: f.optDate(),
  notes: f.optStr(),
  machineIds: f.uuids(),
});

export const createToolAction = action("tool.create", toolForm, async (ctx, input) => {
  const t = await saveTool(ctx, input);
  redirect(`/tooling/${t.id}`);
});

export const updateToolAction = action(
  "tool.update",
  toolForm.extend({ id: f.uuid() }),
  async (ctx, { id, ...input }) => {
    await saveTool(ctx, input, id);
    return "Tool saved.";
  },
  { revalidate: (i) => [`/tooling/${i.id}`, "/tooling"] },
);

export const recordToolEventAction = action(
  "tool.event",
  z.object({
    toolId: f.uuid(),
    kind: f.enumOf(["usage", "inspection", "maintenance", "regrind", "replacement", "status_change"] as const),
    quantity: f.optDec({ min: 0 }),
    status: f.optStr(),
    notes: f.optStr(),
  }),
  async (ctx, { toolId, ...input }) => {
    // Throwing (not returning) releases the duplicate-submission key so the form can be corrected.
    if (input.kind === "usage" && !input.quantity) throw invalid("Enter the usage quantity.", { field: "quantity" });
    if (input.kind === "status_change" && !input.status) throw invalid("Select the new status.", { field: "status" });
    await recordToolEvent(ctx, toolId, { ...input, status: input.kind === "status_change" || input.kind === "inspection" ? input.status : null });
    return "Event recorded.";
  },
  { revalidate: (i) => [`/tooling/${i.toolId}`, "/tooling"] },
);
