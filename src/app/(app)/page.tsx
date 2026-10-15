import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { requireCtx } from "@/server/auth/next";
import { can, canAny } from "@/server/context";
import { managementDashboard, purchasingDashboard, qualityDashboard } from "@/server/services/reports";
import { planningDashboard } from "@/server/services/planning";
import { myWork } from "@/server/services/production";
import { getSettings } from "@/server/services/settings";
import { salesSummary } from "@/server/services/ui/records";
import { fmtDate, fmtMinutes, fmtMoney, fmtPct, fmtQty } from "@/lib/format";
import { INSPECTION_STATUS, JOB_STATUS, NCR_STATUS, OP_STATUS, PO_STATUS, QUOTE_STATUS } from "@/lib/status";
import { cx, Empty, Notice, PageHeader, Ref, Section, Stat, StatusBadge, Table } from "@/components/ui";
import { Disclosure } from "@/components/forms";

export const metadata = { title: "Dashboard" };

const RANGES = [7, 30, 90] as const;

/** KPI definitions — kept word-for-word in line with the comment at the top of services/reports.ts. */
const KPI_DEFINITIONS: { name: string; def: string }[] = [
  { name: "On-time delivery (OTD) %", def: "Dispatched consignments in the period whose dispatch date ≤ the job's required date ÷ all consignments dispatched in the period." },
  { name: "Scrap rate %", def: "Σ scrapped ÷ Σ (good + rejected + scrapped) on operations with time recorded in the period." },
  { name: "Rework rate %", def: "Σ good qty on rework operations ÷ Σ good qty on all operations in the period." },
  { name: "First-pass yield %", def: "Inspections passed at first attempt ÷ inspections completed (first-off/in-process/final)." },
  { name: "Machine utilisation %", def: "Recorded setup+production time ÷ available calendar shift time (see machines.ts)." },
  { name: "WIP", def: "Jobs in production-phase statuses; WIP value = Σ (line qty − dispatched) × unit price (commercial view only)." },
  { name: "Quotation pipeline", def: "Σ total of revisions sent/awaiting response (not expired)." },
];

