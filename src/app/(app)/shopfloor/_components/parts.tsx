import type { ReactNode } from "react";
import { cx, LinkButton, StatusBadge } from "@/components/ui";
import { fmtDate, fmtQty, todayISO } from "@/lib/format";
import { OP_STATUS, PRIORITY } from "@/lib/status";

/** Wrapper class that enlarges form fields and labels for touch screens. */
export const BIG_FIELDS = "[&_.field-input]:min-h-12 [&_.field-input]:px-3 [&_.field-input]:text-[17px] [&_label]:text-[15px] [&_textarea.field-input]:py-2.5";

/** Larger status badge for shop-floor screens (same colours and labels as everywhere else). */
export const BIG_BADGE = "text-[14px]! px-2! py-1! leading-5!";

export const GATE_LABELS: Record<string, string> = {
  route: "Route & job release",
  dependencies: "Previous operations",
  material: "Material",
  program: "CNC program",
  drawing: "Drawing",
  review: "Revision review",
  operator: "Operator & competency",
  machine: "Machine",
  hold: "Holds",
  first_off: "First-off approval",
  checks: "Pre-start confirmations",
  time: "Open time",
  quantity: "Quantities",
  inspection: "Inspection",
};
export const gateName = (g: string) => GATE_LABELS[g] ?? g.replace(/_/g, " ");

export function isOverdue(date: string | null | undefined) {
  return !!date && date < todayISO();
}

export function DueDate({ date, className }: { date: string | null | undefined; className?: string }) {
  if (!date) return <span className={cx("text-steel", className)}>No date</span>;
  const late = isOverdue(date);
  return (
    <span className={cx(late ? "font-semibold text-red" : "text-ink", className)}>
      {fmtDate(date)}
      {late && " — overdue"}
    </span>
  );
}

export function PriorityBadge({ priority, big }: { priority: number; big?: boolean }) {
  return <StatusBadge map={PRIORITY} status={String(priority)} className={big ? BIG_BADGE : undefined} />;
}

type CardRow = {
  op: { id: string; opNumber: string; title: string; status: string; plannedQty: string; qtyGood: string };
  job: { jobNumber: string; priority: number; requiredDate: string | null };
  line: { partNumber: string };
  type: { name: string };
  machine: { code: string } | null;
};

/** One operation on the operator's work list. `emphasis` is used for the job in hand. */
export function OpCard({ row, emphasis = false, children, cta = "Open" }: { row: CardRow; emphasis?: boolean; children?: ReactNode; cta?: string }) {
  const { op, job, line, type, machine } = row;
  return (
    <article className={cx("flex flex-col gap-3 rounded-md bg-sheet p-4", emphasis ? "border-2 border-dykem shadow-[0_2px_0_0_rgba(35,82,160,0.15)]" : "border border-line")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={cx("plate leading-none text-ink", emphasis ? "text-[34px]" : "text-[28px]")}>{job.jobNumber}</div>
          <div className="mt-1.5 text-[15px] text-steel">
            Op <span className="plate text-[20px] text-ink">{op.opNumber}</span>
            <span aria-hidden> · </span>
            {type.name}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusBadge map={OP_STATUS} status={op.status} className={BIG_BADGE} />
          {job.priority !== 3 && <PriorityBadge priority={job.priority} big />}
        </div>
      </div>
      <p className="text-[17px] font-semibold leading-snug text-ink">{op.title}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[15px] sm:grid-cols-4">
        <div>
          <dt className="text-[13px] text-steel">Part</dt>
          <dd className="plate truncate text-[16px] text-ink">{line.partNumber}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-steel">Machine</dt>
          <dd className="plate text-[16px] text-ink">{machine?.code ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-steel">Good / planned</dt>
          <dd className="text-[16px] text-ink">
            {fmtQty(op.qtyGood)} / {fmtQty(op.plannedQty)}
          </dd>
        </div>
        <div>
          <dt className="text-[13px] text-steel">Due</dt>
          <dd className="text-[16px]">
            <DueDate date={job.requiredDate} />
          </dd>
        </div>
      </dl>
      {children}
      <LinkButton href={`/shopfloor/op/${op.id}`} variant={emphasis ? "primary" : "secondary"} size={emphasis ? "xl" : "lg"} className="w-full">
        {cta}
      </LinkButton>
    </article>
  );
}

export type StepState = "done" | "current" | "todo" | "active" | "waiting" | "blocked" | "optional";

const STATE_LABEL: Record<StepState, string> = {
  done: "Done",
  current: "Next",
  todo: "To do",
  active: "In progress",
  waiting: "Waiting",
  blocked: "Do not proceed",
  optional: "If required",
};

const STATE_STYLE: Record<StepState, { circle: string; label: string; card: string }> = {
  done: { circle: "bg-green text-white border-green", label: "text-green", card: "border-line bg-sheet" },
  current: { circle: "bg-dykem text-white border-dykem", label: "text-dykem", card: "border-2 border-dykem bg-sheet" },
  todo: { circle: "bg-sheet text-ink border-steel-2", label: "text-steel", card: "border-line bg-sheet" },
  active: { circle: "bg-violet text-white border-violet", label: "text-violet", card: "border-2 border-violet bg-sheet" },
  waiting: { circle: "bg-amber text-white border-amber", label: "text-[#7a4d06]", card: "border-2 border-amber bg-amber-50/40" },
  blocked: { circle: "bg-red text-white border-red", label: "text-red", card: "border-2 border-red bg-red-50/40" },
  optional: { circle: "bg-sheet text-steel border-line", label: "text-steel", card: "border-line bg-sheet" },
};

/** One numbered step of the operation workflow. */
export function Step({ n, title, state, summary, children, id }: { n: number; title: string; state: StepState; summary?: ReactNode; children?: ReactNode; id?: string }) {
  const s = STATE_STYLE[state];
  return (
    <li id={id} className={cx("flex gap-4 rounded-md border p-4", s.card)}>
      <div className="flex flex-col items-center">
        <span aria-hidden className={cx("plate flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 text-[20px]", s.circle)}>
          {state === "done" ? "✓" : n}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-[18px] font-semibold leading-tight text-ink">
            <span className="sr-only">Step {n}: </span>
            {title}
          </h3>
          <span className={cx("text-[13px] font-semibold uppercase tracking-wide", s.label)}>{STATE_LABEL[state]}</span>
        </div>
        {summary && <div className="mt-1.5 text-[16px] leading-relaxed text-ink-2">{summary}</div>}
        {children && <div className="mt-3 space-y-3">{children}</div>}
      </div>
    </li>
  );
}

/** Plain-language callout used inside steps. */
export function Callout({ tone, title, children }: { tone: "danger" | "warning" | "info" | "success"; title?: string; children?: ReactNode }) {
  const cls = {
    danger: "border-red bg-red-50 text-red",
    warning: "border-amber bg-amber-50 text-[#6b4405]",
    info: "border-dykem/40 bg-dykem-50 text-dykem-2",
    success: "border-green/50 bg-green-50 text-green",
  }[tone];
  return (
    <div role={tone === "danger" ? "alert" : undefined} className={cx("rounded-md border-l-4 px-3 py-2.5 text-[15.5px]", cls)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cx(title && "mt-0.5")}>{children}</div>}
    </div>
  );
}
