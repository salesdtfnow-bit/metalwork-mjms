import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { activeHolds, listCorrectiveActions, listNcrs } from "@/server/services/ncr";
import { userOptions } from "@/server/services/ui/quality";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/format";
import { NCR_STATUS } from "@/lib/status";
import { Badge, LinkButton, Notice, PageHeader, Ref, Section, StatusBadge, Table, Tabs } from "@/components/ui";
import { ActionForm, Disclosure, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { CapaCard } from "./_components/CapaCard";
import { createCapaAction, releaseHoldAction } from "./actions";

export const metadata = { title: "Non-conformances" };

type SP = { tab?: string; raised?: string; all?: string };

export default async function NcrPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageCtx("ncr.view", "ncr.raise");
  const sp = await searchParams;
  const canView = can(ctx.actor, "ncr.view");
  const tab = sp.tab ?? "open";

  return (
    <>
      <PageHeader
        title="Non-conformances"
        description="NCRs, containment holds, dispositions and corrective / preventive actions."
        actions={can(ctx.actor, "ncr.raise") && <LinkButton href="/ncr/new" variant="primary">Raise NCR</LinkButton>}
      />
      {sp.raised && (
        <Notice tone="success" title={`Non-conformance ${sp.raised} raised`}>
          Quality has been notified. Any holds you selected are now in place.
        </Notice>
      )}
      {!canView ? (
        <Notice tone="info">You can raise non-conformances. Viewing and managing NCRs is done by quality staff.</Notice>
      ) : (
        <>
          <Tabs
            base="/ncr"
            current={tab}
            tabs={[
              { key: "open", label: "Open" },
              { key: "all", label: "All" },
              { key: "capa", label: "Corrective actions" },
              { key: "holds", label: "Holds" },
            ]}
          />
          {(tab === "open" || tab === "all") && <NcrList open={tab === "open"} />}
          {tab === "capa" && <CapaList all={sp.all === "1"} />}
          {tab === "holds" && <Holds />}
        </>
      )}
    </>
  );

  async function NcrList({ open }: { open: boolean }) {
    const rows = await listNcrs(ctx, { open });
    return (
      <Table head={["NCR", "Category", "Source", "Job", "Supplier", "Qty", "Status", "Raised"]} empty={open ? "No open non-conformances." : "No non-conformances recorded."}>
        {rows.map(({ n, job, supplier, raisedBy }) => (
          <tr key={n.id}>
            <td><Ref href={`/ncr/${n.id}`}>{n.ref}</Ref></td>
            <td className="capitalize">{n.category.replace(/_/g, " ")}</td>
            <td className="capitalize text-steel">{n.source.replace(/_/g, " ")}</td>
            <td>{job ? <Link href={`/jobs/${n.jobId}`} className="plate link">{job}</Link> : "—"}</td>
            <td>{supplier ?? "—"}</td>
            <td className="plate">{fmtQty(n.qtyAffected)}</td>
            <td><StatusBadge map={NCR_STATUS} status={n.status} /></td>
            <td className="whitespace-nowrap text-steel">{fmtDate(n.raisedAt)}{raisedBy ? ` · ${raisedBy}` : ""}</td>
          </tr>
        ))}
      </Table>
    );
  }

  async function CapaList({ all }: { all: boolean }) {
    const [rows, people] = await Promise.all([listCorrectiveActions(ctx, !all), userOptions(ctx)]);
    const names = Object.fromEntries(people.map((p) => [p.id, p.name]));
    const manage = can(ctx.actor, "capa.manage");
    return (
      <>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <Link href={all ? "/ncr?tab=capa" : "/ncr?tab=capa&all=1"} className="link text-[13px]">
            {all ? "Show open only" : "Include verified and closed"}
          </Link>
          {manage && (
            <Disclosure label="New corrective action">
              <ActionForm action={createCapaAction} submitLabel="Create corrective action" resetOnSuccess>
                <FormGrid>
                  <TextField label="Title" name="title" required className="sm:col-span-2" />
                  <SelectField label="Owner" name="ownerId" placeholder="Unassigned" options={people.map((p) => ({ value: p.id, label: p.name }))} />
                  <TextField label="Due date" name="dueDate" type="date" />
                </FormGrid>
                <TextArea label="Problem statement" name="problem" required rows={3} />
                <p className="text-[12px] text-steel">To link a corrective action to an NCR, create it from the NCR page.</p>
              </ActionForm>
            </Disclosure>
          )}
        </div>
        {rows.length === 0 && <p className="py-6 text-center text-steel">No corrective actions.</p>}
        {rows.map(({ ca, ncrRef }) => (
          <div key={ca.id}>
            {ca.ncrId && (
              <p className="mb-1 text-[12px] text-steel">
                Linked to <Link href={`/ncr/${ca.ncrId}#capa`} className="link">{ncrRef}</Link>
              </p>
            )}
            <CapaCard ca={ca} names={names} canManage={manage} canVerify={can(ctx.actor, "capa.verify")} actorId={ctx.actor.userId} />
          </div>
        ))}
      </>
    );
  }

  async function Holds() {
    const rows = await activeHolds(ctx);
    const canRelease = can(ctx.actor, "holds.release");
    const canJobHold = can(ctx.actor, "jobs.hold");
    return (
      <>
        <p className="mb-3 text-[13px] text-steel">Holds linked to an NCR, and material lot holds, can only be released with the quality hold-release permission. Closing an NCR releases its holds automatically.</p>
        <Table head={["Target", "Job", "Op", "Lot", "NCR", "Reason", "Qty held", "Placed", "Release"]} empty="No active holds.">
          {rows.map(({ h, job, op, lot, ncr }) => {
            const allowed = h.ncrId || h.targetType === "lot" ? canRelease : canRelease || canJobHold;
            return (
              <tr key={h.id}>
                <td><Badge tone="hold" className="capitalize">{h.targetType}</Badge></td>
                <td>{job ? <Link href={`/jobs/${h.jobId}`} className="plate link">{job}</Link> : "—"}</td>
                <td className="plate">{op ?? "—"}</td>
                <td className="plate">{lot ?? "—"}</td>
                <td>{ncr && h.ncrId ? <Ref href={`/ncr/${h.ncrId}`} size="sm">{ncr}</Ref> : "—"}</td>
                <td className="max-w-[320px] whitespace-pre-wrap">{h.reason}</td>
                <td className="plate">{h.qtyHeld ? fmtQty(h.qtyHeld) : "—"}</td>
                <td className="whitespace-nowrap text-steel">{fmtDateTime(h.placedAt)}</td>
                <td className="min-w-[260px]">
                  {allowed ? (
                    <ActionForm action={releaseHoldAction} submitLabel="Release" submitSize="sm" submitVariant="secondary" inline confirm="Releasing the hold allows the work or material to continue.">
                      <input type="hidden" name="holdId" value={h.id} />
                      {h.ncrId && <input type="hidden" name="ncrId" value={h.ncrId} />}
                      <input name="reason" required placeholder="Why can it be released?" aria-label="Release reason" className="field-input min-w-[180px] flex-1 py-1 text-[12.5px]" />
                    </ActionForm>
                  ) : (
                    <span className="text-[12px] text-steel">Needs hold-release permission</span>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      </>
    );
  }
}
