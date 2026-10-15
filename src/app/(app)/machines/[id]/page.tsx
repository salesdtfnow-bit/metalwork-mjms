import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { AppError } from "@/server/errors";
import { calendarsList, downtimeReasonsList, machineDashboard, machineGroupsList } from "@/server/services/machines";
import { openDowntime, opPartNumbers, recordedMinutesByOperation, userNames } from "@/server/services/ui/shopfloor";
import { d } from "@/lib/decimal";
import { fmtDate, fmtDateTime, fmtMinutes, fmtMoney, fmtPct, fmtQty, todayISO } from "@/lib/format";
import { MACHINE_STATUS, MWO_STATUS, OP_STATUS, PRIORITY } from "@/lib/status";
import { Badge, cx, Empty, KeyValues, Notice, Panel, Ref, Section, StatusBadge, Table, Tabs, TitleBlock } from "@/components/ui";
import { ActionForm, Disclosure, SelectField, TextArea, TextField } from "@/components/forms";
import { MachineForm } from "../MachineForm";
import { machineFormOptions } from "../formData";
import { machineEndDowntimeAction, machineStartDowntimeAction, reportStatusAction, setMachineActiveAction, updateMachineAction } from "../actions";

export const metadata = { title: "Machine" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RANGES = [7, 30, 90] as const;
const MWO_KIND: Record<string, string> = { preventive: "Preventive", breakdown: "Breakdown", corrective: "Corrective", inspection: "Inspection", calibration: "Calibration" };

type OpRow = { op: { id: string; jobId: string; opNumber: string; title: string; status: string; plannedQty: string; qtyGood: string; setupMinutesEst: string; cycleMinutesEst: string; plannedStart: Date | null; actualEnd: Date | null }; job: { jobNumber: string; priority: number; requiredDate: string | null }; type: string };

const estMinutes = (op: OpRow["op"]) => d(op.setupMinutesEst).plus(d(op.cycleMinutesEst).times(d(op.plannedQty)));

export default async function MachinePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; days?: string }> }) {
  const ctx = await requirePageCtx("machines.view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const tab = sp.tab ?? "overview";
  const days = RANGES.find((r) => String(r) === sp.days) ?? 30;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const data = await machineDashboard(ctx, id, { from, to }).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const { m, type, responsible, active, queue, onHold, completed, capabilities, statusLog, downtime, plans, workOrders, utilisation, currentOperators } = data;
  const manage = can(ctx.actor, "machines.manage");
  const report = can(ctx.actor, "machines.report_status");
  const commercial = can(ctx.actor, "jobs.view_commercial");

  const [names, open, reasons, groups, calendars, parts, recorded, formOpts] = await Promise.all([
    userNames(ctx, [m.currentStatusBy]),
    openDowntime(ctx, id),
    report ? downtimeReasonsList(ctx) : Promise.resolve([]),
    machineGroupsList(ctx),
    calendarsList(ctx),
    opPartNumbers(ctx, [...active, ...queue, ...onHold].map((r) => r.op.id)),
    tab === "history" ? recordedMinutesByOperation(ctx, completed.map((c) => c.op.id)) : Promise.resolve(new Map<string, { setup: number; run: number }>()),
    tab === "details" && manage ? machineFormOptions(ctx) : Promise.resolve(null),
  ]);
  const group = groups.find((g) => g.id === m.machineGroupId);
  const calendar = calendars.find((c) => c.id === m.calendarId);
  const today = todayISO();
  const nextDue = plans.map((p) => p.nextDueOn).filter((x): x is string => !!x).sort()[0];
  const defs = (Array.isArray(type.customFieldDefs) ? type.customFieldDefs : []) as { key: string; label: string; type: string; unit?: string }[];
  const cf = (m.customFields ?? {}) as Record<string, unknown>;
  const reporter = m.currentStatusBy ? names.get(m.currentStatusBy) : null;
  const base = `/machines/${id}?days=${days}`;

  return (
    <>
      <TitleBlock
        kind="Machine"
        refNo={m.code}
        title={m.name}
        status={
          <>
            <StatusBadge map={MACHINE_STATUS} status={m.currentStatus} />
            <span className="text-[12.5px] text-steel">
              {m.currentStatusSource === "manual" ? "Manual" : m.currentStatusSource} status
              {reporter ? ` — reported by ${reporter}` : ""}
              {m.currentStatusAt ? `, at ${fmtDateTime(m.currentStatusAt)}` : ", not yet reported"}
            </span>
            {!m.isActive && <Badge tone="muted">Inactive</Badge>}
            {open && <Badge tone="danger">Downtime open since {fmtDateTime(open.d.startedAt)}</Badge>}
          </>
        }
        cells={[
          { label: "Type", value: type.name },
          { label: "Location", value: m.location },
          { label: "Responsible", value: responsible ? `${responsible.firstName} ${responsible.lastName}` : null },
          { label: "Controller", value: m.controller },
          { label: `Utilisation (last ${days} days)`, value: utilisation.utilisationPct === null ? "No available time" : fmtPct(utilisation.utilisationPct) },
          { label: "Maintenance due", value: nextDue ? <span className={cx(nextDue < today && "text-red")}>{fmtDate(nextDue)}{nextDue < today ? " — overdue" : ""}</span> : "None planned" },
        ]}
        actions={
          manage && (
            <Disclosure label={m.isActive ? "Deactivate" : "Reactivate"}>
              <ActionForm action={setMachineActiveAction} submitLabel={m.isActive ? "Deactivate machine" : "Reactivate machine"} submitVariant={m.isActive ? "danger" : "primary"} confirm={m.isActive ? "Inactive machines cannot be scheduled or started. Existing history is kept." : undefined}>
                <input type="hidden" name="id" value={m.id} />
                <input type="hidden" name="active" value={m.isActive ? "false" : "true"} />
                <TextField label="Reason" name="reason" required />
              </ActionForm>
            </Disclosure>
          )
        }
      />
      <p className="-mt-3 mb-4 text-[12px] text-steel">
        Status is reported manually by people (from the shop floor or this page) — it is not live machine telemetry. Utilisation: {utilisation.definition} ({fmtMinutes(utilisation.runMinutes)} recorded of {fmtMinutes(utilisation.availableMinutes)} available.)
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-steel">Period:</span>
        {RANGES.map((r) => (
          <Link key={r} href={`/machines/${id}?days=${r}&tab=${tab}`} aria-current={r === days ? "page" : undefined} className={cx("rounded-sm border px-2 py-0.5", r === days ? "border-dykem bg-dykem-50 font-semibold text-dykem-2" : "border-line bg-sheet text-ink hover:border-steel-2")}>
            {r} days
          </Link>
        ))}
      </div>

      <Tabs
        base={base}
        current={tab}
        tabs={[
          { key: "overview", label: "Current & queue", count: active.length + queue.length },
          { key: "history", label: "History & downtime" },
          { key: "maintenance", label: "Maintenance", count: workOrders.filter((w) => !["completed", "cancelled"].includes(w.status)).length },
          { key: "details", label: "Details & capabilities" },
        ]}
      />

      {tab === "overview" && (
        <>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div>
              <Section title="Current job / operation">
                {active.length === 0 ? (
                  <Empty title="Nothing running">No operation is in setup, production or awaiting first-off on this machine.</Empty>
                ) : (
                  <Table head={["Job / op", "Operation", "Part", "Status", "Operator(s)", "Good / planned", "Due"]}>
                    {active.map((r) => (
                      <tr key={r.op.id}>
                        <td className="whitespace-nowrap">
                          <Ref href={`/jobs/${r.op.jobId}?tab=route`}>{`${r.job.jobNumber} / ${r.op.opNumber}`}</Ref>
                        </td>
                        <td>{r.op.title}</td>
                        <td className="plate">{parts.get(r.op.id) ?? "—"}</td>
                        <td>
                          <StatusBadge map={OP_STATUS} status={r.op.status} />
                        </td>
                        <td>{currentOperators.filter((o) => o.operationId === r.op.id).map((o) => o.name).join(", ") || "—"}</td>
                        <td>
                          {fmtQty(r.op.qtyGood)} / {fmtQty(r.op.plannedQty)}
                        </td>
                        <td>
                          <Due date={r.job.requiredDate} today={today} />
                        </td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Section>
              <Section title={`Queue (${queue.length})`} actions={<span className="text-[12px] text-steel">Est. duration = setup estimate + cycle estimate × planned quantity</span>}>
                <QueueTable rows={queue} parts={parts} today={today} empty="No operations queued on this machine." />
              </Section>
              <Section title={`On hold (${onHold.length})`}>
                <QueueTable rows={onHold} parts={parts} today={today} empty="No operations on hold on this machine." />
              </Section>
            </div>
            {report && (
              <aside className="space-y-4">
                <Panel className="p-4">
                  <h2 className="mb-1 text-[14.5px] font-semibold text-ink">Report status</h2>
                  <p className="mb-3 text-[12.5px] text-steel">Recorded as a manual report with your name and the time.</p>
                  <ActionForm action={reportStatusAction} submitLabel="Report status" resetOnSuccess>
                    <input type="hidden" name="id" value={m.id} />
                    <SelectField label="Status" name="status" required defaultValue={m.currentStatus} options={Object.entries(MACHINE_STATUS).map(([value, s]) => ({ value, label: s.label }))} />
                    <TextArea label="Reason" name="reason" rows={2} hint="Required for Blocked, Maintenance and Offline." />
                  </ActionForm>
                </Panel>
                <Panel className="p-4">
                  <h2 className="mb-3 text-[14.5px] font-semibold text-ink">Downtime</h2>
                  {open ? (
                    <>
                      <Notice tone="warning" title={`Down since ${fmtDateTime(open.d.startedAt)}`}>
                        {open.reason} ({open.category}){open.d.notes ? ` — ${open.d.notes}` : ""}
                      </Notice>
                      <ActionForm action={machineEndDowntimeAction} submitLabel="End downtime">
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="downtimeId" value={open.d.id} />
                        <TextField label="Notes" name="notes" placeholder="What was done" />
                      </ActionForm>
                    </>
                  ) : (
                    <ActionForm action={machineStartDowntimeAction} submitLabel="Start downtime" submitVariant="secondary">
                      <input type="hidden" name="id" value={m.id} />
                      <SelectField label="Reason" name="reasonId" required placeholder="Select a reason" options={reasons.map((r) => ({ value: r.id, label: `${r.name}${r.category === "planned" ? " (planned)" : ""}` }))} />
                      <TextField label="Notes" name="notes" />
                    </ActionForm>
                  )}
                </Panel>
              </aside>
            )}
          </div>
        </>
      )}

      {tab === "history" && (
        <>
          <Section title="Completed recently — planned vs actual" actions={<span className="text-[12px] text-steel">Actual = recorded setup + run time from operator time entries</span>}>
            <Table head={["Job / op", "Operation", "Completed", "Qty good", "Estimated", "Recorded setup", "Recorded run", "Recorded total", "Variance"]} empty="No completed operations on this machine yet.">
              {completed.map((r) => {
                const est = estMinutes(r.op).toNumber();
                const rec = recorded.get(r.op.id) ?? { setup: 0, run: 0 };
                const total = rec.setup + rec.run;
                const variance = est > 0 && total > 0 ? ((total - est) / est) * 100 : null;
                return (
                  <tr key={r.op.id}>
                    <td className="whitespace-nowrap">
                      <Ref href={`/jobs/${r.op.jobId}?tab=route`}>{`${r.job.jobNumber} / ${r.op.opNumber}`}</Ref>
                    </td>
                    <td>{r.op.title}</td>
                    <td className="whitespace-nowrap">{fmtDateTime(r.op.actualEnd)}</td>
                    <td>{fmtQty(r.op.qtyGood)}</td>
                    <td>{est ? fmtMinutes(est) : "—"}</td>
                    <td>{fmtMinutes(rec.setup)}</td>
                    <td>{fmtMinutes(rec.run)}</td>
                    <td className="font-medium">{fmtMinutes(total)}</td>
                    <td className={cx(variance !== null && variance > 10 && "text-red", variance !== null && variance < -10 && "text-green")}>{variance === null ? "—" : `${variance > 0 ? "+" : ""}${fmtPct(variance, 0)}`}</td>
                  </tr>
                );
              })}
            </Table>
          </Section>
          <Section title="Downtime log">
            <Table head={["Reason", "Category", "Started", "Ended", "Duration", "Notes", "Source"]} empty="No downtime recorded.">
              {downtime.map(({ d: dt, reason, category }) => (
                <tr key={dt.id}>
                  <td className="font-medium">{reason}</td>
                  <td>{category === "planned" ? <Badge tone="info">Planned</Badge> : <Badge tone="warning">Unplanned</Badge>}</td>
                  <td className="whitespace-nowrap">{fmtDateTime(dt.startedAt)}</td>
                  <td className="whitespace-nowrap">{dt.endedAt ? fmtDateTime(dt.endedAt) : <Badge tone="danger">Open</Badge>}</td>
                  <td>{fmtMinutes(((dt.endedAt ?? new Date()).getTime() - dt.startedAt.getTime()) / 60_000)}</td>
                  <td className="max-w-[320px] whitespace-pre-wrap text-steel">{dt.notes ?? ""}</td>
                  <td className="text-steel">{dt.source === "manual" ? "Manual" : dt.source}</td>
                </tr>
              ))}
            </Table>
          </Section>
          <Section title="Status history" actions={<span className="text-[12px] text-steel">Last 50 reports</span>}>
            <Table head={["When", "Status", "Source", "Reported by", "Reason"]} empty="No status reports yet.">
              {statusLog.map(({ e, user }) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(e.at)}</td>
                  <td>
                    <StatusBadge map={MACHINE_STATUS} status={e.status} />
                  </td>
                  <td className="text-steel">{e.source === "manual" ? "Manual report" : e.source}</td>
                  <td>{user ?? "System"}</td>
                  <td className="max-w-[420px] whitespace-pre-wrap text-steel">{e.reason ?? ""}</td>
                </tr>
              ))}
            </Table>
          </Section>
        </>
      )}

      {tab === "maintenance" && (
        <>
          <Section title="Maintenance plans">
            <Table head={["Plan", "Interval", "Last done", "Next due", "Est. hours"]} empty="No active maintenance plans.">
              {plans.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.title}</td>
                  <td>Every {p.intervalDays} days</td>
                  <td>{fmtDate(p.lastDoneOn)}</td>
                  <td>
                    <Due date={p.nextDueOn} today={today} />
                  </td>
                  <td>{p.estimatedHours ? fmtQty(p.estimatedHours) : "—"}</td>
                </tr>
              ))}
            </Table>
          </Section>
          <Section title="Work orders" actions={<span className="text-[12px] text-steel">Latest 20</span>}>
            <Table head={["Ref", "Title", "Kind", "Status", "Priority", "Reported", "Scheduled", "Locks machine"]} empty="No maintenance work orders.">
              {workOrders.map((w) => (
                <tr key={w.id}>
                  <td>
                    <Ref href={`/maintenance/${w.id}`}>{w.ref}</Ref>
                  </td>
                  <td>{w.title}</td>
                  <td>{MWO_KIND[w.kind] ?? w.kind}</td>
                  <td>
                    <StatusBadge map={MWO_STATUS} status={w.status} />
                  </td>
                  <td>
                    <StatusBadge map={PRIORITY} status={String(w.priority)} />
                  </td>
                  <td className="whitespace-nowrap">{fmtDate(w.reportedAt)}</td>
                  <td className="whitespace-nowrap">{w.scheduledStart ? `${fmtDateTime(w.scheduledStart)} – ${fmtDateTime(w.scheduledEnd)}` : "—"}</td>
                  <td>{w.locksMachine ? "Yes" : "No"}</td>
                </tr>
              ))}
            </Table>
          </Section>
        </>
      )}

      {tab === "details" && (
        <>
          <Section title="Capabilities">
            {capabilities.length ? (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {capabilities.map((c) => (
                  <Badge key={c.id} tone="info">
                    {c.name}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="mb-3 text-[13px] text-steel">No operation types configured — the machine is treated as capable of any operation type.</p>
            )}
            <KeyValues
              cols={2}
              items={[
                { label: "Capabilities", value: m.capabilities },
                { label: "Permitted materials", value: m.permittedMaterials },
              ]}
            />
          </Section>
          <Section title="Machine details">
            <KeyValues
              cols={4}
              items={[
                { label: "Manufacturer", value: m.manufacturer },
                { label: "Model", value: m.model },
                { label: "Serial number", value: m.serialNumber },
                { label: "Year", value: m.yearOfManufacture },
                { label: "Controller", value: m.controller },
                { label: "Axes", value: m.axes },
                { label: "Work envelope", value: m.workEnvelope },
                { label: "Max weight", value: m.maxWeightKg ? fmtQty(m.maxWeightKg, "kg") : null },
                { label: "Max spindle speed", value: m.spindleSpeedMax ? `${m.spindleSpeedMax} rpm` : null },
                { label: "Group", value: group ? `${group.name} (${group.code})` : null },
                { label: "Working calendar", value: calendar?.name ?? "Default (Mon–Fri 07:00–15:30)" },
                { label: "Hourly rate", value: commercial ? (m.hourlyRate ? fmtMoney(m.hourlyRate) : null) : "Restricted" },
                { label: "Concurrent operations", value: m.allowsConcurrent ? "Allowed" : "One at a time" },
                { label: "Accessories", value: m.accessories, wide: true },
                { label: "Setup requirements", value: m.setupRequirements, wide: true },
                { label: "Safety notes", value: m.safetyNotes, wide: true },
              ]}
            />
          </Section>
          {defs.length > 0 && (
            <Section title={`${type.name} fields`}>
              <KeyValues
                cols={4}
                items={defs.map((f) => {
                  const v = cf[f.key];
                  const shown = v === undefined || v === null || v === "" ? null : f.type === "boolean" ? (v === true || v === "true" ? "Yes" : "No") : f.type === "date" ? fmtDate(String(v)) : `${String(v)}${f.unit ? ` ${f.unit}` : ""}`;
                  return { label: f.label, value: shown };
                })}
              />
            </Section>
          )}
          {manage && formOpts && (
            <Disclosure label="Edit machine">
              <MachineForm action={updateMachineAction} machine={m} selectedOperationTypeIds={capabilities.map((c) => c.id)} showRate={commercial} submitLabel="Save changes" {...formOpts} />
            </Disclosure>
          )}
        </>
      )}
    </>
  );
}

function Due({ date, today }: { date: string | null | undefined; today: string }) {
  if (!date) return <span className="text-steel">—</span>;
  const late = date < today;
  return <span className={cx("whitespace-nowrap", late && "font-semibold text-red")}>{fmtDate(date)}{late ? " — overdue" : ""}</span>;
}

function QueueTable({ rows, parts, today, empty }: { rows: OpRow[]; parts: Map<string, string>; today: string; empty: string }) {
  return (
    <Table head={["Priority", "Job / op", "Operation", "Part", "Status", "Due", "Est. duration", "Planned start"]} empty={empty}>
      {rows.map((r) => (
        <tr key={r.op.id}>
          <td>
            <StatusBadge map={PRIORITY} status={String(r.job.priority)} />
          </td>
          <td className="whitespace-nowrap">
            <Ref href={`/jobs/${r.op.jobId}?tab=route`}>{`${r.job.jobNumber} / ${r.op.opNumber}`}</Ref>
          </td>
          <td>
            {r.op.title}
            <span className="block text-[12px] text-steel">{r.type}</span>
          </td>
          <td className="plate">{parts.get(r.op.id) ?? "—"}</td>
          <td>
            <StatusBadge map={OP_STATUS} status={r.op.status} />
          </td>
          <td>
            <Due date={r.job.requiredDate} today={today} />
          </td>
          <td>{fmtMinutes(estMinutes(r.op))}</td>
          <td className="whitespace-nowrap">{fmtDateTime(r.op.plannedStart)}</td>
        </tr>
      ))}
    </Table>
  );
}
