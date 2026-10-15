import { fmtDate } from "@/lib/format";
import type { Tone } from "@/lib/status";
import { Badge, StatusBadge } from "@/components/ui";

/** Approved-supplier statuses (kept with the supplier pages; the service owns the values). */
export const SUPPLIER_APPROVAL: Record<string, { label: string; tone: Tone }> = {
  approved: { label: "Approved", tone: "success" },
  conditional: { label: "Conditional", tone: "warning" },
  pending: { label: "Pending approval", tone: "neutral" },
  not_approved: { label: "Not approved", tone: "danger" },
  suspended: { label: "Suspended", tone: "hold" },
};

export const APPROVAL_OPTIONS = Object.entries(SUPPLIER_APPROVAL).map(([value, v]) => ({ value, label: v.label }));

export { CATEGORY_OPTIONS, categoryLabel } from "./categories";

/** Status badge plus an expiry warning when approval has lapsed or lapses within 30 days. */
export function ApprovalBadge({ status, expiresOn, today }: { status: string; expiresOn: string | null; today: string }) {
  const usable = ["approved", "conditional"].includes(status);
  const expired = usable && !!expiresOn && expiresOn < today;
  const soon = usable && !!expiresOn && !expired && Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`) <= 30 * 86_400_000;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusBadge map={SUPPLIER_APPROVAL} status={status} />
      {expired && <Badge tone="danger">Expired {fmtDate(expiresOn)}</Badge>}
      {soon && <Badge tone="warning">Expires {fmtDate(expiresOn)}</Badge>}
      {usable && !expired && !soon && expiresOn && <span className="text-[12px] text-steel">until {fmtDate(expiresOn)}</span>}
    </span>
  );
}
