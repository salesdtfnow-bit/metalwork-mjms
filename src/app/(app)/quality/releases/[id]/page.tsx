import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { can, canAny } from "@/server/context";
import { AppError } from "@/server/errors";
import { getRelease } from "@/server/services/release";
import { qualityHistory } from "@/server/services/ui/quality";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { d, trimQty } from "@/lib/decimal";
import { JOB_STATUS } from "@/lib/status";
import { Badge, buttonClass, KeyValues, LinkButton, Notice, Panel, Section, StatusBadge, Table, TitleBlock } from "@/components/ui";
import { ActionForm, Disclosure, FormGrid, SignatureBlock, TextArea, TextField } from "@/components/forms";
import { AuditList } from "@/components/AuditList";
import { RELEASE_STATUS } from "../../_components/labels";
import { approveReleaseAction, checkReleaseItemAction, rejectReleaseAction } from "../../actions";

function ItemStatus({ status }: { status: string }) {
  if (status === "pass") return <Badge tone="success">✓ Confirmed</Badge>;
  if (status === "fail") return <Badge tone="danger">✗ Failed</Badge>;
  if (status === "na") return <Badge tone="muted">N/A</Badge>;
  return <Badge tone="warning">Pending</Badge>;
}

export default async function ReleasePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageCtx("quality.view", "quality.release");
  const { id } = await params;
  const data = await getRelease(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const { release: rel, items, system, line, job, decidedBy } = data;
  const history = await qualityHistory(ctx, "final_release", id);
  const draft = rel.status === "draft";
  const canCheck = draft && canAny(ctx.actor, "quality.release", "quality.final_inspect");
  const canDecide = draft && can(ctx.actor, "quality.release");
  const checklist = items.filter((x) => x.i.source !== "system");
  const recordedSystem = items.filter((x) => x.i.source === "system");
  const failingSystem = system.filter((c) => !c.ok);
  const unticked = checklist.filter((x) => x.i.required && x.i.status !== "pass");
  const releasable = d(line.qtyAccepted).minus(d(line.qtyReleased));
  const blocked = failingSystem.length > 0 || unticked.length > 0;

  return (
    <>
      <TitleBlock
        kind="Final quality release"
        refNo={`${job.jobNumber} / ${line.lineNo}`}
        title={`${line.partNumber} — ${line.description}`}
        status={
          <>
            <StatusBadge map={RELEASE_STATUS} status={rel.status} />
            <StatusBadge map={JOB_STATUS} status={job.status} />
          </>
        }
        cells={[
          { label: "Job", value: <Link href={`/jobs/${job.id}`} className="plate link">{job.jobNumber}</Link> },
          { label: "Line quantity", value: fmtQty(line.quantity) },
          { label: "Accepted at final", value: fmtQty(line.qtyAccepted) },
          { label: "Already released", value: fmtQty(line.qtyReleased) },
          { label: "Releasable now", value: draft ? fmtQty(releasable.toString()) : "—" },
          { label: "Prepared", value: fmtDateTime(rel.createdAt) },
        ]}
        actions={
          <>
            <LinkButton href={`/jobs/${job.id}?tab=history`} size="sm">Full job history</LinkButton>
            <LinkButton href={`/traceability?q=${encodeURIComponent(job.jobNumber)}`} size="sm">Traceability</LinkButton>
          </>
        }
      />

      {!draft && (
        <Notice tone={rel.status === "approved" ? "success" : "danger"} title={rel.status === "approved" ? `Released: ${fmtQty(rel.qtyReleased)} part(s)` : "Release rejected"}>
          Decided by {decidedBy ?? "—"} on {fmtDateTime(rel.decidedAt)}.
          {rel.comments && <span className="mt-1 block whitespace-pre-wrap">{rel.comments}</span>}
          {rel.cocFileId && (
            <span className="mt-1 block">
              <a href={`/api/files/${rel.cocFileId}`} className="link font-semibold">Certificate of Conformity (PDF)</a>
            </span>
          )}
        </Notice>
      )}

      {draft && (
        <Notice tone="info" title="Review the complete history before releasing">
          Open the <Link href={`/jobs/${job.id}?tab=history`} className="link font-semibold">job history</Link> and the{" "}
          <Link href={`/traceability?q=${encodeURIComponent(job.jobNumber)}`} className="link font-semibold">traceability record</Link> (material lots, certificates, programs, inspections, NCRs, operators) before signing. Every system check below must pass and every required checklist item must be confirmed.
        </Notice>
      )}

      <Section title="System checks">
        {draft ? (
          <Table head={["", "Check", "Detail"]}>
            {system.map((c) => (
              <tr key={c.key} className={c.ok ? undefined : "bg-red-50/60"}>
                <td className="w-10 text-center text-[16px] font-bold">{c.ok ? <span className="text-green" aria-label="Pass">✓</span> : <span className="text-red" aria-label="Fail">✗</span>}</td>
                <td className="font-medium">{c.label}</td>
                <td className="text-steel">{c.detail}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Table head={["", "Check (recorded at decision)", "Detail"]} empty="System checks are recorded when the release is approved.">
            {recordedSystem.map(({ i }) => (
              <tr key={i.id}>
                <td className="w-10 text-center text-[16px] font-bold">{i.status === "pass" ? <span className="text-green">✓</span> : <span className="text-red">✗</span>}</td>
                <td className="font-medium">{i.label}</td>
                <td className="text-steel">{i.detail}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Release checklist" actions={<span className="text-[12px] text-steel">Company template items and this customer&apos;s requirements. Required items cannot be marked not applicable.</span>}>
        <Table head={["Item", "Required", "Status", "Checked", canCheck ? "Record" : ""]} empty="No checklist items (no active template items or customer requirements).">
          {checklist.map(({ i, by }) => (
            <tr key={i.id}>
              <td className="max-w-[460px] whitespace-pre-wrap">
                <span className="mr-1.5 text-[11.5px] uppercase text-steel">{i.source === "customer" ? "Customer" : "Template"}</span>
                {i.label}
                {i.detail && <span className="block text-[12.5px] text-steel">{i.detail}</span>}
              </td>
              <td>{i.required ? <Badge tone="info">Required</Badge> : "Optional"}</td>
              <td><ItemStatus status={i.status} /></td>
              <td className="whitespace-nowrap text-[12.5px] text-steel">{i.checkedAt ? `${by ?? ""} · ${fmtDateTime(i.checkedAt)}` : "—"}</td>
              <td>
                {canCheck && (
                  <ActionForm action={checkReleaseItemAction} inline hideSubmit>
                    <input type="hidden" name="releaseId" value={rel.id} />
                    <input type="hidden" name="itemId" value={i.id} />
                    <input name="detail" placeholder="Note (optional)" aria-label="Note" className="field-input w-40 py-1 text-[12.5px]" />
                    <button type="submit" name="status" value="pass" className={buttonClass("secondary", "sm")}>Pass</button>
                    <button type="submit" name="status" value="fail" className={buttonClass("secondary", "sm")}>Fail</button>
                    {!i.required && <button type="submit" name="status" value="na" className={buttonClass("ghost", "sm")}>N/A</button>}
                  </ActionForm>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Section>

      {canDecide && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Section title="Approve release">
            <Panel className="p-4">
              {blocked ? (
                <Notice tone="danger" title="Release is blocked">
                  <ul className="list-disc pl-5">
                    {failingSystem.map((c) => (
                      <li key={c.key}>{c.label} — {c.detail}</li>
                    ))}
                    {unticked.map(({ i }) => (
                      <li key={i.id}>Checklist not confirmed: {i.label}</li>
                    ))}
                  </ul>
                </Notice>
              ) : !releasable.greaterThan(0) ? (
                <Notice tone="warning">There is no accepted quantity left to release on this line.</Notice>
              ) : (
                <ActionForm action={approveReleaseAction} submitLabel="Approve release and issue CoC" confirm="Approving releases the parts for dispatch and generates the Certificate of Conformity.">
                  <input type="hidden" name="releaseId" value={rel.id} />
                  <FormGrid>
                    <TextField label="Quantity to release" name="qtyReleased" required inputMode="decimal" defaultValue={trimQty(releasable)} hint={`Maximum ${trimQty(releasable)} (accepted − already released)`} />
                  </FormGrid>
                  <TextArea label="Comments" name="comments" rows={2} />
                  <SignatureBlock meaning={`I have reviewed the complete history of ${job.jobNumber} line ${line.lineNo} (${line.partNumber}) and release the stated quantity as conforming to the order, drawing and specification requirements.`} />
                </ActionForm>
              )}
            </Panel>
          </Section>
          <Section title="Reject release">
            <Panel className="p-4">
              <Disclosure label="Reject this release" variant="secondary">
                <ActionForm action={rejectReleaseAction} submitLabel="Reject release" submitVariant="danger" confirm="Rejecting closes this release record. A new release must be prepared after the problem is resolved.">
                  <input type="hidden" name="releaseId" value={rel.id} />
                  <TextArea label="Why is the release rejected?" name="comments" required rows={3} />
                  <SignatureBlock meaning="I reject this final release." />
                </ActionForm>
              </Disclosure>
            </Panel>
          </Section>
        </div>
      )}

      <Section title="Details">
        <KeyValues
          items={[
            { label: "Part", value: `${line.partNumber} — ${line.description}` },
            { label: "Material specification", value: line.materialSpec },
            { label: "Traceability level", value: line.traceabilityLevel },
            { label: "Customer certification requirements", value: job.certificationRequirements, wide: true },
            { label: "Customer inspection requirements", value: job.inspectionRequirements, wide: true },
          ]}
        />
      </Section>

      <Section title="History">
        <AuditList events={history} />
      </Section>
    </>
  );
}
