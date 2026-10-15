"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type DragEvent } from "react";
import { ActionForm, Disclosure, SelectField, TextArea, TextField } from "@/components/forms";
import { Badge, StatusBadge, buttonClass, cx } from "@/components/ui";
import { OP_STATUS, PRIORITY, statusDef, type Tone } from "@/lib/status";
import { fmtDate, fmtDateTime, fmtMinutes, fmtTime } from "@/lib/format";
import type { ActionResult } from "@/server/boundary";
import type { ScheduleCheckData } from "../actions";

type FormAction = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

export type BoardSegment = { iso: string; label: string; startMs: number; endMs: number; weight: number; working: boolean; today: boolean };
export type BoardMachine = { id: string; code: string; name: string; status: string; loadPct: number | null; plannedMinutes: number; availableMinutes: number };
export type BoardBlock = {
  id: string;
  jobId: string;
  jobNumber: string;
  customer: string;
  opNumber: string;
  part: string;
  title: string;
  status: string;
  machineId: string;
  startMs: number;
  endMs: number;
  actualStartMs: number | null;
  actualEndMs: number | null;
  late: boolean;
  requiredDate: string | null;
};
export type BoardMaint = { id: string; machineId: string; ref: string; title: string; status: string; startMs: number; endMs: number };
export type BoardUnscheduled = {
  id: string;
  jobId: string;
  jobNumber: string;
  opNumber: string;
  part: string;
  title: string;
  type: string;
  priority: number;
  requiredDate: string | null;
  remainingMinutes: number;
  late: boolean;
  preferredMachineId: string | null;
};

const SNAP_MS = 15 * 60_000;
const LABEL_W = 160;

const BLOCK_TONE: Record<Tone, string> = {
  neutral: "bg-line-2 border-steel-2 text-ink",
  info: "bg-dykem-50 border-dykem text-dykem-2",
  progress: "bg-violet-50 border-violet text-violet",
  warning: "bg-amber-50 border-amber text-[#7a4d06]",
  danger: "bg-red-50 border-red text-red",
  success: "bg-green-50 border-green text-green",
  hold: "bg-amber-50 border-[#8a4b00] text-[#8a4b00] [background-image:repeating-linear-gradient(135deg,transparent_0_6px,rgba(185,119,14,.14)_6px_12px)]",
  muted: "bg-sheet border-line text-steel",
};

type Drag = { opId: string; label: string; grabPct: number; isReschedule: boolean; fromMachineId: string | null };
type Proposal = {
  opId: string;
  label: string;
  machineId: string;
  machineCode: string;
  startMs: number;
  isReschedule: boolean;
  checking: boolean;
  check: ScheduleCheckData | null;
  error: string | null;
};

