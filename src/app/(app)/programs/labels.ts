import type { Tone } from "@/lib/status";

/** Program revision verification (simulation / prove-out) vocabulary. */
export const VERIFICATION_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Verification pending", tone: "warning" },
  not_required: { label: "Not required", tone: "muted" },
  simulated: { label: "Simulated", tone: "info" },
  proved_out: { label: "Proved out", tone: "success" },
  failed: { label: "Verification failed", tone: "danger" },
};

export const VERIFICATION_OPTIONS = [
  { value: "simulated", label: "Simulated (CAM / control simulation)" },
  { value: "proved_out", label: "Proved out on the machine" },
  { value: "not_required", label: "Not required (minor change)" },
  { value: "failed", label: "Failed" },
];

export const FILE_ACTION: Record<string, { label: string; tone: Tone }> = {
  download: { label: "Downloaded", tone: "neutral" },
  view: { label: "Viewed", tone: "neutral" },
  denied: { label: "Denied", tone: "danger" },
};
