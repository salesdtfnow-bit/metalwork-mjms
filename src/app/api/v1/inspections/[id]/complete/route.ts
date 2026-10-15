import { apiHandler } from "@/server/api";
import { completeInspection } from "@/server/services/inspections";

/** POST /api/v1/inspections/:id/complete { decision, qtyAccepted, qtyRejected, notes, password } */
export const POST = apiHandler<{ id: string }>(async (ctx, req, { id }) => {
  const b = (await req.json().catch(() => ({}))) as { decision?: "pass" | "fail"; qtyInspected?: string; qtyAccepted?: string; qtyRejected?: string; notes?: string; password?: string };
  if (b.decision !== "pass" && b.decision !== "fail") return Response.json({ error: "decision must be pass or fail" }, { status: 400 });
  return completeInspection(ctx, id, { decision: b.decision, qtyInspected: b.qtyInspected, qtyAccepted: b.qtyAccepted, qtyRejected: b.qtyRejected, notes: b.notes, password: b.password });
});
