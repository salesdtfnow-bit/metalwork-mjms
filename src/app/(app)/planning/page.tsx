import Link from "next/link";
import type { ReactNode } from "react";
import { requirePageCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { planningBoard, planningDashboard, remainingMinutes } from "@/server/services/planning";
import { operatorWorkloads } from "@/server/services/employees";
import { zonedTime } from "@/server/services/machines";
import { boardShiftPattern, recentScheduleChanges } from "@/server/services/ui/workshop";
import { addDaysISO, daysBetween, fmtDate, fmtDateTime, fmtMinutes, todayISO, COMPANY_TZ } from "@/lib/format";
import { JOB_STATUS, MWO_STATUS, OP_STATUS, PRIORITY, SUBCON_STATUS } from "@/lib/status";
import { Badge, LinkButton, PageHeader, Ref, Section, Stat, StatusBadge, Table, Tabs, cx } from "@/components/ui";
import { ActionForm, Disclosure, SelectField, TextArea, TextField } from "@/components/forms";
import { ScheduleBoard, type BoardBlock, type BoardMaint, type BoardSegment, type BoardUnscheduled } from "./_components/ScheduleBoard";
import { toLocalInput } from "./_components/datetime";
import { checkScheduleAction, scheduleOperationAction, unscheduleOperationAction } from "./actions";

export const metadata = { title: "Production planning" };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const dowOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

type SP = { tab?: string; from?: string; days?: string };

export default async function PlanningPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageCtx("planning.view");
  const sp = await searchParams;
  const tab = sp.tab ?? "dashboard";
  return (
    <>
      <PageHeader
        title="Production planning"
        description="Workload, deadlines and the machine schedule. Schedules are planned times only — actual start and finish come from shop-floor bookings."
        actions={<LinkButton href="/planning?tab=board">Open schedule board</LinkButton>}
      />
      <Tabs
        base="/planning"
        current={tab}
        tabs={[
          { key: "dashboard", label: "Dashboard" },
          { key: "board", label: "Schedule board" },
          { key: "changes", label: "Schedule changes" },
        ]}
      />
      {tab === "dashboard" && <Dashboard ctx={ctx} />}
      {tab === "board" && <Board ctx={ctx} sp={sp} />}
      {tab === "changes" && <Changes ctx={ctx} />}
    </>
  );
}

type PageCtx = Awaited<ReturnType<typeof requirePageCtx>>;

// ───────────────────────────── Dashboard ─────────────────────────────

