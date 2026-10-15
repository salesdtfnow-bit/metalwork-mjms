import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { AppError } from "@/server/errors";
import { getNcr } from "@/server/services/ncr";
import { customerOptions, ncrHistory, userOptions } from "@/server/services/ui/quality";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { INSPECTION_STATUS, NCR_STATUS, OP_STATUS } from "@/lib/status";
import { Badge, KeyValues, Notice, Panel, Ref, Section, StatusBadge, Table, TitleBlock } from "@/components/ui";
import { ActionForm, Disclosure, FormGrid, SelectField, SignatureBlock, TextArea, TextField } from "@/components/forms";
import { AuditList } from "@/components/AuditList";
import { CapaCard } from "../_components/CapaCard";
import { DISPOSITION_INFO, DispositionFields } from "../_components/DispositionFields";
import {
  approveDispositionAction,
  cancelNcrAction,
  closeNcrAction,
  createCapaAction,
  releaseHoldAction,
  updateInvestigationAction,
} from "../actions";

const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export default async function NcrDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageCtx("ncr.view");
  const { id } = await params;
  const data = await getNcr(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const { ncr: n, job, operation, lot, supplier, inspection, reinspection, evidence, holds, capas, rework, names } = data;
  const [people, custs, history] = await Promise.all([userOptions(ctx), customerOptions(ctx), ncrHistory(ctx, id)]);
  const nameMap = Object.fromEntries(people.map((p) => [p.id, p.name]));
  const terminal = ["closed", "cancelled"].includes(n.status);
  const canManage = can(ctx.actor, "ncr.manage") && !terminal;
  const canDisposition = can(ctx.actor, "ncr.disposition") && !["closed", "cancelled", "in_rework", "awaiting_reinspection"].includes(n.status);
  const canClose = can(ctx.actor, "ncr.close") && !terminal;
  const canCancel = can(ctx.actor, "ncr.close") && !terminal && !n.disposition;
  const canCapa = can(ctx.actor, "capa.manage") && !["cancelled"].includes(n.status);
  const holdRelease = can(ctx.actor, "holds.release");
  const activeHolds = holds.filter((h) => !h.releasedAt);
  const customer = custs.find((c) => c.id === n.customerId);
  const openRework = rework.filter((o) => !["complete", "cancelled"].includes(o.status));

  return (
    <>
      <TitleBlock
        kind="Non-conformance report"
        refNo={n.ref}
        title={`${label(n.category)} — ${label(n.source)}`}
        status={
          <>
            <StatusBadge map={NCR_STATUS} status={n.status} />
            {activeHolds.length > 0 && <Badge tone="hold">{activeHolds.length} active hold(s)</Badge>}
            {n.disposition && <Badge tone="info">Disposition: {DISPOSITION_INFO[n.disposition]?.label ?? n.disposition}</Badge>}
          </>
        }
        cells={[
          { label: "Job", value: job ? <Link href={`/jobs/${job.id}`} className="plate link">{job.jobNumber}</Link> : null },
          { label: "Operation", value: operation ? <Link href={`/jobs/${operation.jobId}?tab=route`} className="link">{operation.opNumber} {operation.title}</Link> : null },
          { label: "Lot / heat", value: lot ? <Link href={`/materials/lots/${lot.id}`} className="plate link">{lot.lotNo} · {lot.heatNumber}</Link> : n.heatNumber },
          { label: "Supplier", value: supplier?.name },
          { label: "Qty affected", value: fmtQty(n.qtyAffected) },
          { label: "Raised", value: `${names.raisedBy ?? ""} · ${fmtDateTime(n.raisedAt)}` },
        ]}
      />

      <Section title="Description & evidence">
        <KeyValues
          items={[
            { label: "Description", value: n.description, wide: true },
            { label: "Customer", value: customer ? `${customer.code} — ${customer.name}` : null },
            { label: "Raised from inspection", value: inspection ? <Ref href={`/quality/inspections/${inspection.id}`} size="sm">{inspection.ref}</Ref> : null },
            { label: "Owner", value: names.owner },
          ]}
        />
        <div className="mt-3">
          <Table head={["Evidence file", "Caption", "Added"]} empty="No evidence files attached.">
            {evidence.map(({ nf, f }) => (
              <tr key={nf.id}>
                <td><a href={`/api/files/${f.id}`} className="link">{f.originalName}</a></td>
                <td>{nf.caption ?? ""}</td>
                <td className="text-steel">{fmtDateTime(nf.createdAt)}</td>
              </tr>
            ))}
          </Table>
        </div>
      </Section>

      <Section title="Containment & investigation">
        <KeyValues
          cols={2}
          items={[
            { label: "Containment action", value: n.containmentAction, wide: true },
            { label: "Root cause", value: n.rootCause, wide: true },
          ]}
        />
        {canManage && (
          <div className="mt-3">
            <Disclosure label="Update investigation" defaultOpen={!n.containmentAction && n.status === "open"}>
              <ActionForm action={updateInvestigationAction} submitLabel="Save investigation">
                <input type="hidden" name="ncrId" value={n.id} />
                <TextArea label="Containment action" name="containmentAction" rows={2} defaultValue={n.containmentAction} hint="Recording containment moves an open NCR to Contained." />
                <TextArea label="Root cause" name="rootCause" rows={3} defaultValue={n.rootCause} hint="Recording the root cause moves the NCR to Awaiting disposition." />
                <SelectField label="Owner" name="ownerId" placeholder="Unassigned" options={people.map((p) => ({ value: p.id, label: p.name }))} defaultValue={n.ownerId} className="max-w-sm" />
              </ActionForm>
            </Disclosure>
          </div>
        )}
      </Section>

      <Section title="Holds">
        <Table head={["Target", "Reason", "Qty", "Placed", "Released", ""]} empty="This NCR placed no holds.">
          {holds.map((h) => (
            <tr key={h.id}>
              <td><Badge tone={h.releasedAt ? "muted" : "hold"} className="capitalize">{h.targetType}</Badge></td>
              <td className="max-w-[320px] whitespace-pre-wrap">{h.reason}</td>
              <td className="plate">{h.qtyHeld ? fmtQty(h.qtyHeld) : "—"}</td>
              <td className="whitespace-nowrap text-steel">{fmtDateTime(h.placedAt)}</td>
              <td className="text-[12.5px] text-steel">{h.releasedAt ? `${fmtDateTime(h.releasedAt)} · ${nameMap[h.releasedBy ?? ""] ?? ""} — ${h.releaseReason ?? ""}` : "Active"}</td>
              <td className="min-w-[240px]">
                {!h.releasedAt && holdRelease && (
                  <ActionForm action={releaseHoldAction} submitLabel="Release" submitSize="sm" submitVariant="secondary" inline confirm="Releasing the hold allows the work or material to continue before the NCR is closed.">
                    <input type="hidden" name="holdId" value={h.id} />
                    <input type="hidden" name="ncrId" value={n.id} />
                    <input name="reason" required placeholder="Why can it be released?" aria-label="Release reason" className="field-input min-w-[160px] flex-1 py-1 text-[12.5px]" />
                  </ActionForm>
                )}
              </td>
            </tr>
          ))}
        </Table>
        {activeHolds.length > 0 && !holdRelease && <p className="mt-1 text-[12px] text-steel">Releasing NCR holds requires the quality hold-release permission.</p>}
      </Section>

      <Section title="Disposition">
        {n.disposition ? (
          <KeyValues
            items={[
              { label: "Disposition", value: DISPOSITION_INFO[n.disposition]?.label ?? n.disposition },
              { label: "Approved by", value: `${names.dispositionBy ?? ""} · ${fmtDateTime(n.dispositionAt)}` },
              { label: "Customer concession", value: n.customerConcessionRef },
              { label: "Rationale", value: n.dispositionNotes, wide: true },
            ]}
          />
        ) : (
          <p className="text-[13.5px] text-steel">No disposition approved yet.</p>
        )}
        {canDisposition && (
          <div className="mt-3">
            <Disclosure label={n.disposition ? "Change disposition" : "Approve disposition"} variant={n.disposition ? "secondary" : "primary"}>
              <ActionForm action={approveDispositionAction} submitLabel="Approve disposition">
                <input type="hidden" name="ncrId" value={n.id} />
                <DispositionFields hasJobLine={!!n.jobLineId} />
                <SignatureBlock meaning={`I approve the selected disposition for ${n.ref} (${fmtQty(n.qtyAffected)} affected).`} />
              </ActionForm>
            </Disclosure>
          </div>
        )}
      </Section>

      {(rework.length > 0 || reinspection) && (
        <Section title="Rework & reinspection">
          <Table head={["Operation", "Title", "Planned qty", "Status"]} empty="No rework operations.">
            {rework.map((o) => (
              <tr key={o.id}>
                <td><Link href={`/jobs/${o.jobId}?tab=route`} className="plate link">{o.opNumber}</Link></td>
                <td>{o.title}</td>
                <td className="plate">{fmtQty(o.plannedQty)}</td>
                <td><StatusBadge map={OP_STATUS} status={o.status} /></td>
              </tr>
            ))}
          </Table>
          <p className="mt-2 text-[13px]">
            Reinspection:{" "}
            {reinspection ? (
              <>
                <Ref href={`/quality/inspections/${reinspection.id}`} size="sm">{reinspection.ref}</Ref> <StatusBadge map={INSPECTION_STATUS} status={reinspection.status} />
              </>
            ) : (
              <span className="text-steel">Opens automatically when all rework operations are signed off{openRework.length ? ` (${openRework.length} still open)` : ""}.</span>
            )}
          </p>
        </Section>
      )}

      <Section title="Corrective actions" id="capa">
        {capas.length === 0 && <p className="mb-3 text-[13.5px] text-steel">No corrective action raised from this NCR.</p>}
        {capas.map((ca) => (
          <CapaCard key={ca.id} ca={ca} names={nameMap} canManage={can(ctx.actor, "capa.manage")} canVerify={can(ctx.actor, "capa.verify")} actorId={ctx.actor.userId} />
        ))}
        {canCapa && (
          <Disclosure label="Create corrective action">
            <ActionForm action={createCapaAction} submitLabel="Create corrective action" resetOnSuccess>
              <input type="hidden" name="ncrId" value={n.id} />
              <FormGrid>
                <TextField label="Title" name="title" required defaultValue={`${label(n.category)} — ${n.ref}`} className="sm:col-span-2" />
                <SelectField label="Owner" name="ownerId" placeholder="Unassigned" options={people.map((p) => ({ value: p.id, label: p.name }))} />
                <TextField label="Due date" name="dueDate" type="date" />
              </FormGrid>
              <TextArea label="Problem statement" name="problem" required rows={3} defaultValue={n.description} />
            </ActionForm>
          </Disclosure>
        )}
      </Section>

      {n.status === "closed" || n.status === "cancelled" ? (
        <Section title={n.status === "closed" ? "Closure" : "Cancellation"}>
          <KeyValues
            items={[
              { label: n.status === "closed" ? "Closed by" : "Cancelled by", value: `${names.closedBy ?? ""} · ${fmtDateTime(n.closedAt)}` },
              { label: "Notes", value: n.closureNotes, wide: true },
            ]}
          />
        </Section>
      ) : (
        (canClose || canCancel) && (
          <div className="mb-6 grid gap-6 xl:grid-cols-2">
            {canClose && (
              <Section title="Close NCR">
                <Panel className="p-4">
                  <ul className="mb-3 list-disc pl-5 text-[13px] text-steel">
                    <li>An approved disposition (other than &quot;awaiting investigation&quot;) is required.</li>
                    <li>For rework or repair: all rework operations complete and the reinspection passed.</li>
                    <li>Active holds raised by this NCR are released on closure (returned-to-supplier lots stay out of production). This requires the hold-release permission.</li>
                  </ul>
                  {(!n.disposition || n.disposition === "awaiting_investigation") && <Notice tone="warning">Not ready to close: no final disposition has been approved.</Notice>}
                  <ActionForm action={closeNcrAction} submitLabel="Close NCR" confirm="Closing the NCR releases its holds and makes the record read-only.">
                    <input type="hidden" name="ncrId" value={n.id} />
                    <TextArea label="Closure notes" name="notes" required rows={3} />
                  </ActionForm>
                </Panel>
              </Section>
            )}
            {canCancel && (
              <Section title="Cancel NCR">
                <Panel className="p-4">
                  <p className="mb-3 text-[13px] text-steel">Only possible before a disposition is approved — e.g. raised in error or a duplicate. Holds are not released automatically.</p>
                  <Disclosure label="Cancel this NCR" variant="ghost">
                    <ActionForm action={cancelNcrAction} submitLabel="Cancel NCR" submitVariant="danger" confirm="Cancelling marks the NCR as void. This cannot be undone.">
                      <input type="hidden" name="ncrId" value={n.id} />
                      <TextArea label="Reason" name="reason" required rows={2} />
                    </ActionForm>
                  </Disclosure>
                </Panel>
              </Section>
            )}
          </div>
        )
      )}

      <Section title="History">
        <AuditList events={history} />
      </Section>
    </>
  );
}
