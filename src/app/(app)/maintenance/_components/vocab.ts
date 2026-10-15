import type { Tone } from "@/lib/status";

export const WO_KINDS = [
  { value: "preventive", label: "Preventive" },
  { value: "breakdown", label: "Breakdown" },
  { value: "corrective", label: "Corrective" },
  { value: "inspection", label: "Inspection" },
  { value: "calibration", label: "Calibration" },
];
export const kindLabel = (k: string) => WO_KINDS.find((x) => x.value === k)?.label ?? k;

export const PRIORITY_OPTIONS = [
  { value: "1", label: "1 — Urgent" },
  { value: "2", label: "2 — High" },
  { value: "3", label: "3 — Normal" },
  { value: "4", label: "4 — Low" },
];

const def = (label: string, tone: Tone) => ({ label, tone });
/** Measuring instrument statuses (quality.measuring_instruments.status). */
export const INSTRUMENT_STATUS = {
  in_service: def("In service", "success"),
  out_of_calibration: def("Out of calibration", "danger"),
  quarantined: def("Quarantined", "hold"),
  retired: def("Retired", "muted"),
  lost: def("Lost", "danger"),
} as const;
