import type { Tone } from "@/lib/status";

/** Certificate status on a lot (local vocabulary — not in lib/status). */
export const CERT_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Certificate outstanding", tone: "warning" },
  received: { label: "Certificate received — not verified", tone: "info" },
  verified: { label: "Certificate verified", tone: "success" },
  rejected: { label: "Certificate rejected", tone: "danger" },
  not_required: { label: "Certificate not required", tone: "muted" },
};

export const CERT_REQ_OPTIONS = [
  { value: "none", label: "None required" },
  { value: "2.1", label: "EN 10204 2.1 (declaration of compliance)" },
  { value: "2.2", label: "EN 10204 2.2 (test report)" },
  { value: "3.1", label: "EN 10204 3.1 (inspection certificate)" },
  { value: "3.2", label: "EN 10204 3.2 (third-party verified)" },
];
export const certReqLabel = (v: string | null | undefined) => (!v ? "—" : v === "none" ? "None" : `EN 10204 ${v}`);

export const CERT_TYPE_OPTIONS = [
  { value: "3.1", label: "EN 10204 3.1" },
  { value: "3.2", label: "EN 10204 3.2" },
  { value: "2.2", label: "EN 10204 2.2" },
  { value: "2.1", label: "EN 10204 2.1" },
  { value: "coc", label: "Certificate of conformity" },
  { value: "other", label: "Other" },
];
export const certTypeLabel = (v: string) => CERT_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v;

export const FORM_OPTIONS = ["bar", "plate", "sheet", "tube", "billet", "casting", "forging", "extrusion", "other"].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }));

export const FAMILY_OPTIONS = [
  { value: "aluminium", label: "Aluminium" },
  { value: "carbon_steel", label: "Carbon steel" },
  { value: "alloy_steel", label: "Alloy steel" },
  { value: "stainless", label: "Stainless steel" },
  { value: "brass", label: "Brass / copper alloy" },
  { value: "titanium", label: "Titanium" },
  { value: "plastic", label: "Plastic" },
  { value: "other", label: "Other" },
];

export const TX_KIND: Record<string, string> = {
  issue: "Issued to job",
  consume: "Consumed",
  remnant: "Remnant",
  return: "Returned to stores",
  scrap: "Scrapped",
  adjust: "Stock adjustment",
};

export const SYNC_KIND: Record<string, string> = { in: "Stock in", out: "Stock out", adjust: "Adjustment", move: "Move" };

const SYNC_DONE = ["confirmed", "manual_confirmed"];
export const syncDone = (s: { status: string } | null | undefined) => !!s && SYNC_DONE.includes(s.status);

/**
 * What still has to happen before this lot can be used. Receipt alone never makes material
 * available — inspection, certificate verification, BoxHero recording and a signed release are separate.
 */
export function nextStep(
  lot: { status: string; inspectionResult: string | null; certificateStatus: string; stockInSyncId: string | null },
  sync: { status: string } | null | undefined,
): { text: string; tone: Tone } {
  if (lot.status === "released") return { text: "Released — can be allocated", tone: "success" };
  if (lot.status === "rejected") return { text: "Rejected — do not use", tone: "danger" };
  if (lot.status === "returned") return { text: "Returned to supplier", tone: "muted" };
  if (lot.status === "consumed") return { text: "Fully consumed", tone: "muted" };
  if (lot.status === "quarantined") return { text: "Quarantined — resolve before release", tone: "hold" };
  const missing: string[] = [];
  if (lot.stockInSyncId && !syncDone(sync)) missing.push("BoxHero stock-in");
  if (lot.inspectionResult !== "pass") missing.push("inspection");
  if (!["verified", "not_required"].includes(lot.certificateStatus)) missing.push("certificate verification");
  if (missing.length) return { text: `Not usable — needs ${missing.join(", ")}`, tone: "warning" };
  return { text: "Ready for signed release", tone: "info" };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
