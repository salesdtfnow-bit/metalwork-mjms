import type { Tone } from "@/lib/status";

const def = (label: string, tone: Tone) => ({ label, tone });

export const STAGE_LABEL: Record<string, string> = {
  incoming: "Incoming",
  first_off: "First-off",
  in_process: "In-process",
  final: "Final",
  subcontract_return: "Subcontract return",
  other: "Other",
};
export const stageLabel = (s: string | null | undefined) => (s ? STAGE_LABEL[s] ?? s.replace(/_/g, " ") : "—");

export const PLAN_STATUS = {
  draft: def("Draft", "neutral"),
  approved: def("Approved", "success"),
  obsolete: def("Obsolete — superseded", "muted"),
} as const;

export const INSTRUMENT_STATUS = {
  in_service: def("In service", "success"),
  out_of_calibration: def("Out of calibration", "danger"),
  quarantined: def("Quarantined", "hold"),
  retired: def("Retired", "muted"),
  lost: def("Lost", "muted"),
} as const;

export const RELEASE_STATUS = {
  draft: def("Awaiting decision", "warning"),
  approved: def("Released", "success"),
  rejected: def("Rejected", "danger"),
  revoked: def("Revoked", "muted"),
} as const;

export const INSTRUMENT_TYPES = [
  { value: "micrometer", label: "Micrometer" },
  { value: "caliper", label: "Caliper" },
  { value: "height_gauge", label: "Height gauge" },
  { value: "bore_gauge", label: "Bore gauge" },
  { value: "cmm", label: "CMM" },
  { value: "thread_gauge", label: "Thread gauge" },
  { value: "surface_tester", label: "Surface roughness tester" },
  { value: "hardness_tester", label: "Hardness tester" },
  { value: "other", label: "Other" },
];

export const STAGE_OPTIONS = Object.entries(STAGE_LABEL).map(([value, label]) => ({ value, label }));
