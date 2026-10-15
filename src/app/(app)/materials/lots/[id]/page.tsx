import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { can, canAny } from "@/server/context";
import { AppError } from "@/server/errors";
import { getLot } from "@/server/services/materials";
import { jobOptions, lotHistory, userNames } from "@/server/services/ui/materials";
import { d, sum } from "@/lib/decimal";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/format";
import { LOT_STATUS, SYNC_STATUS } from "@/lib/status";
import { Badge, KeyValues, Notice, Ref, Section, StatusBadge, Table, TitleBlock } from "@/components/ui";
import { ActionForm, Disclosure, FileField, FormGrid, SelectField, SignatureBlock, TextArea, TextField } from "@/components/forms";
import { AuditList } from "@/components/AuditList";
import { CheckList, LifecycleStrip, SyncCell, type Stage } from "../../_components/Lifecycle";
import { CERT_STATUS, CERT_TYPE_OPTIONS, SYNC_KIND, TX_KIND, UUID_RE, certReqLabel, certTypeLabel, syncDone } from "../../_components/labels";
import {
  addCertificateAction,
  allocateLotAction,
  cancelAllocationAction,
  inspectLotAction,
  quarantineLotAction,
  rejectLotAction,
  releaseLotAction,
  verifyCertificateAction,
} from "../../actions";

export const metadata = { title: "Material lot" };

const ALLOC_STATUS = {
  active: { label: "Active", tone: "info" },
  fully_issued: { label: "Fully issued", tone: "success" },
  cancelled: { label: "Cancelled", tone: "muted" },
} as const;

