import type { Tone } from "@/lib/status";

type Def = { label: string; tone: Tone };
const def = (label: string, tone: Tone): Def => ({ label, tone });

/** Vocabularies used only by the jobs module (not in src/lib/status.ts). */
export const ROUTE_STATUS: Record<string, Def> = {
  draft: def("Route draft", "warning"),
  released: def("Route released", "success"),
};

export const FIRST_OFF_STATUS: Record<string, Def> = {
  not_required: def("Not required", "muted"),
  required: def("Required", "warning"),
  requested: def("Requested", "progress"),
  approved: def("Approved", "success"),
  rejected: def("Rejected", "danger"),
};

export const BATCH_STATUS: Record<string, Def> = {
  planned: def("Planned", "neutral"),
  in_progress: def("In progress", "progress"),
  on_hold: def("On hold", "hold"),
  quarantined: def("Quarantined", "hold"),
  complete: def("Complete", "success"),
  accepted: def("Accepted", "success"),
  rejected: def("Rejected", "danger"),
  dispatched: def("Dispatched", "muted"),
};

export const SERIAL_STATUS: Record<string, Def> = {
  in_process: def("In process", "progress"),
  accepted: def("Accepted", "success"),
  rejected: def("Rejected", "danger"),
  scrapped: def("Scrapped", "muted"),
  dispatched: def("Dispatched", "muted"),
};

export const PO_LINE_STATUS: Record<string, Def> = {
  open: def("Open", "info"),
  partially_received: def("Partially received", "warning"),
  received: def("Received", "success"),
  cancelled: def("Cancelled", "muted"),
};

export const RELEASE_STATUS: Record<string, Def> = {
  draft: def("Draft — checks in progress", "warning"),
  approved: def("Approved", "success"),
  rejected: def("Rejected", "danger"),
  revoked: def("Revoked", "muted"),
};

export const GATE_EXCEPTION_STATUS: Record<string, Def> = {
  approved: def("Active", "warning"),
  revoked: def("Revoked", "muted"),
  used: def("Used", "muted"),
};

export const TRACE_LEVEL: Record<string, string> = {
  job: "Job",
  batch: "Batch",
  piece: "Piece (serialised)",
};

export const GATE_LABELS: Record<string, string> = {
  route: "Route & authorisation",
  dependencies: "Previous operations",
  material: "Material",
  program: "CNC program",
  drawing: "Drawing",
  review: "Revision review",
  operator: "Operator",
  machine: "Machine",
  hold: "Hold",
  first_off: "First-off",
  checks: "Pre-start confirmations",
};
export const gateName = (g: string) => GATE_LABELS[g] ?? g;

export const MATERIAL_KIND: Record<string, string> = {
  issue: "Issue",
  consume: "Consume",
  remnant: "Remnant",
  return: "Return",
  scrap: "Scrap",
  adjust: "Adjustment",
};

export const DOC_PURPOSE = [
  { value: "drawing", label: "Drawing" },
  { value: "setup_sheet", label: "Setup sheet" },
  { value: "work_instruction", label: "Work instruction" },
  { value: "reference", label: "Reference" },
];

/** Operation statuses after which an operation counts as started (mirrors routing service). */
export const STARTED_OP = ["in_setup", "awaiting_first_off", "in_production", "paused", "awaiting_inspection", "subcontracted", "complete"];

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
