import type { ReactNode } from "react";
import { Badge, StatusBadge, cx } from "@/components/ui";
import { SYNC_STATUS } from "@/lib/status";

export const STAGES = [
  "Ordered",
  "Received",
  "Recorded in BoxHero",
  "Inspected & certificate verified",
  "Released",
  "Allocated",
  "Issued",
  "Consumed / Remnant / Returned",
] as const;

/** Explains that ordering or receiving material does not make it available for production. */
export function StageLegend({ compact = false }: { compact?: boolean }) {
  return (
    <div className="mb-4 rounded-md border border-line bg-sheet px-3 py-2">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-ink-2" aria-label="Material stages">
        {STAGES.map((s, i) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className={cx("rounded-sm border px-1.5 py-0.5", s === "Released" ? "border-green/40 bg-green-50 font-semibold text-green" : "border-line bg-paper")}>
              {i + 1}. {s}
            </span>
            {i < STAGES.length - 1 && <span aria-hidden className="text-steel">→</span>}
          </li>
        ))}
      </ol>
      {!compact && (
        <p className="mt-1.5 text-[12.5px] text-steel">
          Material is <strong className="text-ink">not available for production</strong> just because it was ordered or received. Each stage is a separate recorded step; only a
          lot that has been inspected, had its certificate verified and been formally released can be allocated and issued to a job.
        </p>
      )}
    </div>
  );
}

export type StageState = "done" | "pending" | "problem" | "na";
export type Stage = { label: string; state: StageState; detail?: ReactNode };

const MARK: Record<StageState, { sym: string; cls: string; sr: string }> = {
  done: { sym: "✓", cls: "border-green bg-green text-white", sr: "Done" },
  pending: { sym: "", cls: "border-steel-2 bg-sheet text-steel", sr: "Not done" },
  problem: { sym: "!", cls: "border-red bg-red text-white", sr: "Problem" },
  na: { sym: "–", cls: "border-line bg-line-2 text-steel", sr: "Not applicable" },
};

/** Lot lifecycle strip: every stage shown as done / not done with who and when. */
export function LifecycleStrip({ stages }: { stages: Stage[] }) {
  return (
    <ol className="mb-5 grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4 xl:grid-cols-8" aria-label="Lot lifecycle">
      {stages.map((s, i) => {
        const m = MARK[s.state];
        return (
          <li key={i} className={cx("bg-sheet px-3 py-2", s.state === "done" && "bg-green-50/40")}>
            <div className="flex items-center gap-2">
              <span aria-hidden className={cx("inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold", m.cls)}>
                {m.sym || i + 1}
              </span>
              <span className="text-[12.5px] font-semibold leading-tight text-ink">{s.label}</span>
              <span className="sr-only">— {m.sr}</span>
            </div>
            <div className="mt-1 text-[12px] leading-snug text-steel">{s.detail ?? (s.state === "pending" ? "Not yet" : "—")}</div>
          </li>
        );
      })}
    </ol>
  );
}

/** BoxHero sync status cell; lots/movements without a BoxHero item are "Not tracked". */
export function SyncCell({ sync }: { sync: { status: string } | null | undefined }) {
  if (!sync) return <Badge tone="muted">Not tracked</Badge>;
  return <StatusBadge map={SYNC_STATUS} status={sync.status} />;
}

/** ✓ / ✗ release-check list. */
export function CheckList({ checks, compact = false, failLinks }: { checks: { key: string; ok: boolean; message: string }[]; compact?: boolean; failLinks?: Record<string, ReactNode> }) {
  return (
    <ul className={cx(compact ? "space-y-0.5 text-[12.5px]" : "space-y-1 text-[13.5px]")}>
      {checks.map((c) => (
        <li key={c.key} className="flex items-start gap-1.5">
          <span aria-hidden className={cx("font-bold", c.ok ? "text-green" : "text-red")}>
            {c.ok ? "✓" : "✗"}
          </span>
          <span className={c.ok ? "text-ink-2" : "text-ink"}>
            <span className="sr-only">{c.ok ? "Passed: " : "Not met: "}</span>
            {c.message}
            {!c.ok && failLinks?.[c.key] && <> · {failLinks[c.key]}</>}
          </span>
        </li>
      ))}
    </ul>
  );
}