export default async function LotPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageCtx("materials.view");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const data = await getLot(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const { lot, supplier, spec, receipt, po, pol, item, certificates, allocations, transactions, releaseChecks, releaseReady, stockIn } = data;

  const canInspect = can(ctx.actor, "materials.inspect");
  const canQuarantine = canAny(ctx.actor, "materials.inspect", "ncr.manage");
  const canRelease = can(ctx.actor, "materials.release");
  const canAllocate = can(ctx.actor, "materials.allocate");
  const canUploadCert = canAny(ctx.actor, "materials.receive", "materials.inspect");

  const [names, history, jobs] = await Promise.all([
    userNames(ctx, [receipt.receivedBy, lot.inspectedBy, lot.releasedBy, po.createdBy, ...certificates.map((c) => c.c.verifiedBy), ...allocations.map((a) => a.a.allocatedBy)]),
    lotHistory(ctx, id),
    canAllocate && lot.status === "released" ? jobOptions(ctx) : Promise.resolve([]),
  ]);
  const who = (uid: string | null | undefined) => (uid ? (names.get(uid) ?? "Unknown user") : "—");

  const terminal = ["rejected", "returned", "consumed"].includes(lot.status);
  const activeAllocs = allocations.filter((a) => a.a.status !== "cancelled");
  const allocated = sum(activeAllocs.map((a) => a.a.quantity));
  const unallocated = d(lot.qtyReceived).minus(allocated);
  const txSum = (k: string) => sum(transactions.filter((t) => t.t.kind === k).map((t) => t.t.quantity));
  const issued = txSum("issue");
  const lastTx = (kinds: string[]) => [...transactions].reverse().find((t) => kinds.includes(t.t.kind));
  const verifiedCert = certificates.find((c) => c.c.verificationResult === "accepted");
  const inspectionOk = lot.inspectionResult === "pass";
  const certOk = ["verified", "not_required"].includes(lot.certificateStatus);

  const stages: Stage[] = [
    { label: "Ordered", state: "done", detail: <>{po.ref} · {fmtDate(po.orderDate)}{po.sentAt ? ` · sent ${fmtDate(po.sentAt)}` : ""}</> },
    { label: "Received", state: "done", detail: <>{receipt.ref} · {fmtDateTime(receipt.receivedAt)} · {who(receipt.receivedBy)}</> },
    !lot.stockInSyncId
      ? { label: "Recorded in BoxHero", state: "na", detail: "Not tracked in BoxHero (no item linked)" }
      : syncDone(stockIn)
        ? { label: "Recorded in BoxHero", state: "done", detail: <>{stockIn?.boxheroTxId ?? "—"} · {fmtDateTime(stockIn?.confirmedAt)}{stockIn?.status === "manual_confirmed" ? " · manual" : ""}</> }
        : { label: "Recorded in BoxHero", state: stockIn && ["failed", "needs_reconciliation"].includes(stockIn.status) ? "problem" : "pending", detail: <>Stock-in {SYNC_STATUS[stockIn?.status as keyof typeof SYNC_STATUS]?.label.toLowerCase() ?? "missing"}</> },
    {
      label: "Inspected & certificate verified",
      state: lot.inspectionResult === "fail" || lot.certificateStatus === "rejected" ? "problem" : inspectionOk && certOk ? "done" : "pending",
      detail: (
        <>
          Inspection: {lot.inspectionResult ? `${lot.inspectionResult === "pass" ? "passed" : "failed"} · ${who(lot.inspectedBy)} · ${fmtDateTime(lot.inspectedAt)}` : "not done"}
          <br />
          Certificate: {lot.certificateStatus === "not_required" ? "not required" : verifiedCert ? `verified · ${who(verifiedCert.c.verifiedBy)} · ${fmtDateTime(verifiedCert.c.verifiedAt)}` : (CERT_STATUS[lot.certificateStatus]?.label.toLowerCase() ?? lot.certificateStatus)}
        </>
      ),
    },
    lot.releasedAt
      ? { label: "Released", state: "done", detail: <>{who(lot.releasedBy)} · {fmtDateTime(lot.releasedAt)} · signed</> }
      : { label: "Released", state: lot.status === "rejected" ? "problem" : "pending", detail: lot.status === "rejected" ? "Rejected — will not be released" : "Not released — cannot be used" },
    activeAllocs.length
      ? { label: "Allocated", state: "done", detail: <>{fmtQty(allocated, lot.uom)} to {[...new Set(activeAllocs.map((a) => a.job))].join(", ")}</> }
      : { label: "Allocated", state: "pending" },
    issued.greaterThan(0)
      ? { label: "Issued", state: "done", detail: <>{fmtQty(issued.minus(txSum("return")), lot.uom)} net · last {fmtDateTime(lastTx(["issue"])?.t.performedAt)} · {lastTx(["issue"])?.by ?? "—"}</> }
      : { label: "Issued", state: "pending" },
    ["consume", "remnant", "return", "scrap"].some((k) => txSum(k).greaterThan(0))
      ? {
          label: "Consumed / Remnant / Returned",
          state: "done",
          detail: (
            <>
              Consumed {fmtQty(txSum("consume"))} · remnant {fmtQty(txSum("remnant"))} · returned {fmtQty(txSum("return"))}
              {txSum("scrap").greaterThan(0) ? ` · scrapped ${fmtQty(txSum("scrap"))}` : ""}
            </>
          ),
        }
      : { label: "Consumed / Remnant / Returned", state: "pending" },
  ];

  return (
    <>
      <TitleBlock
        kind="Material lot"
        refNo={lot.lotNo}
        title={spec ? `${spec.code} — ${spec.grade}${lot.dimensions ? ` · ${lot.dimensions}` : ""}` : `${pol.description}${lot.dimensions ? ` · ${lot.dimensions}` : ""}`}
        status={
          <>
            <StatusBadge map={LOT_STATUS} status={lot.status} />
            <StatusBadge map={CERT_STATUS} status={lot.certificateStatus} />
            {lot.status !== "released" && !terminal && <Badge tone="warning">Not available for production</Badge>}
          </>
        }
        cells={[
          { label: "Heat / cast no", value: <span className="plate">{lot.heatNumber}</span> },
          { label: "Supplier", value: supplier.name },
          { label: "Purchase order", value: <Link href={`/purchasing/${po.id}`} className="link">{po.ref} / line {pol.lineNo}</Link> },
          { label: "GRN / delivery note", value: `${receipt.ref}${receipt.deliveryNoteNo ? ` / ${receipt.deliveryNoteNo}` : ""}` },
          { label: "Quantity received", value: fmtQty(lot.qtyReceived, lot.uom) },
          { label: "BoxHero item", value: item ? `${item.name}${item.sku ? ` (${item.sku})` : ""}` : "Not tracked" },
        ]}
      />
      <LifecycleStrip stages={stages} />
      {lot.status === "quarantined" && lot.quarantineReason && (
        <Notice tone="warning" title="Quarantined">
          {lot.quarantineReason}
        </Notice>
      )}
      {lot.status === "rejected" && (
        <Notice tone="danger" title="Rejected — do not use">
          {lot.quarantineReason ?? "This lot has been rejected."}
        </Notice>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Release checks" id="release">
          <CheckList checks={releaseChecks} failLinks={{ hold: <Link href="/ncr?tab=holds" className="link">Review holds</Link> }} />
          <p className="mt-2 text-[13px]">
            {lot.status === "released" ? (
              <Badge tone="success">Released for production</Badge>
            ) : releaseReady ? (
              <Badge tone="info">All checks passed — ready for signed release</Badge>
            ) : (
              <Badge tone="warning">Not ready for release</Badge>
            )}
          </p>
          <div className="mt-3 flex flex-wrap items-start gap-2">
            {canInspect && ["received", "awaiting_inspection", "quarantined"].includes(lot.status) && (
              <Disclosure label={lot.inspectionResult ? "Re-inspect" : "Record inspection"} variant="primary">
                <ActionForm action={inspectLotAction} submitLabel="Record inspection">
                  <input type="hidden" name="lotId" value={lot.id} />
                  <SelectField
                    label="Result"
                    name="result"
                    required
                    placeholder="Select…"
                    options={[
                      { value: "pass", label: "Pass — conforms to order and specification" },
                      { value: "fail", label: "Fail — quarantine the lot" },
                    ]}
                  />
                  <TextArea label="Notes" name="notes" rows={2} hint="Required when the inspection fails." />
                </ActionForm>
              </Disclosure>
            )}
            {canRelease && !terminal && lot.status !== "released" && releaseReady && (
              <Disclosure label="Release lot" variant="primary">
                <ActionForm action={releaseLotAction} submitLabel="Sign and release">
                  <input type="hidden" name="lotId" value={lot.id} />
                  <SignatureBlock meaning={`I release material lot ${lot.lotNo} (heat ${lot.heatNumber}) for production: inspection passed and certification verified.`} />
                  <TextArea label="Comment" name="comment" rows={2} />
                </ActionForm>
              </Disclosure>
            )}
            {canQuarantine && !terminal && lot.status !== "quarantined" && (
              <Disclosure label="Quarantine">
                <ActionForm action={quarantineLotAction} submitLabel="Quarantine lot" submitVariant="danger" confirm="The lot will be placed on hold and cannot be released or issued until the hold is cleared.">
                  <input type="hidden" name="lotId" value={lot.id} />
                  <TextArea label="Reason" name="reason" rows={2} required />
                </ActionForm>
              </Disclosure>
            )}
            {canRelease && !terminal && (
              <Disclosure label="Reject lot" variant="ghost">
                <ActionForm action={rejectLotAction} submitLabel="Reject lot" submitVariant="danger" confirm="Rejecting the lot means it must not be used. Active allocations must be cancelled first.">
                  <input type="hidden" name="lotId" value={lot.id} />
                  <TextArea label="Reason" name="reason" rows={2} required />
                </ActionForm>
              </Disclosure>
            )}
          </div>
          {canRelease && !terminal && lot.status !== "released" && !releaseReady && (
            <p className="mt-2 text-[12.5px] text-steel">Release is available once every check above is met.</p>
          )}
        </Section>

        <Section title="Lot details">
          <KeyValues
            cols={2}
            items={[
              { label: "Specification", value: spec ? `${spec.code} — ${spec.grade}${spec.standard ? ` (${spec.standard})` : ""}` : "None" },
              { label: "Certificate requirement", value: certReqLabel(pol.certRequirement ?? spec?.certRequirement) },
              { label: "Form / dimensions", value: [lot.form, lot.dimensions].filter(Boolean).join(" · ") },
              { label: "Supplier batch no", value: lot.supplierBatchNo },
              { label: "Storage location", value: lot.storageLocation },
              { label: "BoxHero location", value: lot.boxheroLocationId },
              { label: "Allocated / unallocated", value: `${fmtQty(allocated, lot.uom)} / ${fmtQty(unallocated, lot.uom)}` },
              { label: "PO line", value: `${pol.description}${pol.dimensions ? ` · ${pol.dimensions}` : ""}` },
              { label: "Notes", value: lot.notes, wide: true },
            ]}
          />
        </Section>
      </div>

      <Section title="Certificates" id="certificates">
        <Table head={["File", "Type", "Cert no", "Heat no", "Issued by", "Verification", "Verified by / at", ""]} empty="No certificate uploaded yet.">
          {certificates.map(({ c, f }) => (
            <tr key={c.id}>
              <td>
                <a className="link" href={`/api/files/${f.id}`}>
                  {f.originalName}
                </a>
              </td>
              <td>{certTypeLabel(c.certType)}</td>
              <td>{c.certNumber ?? "—"}</td>
              <td className="plate text-[13px]">
                {c.heatNumber ?? "—"}
                {c.heatNumber && c.heatNumber.trim().toUpperCase() !== lot.heatNumber.trim().toUpperCase() && (
                  <Badge tone="danger" className="ml-1">
                    Does not match lot
                  </Badge>
                )}
              </td>
              <td>{c.issuedBy ?? "—"}</td>
              <td>
                {c.verificationResult === "accepted" ? <Badge tone="success">Accepted</Badge> : c.verificationResult === "rejected" ? <Badge tone="danger">Rejected</Badge> : <Badge tone="warning">Not verified</Badge>}
                {c.verificationNotes && <span className="mt-0.5 block max-w-[260px] whitespace-pre-wrap text-[12px] text-steel">{c.verificationNotes}</span>}
              </td>
              <td className="whitespace-nowrap text-steel">{c.verifiedAt ? `${who(c.verifiedBy)} · ${fmtDateTime(c.verifiedAt)}` : "—"}</td>
              <td>
                {canInspect && (
                  <Disclosure label={c.verificationResult ? "Re-verify" : "Verify"} variant={c.verificationResult ? "ghost" : "primary"}>
                    <ActionForm action={verifyCertificateAction} submitLabel="Record verification">
                      <input type="hidden" name="lotId" value={lot.id} />
                      <input type="hidden" name="certificateId" value={c.id} />
                      <p className="text-[12.5px] text-steel">Check the heat number, grade, standard and test results against the order and lot {lot.lotNo} (heat {lot.heatNumber}).</p>
                      <SelectField
                        label="Result"
                        name="result"
                        required
                        placeholder="Select…"
                        options={[
                          { value: "accepted", label: "Accepted — certificate conforms" },
                          { value: "rejected", label: "Rejected" },
                        ]}
                      />
                      <TextArea label="Notes" name="notes" rows={2} hint="Required when rejecting." />
                    </ActionForm>
                  </Disclosure>
                )}
              </td>
            </tr>
          ))}
        </Table>
        {canUploadCert && !terminal && (
          <div className="mt-3">
            <Disclosure label="Upload certificate">
              <ActionForm action={addCertificateAction} submitLabel="Upload certificate" resetOnSuccess>
                <input type="hidden" name="lotIds" value={lot.id} />
                <FormGrid cols={4}>
                  <SelectField label="Certificate type" name="certType" required options={CERT_TYPE_OPTIONS} defaultValue={pol.certRequirement && pol.certRequirement !== "none" ? pol.certRequirement : "3.1"} />
                  <TextField label="Certificate number" name="certNumber" />
                  <TextField label="Heat / cast number on certificate" name="heatNumber" defaultValue={lot.heatNumber} hint="Must match the lot to be accepted." />
                  <TextField label="Issued by" name="issuedBy" defaultValue={supplier.name} />
                </FormGrid>
                <FileField label="Certificate file" name="file" required accept=".pdf,image/*" />
              </ActionForm>
            </Disclosure>
          </div>
        )}
      </Section>

      <Section title="Allocations">
        <Table head={["Job", "Quantity", "Status", "Allocated", "By", "Cancel reason", ""]} empty="Not allocated to any job.">
          {allocations.map(({ a, job }) => (
            <tr key={a.id}>
              <td>
                <Ref href={`/jobs/${a.jobId}`} size="sm">
                  {job}
                </Ref>
              </td>
              <td className="whitespace-nowrap">{fmtQty(a.quantity, lot.uom)}</td>
              <td>
                <StatusBadge map={ALLOC_STATUS} status={a.status} />
              </td>
              <td className="whitespace-nowrap text-steel">{fmtDateTime(a.allocatedAt)}</td>
              <td>{who(a.allocatedBy)}</td>
              <td className="text-steel">{a.cancelReason ?? ""}</td>
              <td>
                {canAllocate && a.status === "active" && (
                  <Disclosure label="Cancel" variant="ghost">
                    <ActionForm action={cancelAllocationAction} submitLabel="Cancel allocation" submitVariant="danger" confirm="The quantity will return to the lot's unallocated balance.">
                      <input type="hidden" name="lotId" value={lot.id} />
                      <input type="hidden" name="allocationId" value={a.id} />
                      <TextArea label="Reason" name="reason" rows={2} required />
                    </ActionForm>
                  </Disclosure>
                )}
              </td>
            </tr>
          ))}
        </Table>
        {canAllocate && (
          <div className="mt-3">
            {lot.status !== "released" ? (
              <p className="text-[13px] text-steel">Only released material can be allocated. This lot is {LOT_STATUS[lot.status as keyof typeof LOT_STATUS]?.label.toLowerCase() ?? lot.status}.</p>
            ) : unallocated.lessThanOrEqualTo(0) ? (
              <p className="text-[13px] text-steel">The whole lot is allocated.</p>
            ) : (
              <Disclosure label="Allocate to job">
                <ActionForm action={allocateLotAction} submitLabel="Allocate" resetOnSuccess>
                  <input type="hidden" name="lotId" value={lot.id} />
                  <FormGrid cols={2}>
                    <SelectField label="Job" name="jobId" required placeholder="Select an open job…" options={jobs.map((j) => ({ value: j.id, label: `${j.jobNumber} — ${j.title} (${j.customer})` }))} />
                    <TextField label={`Quantity (${lot.uom})`} name="quantity" required inputMode="decimal" hint={`${fmtQty(unallocated, lot.uom)} unallocated`} />
                  </FormGrid>
                </ActionForm>
              </Disclosure>
            )}
          </div>
        )}
      </Section>

      <Section title="Transactions">
        <p className="mb-2 text-[12.5px] text-steel">Issue, consumption, remnants, returns and scrap are recorded against the job in production. Issues and returns create BoxHero movements when the lot is tracked.</p>
        <Table head={["Ref", "Event", "Job", "Quantity", "By", "When", "Reason", "BoxHero"]} empty="No material transactions yet.">
          {transactions.map(({ t, job, by, sync }) => (
            <tr key={t.id}>
              <td className="plate text-[13px]">{t.ref}</td>
              <td>{TX_KIND[t.kind] ?? t.kind}</td>
              <td>{t.jobId && job ? <Ref href={`/jobs/${t.jobId}`} size="sm">{job}</Ref> : "—"}</td>
              <td className="whitespace-nowrap">{fmtQty(t.quantity, t.uom)}</td>
              <td>{by ?? "—"}</td>
              <td className="whitespace-nowrap text-steel">{fmtDateTime(t.performedAt)}</td>
              <td className="text-steel">{t.reason ?? ""}</td>
              <td>{sync ? <StatusBadge map={SYNC_STATUS} status={sync.status} /> : ["consume", "remnant", "scrap"].includes(t.kind) ? <span className="text-[12px] text-steel">Record only</span> : <SyncCell sync={null} />}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="BoxHero stock-in" actions={stockIn && !syncDone(stockIn) && can(ctx.actor, "boxhero.view") ? <Link href="/materials?tab=boxhero" className="link text-[13px]">Resolve on the BoxHero tab</Link> : undefined}>
        {stockIn ? (
          <KeyValues
            cols={4}
            items={[
              { label: "Status", value: <StatusBadge map={SYNC_STATUS} status={stockIn.status} /> },
              { label: "Kind", value: SYNC_KIND[stockIn.kind] ?? stockIn.kind },
              { label: "Quantity", value: fmtQty(stockIn.quantity, lot.uom) },
              { label: "BoxHero transaction", value: stockIn.boxheroTxId },
              { label: "Mode", value: stockIn.mode === "simulated" ? "SIMULATED — no real stock changed" : stockIn.mode },
              { label: "Attempts", value: stockIn.attempts },
              { label: "Queued", value: fmtDateTime(stockIn.createdAt) },
              { label: "Confirmed", value: fmtDateTime(stockIn.confirmedAt) },
              { label: "Idempotency key", value: <span className="break-all font-mono text-[12px]">{stockIn.idempotencyKey}</span>, wide: true },
              { label: "Last error", value: stockIn.lastError, wide: true },
            ]}
          />
        ) : (
          <p className="text-[13px] text-steel">No BoxHero item was linked when this lot was received, so no stock-in was queued. The lot is not tracked in BoxHero.</p>
        )}
      </Section>

      <Section title="History">
        <AuditList events={history} />
      </Section>
    </>
  );
}
