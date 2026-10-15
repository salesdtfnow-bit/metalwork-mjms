import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { qualityDashboard } from "@/server/services/reports";
import { listInspections, listInstruments, listPlans, STAGES } from "@/server/services/inspections";
import { customerOptions, partOptions, releaseCandidates } from "@/server/services/ui/quality";
import { fmtDate, fmtDateTime, fmtQty, todayISO } from "@/lib/format";
import { CAPA_STATUS, INSPECTION_STATUS, JOB_STATUS, LOT_STATUS, NCR_STATUS } from "@/lib/status";
import { Badge, LinkButton, PageHeader, Ref, Section, Stat, StatusBadge, Table, Tabs } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { prepareReleaseAction } from "./actions";
import { STAGE_LABEL, PLAN_STATUS, INSTRUMENT_STATUS, stageLabel } from "./_components/labels";

export const metadata = { title: "Quality control" };

type SP = { tab?: string; stage?: string; status?: string; open?: string };

export default async function QualityPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageCtx("quality.view");
  const sp = await searchParams;
  const tab = sp.tab ?? "dashboard";
  const canInspect = can(ctx.actor, "quality.inspect") || can(ctx.actor, "quality.final_inspect");

  return (
    <>
      <PageHeader
        title="Quality control"
        description="Inspections, inspection plans, measuring instruments and final quality release."
        actions={
          <>
            {canInspect && (
              <LinkButton href="/quality/inspections/new" variant="primary">
                New inspection
              </LinkButton>
            )}
            {can(ctx.actor, "ncr.view") && <LinkButton href="/ncr">Non-conformances</LinkButton>}
          </>
        }
      />
      <Tabs
        base="/quality"
        current={tab}
        tabs={[
          { key: "dashboard", label: "Dashboard" },
          { key: "inspections", label: "Inspections" },
          { key: "plans", label: "Plans" },
          { key: "instruments", label: "Instruments" },
        ]}
      />
      {tab === "dashboard" && <Dashboard />}
      {tab === "inspections" && <Inspections sp={sp} />}
      {tab === "plans" && <Plans />}
      {tab === "instruments" && <Instruments />}
    </>
  );

  async function Dashboard() {
    const [dash, releases] = await Promise.all([qualityDashboard(ctx), releaseCandidates(ctx)]);
    const today = todayISO();
    const firstOff = dash.openInspections.filter((r) => r.i.stage === "first_off");
    const overdueCal = dash.calibrationDue.filter((i) => i.calibrationDueOn && i.calibrationDueOn < today);
    const canRelease = can(ctx.actor, "quality.release") || can(ctx.actor, "quality.final_inspect");
    return (
      <>
        <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Open inspections" value={dash.openInspections.length} sub={firstOff.length ? `${firstOff.length} first-off blocking production` : "None blocking production"} tone={firstOff.length ? "danger" : undefined} href="/quality?tab=inspections&open=1" />
          <Stat label="Awaiting final release" value={releases.length} sub={`${dash.awaitingRelease.length} job(s) in final QC`} tone={releases.length ? "warning" : undefined} />
          <Stat label="Open NCRs" value={dash.openNcrs.length} tone={dash.openNcrs.length ? "danger" : "success"} href={can(ctx.actor, "ncr.view") ? "/ncr" : undefined} />
          <Stat label="Open corrective actions" value={dash.openCapa.length} tone={dash.openCapa.length ? "warning" : undefined} href={can(ctx.actor, "ncr.view") ? "/ncr?tab=capa" : undefined} />
          <Stat label="Calibration due (30 days)" value={dash.calibrationDue.length} sub={overdueCal.length ? `${overdueCal.length} overdue` : "None overdue"} tone={overdueCal.length ? "danger" : dash.calibrationDue.length ? "warning" : undefined} href="/quality?tab=instruments" />
          <Stat label="Results under review" value={dash.resultsUnderReview} sub="After an out-of-tolerance calibration" tone={dash.resultsUnderReview ? "danger" : undefined} />
          <Stat label="Lots awaiting incoming inspection" value={dash.lotsAwaiting.length} tone={dash.lotsAwaiting.length ? "warning" : undefined} />
          <Stat label="Material certificates outstanding" value={dash.certsOutstanding.length} tone={dash.certsOutstanding.length ? "warning" : undefined} />
          <Stat label="Qualifications expiring (30 days)" value={dash.qualificationsExpiring.length} tone={dash.qualificationsExpiring.length ? "warning" : undefined} />
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Section title="Open inspections" actions={<Link href="/quality?tab=inspections&open=1" className="link text-[12.5px]">All open</Link>}>
            <Table head={["Ref", "Stage", "Job", "Status", "Requested"]} empty="No open inspections.">
              {dash.openInspections.slice(0, 15).map(({ i, job }) => (
                <tr key={i.id} className={i.stage === "first_off" ? "bg-amber-50/60" : undefined}>
                  <td><Ref href={`/quality/inspections/${i.id}`}>{i.ref}</Ref></td>
                  <td>
                    {stageLabel(i.stage)}
                    {i.stage === "first_off" && <Badge tone="danger" className="ml-1.5">Blocking production</Badge>}
                  </td>
                  <td>{job ? <Link href={`/jobs/${i.jobId}`} className="link">{job}</Link> : "—"}</td>
                  <td><StatusBadge map={INSPECTION_STATUS} status={i.status} /></td>
                  <td className="whitespace-nowrap text-steel">{fmtDateTime(i.requestedAt)}</td>
                </tr>
              ))}
            </Table>
          </Section>

          <Section title="Awaiting final release">
            <Table head={["Job / line", "Part", "Accepted", "Released", "Job status", ""]} empty="No job lines are waiting for final release.">
              {releases.map((r) => (
                <tr key={r.line.id}>
                  <td className="whitespace-nowrap"><Link href={`/jobs/${r.line.jobId}`} className="plate link">{r.jobNumber}</Link> <span className="text-steel">line {r.line.lineNo}</span></td>
                  <td>{r.line.partNumber}</td>
                  <td className="plate">{fmtQty(r.line.qtyAccepted)}</td>
                  <td className="plate">{fmtQty(r.line.qtyReleased)}</td>
                  <td><StatusBadge map={JOB_STATUS} status={r.jobStatus} /></td>
                  <td>
                    {r.draftReleaseId ? (
                      <LinkButton href={`/quality/releases/${r.draftReleaseId}`} size="sm">Open release</LinkButton>
                    ) : canRelease ? (
                      <ActionForm action={prepareReleaseAction} submitLabel="Start release" submitSize="sm" submitVariant="secondary">
                        <input type="hidden" name="jobLineId" value={r.line.id} />
                      </ActionForm>
                    ) : null}
                  </td>
                </tr>
              ))}
            </Table>
          </Section>

          <Section title="Open non-conformances">
            <Table head={["NCR", "Category", "Job", "Status", "Raised"]} empty="No open NCRs.">
              {dash.openNcrs.slice(0, 15).map(({ n, job }) => (
                <tr key={n.id}>
                  <td>{can(ctx.actor, "ncr.view") ? <Ref href={`/ncr/${n.id}`}>{n.ref}</Ref> : <Ref>{n.ref}</Ref>}</td>
                  <td className="capitalize">{n.category.replace(/_/g, " ")}</td>
                  <td>{job ?? "—"}</td>
                  <td><StatusBadge map={NCR_STATUS} status={n.status} /></td>
                  <td className="whitespace-nowrap text-steel">{fmtDate(n.raisedAt)}</td>
                </tr>
              ))}
            </Table>
          </Section>

          <Section title="Open corrective actions">
            <Table head={["CAPA", "Title", "Status", "Due"]} empty="No open corrective actions.">
              {dash.openCapa.slice(0, 15).map((ca) => (
                <tr key={ca.id}>
                  <td><Ref>{ca.ref}</Ref></td>
                  <td>{ca.ncrId && can(ctx.actor, "ncr.view") ? <Link href={`/ncr/${ca.ncrId}#capa`} className="link">{ca.title}</Link> : ca.title}</td>
                  <td><StatusBadge map={CAPA_STATUS} status={ca.status} /></td>
                  <td className={ca.dueDate && ca.dueDate < today ? "font-semibold text-red" : "text-steel"}>{fmtDate(ca.dueDate)}</td>
                </tr>
              ))}
            </Table>
          </Section>

          <Section title="Calibration due or overdue (next 30 days)">
            <Table head={["Asset", "Description", "Status", "Due"]} empty="No calibrations due in the next 30 days.">
              {dash.calibrationDue.map((i) => (
                <tr key={i.id}>
                  <td><Ref href={`/quality/instruments/${i.id}`}>{i.assetNo}</Ref></td>
                  <td>{i.description}</td>
                  <td><StatusBadge map={INSTRUMENT_STATUS} status={i.status} /></td>
                  <td className={i.calibrationDueOn && i.calibrationDueOn < today ? "font-semibold text-red" : ""}>
                    {fmtDate(i.calibrationDueOn)}
                    {i.calibrationDueOn && i.calibrationDueOn < today && <Badge tone="danger" className="ml-1.5">Overdue</Badge>}
                  </td>
                </tr>
              ))}
            </Table>
          </Section>

          <Section title="Material lots awaiting incoming inspection">
            <Table head={["Lot", "Heat", "Status", "Certificate"]} empty="No lots awaiting inspection.">
              {dash.lotsAwaiting.map((l) => (
                <tr key={l.id}>
                  <td className="plate">{l.lotNo}</td>
                  <td className="plate">{l.heatNumber}</td>
                  <td><StatusBadge map={LOT_STATUS} status={l.status} /></td>
                  <td>
                    {["pending", "received"].includes(l.certificateStatus) ? <Badge tone="warning">Certificate {l.certificateStatus}</Badge> : <span className="capitalize text-steel">{l.certificateStatus.replace(/_/g, " ")}</span>}
                  </td>
                </tr>
              ))}
            </Table>
            {dash.lotsAwaiting.length > 0 && <p className="mt-1 text-[12px] text-steel">Lot inspection and release are recorded on the <Link href="/materials?tab=lots" className="link">materials</Link> screens.</p>}
          </Section>

          <Section title="Qualifications expiring (next 30 days)">
            <Table head={["Employee", "Competency", "Expires"]} empty="No qualifications expiring.">
              {dash.qualificationsExpiring.map(({ ec, c, e }) => (
                <tr key={ec.id}>
                  <td>{e.firstName} {e.lastName}</td>
                  <td>{c.name}</td>
                  <td className={ec.expiresOn && ec.expiresOn < today ? "font-semibold text-red" : ""}>{fmtDate(ec.expiresOn)}</td>
                </tr>
              ))}
            </Table>
          </Section>
        </div>
      </>
    );
  }

  async function Inspections({ sp }: { sp: SP }) {
    const open = sp.open === "1";
    const rows = await listInspections(ctx, { stage: sp.stage || undefined, status: sp.status || undefined, open });
    return (
      <>
        <form className="mb-3 flex flex-wrap items-center gap-2" role="search">
          <input type="hidden" name="tab" value="inspections" />
          <select name="stage" defaultValue={sp.stage ?? ""} className="field-input w-auto" aria-label="Stage">
            <option value="">All stages</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>{STAGE_LABEL[s]}</option>
            ))}
          </select>
          <select name="status" defaultValue={sp.status ?? ""} className="field-input w-auto" aria-label="Status">
            <option value="">Any status</option>
            {Object.entries(INSPECTION_STATUS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-[13px] text-steel">
            <input type="checkbox" name="open" value="1" defaultChecked={open} className="accent-dykem" /> Open only
          </label>
          <button className="rounded-sm border border-line bg-sheet px-3 py-1.5 text-[13px]">Apply</button>
        </form>
        <Table head={["Ref", "Stage", "Job", "Op", "Lot", "Status", "Inspector", "Requested"]} empty="No inspections match.">
          {rows.map(({ i, job, opNumber, lotNo, inspector }) => (
            <tr key={i.id}>
              <td><Ref href={`/quality/inspections/${i.id}`}>{i.ref}</Ref></td>
              <td>
                {stageLabel(i.stage)}
                {i.stage === "first_off" && ["open", "in_progress"].includes(i.status) && <Badge tone="danger" className="ml-1.5">Blocking</Badge>}
              </td>
              <td>{job ? <Link href={`/jobs/${i.jobId}`} className="plate link">{job}</Link> : "—"}</td>
              <td className="plate">{opNumber ?? "—"}</td>
              <td className="plate">{lotNo ?? "—"}</td>
              <td><StatusBadge map={INSPECTION_STATUS} status={i.status} /></td>
              <td>{inspector ?? "—"}</td>
              <td className="whitespace-nowrap text-steel">{fmtDateTime(i.requestedAt)}</td>
            </tr>
          ))}
        </Table>
      </>
    );
  }

  async function Plans() {
    const [plans, partsList, custs] = await Promise.all([listPlans(ctx), partOptions(ctx), customerOptions(ctx)]);
    return (
      <Section
        title="Inspection plans"
        actions={can(ctx.actor, "quality.plans") && <LinkButton href="/quality/plans/new" variant="primary" size="sm">New plan</LinkButton>}
      >
        <Table head={["Code", "Version", "Name", "Stage", "Part", "Customer", "Status", "Characteristics"]} empty="No inspection plans yet. Plans define what is measured at each inspection stage.">
          {plans.map((p) => (
            <tr key={p.id}>
              <td><Ref href={`/quality/plans/${p.id}`}>{p.code}</Ref></td>
              <td className="plate">v{p.version}</td>
              <td>{p.name}</td>
              <td>{stageLabel(p.stage)}</td>
              <td>{partsList.find((x) => x.id === p.partId)?.partNumber ?? "—"}</td>
              <td>{custs.find((x) => x.id === p.customerId)?.name ?? "—"}</td>
              <td><StatusBadge map={PLAN_STATUS} status={p.status} /></td>
              <td className="plate">{p.characteristics}</td>
            </tr>
          ))}
        </Table>
      </Section>
    );
  }

  async function Instruments() {
    const rows = await listInstruments(ctx);
    const today = todayISO();
    return (
      <Section
        title="Measuring instruments"
        actions={can(ctx.actor, "quality.instruments") && <LinkButton href="/quality/instruments/new" variant="primary" size="sm">Add instrument</LinkButton>}
      >
        <Table head={["Asset no.", "Description", "Type", "Location", "Status", "Calibration due", "Validity"]} empty="No instruments registered.">
          {rows.map((i) => {
            const overdue = i.calibrationRequired && (!i.calibrationDueOn || i.calibrationDueOn < today);
            return (
              <tr key={i.id}>
                <td><Ref href={`/quality/instruments/${i.id}`}>{i.assetNo}</Ref></td>
                <td>{i.description}</td>
                <td className="capitalize">{i.instrumentType.replace(/_/g, " ")}</td>
                <td>{i.location ?? "—"}</td>
                <td><StatusBadge map={INSTRUMENT_STATUS} status={i.status} /></td>
                <td className={overdue ? "font-semibold text-red" : ""}>{i.calibrationRequired ? fmtDate(i.calibrationDueOn) : "Not required"}</td>
                <td>{i.validity.ok ? <Badge tone="success">Valid for use</Badge> : <span className="text-[12.5px] text-red">{i.validity.reason}</span>}</td>
              </tr>
            );
          })}
        </Table>
      </Section>
    );
  }
}