async function Dashboard({ ctx }: { ctx: PageCtx }) {
  const [dash, operators] = await Promise.all([planningDashboard(ctx), operatorWorkloads(ctx)]);
  const today = todayISO();
  const maxMachine = Math.max(1, ...dash.machineLoad.map((m) => m.minutes));
  const maxOperator = Math.max(1, ...operators.map((o) => o.minutes));

  const jobRow = (r: (typeof dash.activeJobs)[number], extra?: ReactNode) => (
    <tr key={r.job.id}>
      <td>
        <Ref href={`/jobs/${r.job.id}`} size="sm">
          {r.job.jobNumber}
        </Ref>
      </td>
      <td className="plate text-[12.5px]">{r.customer}</td>
      <td className="max-w-[260px] truncate">{r.job.title}</td>
      <td>
        <StatusBadge map={JOB_STATUS} status={r.job.status} />
      </td>
      <td>
        <StatusBadge map={PRIORITY} status={String(r.job.priority)} />
      </td>
      <td className="whitespace-nowrap">{fmtDate(r.job.requiredDate)}</td>
      {extra !== undefined && <td className="whitespace-nowrap">{extra}</td>}
    </tr>
  );

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4 xl:grid-cols-8">
        <Stat label="Active jobs" value={dash.activeJobs.length} />
        <Stat label="Awaiting material" value={dash.awaitingMaterial.length} tone={dash.awaitingMaterial.length ? "warning" : undefined} />
        <Stat label="Awaiting programming" value={dash.awaitingProgramming.length} tone={dash.awaitingProgramming.length ? "warning" : undefined} />
        <Stat label="Operations ready" value={dash.readyOps.length} tone="success" />
        <Stat label="Awaiting inspection" value={dash.awaitingInspection.length} tone={dash.awaitingInspection.length ? "warning" : undefined} />
        <Stat label="On hold" value={dash.onHold.length} tone={dash.onHold.length ? "warning" : undefined} />
        <Stat label="Late jobs" value={dash.late.length} tone="danger" href="#late" sub="Required date passed" />
        <Stat label="At risk" value={dash.atRisk.length} tone="warning" href="#at-risk" sub="Plan finishes after due" />
      </div>

      <div className="grid gap-x-6 xl:grid-cols-2">
        <Section id="late" title={`Jobs behind schedule (${dash.late.length})`}>
          <Table head={["Job", "Customer", "Title", "Status", "Priority", "Required", "Late by"]} empty="No open job is past its required date.">
            {[...dash.late]
              .sort((a, b) => (a.job.requiredDate! < b.job.requiredDate! ? -1 : 1))
              .map((r) => jobRow(r, <span className="font-semibold text-red">{daysBetween(r.job.requiredDate!, today)} d</span>))}
          </Table>
        </Section>
        <Section id="at-risk" title={`At risk (${dash.atRisk.length})`}>
          <Table head={["Job", "Customer", "Title", "Status", "Priority", "Required"]} empty="No jobs at risk: planned work finishes before every required date.">
            {dash.atRisk.map((r) => jobRow(r))}
          </Table>
          <p className="mt-1 text-[12px] text-steel">At risk = remaining planned work ends after the required date, or machine work is still unscheduled within 5 days of it.</p>
        </Section>
        <Section title="Upcoming deadlines (next 14 days)">
          <Table head={["Job", "Customer", "Title", "Status", "Priority", "Required", "Days left"]} empty="No deadlines in the next 14 days.">
            {dash.upcoming.map((r) => jobRow(r, `${daysBetween(today, r.job.requiredDate!)} d`))}
          </Table>
        </Section>
        <Section title={`Operations behind plan (${dash.opsBehind.length})`}>
          <Table head={["Job", "Op", "Type", "Machine", "Planned end", "Status"]} empty="All open operations are within their planned times.">
            {dash.opsBehind.map((o) => (
              <tr key={o.op.id}>
                <td>
                  <Ref href={`/jobs/${o.job.id}?tab=route`} size="sm">
                    {o.job.jobNumber}
                  </Ref>
                </td>
                <td className="whitespace-nowrap">
                  {o.op.opNumber} <span className="text-steel">{o.op.title}</span>
                </td>
                <td>{o.type.name}</td>
                <td className="plate text-[12.5px]">{o.machine ?? "—"}</td>
                <td className="whitespace-nowrap text-red">{fmtDateTime(o.op.plannedEnd)}</td>
                <td>
                  <StatusBadge map={OP_STATUS} status={o.op.status} />
                </td>
              </tr>
            ))}
          </Table>
        </Section>
        <Section title={`Subcontracted (${dash.subcontracted.length})`} actions={<Link href="/subcontract" className="link text-[12.5px]">All subcontract orders</Link>}>
          <Table head={["Order", "Process", "Status", "Qty sent", "Return due"]} empty="Nothing is out with subcontractors.">
            {dash.subcontracted.map((s) => (
              <tr key={s.id}>
                <td>
                  <Ref href={`/subcontract/${s.id}`} size="sm">
                    {s.ref}
                  </Ref>
                </td>
                <td className="capitalize">{s.process.replace(/_/g, " ")}</td>
                <td>
                  <StatusBadge map={SUBCON_STATUS} status={s.status} />
                </td>
                <td>{s.qtySent ?? "—"}</td>
                <td className={cx("whitespace-nowrap", s.requiredReturnDate && s.requiredReturnDate < today && s.status !== "returned" && "font-semibold text-red")}>{fmtDate(s.requiredReturnDate)}</td>
              </tr>
            ))}
          </Table>
        </Section>
        <Section title={`Maintenance restrictions (${dash.maintenance.length})`} actions={<Link href="/maintenance" className="link text-[12.5px]">Maintenance</Link>}>
          <Table head={["Work order", "Machine", "Kind", "Status", "Window", "Locks machine"]} empty="No scheduled or in-progress maintenance.">
            {dash.maintenance.map(({ wo, machine }) => (
              <tr key={wo.id}>
                <td>
                  <Ref href={`/maintenance/${wo.id}`} size="sm">
                    {wo.ref}
                  </Ref>
                </td>
                <td className="plate text-[12.5px]">{machine}</td>
                <td className="capitalize">{wo.kind}</td>
                <td>
                  <StatusBadge map={MWO_STATUS} status={wo.status} />
                </td>
                <td className="whitespace-nowrap text-[12.5px]">
                  {wo.status === "in_progress" ? `Since ${fmtDateTime(wo.startedAt)}` : `${fmtDateTime(wo.scheduledStart)} – ${fmtDateTime(wo.scheduledEnd)}`}
                </td>
                <td>{wo.locksMachine ? <Badge tone="hold">Locked</Badge> : <Badge tone="muted">No</Badge>}</td>
              </tr>
            ))}
          </Table>
        </Section>
        <Section title="Machine workloads (remaining work on open operations)">
          <Table head={["Machine", "Ops", "Remaining", ""]} empty="No open operations are assigned to machines.">
            {dash.machineLoad.map((m) => (
              <tr key={m.code}>
                <td className="plate text-[13px]">{m.code}</td>
                <td>{m.ops}</td>
                <td className="whitespace-nowrap">{(m.minutes / 60).toFixed(1)} h</td>
                <td className="w-1/2">
                  <Bar pct={(m.minutes / maxMachine) * 100} label={`${(m.minutes / 60).toFixed(1)} hours`} />
                </td>
              </tr>
            ))}
          </Table>
        </Section>
        <Section title="Operator workloads (assigned, not yet complete)">
          <Table head={["Operator", "Ops", "Remaining", ""]} empty="No operators have open assignments.">
            {operators.map((o) => (
              <tr key={o.employee.id}>
                <td>
                  <Link href={`/operators/${o.employee.id}`} className="link">
                    {o.employee.firstName} {o.employee.lastName}
                  </Link>
                  <span className="ml-1.5 text-[12px] text-steel">{o.employee.employeeNo}</span>
                </td>
                <td>{o.ops.length}</td>
                <td className="whitespace-nowrap">{(o.minutes / 60).toFixed(1)} h</td>
                <td className="w-1/2">
                  <Bar pct={(o.minutes / maxOperator) * 100} label={`${(o.minutes / 60).toFixed(1)} hours`} />
                </td>
              </tr>
            ))}
          </Table>
        </Section>
      </div>
    </>
  );
}

