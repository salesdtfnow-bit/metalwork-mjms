import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { can, canAny } from "@/server/context";
import { AppError } from "@/server/errors";
import { getInspection } from "@/server/services/inspections";
import { employeeName, inspectionExtras, instrumentOptions, qualityHistory } from "@/server/services/ui/quality";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { trimQty } from "@/lib/decimal";
import { INSPECTION_STATUS, NCR_STATUS } from "@/lib/status";
import { KeyValues, Notice, Panel, Ref, Section, Stat, StatusBadge, Table, TitleBlock } from "@/components/ui";
import { ActionForm, Disclosure, FileField, FormGrid, SelectField, SignatureBlock, TextArea, TextField } from "@/components/forms";
import { AuditList } from "@/components/AuditList";
import { ResultBadge, ResultsGrid, type GridChar } from "../../_components/ResultsGrid";
import { stageLabel } from "../../_components/labels";
import {
  addAdhocResultAction,
  addInspectionEvidenceAction,
  cancelInspectionAction,
  completeInspectionAction,
  recordResultsAction,
} from "../../actions";

export default async function InspectionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ncr?: string }> }) {
  const ctx = await requirePageCtx("quality.view", "quality.inspect", "materials.inspect");
  const { id } = await params;
  const sp = await searchParams;
  const data = await getInspection(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const insp = data.inspection;
  const [extras, instruments, setupName, history] = await Promise.all([
    inspectionExtras(ctx, insp),
    instrumentOptions(ctx),
    employeeName(ctx, insp.setupOperatorId),
    qualityHistory(ctx, "inspection", id),
  ]);

  const isOpen = ["open", "in_progress"].includes(insp.status);
  const canRecord = isOpen && canAny(ctx.actor, "quality.inspect", "quality.final_inspect", "materials.inspect");
  const canEvidence = isOpen && canAny(ctx.actor, "quality.inspect", "quality.final_inspect");
  const completePerm = insp.stage === "first_off" ? "quality.approve_first_off" : insp.stage === "final" ? "quality.final_inspect" : insp.stage === "incoming" ? "materials.inspect" : "quality.inspect";
  const canComplete = isOpen && can(ctx.actor, completePerm);
  const canCancel = isOpen && can(ctx.actor, "quality.inspect");
  const signed = insp.stage === "first_off" || insp.stage === "final";
  const stageText = stageLabel(insp.stage);
  const instName = (iid: string | null) => instruments.find((i) => i.id === iid)?.assetNo ?? "—";

  const chars: GridChar[] = data.grid.map((g) => ({
    id: g.characteristic.id,
    balloonNo: g.characteristic.balloonNo,
    name: g.characteristic.name,
    charType: g.characteristic.charType,
    specification: g.characteristic.specification,
    nominal: g.characteristic.nominal,
    tolMinus: g.characteristic.tolMinus,
    tolPlus: g.characteristic.tolPlus,
    unit: g.characteristic.unit,
    method: g.characteristic.method,
    instrumentType: g.characteristic.instrumentType,
    isCritical: g.characteristic.isCritical,
    evidenceRequired: g.characteristic.evidenceRequired,
    cells: g.cells.map((c) => ({
      sampleNo: c.sampleNo,
      result: c.result,
      measuredValue: c.row?.measuredValue ?? null,
      attributeResult: c.row?.attributeResult ?? null,
      instrumentId: c.row?.instrumentId ?? null,
      comment: c.row?.comment ?? null,
      underReview: c.row?.underReview ?? false,
    })),
  }));

  const highlightNcr = sp.ncr ? extras.ncrs.find((n) => n.id === sp.ncr) : null;

  return (
    <>
      <TitleBlock
        kind={`${stageText} inspection`}
        refNo={insp.ref}
        title={data.plan ? `${data.plan.code} v${data.plan.version} — ${data.plan.name}` : "Ad-hoc inspection (no plan)"}
        status={
          <>
            <StatusBadge map={INSPECTION_STATUS} status={insp.status} />
            {insp.stage === "first_off" && isOpen && <span className="text-[12.5px] font-medium text-red">Production on this operation is blocked until first-off is approved.</span>}
          </>
        }
        cells={[
          { label: "Job", value: data.job ? <Link href={`/jobs/${data.job.id}`} className="plate link">{data.job.jobNumber}</Link> : null },
          { label: "Line / part", value: data.line ? `${data.line.lineNo} · ${data.line.partNumber}` : null },
          { label: "Operation", value: data.operation ? <Link href={`/jobs/${data.operation.jobId}?tab=route`} className="link">{data.operation.opNumber} {data.operation.title}</Link> : null },
          { label: "Lot / heat", value: data.lot ? <Link href={`/materials/lots/${data.lot.id}`} className="plate link">{data.lot.lotNo} · {data.lot.heatNumber}</Link> : null },
          { label: "Drawing rev", value: data.drawing ? `Rev ${data.drawing.revision}` : null },
          { label: "Program rev", value: extras.program },
          { label: "Machine", value: data.machine ? `${data.machine.code} ${data.machine.name}` : null },
          { label: "Setup operator", value: setupName },
          { label: "Inspector", value: data.inspectorName },
          { label: "Sample qty", value: insp.sampleQty ? fmtQty(insp.sampleQty) : null },
          { label: "Requested", value: fmtDateTime(insp.requestedAt) },
          { label: "Completed", value: insp.completedAt ? fmtDateTime(insp.completedAt) : null },
        ]}
      />

      {highlightNcr && (
        <Notice tone="danger" title={`Non-conformance ${highlightNcr.ref} raised`}>
          The inspection failed or rejected parts, so an NCR was raised automatically and the operation / lot / batch was placed on hold.{" "}
          {can(ctx.actor, "ncr.view") && <Link href={`/ncr/${highlightNcr.id}`} className="link font-semibold">Open {highlightNcr.ref}</Link>}
        </Notice>
      )}
      {extras.ncrs.length > 0 && !highlightNcr && (
        <Notice tone="warning" title="Linked non-conformances">
          {extras.ncrs.map((n) => (
            <span key={n.id} className="mr-3 inline-flex items-center gap-1.5">
              {can(ctx.actor, "ncr.view") ? <Ref href={`/ncr/${n.id}`} size="sm">{n.ref}</Ref> : <Ref size="sm">{n.ref}</Ref>}
              <StatusBadge map={NCR_STATUS} status={n.status} />
            </span>
          ))}
        </Notice>
      )}
      {isOpen && extras.independenceWarning && (
        <Notice tone="warning" title="Independent inspector required">
          {extras.independenceWarning} The system will refuse to save results or a decision from you.
        </Notice>
      )}

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
        <Stat label="Results expected" value={data.total} />
        <Stat label="Missing" value={data.missing} tone={data.missing ? "warning" : "success"} sub="Missing is never a pass" />
        <Stat label="Out of tolerance / failed" value={data.failed} tone={data.failed ? "danger" : "success"} />
        <Stat label="Evidence files" value={data.evidence.length} tone={data.needEvidence ? "danger" : undefined} sub={data.needEvidence ? "Required evidence missing" : undefined} />
        <Stat label="Can pass" value={data.canPass ? "Yes" : "No"} tone={data.canPass ? "success" : "warning"} />
      </div>

      <Section title="Context">
        <KeyValues
          cols={4}
          items={[
            { label: "Plan", value: data.plan ? <Link href={`/quality/plans/${data.plan.id}`} className="link">{data.plan.code} v{data.plan.version}</Link> : "No plan" },
            { label: "Requested by", value: extras.requestedBy },
            { label: "Part", value: data.line ? `${data.line.partNumber} — ${data.line.description}` : null },
            { label: "Line quantity", value: data.line ? fmtQty(data.line.quantity) : null },
            { label: "Qty inspected", value: insp.qtyInspected ? fmtQty(insp.qtyInspected) : null },
            { label: "Qty accepted", value: insp.qtyAccepted ? fmtQty(insp.qtyAccepted) : null },
            { label: "Qty rejected", value: insp.qtyRejected ? fmtQty(insp.qtyRejected) : null },
            { label: "Decision", value: insp.result ? <ResultBadge result={insp.result} /> : null },
            { label: "Notes", value: insp.notes, wide: true },
          ]}
        />
      </Section>

      <Section title="Results" actions={<span className="text-[12px] text-steel">Type a value to record it, or retype to correct it while the inspection is open. Blank cells stay missing.</span>}>
        {chars.length === 0 ? (
          <p className="text-[13.5px] text-steel">This inspection has no plan, so there is no characteristic grid. Record ad-hoc pass/fail results below.</p>
        ) : canRecord ? (
          <ActionForm action={recordResultsAction} submitLabel="Save results">
            <input type="hidden" name="inspectionId" value={id} />
            <ResultsGrid chars={chars} instruments={instruments} editable />
          </ActionForm>
        ) : (
          <ResultsGrid chars={chars} instruments={instruments} editable={false} />
        )}
      </Section>

      <Section title="Ad-hoc results" actions={<span className="text-[12px] text-steel">Checks outside the plan — always with a comment.</span>}>
        <Table head={["Result", "Value", "Instrument", "Comment", "Recorded"]} empty="No ad-hoc results.">
          {data.adhoc.map((r) => (
            <tr key={r.id}>
              <td><ResultBadge result={r.result} /></td>
              <td className="plate">{r.measuredValue ? trimQty(r.measuredValue) : "—"}</td>
              <td className="plate">{instName(r.instrumentId)}</td>
              <td className="whitespace-pre-wrap">{r.comment ?? ""}</td>
              <td className="whitespace-nowrap text-steel">{fmtDateTime(r.recordedAt)}</td>
            </tr>
          ))}
        </Table>
        {canRecord && (
          <div className="mt-3">
            <Disclosure label="Add ad-hoc result">
              <ActionForm action={addAdhocResultAction} submitLabel="Add result" resetOnSuccess>
                <input type="hidden" name="inspectionId" value={id} />
                <FormGrid cols={3}>
                  <SelectField label="Result" name="attributeResult" required placeholder="Select…" options={[{ value: "pass", label: "Pass" }, { value: "fail", label: "Fail" }]} />
                  <TextField label="Measured value (optional)" name="measuredValue" inputMode="decimal" />
                  <SelectField
                    label="Instrument (optional)"
                    name="instrumentId"
                    placeholder="None"
                    options={instruments.filter((i) => i.ok).map((i) => ({ value: i.id, label: `${i.assetNo} · ${i.description}` }))}
                  />
                </FormGrid>
                <TextArea label="What was checked" name="comment" required rows={2} />
              </ActionForm>
            </Disclosure>
          </div>
        )}
      </Section>

      <Section title="Evidence">
        <Table head={["File", "Caption", "Uploaded"]} empty={data.needEvidence ? "Evidence is required by this plan and none is attached yet." : "No evidence attached."}>
          {data.evidence.map(({ e, f }) => (
            <tr key={e.id}>
              <td><a className="link" href={`/api/files/${f.id}`}>{f.originalName}</a></td>
              <td>{e.caption ?? ""}</td>
              <td className="text-steel">{fmtDateTime(e.createdAt)}</td>
            </tr>
          ))}
        </Table>
        {canEvidence && (
          <div className="mt-3">
            <Disclosure label="Attach evidence">
              <ActionForm action={addInspectionEvidenceAction} submitLabel="Upload" resetOnSuccess>
                <input type="hidden" name="inspectionId" value={id} />
                <FileField label="File" name="file" required hint="Photo, CMM report, gauge print-out…" />
                <TextField label="Caption" name="caption" />
              </ActionForm>
            </Disclosure>
          </div>
        )}
      </Section>

      {canComplete && (
        <Section title="Complete inspection">
          <Panel className="max-w-3xl p-4">
            {!data.canPass && (
              <Notice tone="warning" title="This inspection cannot pass yet">
                {[data.total === 0 && "no results recorded", data.missing > 0 && `${data.missing} measurement(s) missing`, data.failed > 0 && `${data.failed} out of tolerance`, data.needEvidence && "required evidence not attached"].filter(Boolean).join(", ")}. You can still record a fail.
              </Notice>
            )}
            <p className="mb-3 text-[13px] text-steel">
              A <strong className="text-ink">fail</strong> (or any rejected quantity) automatically raises a non-conformance report and places the operation, batch or lot on hold.
            </p>
            <ActionForm action={completeInspectionAction} submitLabel="Record decision" confirm="The decision is final for this inspection record and will be written to the audit trail.">
              <input type="hidden" name="inspectionId" value={id} />
              <FormGrid cols={4}>
                <SelectField label="Decision" name="decision" required placeholder="Select…" options={[{ value: "pass", label: "Pass — conforms" }, { value: "fail", label: "Fail — does not conform" }]} />
                <TextField label="Qty inspected" name="qtyInspected" inputMode="decimal" required={insp.stage === "final"} defaultValue={insp.sampleQty ? trimQty(insp.sampleQty) : undefined} />
                <TextField label="Qty accepted" name="qtyAccepted" inputMode="decimal" required={insp.stage === "final"} hint={insp.stage === "final" ? "Added to the line's accepted quantity" : undefined} />
                <TextField label="Qty rejected" name="qtyRejected" inputMode="decimal" required={insp.stage === "final"} hint="Rejected parts raise an NCR" />
              </FormGrid>
              <TextArea label="Notes" name="notes" rows={2} hint="Required for a fail when no characteristic is out of tolerance." />
              {signed && <SignatureBlock meaning={`I confirm ${insp.stage === "first_off" ? "first-off" : "final"} inspection ${insp.ref} meets the drawing and specification requirements (for a pass), or record its rejection (for a fail).`} />}
            </ActionForm>
          </Panel>
        </Section>
      )}
      {isOpen && !canComplete && (
        <Notice tone="info">Recording the decision for a {stageText.toLowerCase()} inspection needs the {completePerm} permission. Ask an authorised inspector to complete it.</Notice>
      )}

      {canCancel && (
        <div className="my-6">
          <Disclosure label="Cancel inspection" variant="ghost">
            <ActionForm action={cancelInspectionAction} submitLabel="Cancel inspection" submitVariant="danger" confirm="Cancelling closes this inspection without a decision. Recorded results remain in the audit trail.">
              <input type="hidden" name="inspectionId" value={id} />
              <TextArea label="Reason" name="reason" required rows={2} />
            </ActionForm>
          </Disclosure>
        </div>
      )}

      <Section title="History">
        <AuditList events={history} />
      </Section>
    </>
  );
}