export function ScheduleBoard({
  segments,
  machines,
  blocks,
  maintenance,
  unscheduled,
  canSchedule,
  checkAction,
  scheduleAction,
}: {
  segments: BoardSegment[];
  machines: BoardMachine[];
  blocks: BoardBlock[];
  maintenance: BoardMaint[];
  unscheduled: BoardUnscheduled[];
  canSchedule: boolean;
  checkAction: FormAction;
  scheduleAction: FormAction;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<{ machineId: string; pct: number; t: number } | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  // "Now" is only known on the client (avoids a hydration mismatch); refresh every minute.
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  // ── Time ↔ position mapping (piecewise across visible working-hour windows) ──
  const layout = useMemo(() => {
    const total = segments.reduce((a, s) => a + s.weight, 0) || 1;
    return segments.map((s, i) => {
      const before = segments.slice(0, i).reduce((a, x) => a + x.weight, 0);
      return { ...s, off: (before / total) * 100, w: (s.weight / total) * 100 };
    });
  }, [segments]);

  const pctOf = (t: number) => {
    if (!layout.length || t <= layout[0].startMs) return 0;
    for (const s of layout) {
      if (t < s.startMs) return s.off; // outside working hours → snap to next visible start
      if (t <= s.endMs) return s.off + ((t - s.startMs) / (s.endMs - s.startMs)) * s.w;
    }
    return 100;
  };
  const timeAt = (pct: number) => {
    const p = Math.min(Math.max(pct, 0), 99.999);
    const s = layout.find((x) => p >= x.off && p < x.off + x.w) ?? layout[layout.length - 1];
    const frac = (p - s.off) / s.w;
    return Math.round((s.startMs + frac * (s.endMs - s.startMs)) / SNAP_MS) * SNAP_MS;
  };

  const ticks = useMemo(() => {
    const out: { pct: number; label: string }[] = [];
    const step = segments.length > 7 ? 4 : 2;
    for (const s of layout) {
      if (!s.working) continue;
      for (let t = s.startMs + step * 3_600_000; t < s.endMs; t += step * 3_600_000) out.push({ pct: s.off + ((t - s.startMs) / (s.endMs - s.startMs)) * s.w, label: fmtTime(new Date(t)) });
    }
    return out;
  }, [layout, segments.length]);

  const machineById = useMemo(() => new Map(machines.map((m) => [m.id, m])), [machines]);
  const nowPct = nowMs !== null && layout.length && nowMs >= layout[0].startMs && nowMs <= layout[layout.length - 1].endMs ? pctOf(nowMs) : null;

  // ── Drag and drop ──
  function onDragStart(e: DragEvent, d: Drag) {
    e.dataTransfer.setData("text/plain", d.opId);
    e.dataTransfer.effectAllowed = "move";
    setDrag(d);
  }
  function pointerPct(e: DragEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * 100;
  }
  function onTrackOver(e: DragEvent<HTMLDivElement>, machineId: string) {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const pct = pointerPct(e) - drag.grabPct;
    const t = timeAt(pct);
    if (!hover || hover.machineId !== machineId || hover.t !== t) setHover({ machineId, pct: pctOf(t), t });
  }
  function onTrackDrop(e: DragEvent<HTMLDivElement>, machineId: string) {
    e.preventDefault();
    if (!drag) return;
    const t = timeAt(pointerPct(e) - drag.grabPct);
    const m = machineById.get(machineId);
    setHover(null);
    setDrag(null);
    openProposal({ opId: drag.opId, label: drag.label, machineId, machineCode: m?.code ?? "?", startMs: t, isReschedule: drag.isReschedule });
  }

  function openProposal(p: Omit<Proposal, "checking" | "check" | "error">) {
    const next: Proposal = { ...p, checking: true, check: null, error: null };
    setProposal(next);
    dialogRef.current?.showModal();
    const fd = new FormData();
    fd.set("opId", p.opId);
    fd.set("machineId", p.machineId);
    fd.set("start", new Date(p.startMs).toISOString());
    startTransition(async () => {
      const res = await checkAction(null, fd);
      setProposal((cur) => (cur && cur.opId === p.opId && cur.startMs === p.startMs ? { ...cur, checking: false, check: res.ok ? (res.data as ScheduleCheckData) : null, error: res.ok ? null : res.error } : cur));
    });
  }

  function confirm() {
    if (!proposal) return;
    const reason = reasonRef.current?.value.trim() ?? "";
    if (proposal.isReschedule && !reason) {
      setProposal({ ...proposal, error: "Give a reason for rescheduling." });
      reasonRef.current?.focus();
      return;
    }
    const fd = new FormData();
    fd.set("_key", crypto.randomUUID());
    fd.set("opId", proposal.opId);
    fd.set("machineId", proposal.machineId);
    fd.set("start", new Date(proposal.startMs).toISOString());
    if (reason) fd.set("reason", reason);
    startTransition(async () => {
      const res = await scheduleAction(null, fd);
      if (res.ok) {
        dialogRef.current?.close();
        setProposal(null);
        setFlash(res.message ?? "Scheduled.");
        router.refresh();
      } else {
        setProposal((cur) => (cur ? { ...cur, error: res.error } : cur));
      }
    });
  }

  const minWidth = LABEL_W + segments.reduce((a, s) => a + (s.working ? 150 : 48), 0);

  return (
    <div className="flex flex-col gap-4 2xl:flex-row">
      <div className="min-w-0 flex-1">
        <Legend />
        {flash && (
          <p role="status" className="mb-2 rounded-sm border border-green/40 bg-green-50 px-3 py-1.5 text-[13px] text-green">
            {flash}{" "}
            <button type="button" className="ml-2 underline" onClick={() => setFlash(null)}>
              Dismiss
            </button>
          </p>
        )}
        <div className="overflow-x-auto rounded-md border border-line bg-sheet" role="region" aria-label="Machine schedule timeline" tabIndex={0}>
          <div style={{ minWidth }} className="relative">
            {/* Header */}
            <div className="sticky top-0 z-20 flex border-b border-line bg-paper">
              <div style={{ width: LABEL_W }} className="sticky left-0 z-30 shrink-0 border-r border-line bg-paper px-2 py-1.5 text-[11.5px] font-medium text-steel">
                Machine · load
              </div>
              <div className="relative h-11 flex-1">
                {layout.map((s) => (
                  <div key={s.iso} className={cx("absolute inset-y-0 border-l border-line px-1.5 py-1", s.today && "bg-dykem-50", !s.working && "bg-line-2/60")} style={{ left: `${s.off}%`, width: `${s.w}%` }}>
                    <div className={cx("truncate text-[12px] font-semibold", s.today ? "text-dykem-2" : "text-ink")}>{s.label}</div>
                    {!s.working && <div className="truncate text-[10.5px] text-steel">No shift</div>}
                  </div>
                ))}
                {ticks.map((t, i) => (
                  <span key={i} className="absolute bottom-0.5 -translate-x-1/2 text-[10px] text-steel-2" style={{ left: `${t.pct}%` }}>
                    {t.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Rows */}
            {machines.length === 0 && <p className="px-3 py-8 text-center text-steel">No active machines.</p>}
            {machines.map((m) => {
              const mine = blocks.filter((b) => b.machineId === m.id);
              const maint = maintenance.filter((w) => w.machineId === m.id);
              const loadTone = m.loadPct === null ? "bg-line" : m.loadPct > 100 ? "bg-red" : m.loadPct >= 85 ? "bg-amber" : "bg-green";
              return (
                <div key={m.id} className="flex border-b border-line last:border-b-0">
                  <div style={{ width: LABEL_W }} className="sticky left-0 z-10 shrink-0 border-r border-line bg-sheet px-2 py-1.5">
                    <Link href={`/machines/${m.id}`} className="plate text-[13.5px] text-dykem hover:underline">
                      {m.code}
                    </Link>
                    <div className="truncate text-[11.5px] text-steel" title={m.name}>
                      {m.name}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5" title={`${fmtMinutes(m.plannedMinutes)} planned of ${fmtMinutes(m.availableMinutes)} available`}>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line-2">
                        <span className={cx("block h-full", loadTone)} style={{ width: `${Math.min(100, m.loadPct ?? 0)}%` }} />
                      </span>
                      <span className={cx("text-[11px] tabular-nums", m.loadPct !== null && m.loadPct > 100 ? "font-semibold text-red" : "text-steel")}>{m.loadPct === null ? "—" : `${m.loadPct}%`}</span>
                    </div>
                  </div>
                  <div
                    className={cx("relative h-[64px] flex-1", drag && "bg-dykem-50/30")}
                    onDragOver={canSchedule ? (e) => onTrackOver(e, m.id) : undefined}
                    onDragLeave={() => setHover((h) => (h?.machineId === m.id ? null : h))}
                    onDrop={canSchedule ? (e) => onTrackDrop(e, m.id) : undefined}
                    aria-label={`${m.code} timeline`}
                  >
                    {/* day backgrounds */}
                    {layout.map((s) => (
                      <div key={s.iso} aria-hidden className={cx("absolute inset-y-0 border-l border-line-2", s.today && "bg-dykem-50/50", !s.working && "bg-line-2/50")} style={{ left: `${s.off}%`, width: `${s.w}%` }} />
                    ))}
                    {/* maintenance windows */}
                    {maint.map((w) => {
                      const left = pctOf(w.startMs);
                      const width = Math.max(pctOf(w.endMs) - left, 0.6);
                      return (
                        <Link
                          key={w.id}
                          href={`/maintenance/${w.id}`}
                          className="absolute inset-y-1 z-[1] overflow-hidden rounded-sm border border-dashed border-[#8a4b00] bg-amber-50/80 px-1 text-[10.5px] font-medium text-[#8a4b00] [background-image:repeating-linear-gradient(135deg,rgba(138,75,0,.16)_0_5px,transparent_5px_10px)]"
                          style={{ left: `${left}%`, width: `${width}%` }}
                          title={`Maintenance ${w.ref}: ${w.title} (${w.status.replace(/_/g, " ")}) ${fmtDateTime(new Date(w.startMs))} – ${fmtDateTime(new Date(w.endMs))}`}
                        >
                          <span className="block truncate">Maintenance {w.ref}</span>
                        </Link>
                      );
                    })}
                    {/* planned blocks + actual bars */}
                    {mine.map((b) => {
                      const left = pctOf(b.startMs);
                      const width = Math.max(pctOf(b.endMs) - left, 0.5);
                      const tone = statusDef(OP_STATUS, b.status).tone;
                      const label = `${b.jobNumber} op ${b.opNumber} · ${b.part}`;
                      const movable = canSchedule && !["complete", "cancelled"].includes(b.status);
                      const aStart = b.actualStartMs;
                      const aEnd = b.actualEndMs ?? (aStart !== null && nowMs !== null ? nowMs : null);
                      return (
                        <div key={b.id}>
                          <Link
                            href={`/jobs/${b.jobId}?tab=route`}
                            draggable={movable}
                            onDragStart={
                              movable
                                ? (e) => {
                                    const r = (e.currentTarget.parentElement?.parentElement as HTMLElement).getBoundingClientRect();
                                    const grab = ((e.clientX - r.left) / r.width) * 100 - left;
                                    onDragStart(e, { opId: b.id, label, grabPct: Math.max(0, grab), isReschedule: true, fromMachineId: b.machineId });
                                  }
                                : undefined
                            }
                            onDragEnd={() => {
                              setDrag(null);
                              setHover(null);
                            }}
                            className={cx(
                              "absolute top-1.5 z-[2] h-[34px] overflow-hidden rounded-sm border px-1 py-0.5 text-[10.5px] leading-tight shadow-[0_1px_0_rgba(0,0,0,.04)] hover:z-[3] hover:shadow-md",
                              BLOCK_TONE[tone],
                              b.late && "outline-2 outline-red outline-offset-0",
                              movable && "cursor-grab active:cursor-grabbing",
                            )}
                            style={{ left: `${left}%`, width: `${width}%` }}
                            title={`Planned: ${label}\n${b.title}\nStatus: ${statusDef(OP_STATUS, b.status).label}\n${fmtDateTime(new Date(b.startMs))} – ${fmtDateTime(new Date(b.endMs))}${b.late ? `\nLATE — required ${fmtDate(b.requiredDate)}` : ""}`}
                            aria-label={`Planned ${label}, ${statusDef(OP_STATUS, b.status).label}, ${fmtDateTime(new Date(b.startMs))} to ${fmtDateTime(new Date(b.endMs))}${b.late ? ", job late" : ""}`}
                          >
                            <span className="block truncate font-semibold">
                              {b.jobNumber} · {b.opNumber}
                            </span>
                            <span className="block truncate">{b.part}</span>
                          </Link>
                          {aStart !== null && aEnd !== null && (
                            <div
                              className={cx("absolute top-[46px] z-[2] h-[7px] rounded-[2px] border border-ink/50 bg-ink/70", b.actualEndMs === null && "animate-pulse")}
                              style={{ left: `${pctOf(aStart)}%`, width: `${Math.max(pctOf(aEnd) - pctOf(aStart), 0.4)}%` }}
                              title={`Actual: ${b.jobNumber} op ${b.opNumber} ${fmtDateTime(new Date(aStart))} – ${b.actualEndMs ? fmtDateTime(new Date(b.actualEndMs)) : "in progress"}`}
                              aria-label={`Actual ${b.jobNumber} op ${b.opNumber} from ${fmtDateTime(new Date(aStart))} to ${b.actualEndMs ? fmtDateTime(new Date(b.actualEndMs)) : "now (in progress)"}`}
                            />
                          )}
                        </div>
                      );
                    })}
                    {/* drop indicator */}
                    {hover?.machineId === m.id && (
                      <div aria-hidden className="pointer-events-none absolute inset-y-0 z-[4] border-l-2 border-dykem" style={{ left: `${hover.pct}%` }}>
                        <span className="ml-1 rounded-sm bg-dykem px-1 py-0.5 text-[10.5px] font-medium whitespace-nowrap text-white">{fmtDateTime(new Date(hover.t))}</span>
                      </div>
                    )}
                    {nowPct !== null && <div aria-hidden className="pointer-events-none absolute inset-y-0 z-[3] border-l-2 border-red/70" style={{ left: `${nowPct}%` }} />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <p className="mt-1.5 text-[12px] text-steel">
          Columns show working hours only (time outside shifts is collapsed). Drop positions snap to 15 minutes; the planned finish is calculated from the machine&apos;s calendar.
          {canSchedule ? " Drag an operation onto a machine row to schedule or move it, or use the Schedule / Reschedule forms." : " You can view the schedule but not change it."}
        </p>
      </div>

      {/* Unscheduled operations */}
      <aside className="w-full shrink-0 2xl:w-[340px]" aria-labelledby="unsched-h">
        <div className="mb-2 flex items-center justify-between border-b border-line pb-1.5">
          <h2 id="unsched-h" className="text-[14.5px] font-semibold text-ink">
            Needs a machine slot <span className="ml-1 rounded-sm bg-line-2 px-1 text-[11.5px] font-normal text-steel">{unscheduled.length}</span>
          </h2>
        </div>
        <p className="mb-2 text-[12px] text-steel">Sorted by job priority, then required date.</p>
        {unscheduled.length === 0 ? (
          <p className="rounded-md border border-dashed border-line bg-sheet px-3 py-6 text-center text-[13px] text-steel">Every machine operation is scheduled.</p>
        ) : (
          <ul className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
            {unscheduled.map((u) => {
              const label = `${u.jobNumber} op ${u.opNumber} · ${u.part}`;
              return (
                <li
                  key={u.id}
                  draggable={canSchedule}
                  onDragStart={canSchedule ? (e) => onDragStart(e, { opId: u.id, label, grabPct: 0, isReschedule: false, fromMachineId: null }) : undefined}
                  onDragEnd={() => {
                    setDrag(null);
                    setHover(null);
                  }}
                  className={cx("rounded-md border bg-sheet p-2", u.late ? "border-red/50" : "border-line", canSchedule && "cursor-grab active:cursor-grabbing")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/jobs/${u.jobId}?tab=route`} className="plate text-[13px] text-dykem hover:underline">
                        {u.jobNumber}
                      </Link>
                      <span className="ml-1.5 text-[12.5px] font-medium text-ink">op {u.opNumber}</span>
                      <div className="truncate text-[12.5px] text-ink-2">
                        {u.part} — {u.title}
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-steel">
                        {u.type} · {fmtMinutes(u.remainingMinutes)} · required {fmtDate(u.requiredDate)}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <StatusBadge map={PRIORITY} status={String(u.priority)} />
                      {u.late && <Badge tone="danger">Late</Badge>}
                    </div>
                  </div>
                  {canSchedule && (
                    <div className="mt-2">
                      <Disclosure label="Schedule">
                        <ActionForm action={scheduleAction} submitLabel="Schedule operation" submitSize="sm">
                          <input type="hidden" name="opId" value={u.id} />
                          <SelectField label="Machine" name="machineId" required options={machines.map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` }))} defaultValue={u.preferredMachineId} placeholder="Select…" />
                          <TextField label="Planned start" name="start" type="datetime-local" required step="900" />
                          <TextArea label="Note (optional)" name="reason" rows={2} />
                        </ActionForm>
                      </Disclosure>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* Proposal dialog (drag-and-drop) */}
      <dialog
        ref={dialogRef}
        className="m-auto w-[min(520px,94vw)] rounded-md border border-line p-0 backdrop:bg-ink/40"
        onClose={() => setProposal(null)}
        aria-labelledby="proposal-h"
      >
        {proposal && (
          <div>
            <div className="p-4">
              <p id="proposal-h" className="font-semibold text-ink">
                {proposal.isReschedule ? "Reschedule operation" : "Schedule operation"}
              </p>
              <dl className="mt-2 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[13.5px]">
                <dt className="text-steel">Operation</dt>
                <dd className="font-medium">{proposal.label}</dd>
                <dt className="text-steel">Machine</dt>
                <dd className="plate">{proposal.machineCode}</dd>
                <dt className="text-steel">Planned start</dt>
                <dd>{fmtDateTime(new Date(proposal.startMs))}</dd>
                <dt className="text-steel">Planned finish</dt>
                <dd>{proposal.checking ? "Checking…" : proposal.check?.plannedEnd ? fmtDateTime(proposal.check.plannedEnd) : "—"}</dd>
              </dl>
              {proposal.check && proposal.check.errors.length > 0 && (
                <div role="alert" className="mt-3 rounded-sm border border-red/40 bg-red-50 px-3 py-2 text-[13px] text-red">
                  <p className="font-semibold">This placement is not allowed:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {proposal.check.errors.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
              )}
              {proposal.check && proposal.check.warnings.length > 0 && (
                <div role="status" className="mt-3 rounded-sm border border-amber/40 bg-amber-50 px-3 py-2 text-[13px] text-[#7a4d06]">
                  <p className="font-semibold">Warnings — you can still schedule:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {proposal.check.warnings.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
              )}
              {proposal.check && proposal.check.errors.length === 0 && proposal.check.warnings.length === 0 && (
                <p className="mt-3 rounded-sm border border-green/40 bg-green-50 px-3 py-1.5 text-[13px] text-green">No conflicts found.</p>
              )}
              <label htmlFor="proposal-reason" className="mt-3 block text-[12.5px] font-medium text-ink-2">
                {proposal.isReschedule ? (
                  <>
                    Reason for rescheduling<span className="text-red"> *</span>
                  </>
                ) : (
                  "Note (optional)"
                )}
              </label>
              <textarea id="proposal-reason" ref={reasonRef} rows={2} className="field-input mt-1" required={proposal.isReschedule} />
              {proposal.error && (
                <p role="alert" className="mt-2 text-[13px] text-red">
                  {proposal.error}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-paper px-4 py-3">
              <button type="button" className={buttonClass("secondary")} onClick={() => dialogRef.current?.close()}>
                Cancel
              </button>
              <button type="button" className={buttonClass("primary")} disabled={pending || proposal.checking || !proposal.check || proposal.check.errors.length > 0} onClick={confirm}>
                {pending ? "Working…" : proposal.isReschedule ? "Reschedule" : "Schedule"}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}

function Legend() {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-steel">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-3.5 w-7 rounded-sm border border-dykem bg-dykem-50" /> Planned (block, coloured by operation status)
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-[7px] w-7 rounded-[2px] bg-ink/70" /> Actual (thin bar below the plan)
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-3.5 w-7 rounded-sm border border-line bg-sheet outline-2 outline-red" /> Job late
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-3.5 w-7 rounded-sm border border-dashed border-[#8a4b00] [background-image:repeating-linear-gradient(135deg,rgba(138,75,0,.25)_0_4px,transparent_4px_8px)]" /> Maintenance window (machine locked)
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-3.5 w-0 border-l-2 border-red/70" /> Now
      </span>
    </div>
  );
}
