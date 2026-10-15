import type { Tone } from "@/lib/status";

const def = (label: string, tone: Tone) => ({ label, tone });

/** Tool statuses (tools.status). Kept local: not part of the shared status vocabulary yet. */
export const TOOL_STATUS = {
  available: def("Available", "success"),
  in_use: def("In use", "progress"),
  maintenance: def("Maintenance / life reached", "warning"),
  quarantined: def("Quarantined", "hold"),
  scrapped: def("Scrapped", "muted"),
  lost: def("Lost", "danger"),
} as const;

export const TOOL_TYPES = [
  { value: "cutting_tool", label: "Cutting tool" },
  { value: "insert", label: "Insert" },
  { value: "holder", label: "Holder" },
  { value: "fixture", label: "Fixture" },
  { value: "jig", label: "Jig" },
  { value: "gauge", label: "Gauge" },
  { value: "other", label: "Other" },
];

export const LIFE_UNITS = [
  { value: "none", label: "Not life-tracked" },
  { value: "minutes", label: "Minutes" },
  { value: "cycles", label: "Cycles" },
  { value: "parts", label: "Parts" },
];

export const EVENT_KINDS = [
  { value: "usage", label: "Usage (adds to life used)" },
  { value: "inspection", label: "Inspection (resets inspection due date)" },
  { value: "maintenance", label: "Maintenance" },
  { value: "regrind", label: "Regrind (resets life, makes available)" },
  { value: "replacement", label: "Replacement (resets life, makes available)" },
  { value: "status_change", label: "Status change (reason required)" },
];

export const typeLabel = (v: string) => TOOL_TYPES.find((t) => t.value === v)?.label ?? v;
export const eventLabel = (v: string) => EVENT_KINDS.find((t) => t.value === v)?.label.replace(/ \(.*\)$/, "") ?? v;