function Bar({ pct, label }: { pct: number; label: string }) {
  return (
    <span className="block h-2 overflow-hidden rounded-full bg-line-2" role="img" aria-label={label}>
      <span className="block h-full bg-dykem" style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
    </span>
  );
}

// ───────────────────────────── Board ─────────────────────────────

async function Board({ ctx, sp }: { ctx: PageCtx; sp: SP }) {
  const today = todayISO();
  const days = sp.days === "14" ? 14 : 7;
  const monday = addDaysISO(today, -((dowOf(today) + 6) % 7));
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : monday;
  const rangeFrom = zonedTime(from, "00:00", COMPANY_TZ);
  const rangeTo = zonedTime(addDaysISO(from, days), "00:00", COMPANY_TZ);
  const board = await planningBoard(ctx, { from: rangeFrom, to: rangeTo });
  const pattern = await boardShiftPattern(ctx, board.machines.map((m) => m.calendarId));
  const canSchedule = can(ctx.actor, "planning.schedule");

  const segments: BoardSegment[] = Array.from({ length: days }, (_, i) => {
    const iso = addDaysISO(from, i);
    const dow = dowOf(iso);
    const start = zonedTime(iso, hhmm(pattern.startMin), COMPANY_TZ);
    const end = pattern.endMin >= 1440 ? zonedTime(addDaysISO(iso, 1), "00:00", COMPANY_TZ) : zonedTime(iso, hhmm(pattern.endMin), COMPANY_TZ);
    const working = pattern.workingDays.includes(dow);
    return { iso, label: `${WEEKDAYS[dow]} ${fmtDate(iso).slice(0, 6)}`, startMs: start.getTime(), endMs: end.getTime(), weight: working ? 1 : 0.32, working, today: iso === today };
  });

  const blocks: BoardBlock[] = board.planned
    .filter((p) => p.op.machineId && p.op.plannedStart && p.op.plannedEnd)
    .map((p) => ({
      id: p.op.id,
      jobId: p.job.id,
      jobNumber: p.job.jobNumber,
      customer: p.customer,
      opNumber: p.op.opNumber,
      part: p.part,
      title: p.op.title,
      status: p.op.status,
      machineId: p.op.machineId!,
      startMs: p.op.plannedStart!.getTime(),
      endMs: p.op.plannedEnd!.getTime(),
      actualStartMs: p.op.actualStart ? p.op.actualStart.getTime() : null,
      actualEndMs: p.op.actualEnd ? p.op.actualEnd.getTime() : null,
      late: !!p.job.requiredDate && (p.job.requiredDate < today || p.op.plannedEnd!.toISOString().slice(0, 10) > p.job.requiredDate) && !["complete", "cancelled"].includes(p.op.status),
      requiredDate: p.job.requiredDate,
    }));

  const maintenance: BoardMaint[] = board.maintenance
    .map((w) => {
      const start = w.status === "in_progress" ? (w.startedAt ?? w.scheduledStart ?? rangeFrom) : w.scheduledStart;
      const end = w.status === "in_progress" ? (w.scheduledEnd && w.scheduledEnd > new Date() ? w.scheduledEnd : rangeTo) : w.scheduledEnd;
      if (!start || !end || end < rangeFrom || start > rangeTo) return null;
      return { id: w.id, machineId: w.machineId, ref: w.ref, title: w.title, status: w.status, startMs: start.getTime(), endMs: end.getTime() };
    })
    .filter((x): x is BoardMaint => !!x);

  const unscheduled: BoardUnscheduled[] = board.unscheduled.map((u) => ({
    id: u.op.id,
    jobId: u.job.id,
    jobNumber: u.job.jobNumber,
    opNumber: u.op.opNumber,
    part: u.part,
    title: u.op.title,
    type: u.type.name,
    priority: u.job.priority,
    requiredDate: u.job.requiredDate,
    remainingMinutes: remainingMinutes(u.op),
    late: !!u.job.requiredDate && u.job.requiredDate < today,
    preferredMachineId: u.op.machineId,
  }));

  const machines = board.machines.map((m) => {
    const l = board.load.find((x) => x.machineId === m.id);
    return { id: m.id, code: m.code, name: m.name, status: m.currentStatus, loadPct: l?.loadPct ?? null, plannedMinutes: l?.plannedMinutes ?? 0, availableMinutes: l?.availableMinutes ?? 0 };
  });
  const machineOpts = machines.map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` }));
  const code = new Map(machines.map((m) => [m.id, m.code]));

  const q = (f: string, d = days) => `/planning?tab=board&from=${f}&days=${d}`;
  const last = addDaysISO(from, days - 1);
  const inRange = [...board.planned].sort((a, b) => a.op.plannedStart!.getTime() - b.op.plannedStart!.getTime());

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <LinkButton href={q(addDaysISO(from, -days))} size="sm">
          ← Previous
        </LinkButton>
        <LinkButton href={q(monday)} size="sm">
          This week
        </LinkButton>
        <LinkButton href={q(addDaysISO(from, days))} size="sm">
          Next →
        </LinkButton>
        <span className="mx-2 text-[13.5px] font-medium text-ink">
          {fmtDate(from)} – {fmtDate(last)}
        </span>
        <span className="flex overflow-hidden rounded-sm border border-line text-[12.5px]" role="group" aria-label="Range length">
          <Link href={q(from, 7)} aria-current={days === 7 ? "true" : undefined} className={cx("px-2.5 py-1", days === 7 ? "bg-dykem text-white" : "bg-sheet hover:bg-line-2")}>
            7 days
          </Link>
          <Link href={q(from, 14)} aria-current={days === 14 ? "true" : undefined} className={cx("border-l border-line px-2.5 py-1", days === 14 ? "bg-dykem text-white" : "bg-sheet hover:bg-line-2")}>
            14 days
          </Link>
        </span>
        <form className="ml-auto flex items-center gap-2" action="/planning">
          <input type="hidden" name="tab" value="board" />
          <input type="hidden" name="days" value={days} />
          <label className="text-[12.5px] text-steel" htmlFor="board-from">
            From
          </label>
          <input id="board-from" type="date" name="from" defaultValue={from} className="field-input h-7 w-auto py-0" />
          <button className="h-7 rounded-sm border border-line bg-sheet px-2.5 text-[12.5px]">Go</button>
        </form>
      </div>

      <ScheduleBoard
        segments={segments}
        machines={machines}
        blocks={blocks}
        maintenance={maintenance}
        unscheduled={unscheduled}
        canSchedule={canSchedule}
        checkAction={checkScheduleAction}
        scheduleAction={scheduleOperationAction}
      />

      <Section title={`Scheduled in this range (${inRange.length})`} className="mt-6">
        <Table head={["Job", "Op", "Part", "Machine", "Planned", "Actual", "Status", ""]} empty="Nothing is scheduled in this range.">
          {inRange.map((p) => (
            <tr key={p.op.id}>
              <td>
                <Ref href={`/jobs/${p.job.id}?tab=route`} size="sm">
                  {p.job.jobNumber}
                </Ref>
              </td>
              <td className="whitespace-nowrap">
                {p.op.opNumber} <span className="text-steel">{p.op.title}</span>
              </td>
              <td>{p.part}</td>
              <td className="plate text-[12.5px]">{(p.op.machineId && code.get(p.op.machineId)) ?? "—"}</td>
              <td className="whitespace-nowrap text-[12.5px]">
                <span className="text-steel">Planned </span>
                {fmtDateTime(p.op.plannedStart)} – {fmtDateTime(p.op.plannedEnd)}
              </td>
              <td className="whitespace-nowrap text-[12.5px]">
                {p.op.actualStart ? (
                  <>
                    <span className="text-steel">Actual </span>
                    {fmtDateTime(p.op.actualStart)} – {p.op.actualEnd ? fmtDateTime(p.op.actualEnd) : "in progress"}
                  </>
                ) : (
                  <span className="text-steel">Not started</span>
                )}
              </td>
              <td>
                <StatusBadge map={OP_STATUS} status={p.op.status} />
              </td>
              <td className="min-w-[120px]">
                {canSchedule && !["complete", "cancelled"].includes(p.op.status) && (
                  <div className="flex flex-col gap-1.5">
                    <Disclosure label="Reschedule">
                      <ActionForm action={scheduleOperationAction} submitLabel="Reschedule" submitSize="sm">
                        <input type="hidden" name="opId" value={p.op.id} />
                        <SelectField label="Machine" name="machineId" required options={machineOpts} defaultValue={p.op.machineId} />
                        <TextField label="Planned start" name="start" type="datetime-local" required step="900" defaultValue={toLocalInput(p.op.plannedStart)} />
                        <TextArea label="Reason for rescheduling" name="reason" required rows={2} />
                      </ActionForm>
                    </Disclosure>
                    <Disclosure label="Unschedule" variant="ghost">
                      <ActionForm action={unscheduleOperationAction} submitLabel="Remove from schedule" submitVariant="danger" submitSize="sm" confirm="The operation will return to the unscheduled list. The change is logged.">
                        <input type="hidden" name="opId" value={p.op.id} />
                        <TextArea label="Reason" name="reason" required rows={2} />
                      </ActionForm>
                    </Disclosure>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
        <p className="mt-1 text-[12px] text-steel">Times shown in {COMPANY_TZ}. Planned finish is recalculated from remaining set-up and cycle time whenever an operation is rescheduled.</p>
      </Section>
      <p className="text-[12px] text-steel">Remaining work on unscheduled operations: {fmtMinutes(unscheduled.reduce((a, u) => a + u.remainingMinutes, 0))}.</p>
    </>
  );
}

// ───────────────────────────── Changes ─────────────────────────────

async function Changes({ ctx }: { ctx: PageCtx }) {
  const rows = await recentScheduleChanges(ctx, 150);
  return (
    <Section title="Recent schedule changes" actions={<span className="text-[12px] text-steel">Every schedule set, move and removal is logged with who, when and why.</span>}>
      <Table head={["When", "Who", "Job / op", "Machine", "Start", "End", "Reason"]} empty="No schedule changes recorded yet.">
        {rows.map((r) => {
          const kind = !r.c.oldStart ? "Scheduled" : !r.c.newStart ? "Unscheduled" : "Moved";
          return (
            <tr key={r.c.id}>
              <td className="whitespace-nowrap text-steel">{fmtDateTime(r.c.changedAt)}</td>
              <td className="whitespace-nowrap">{r.by ?? "System"}</td>
              <td className="whitespace-nowrap">
                <Ref href={`/jobs/${r.jobId}?tab=route`} size="sm">
                  {r.jobNumber}
                </Ref>{" "}
                op {r.opNumber}
                <div className="text-[12px] text-steel">
                  <Badge tone={kind === "Unscheduled" ? "warning" : kind === "Moved" ? "info" : "success"}>{kind}</Badge>
                </div>
              </td>
              <td className="plate whitespace-nowrap text-[12.5px]">{r.oldMachine && r.oldMachine !== r.newMachine ? `${r.oldMachine} → ${r.newMachine ?? "—"}` : (r.newMachine ?? r.oldMachine ?? "—")}</td>
              <td className="whitespace-nowrap text-[12.5px]">
                {r.c.oldStart && <span className="text-steel line-through">{fmtDateTime(r.c.oldStart)}</span>}
                {r.c.oldStart && r.c.newStart && " → "}
                {r.c.newStart ? fmtDateTime(r.c.newStart) : !r.c.oldStart ? "—" : ""}
              </td>
              <td className="whitespace-nowrap text-[12.5px]">
                {r.c.oldEnd && <span className="text-steel line-through">{fmtDateTime(r.c.oldEnd)}</span>}
                {r.c.oldEnd && r.c.newEnd && " → "}
                {r.c.newEnd ? fmtDateTime(r.c.newEnd) : ""}
              </td>
              <td className="max-w-[360px] whitespace-pre-wrap text-steel">{r.c.reason ?? ""}</td>
            </tr>
          );
        })}
      </Table>
    </Section>
  );
}
