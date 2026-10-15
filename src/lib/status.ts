/**
 * Status vocabularies shared by server and UI. Every status has a text label — colour is
 * never the only signal (accessibility).
 */
export type Tone = "neutral" | "info" | "progress" | "warning" | "danger" | "success" | "hold" | "muted";

type Def = { label: string; tone: Tone };
const def = (label: string, tone: Tone): Def => ({ label, tone });

export const JOB_STATUS = {
  order_confirmed: def("Order confirmed", "info"),
  awaiting_material: def("Awaiting material", "warning"),
  material_received: def("Material received", "info"),
  awaiting_material_release: def("Awaiting material release", "warning"),
  ready_for_planning: def("Ready for planning", "info"),
  planned: def("Planned", "info"),
  awaiting_programming: def("Awaiting programming", "warning"),
  programming_in_progress: def("Programming in progress", "progress"),
  awaiting_program_approval: def("Awaiting program approval", "warning"),
  ready_for_production: def("Ready for production", "success"),
  in_setup: def("In setup", "progress"),
  awaiting_first_off: def("Awaiting first-off approval", "warning"),
  in_production: def("In production", "progress"),
  partially_completed: def("Partially completed", "progress"),
  awaiting_inspection: def("Awaiting inspection", "warning"),
  on_hold: def("On hold", "hold"),
  non_conformance: def("Non-conformance", "danger"),
  rework_required: def("Rework required", "danger"),
  subcontracted: def("Subcontracted", "progress"),
  production_complete: def("Production complete", "success"),
  final_qc: def("Final QC", "warning"),
  ready_for_dispatch: def("Ready for dispatch", "success"),
  dispatched: def("Dispatched", "success"),
  completed: def("Completed", "muted"),
  cancelled: def("Cancelled", "muted"),
} as const;
export type JobStatus = keyof typeof JOB_STATUS;

/** Pre-job pipeline stages (shown on enquiry/quote records, not on jobs). */
export const PIPELINE_STAGE = {
  enquiry: def("Enquiry", "info"),
  quotation_in_progress: def("Quotation in progress", "progress"),
  awaiting_po: def("Awaiting PO", "warning"),
} as const;

export const OP_STATUS = {
  pending: def("Pending", "neutral"),
  ready: def("Ready", "info"),
  in_setup: def("In setup", "progress"),
  awaiting_first_off: def("Awaiting first-off", "warning"),
  in_production: def("In production", "progress"),
  paused: def("Paused", "neutral"),
  on_hold: def("On hold", "hold"),
  awaiting_inspection: def("Awaiting inspection", "warning"),
  subcontracted: def("At subcontractor", "progress"),
  complete: def("Complete", "success"),
  cancelled: def("Cancelled", "muted"),
} as const;
export type OpStatus = keyof typeof OP_STATUS;

export const ENQUIRY_STATUS = {
  new: def("New", "info"),
  under_review: def("Under review", "progress"),
  quoting: def("Quoting", "progress"),
  quoted: def("Quoted", "warning"),
  won: def("Won", "success"),
  lost: def("Lost", "muted"),
  no_quote: def("No quote", "muted"),
  cancelled: def("Cancelled", "muted"),
} as const;

export const QUOTE_STATUS = {
  draft: def("Draft", "neutral"),
  internal_review: def("Internal review", "warning"),
  sent: def("Sent", "info"),
  awaiting_response: def("Awaiting response", "warning"),
  accepted: def("Accepted", "success"),
  rejected: def("Rejected", "danger"),
  expired: def("Expired", "muted"),
  superseded: def("Superseded", "muted"),
} as const;
export type QuoteStatus = keyof typeof QUOTE_STATUS;

export const ORDER_STATUS = {
  received: def("Received — unverified", "warning"),
  verified: def("Verified", "info"),
  converted: def("Converted to job", "success"),
  cancelled: def("Cancelled", "muted"),
} as const;

export const REVISION_STATUS = {
  draft: def("Draft", "neutral"),
  in_review: def("In review", "warning"),
  submitted: def("Submitted for approval", "warning"),
  approved: def("Approved (not released)", "info"),
  released: def("Released", "success"),
  superseded: def("Superseded — do not use", "muted"),
  rejected: def("Rejected", "danger"),
  obsolete: def("Obsolete", "muted"),
} as const;

