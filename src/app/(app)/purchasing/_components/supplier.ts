import { fmtDate } from "@/lib/format";

const APPROVAL: Record<string, string> = {
  approved: "Approved",
  conditional: "Conditional approval",
  pending: "Approval pending",
  not_approved: "Not approved",
  suspended: "Suspended",
};

export const approvalLabel = (s: string) => APPROVAL[s] ?? s;

/** "Name (CODE) — Approved, expires 01 Jan 2027" for supplier selects. */
export function supplierLabel(s: { name: string; code: string; approvalStatus: string; approvalExpiresOn: string | null }) {
  return `${s.name} (${s.code}) — ${approvalLabel(s.approvalStatus)}${s.approvalExpiresOn ? `, expires ${fmtDate(s.approvalExpiresOn)}` : ""}`;
}