function Tiles({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">{children}</div>;
}

function MiniList({ title, href, children, empty }: { title: string; href?: string; children: ReactNode; empty: string }) {
  const items = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : [];
  return (
    <div className="rounded-md border border-line bg-sheet">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        {href && (
          <Link href={href} className="link text-[12.5px]">
            View all
          </Link>
        )}
      </div>
      {items.length ? <ul className="divide-y divide-line">{children}</ul> : <p className="px-3 py-4 text-[13px] text-steel">{empty}</p>}
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]">{children}</li>;
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const ctx = await requireCtx();
  const a = ctx.actor;
  const sp = await searchParams;

  const showMgmt = canAny(a, "reports.management", "reports.view");
  const showProd = can(a, "planning.view");
  const showQuality = can(a, "quality.view");
  const showPurch = can(a, "purchasing.view");
  const showSales = can(a, "enquiries.view");
  const operatorOnly = can(a, "production.execute") && !showMgmt && !showProd && !showQuality && !showPurch && !showSales && !canAny(a, "jobs.view", "production.view_all");
  if (operatorOnly) redirect("/shopfloor");

  const days = RANGES.find((r) => String(r) === sp.days) ?? 30;
  const to = new Date();
  const range = { from: new Date(to.getTime() - days * 86_400_000), to };
  const [settings, mgmt, prod, quality, purch, sales, work] = await Promise.all([
    getSettings(ctx.db),
    showMgmt ? managementDashboard(ctx, range) : null,
    showProd ? planningDashboard(ctx) : null,
    showQuality ? qualityDashboard(ctx) : null,
    showPurch ? purchasingDashboard(ctx) : null,
    showSales ? salesSummary(ctx) : null,
    can(a, "production.execute") && a.employeeId ? myWork(ctx).catch(() => null) : null,
  ]);
  const cur = settings.currency;
  const nothing = !mgmt && !prod && !quality && !purch && !sales && !work;

  return (
    <>
      <PageHeader title="Dashboard" description={`Signed in as ${a.name}. Sections shown depend on your role.`} />

      {nothing && (
        <Empty title="Nothing to show on your dashboard yet">
          Your role does not include any dashboard sections. Use the navigation menu to open the modules you have access to, or ask an administrator to review your permissions.
        </Empty>
      )}

      {work && (
        <Section title="My work" actions={<Link href="/shopfloor" className="link text-[13px]">Open shop floor</Link>}>
          <Tiles>
            <Stat label="Active now" value={work.active.length} href="/shopfloor" />
            <Stat label="Ready to start" value={work.ready.length} href="/shopfloor" tone={work.ready.length ? "success" : undefined} />
            <Stat label="Waiting on previous ops" value={work.pending.length} href="/shopfloor" />
            <Stat label="On hold" value={work.onHold.length} href="/shopfloor" tone={work.onHold.length ? "warning" : undefined} />
            <Stat label="Awaiting inspection" value={work.awaitingInspection.length} href="/shopfloor" />
            <Stat label="Next job" value={work.next ? work.next.job.jobNumber : "—"} sub={work.next ? `Op ${work.next.op.opNumber} · ${work.next.type.name}` : "No work assigned"} href={work.next ? `/shopfloor/op/${work.next.op.id}` : "/shopfloor"} />
          </Tiles>
        </Section>
      )}

      {mgmt && (
        <Section
          title="Management"
          actions={
            <nav aria-label="KPI period" className="flex items-center gap-1 text-[12.5px]">
              <span className="text-steel">Period:</span>
              {RANGES.map((r) => (
                <Link key={r} href={`/?days=${r}`} aria-current={r === days ? "page" : undefined} className={cx("rounded-sm border px-2 py-0.5", r === days ? "border-dykem bg-dykem-50 font-semibold text-dykem-2" : "border-line bg-sheet text-ink-2 hover:border-steel-2")}>
                  {r} days
                </Link>
              ))}
            </nav>
          }
        >
          <Tiles>
            <Stat label="Open orders" value={mgmt.openOrders} sub="Jobs not completed or cancelled" href="/jobs" />
            {mgmt.commercial && <Stat label="Order value" value={fmtMoney(mgmt.orderValue, cur)} sub="Open job lines" href="/jobs" />}
            {mgmt.commercial && <Stat label="WIP value" value={fmtMoney(mgmt.wipValue, cur)} sub="Not yet dispatched" href="/jobs" />}
            {mgmt.commercial && <Stat label="Quotation pipeline" value={fmtMoney(mgmt.pipelineValue, cur)} sub={`${mgmt.pipelineCount} revision(s) sent`} href="/quotations?status=awaiting_response" />}
            <Stat label="Jobs in progress" value={mgmt.inProgress} sub="Production-phase statuses" href="/jobs?status=in_production" />
            <Stat label="Late" value={mgmt.late.length} sub="Past required date" href="#late-jobs" tone={mgmt.late.length ? "danger" : "success"} />
            <Stat label="At risk (7 days)" value={mgmt.atRiskSoon.length} sub="Due within a week, not ready" href="#at-risk-jobs" tone={mgmt.atRiskSoon.length ? "warning" : undefined} />
            <Stat label="On-time delivery" value={fmtPct(mgmt.otdPct)} sub={`${mgmt.dispatchedCount} consignment(s), ${days} days`} href="/dispatch" tone={mgmt.otdPct !== null && mgmt.otdPct < 90 ? "warning" : undefined} />
            <Stat label="Scrap rate" value={fmtPct(mgmt.scrapPct)} sub={`Reject rate ${fmtPct(mgmt.rejectPct)}`} href="/ncr" />
            <Stat label="Rework rate" value={fmtPct(mgmt.reworkPct)} href="/ncr" />
            <Stat label="First-pass yield" value={fmtPct(mgmt.firstPassYieldPct)} href="/quality" />
            <Stat label="Good parts produced" value={fmtQty(mgmt.throughputQty)} sub={`${days} days`} href="/reports" />
            <Stat label="Open NCRs" value={mgmt.openNcrs} href="/ncr" tone={mgmt.openNcrs ? "warning" : undefined} />
            <Stat label="Overdue inspections" value={mgmt.overdueInspections} sub="Requested over 24 h ago" href="/quality" tone={mgmt.overdueInspections ? "danger" : undefined} />
            <Stat label="Material awaiting release" value={mgmt.materialAwaitingRelease} sub="Awaiting inspection / quarantined" href="/materials" tone={mgmt.materialAwaitingRelease ? "warning" : undefined} />
            <Stat label="Quotations awaiting customer" value={mgmt.awaitingCustomer} href="/quotations?status=awaiting_response" />
            <Stat label="Calibration due (14 days)" value={mgmt.calibrationDue} href="/quality?tab=instruments" tone={mgmt.calibrationDue ? "warning" : undefined} />
          </Tiles>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <div id="late-jobs">
              <MiniList title={`Late jobs (${mgmt.late.length})`} href="/jobs" empty="No jobs are past their required date.">
                {mgmt.late.slice(0, 10).map((j) => (
                  <Row key={j.job.id}>
                    <Ref href={`/jobs/${j.job.id}`} size="sm">{j.job.jobNumber}</Ref>
                    <span className="min-w-0 flex-1 truncate">{j.job.title}</span>
                    <span className="text-steel">{j.customer}</span>
                    <span className="font-medium text-red">Due {fmtDate(j.job.requiredDate)}</span>
                    <StatusBadge map={JOB_STATUS} status={j.job.status} />
                  </Row>
                ))}
              </MiniList>
            </div>
            <div id="at-risk-jobs">
              <MiniList title={`At risk — due within 7 days (${mgmt.atRiskSoon.length})`} href="/planning" empty="No jobs due in the next 7 days are behind.">
                {mgmt.atRiskSoon.slice(0, 10).map((j) => (
                  <Row key={j.job.id}>
                    <Ref href={`/jobs/${j.job.id}`} size="sm">{j.job.jobNumber}</Ref>
                    <span className="min-w-0 flex-1 truncate">{j.job.title}</span>
                    <span className="text-steel">{j.customer}</span>
                    <span className="font-medium text-amber">Due {fmtDate(j.job.requiredDate)}</span>
                    <StatusBadge map={JOB_STATUS} status={j.job.status} />
                  </Row>
                ))}
              </MiniList>
            </div>
          </div>

          <div className="mt-4">
            <h3 className="mb-1.5 text-[13px] font-semibold text-ink">Machine utilisation — last {days} days</h3>
            <Table head={["Machine", "Utilisation", "Recorded run time", "Available shift time"]} empty="No active machines.">
              {mgmt.utilisation.map((u) => (
                <tr key={u.machine}>
                  <td className="plate">{u.machine}</td>
                  <td className="w-[40%]">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 flex-1 overflow-hidden rounded-sm bg-line-2" role="img" aria-label={`Utilisation ${u.utilisationPct ?? 0}%`}>
                        <div className={cx("h-full", (u.utilisationPct ?? 0) > 85 ? "bg-amber" : "bg-dykem")} style={{ width: `${Math.min(100, u.utilisationPct ?? 0)}%` }} />
                      </div>
                      <span className="w-14 text-right tabular-nums">{fmtPct(u.utilisationPct)}</span>
                    </div>
                  </td>
                  <td>{fmtMinutes(u.runMinutes)}</td>
                  <td>{u.availableMinutes ? fmtMinutes(u.availableMinutes) : <span className="text-steel">No calendar time</span>}</td>
                </tr>
              ))}
            </Table>
            <p className="mt-1 text-[12px] text-steel">{mgmt.utilisation[0]?.definition ?? "Recorded setup + production time ÷ available shift time from the machine calendar, less planned maintenance."}</p>
          </div>

          <div className="mt-3">
            <Disclosure label="KPI definitions" variant="ghost">
              <dl className="space-y-2 text-[13px]">
                {KPI_DEFINITIONS.map((k) => (
                  <div key={k.name}>
                    <dt className="font-semibold text-ink">{k.name}</dt>
                    <dd className="text-steel">{k.def}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-[12px] text-steel">Values marked “—” have no data in the period (for example, no dispatches yet).</p>
            </Disclosure>
          </div>
        </Section>
      )}

      {prod && (
        <Section title="Production" actions={<Link href="/planning" className="link text-[13px]">Open planning</Link>}>
          <Tiles>
            <Stat label="Operations ready" value={prod.readyOps.length} href="/planning" tone={prod.readyOps.length ? "success" : undefined} />
            <Stat label="Awaiting inspection / first-off" value={prod.awaitingInspection.length} href="/quality" tone={prod.awaitingInspection.length ? "warning" : undefined} />
            <Stat label="Jobs on hold / NCR" value={prod.onHold.length} href="/jobs?status=on_hold" tone={prod.onHold.length ? "warning" : undefined} />
            <Stat label="Awaiting material" value={prod.awaitingMaterial.length} href="/materials" />
            <Stat label="Awaiting programming" value={prod.awaitingProgramming.length} href="/programs" />
            <Stat label="Operations behind plan" value={prod.opsBehind.length} href="/planning" tone={prod.opsBehind.length ? "danger" : undefined} />
          </Tiles>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <MiniList title="Ready operations" href="/planning" empty="No operations are ready to start.">
              {prod.readyOps.slice(0, 8).map((o) => (
                <Row key={o.op.id}>
                  <Ref href={`/jobs/${o.job.id}?tab=route`} size="sm">{o.job.jobNumber}</Ref>
                  <span>Op {o.op.opNumber}</span>
                  <span className="min-w-0 flex-1 truncate text-steel">{o.type.name}</span>
                  <span className="plate text-[12.5px]">{o.machine ?? "No machine"}</span>
                  <StatusBadge map={OP_STATUS} status={o.op.status} />
                </Row>
              ))}
            </MiniList>
            <div className="rounded-md border border-line bg-sheet">
              <div className="flex items-center justify-between border-b border-line px-3 py-2">
                <h3 className="text-[13px] font-semibold text-ink">Machine load — top 5 (remaining work)</h3>
                <Link href="/planning" className="link text-[12.5px]">Planning board</Link>
              </div>
              {prod.machineLoad.length ? (
                <ul className="divide-y divide-line">
                  {prod.machineLoad.slice(0, 5).map((m) => {
                    const max = prod.machineLoad[0]?.minutes || 1;
                    return (
                      <li key={m.code} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                        <span className="plate w-20">{m.code}</span>
                        <div className="h-2.5 flex-1 overflow-hidden rounded-sm bg-line-2" aria-hidden>
                          <div className="h-full bg-violet" style={{ width: `${Math.round((m.minutes / max) * 100)}%` }} />
                        </div>
                        <span className="w-28 text-right">{fmtMinutes(m.minutes)}</span>
                        <span className="w-16 text-right text-steel">{m.ops} op(s)</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="px-3 py-4 text-[13px] text-steel">No open operations are assigned to machines.</p>
              )}
            </div>
          </div>
        </Section>
      )}

      {quality && (
        <Section title="Quality" actions={<Link href="/quality" className="link text-[13px]">Open quality control</Link>}>
          <Tiles>
            <Stat label="Open inspections" value={quality.openInspections.length} href="/quality" tone={quality.openInspections.length ? "warning" : undefined} />
            <Stat label="Awaiting final release" value={quality.awaitingRelease.length} href="/quality" />
            <Stat label="Open NCRs" value={quality.openNcrs.length} href="/ncr" tone={quality.openNcrs.length ? "danger" : undefined} />
            <Stat label="Open corrective actions" value={quality.openCapa.length} href="/ncr?tab=capa" />
            <Stat label="Calibration due (30 days)" value={quality.calibrationDue.length} href="/quality?tab=instruments" tone={quality.calibrationDue.length ? "warning" : undefined} />
            <Stat label="Results under review" value={quality.resultsUnderReview} href="/quality" />
            <Stat label="Material lots awaiting release" value={quality.lotsAwaiting.length} href="/materials" />
            <Stat label="Certificates outstanding" value={quality.certsOutstanding.length} href="/materials" tone={quality.certsOutstanding.length ? "warning" : undefined} />
            <Stat label="Qualifications expiring (30 days)" value={quality.qualificationsExpiring.length} href="/operators" />
          </Tiles>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <MiniList title="Oldest open inspections" href="/quality" empty="No inspections are waiting.">
              {quality.openInspections.slice(0, 8).map((i) => (
                <Row key={i.i.id}>
                  <Ref href={`/quality/inspections/${i.i.id}`} size="sm">{i.i.ref}</Ref>
                  <span className="capitalize">{i.i.stage.replace(/_/g, " ")}</span>
                  <span className="min-w-0 flex-1 truncate text-steel">{i.job ?? ""}</span>
                  <span className="text-steel">{fmtDate(i.i.requestedAt)}</span>
                  <StatusBadge map={INSPECTION_STATUS} status={i.i.status} />
                </Row>
              ))}
            </MiniList>
            <MiniList title="Open non-conformances" href="/ncr" empty="No open NCRs.">
              {quality.openNcrs.slice(0, 8).map((n) => (
                <Row key={n.n.id}>
                  <Ref href={`/ncr/${n.n.id}`} size="sm">{n.n.ref}</Ref>
                  <span className="min-w-0 flex-1 truncate">{n.n.description}</span>
                  <span className="text-steel">{n.job ?? ""}</span>
                  <StatusBadge map={NCR_STATUS} status={n.n.status} />
                </Row>
              ))}
            </MiniList>
          </div>
        </Section>
      )}

      {purch && (
        <Section title="Purchasing" actions={<Link href="/purchasing" className="link text-[13px]">Open purchasing</Link>}>
          <Tiles>
            <Stat label="Open purchase orders" value={purch.openPos.length} href="/purchasing" />
            <Stat label="Overdue deliveries" value={purch.overdue.length} href="/purchasing" tone={purch.overdue.length ? "danger" : "success"} />
            <Stat label="Expected in 14 days" value={purch.expected.length} href="/purchasing" />
            <Stat label="Certificates outstanding" value={purch.certsOutstanding.length} href="/materials" tone={purch.certsOutstanding.length ? "warning" : undefined} />
            <Stat label="BoxHero sync problems" value={purch.syncProblems.length} href="/materials?tab=boxhero" tone={purch.syncProblems.length ? "danger" : undefined} />
            <Stat label="Jobs needing material" value={purch.jobsNeedingMaterial.length} href="/purchasing" />
          </Tiles>
          <div className="mt-4">
            <MiniList title="Overdue deliveries" href="/purchasing" empty="No deliveries are overdue.">
              {purch.overdue.slice(0, 8).map((o) => (
                <Row key={o.l.id}>
                  <Ref href={`/purchasing/${o.po.id}`} size="sm">{o.po.ref}</Ref>
                  <span className="min-w-0 flex-1 truncate">{o.l.description}</span>
                  <span className="text-steel">{o.supplier}</span>
                  {o.job && <span className="plate text-[12.5px]">{o.job}</span>}
                  <span className="font-medium text-red">Due {fmtDate(o.l.requiredDate)}</span>
                  <StatusBadge map={PO_STATUS} status={o.po.status} />
                </Row>
              ))}
            </MiniList>
          </div>
        </Section>
      )}

      {sales && (
        <Section title="Sales" actions={<Link href="/enquiries" className="link text-[13px]">Open enquiries</Link>}>
          <Tiles>
            <Stat label="Open enquiries" value={sales.openEnquiries} href="/enquiries" />
            <Stat label="New (not yet reviewed)" value={sales.newEnquiries} href="/enquiries?status=new" tone={sales.newEnquiries ? "warning" : undefined} />
            <Stat label="Quotations awaiting response" value={sales.awaitingResponse} href="/quotations?status=awaiting_response" />
            <Stat label="Quotations in internal review" value={sales.inInternalReview} href="/quotations?status=internal_review" />
          </Tiles>
          {can(a, "quotations.view") && (
            <div className="mt-4">
              <MiniList title="Quotations awaiting the customer" href="/quotations" empty="No quotations are awaiting a customer response.">
                {sales.awaitingList.map((r) => (
                  <Row key={r.rev.id}>
                    <Ref href={`/quotations/${r.q.id}`} size="sm">{r.q.ref}</Ref>
                    <span className="text-steel">rev {r.rev.revisionNo}</span>
                    <span className="min-w-0 flex-1 truncate">{r.q.title}</span>
                    <span className="text-steel">{r.customer}</span>
                    <span className="text-steel">Valid until {fmtDate(r.rev.validUntil)}</span>
                    <StatusBadge map={QUOTE_STATUS} status={r.rev.status} />
                  </Row>
                ))}
              </MiniList>
            </div>
          )}
        </Section>
      )}

      {mgmt && !mgmt.commercial && (
        <Notice tone="info">Order, WIP and pipeline values are shown only to users with the management KPI permission.</Notice>
      )}
    </>
  );
}