export const LOT_STATUS = {
  received: def("Received", "info"),
  awaiting_inspection: def("Awaiting inspection", "warning"),
  quarantined: def("Quarantined", "hold"),
  released: def("Released for production", "success"),
  rejected: def("Rejected", "danger"),
  returned: def("Returned to supplier", "muted"),
  consumed: def("Consumed", "muted"),
} as const;

export const PO_STATUS = {
  draft: def("Draft", "neutral"),
  approved: def("Approved", "info"),
  sent: def("Sent to supplier", "progress"),
  partially_received: def("Partially received", "warning"),
  received: def("Received", "success"),
  closed: def("Closed", "muted"),
  cancelled: def("Cancelled", "muted"),
} as const;

export const INSPECTION_STATUS = {
  open: def("Open", "warning"),
  in_progress: def("In progress", "progress"),
  passed: def("Passed", "success"),
  failed: def("Failed", "danger"),
  cancelled: def("Cancelled", "muted"),
} as const;

export const NCR_STATUS = {
  open: def("Open", "danger"),
  contained: def("Contained", "warning"),
  awaiting_disposition: def("Awaiting disposition", "warning"),
  disposition_approved: def("Disposition approved", "info"),
  in_rework: def("In rework", "progress"),
  awaiting_reinspection: def("Awaiting reinspection", "warning"),
  closed: def("Closed", "muted"),
  cancelled: def("Cancelled", "muted"),
} as const;

export const CAPA_STATUS = {
  open: def("Open", "warning"),
  in_progress: def("In progress", "progress"),
  implemented: def("Implemented — awaiting verification", "info"),
  verified_effective: def("Verified effective", "success"),
  verified_ineffective: def("Verified ineffective", "danger"),
  closed: def("Closed", "muted"),
  cancelled: def("Cancelled", "muted"),
} as const;

export const MACHINE_STATUS = {
  available: def("Available", "success"),
  running: def("Running", "progress"),
  setup: def("In setup", "info"),
  blocked: def("Blocked", "danger"),
  maintenance: def("Maintenance", "hold"),
  offline: def("Offline", "muted"),
} as const;
export type MachineStatus = keyof typeof MACHINE_STATUS;

export const SYNC_STATUS = {
  pending: def("Pending", "warning"),
  sending: def("Sending", "progress"),
  confirmed: def("Confirmed", "success"),
  manual_confirmed: def("Manually confirmed", "success"),
  failed: def("Failed", "danger"),
  needs_reconciliation: def("Needs reconciliation", "danger"),
  cancelled: def("Cancelled", "muted"),
} as const;

export const DISPATCH_STATUS = {
  draft: def("Draft", "neutral"),
  dispatched: def("Dispatched", "success"),
  delivered: def("Delivered", "success"),
  cancelled: def("Cancelled", "muted"),
} as const;

export const SUBCON_STATUS = {
  draft: def("Draft", "neutral"),
  sent: def("Sent", "progress"),
  at_supplier: def("At supplier", "progress"),
  returned: def("Returned — awaiting inspection", "warning"),
  accepted: def("Accepted", "success"),
  rejected: def("Rejected", "danger"),
  closed: def("Closed", "muted"),
  cancelled: def("Cancelled", "muted"),
} as const;

export const MWO_STATUS = {
  open: def("Open", "warning"),
  scheduled: def("Scheduled", "info"),
  in_progress: def("In progress", "progress"),
  completed: def("Completed", "success"),
  cancelled: def("Cancelled", "muted"),
} as const;

export const PRIORITY = {
  1: def("Urgent", "danger"),
  2: def("High", "warning"),
  3: def("Normal", "neutral"),
  4: def("Low", "muted"),
} as const;

export function statusDef(map: Record<string, Def>, key: string | null | undefined): Def {
  if (!key) return { label: "—", tone: "muted" };
  return map[key] ?? { label: key.replace(/_/g, " "), tone: "neutral" };
}
