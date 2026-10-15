import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { AppError } from "@/server/errors";
import { canSeeUnreleased, getDocument } from "@/server/services/documents";
import { getSettings } from "@/server/services/settings";
import { documentLinks, userNames } from "@/server/services/ui/records";
import { fmtDate, fmtDateTime, todayISO } from "@/lib/format";
import { REVISION_STATUS } from "@/lib/status";
import { Badge, cx, Notice, Panel, Section, StatusBadge, Table, TitleBlock } from "@/components/ui";
import { ActionForm, Disclosure, FileField, FormGrid, SelectField, SignatureBlock, TextArea, TextField } from "@/components/forms";
import { docTypeLabel } from "../_components/labels";
import { addRevisionAction, approveReleaseAction, obsoleteRevisionAction, reviewRevisionAction, submitRevisionAction } from "../actions";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageCtx("documents.view");
  const { id } = await params;
  const data = await getDocument(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const { doc, revisions, access } = data;
  const [names, links, settings] = await Promise.all([
    userNames(ctx, revisions.flatMap((r) => [r.rev.reviewerId, r.rev.approverId])),
    documentLinks(ctx, doc),
    getSettings(ctx.db),
  ]);
  const current = revisions.find((r) => r.rev.id === doc.currentRevisionId) ?? null;
  const seeUnreleased = canSeeUnreleased(ctx);
  const upload = can(ctx.actor, "documents.upload");
  const review = can(ctx.actor, "documents.review");
  const approve = can(ctx.actor, "documents.approve");
  const revByFile = new Map(revisions.map((r) => [r.file.id, r.rev.revision]));
  const actionable = revisions.filter(
    (r) => (upload && r.rev.status === "draft") || ((review || approve) && r.rev.status === "in_review") || (approve && ["draft", "in_review", "approved", "released"].includes(r.rev.status)),
  );

  return (
    <>
      <TitleBlock
        kind={docTypeLabel(doc.docType)}
        refNo={doc.docNumber}
        title={doc.title}
        status={
          <>
            {current ? <StatusBadge map={REVISION_STATUS} status={current.rev.status} /> : <Badge tone="warning">No released revision</Badge>}
            {doc.isCustomerSupplied && <Badge tone="info">Customer-supplied</Badge>}
          </>
        }
        cells={[
          { label: "Type", value: docTypeLabel(doc.docType) },
          { label: "Current revision", value: current ? <span className="plate">{current.rev.revision}</span> : "None released" },
          { label: "Effective", value: fmtDate(current?.rev.effectiveDate) },
          { label: "Customer", value: links.customer ? <Link className="link" href={`/customers/${links.customer.id}`}>{links.customer.label}</Link> : null },
          { label: "Part", value: links.part ? <Link className="link" href={`/parts/${links.part.id}`}>{links.part.label}</Link> : null },
          { label: links.machine ? "Machine" : "Supplier", value: links.machine ? <Link className="link" href={`/machines/${links.machine.id}`}>{links.machine.label}</Link> : links.supplier ? <Link className="link" href={`/suppliers/${links.supplier.id}`}>{links.supplier.label}</Link> : null },
        ]}
      />

      {!current && <Notice tone="warning">This document has no released revision. It must not be used for production until a revision is approved and released.</Notice>}

      <Section title="Revisions">
        <Table head={["Rev", "Status", "Author", "Reviewer", "Approver", "Effective", "Change description", "File"]} empty="No revisions.">
          {revisions.map(({ rev, file, author }) => {
            const dead = rev.status === "superseded" || rev.status === "obsolete";
            const fileVisible = rev.status === "released" || seeUnreleased;
            return (
              <tr key={rev.id} className={cx(dead && "bg-line-2/40 text-steel")}>
                <td className={cx("plate", dead && "line-through decoration-steel-2")}>{rev.revision}</td>
                <td>
                  <div className="flex flex-wrap items-center gap-1">
                    <StatusBadge map={REVISION_STATUS} status={rev.status} />
                    {dead && <Badge tone="danger">Do not use</Badge>}
                    {rev.status === "in_review" && rev.reviewerId && <Badge tone="info">Reviewed</Badge>}
                  </div>
                </td>
                <td>{author ?? "—"}</td>
                <td>
                  {rev.reviewerId ? names.get(rev.reviewerId) ?? "—" : "—"}
                  {rev.reviewedAt && <div className="text-[12px] text-steel">{fmtDateTime(rev.reviewedAt)}</div>}
                </td>
                <td>
                  {rev.approverId ? names.get(rev.approverId) ?? "—" : "—"}
                  {rev.approvedAt && <div className="text-[12px] text-steel">{fmtDateTime(rev.approvedAt)}</div>}
                </td>
                <td>{fmtDate(rev.effectiveDate)}</td>
                <td className="max-w-[320px] whitespace-pre-wrap">{rev.changeDescription ?? "—"}</td>
                <td>
                  {fileVisible ? (
                    <a href={`/api/files/${file.id}`} className="link">
                      {file.originalName}
                    </a>
                  ) : (
                    <span className="text-[12px] text-steel">Not released — restricted</span>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
        <p className="mt-1 text-[12px] text-steel">Superseded and obsolete revisions are kept for traceability and must not be used. Revisions are never overwritten — every change is a new revision.</p>
      </Section>

      {actionable.length > 0 && (
        <Section title="Revision actions">
          <div className="grid gap-4 xl:grid-cols-2">
            {actionable.map(({ rev }) => (
              <Panel key={rev.id} className="p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="plate text-[16px]">Rev {rev.revision}</span>
                  <StatusBadge map={REVISION_STATUS} status={rev.status} />
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  {upload && rev.status === "draft" && (
                    <ActionForm action={submitRevisionAction} submitLabel="Submit for review" submitSize="sm">
                      <input type="hidden" name="documentId" value={doc.id} />
                      <input type="hidden" name="revisionId" value={rev.id} />
                    </ActionForm>
                  )}
                  {review && rev.status === "in_review" && (
                    <Disclosure label={rev.reviewerId ? "Review again" : "Review"}>
                      <ActionForm action={reviewRevisionAction} submitLabel="Record review">
                        <input type="hidden" name="documentId" value={doc.id} />
                        <input type="hidden" name="revisionId" value={rev.id} />
                        <SelectField
                          label="Outcome"
                          name="outcome"
                          required
                          defaultValue="reviewed"
                          options={[
                            { value: "reviewed", label: "Reviewed — ready for approval" },
                            { value: "rejected", label: "Rejected — needs changes" },
                          ]}
                        />
                        <TextArea label="Comment" name="comment" rows={2} hint="Required when rejecting." />
                      </ActionForm>
                    </Disclosure>
                  )}
                  {approve && rev.status === "in_review" && (
                    <Disclosure label="Approve & release" variant="primary">
                      <ActionForm action={approveReleaseAction} submitLabel="Approve and release">
                        <input type="hidden" name="documentId" value={doc.id} />
                        <input type="hidden" name="revisionId" value={rev.id} />
                        <Notice tone="info">
                          {current
                            ? `Revision ${current.rev.revision} will be superseded. Open jobs and operations that use it will be flagged for review — they are not changed automatically.`
                            : "This becomes the first released revision of the document."}
                          {settings.requireIndependentApproval && " Independent approval is required: you cannot approve a revision you authored."}
                        </Notice>
                        <FormGrid>
                          <TextField label="Effective date" name="effectiveDate" type="date" defaultValue={todayISO()} />
                          <TextField label="Comment" name="comment" />
                        </FormGrid>
                        <SignatureBlock meaning={`I approve ${doc.docNumber} revision ${rev.revision} for use and release it as the current controlled revision.`} />
                      </ActionForm>
                    </Disclosure>
                  )}
                  {approve && ["draft", "in_review", "approved", "released"].includes(rev.status) && (
                    <Disclosure label="Make obsolete" variant="ghost">
                      <ActionForm
                        action={obsoleteRevisionAction}
                        submitLabel="Make obsolete"
                        submitVariant="danger"
                        confirm={rev.status === "released" ? "The document will have no released revision. Open jobs and operations using it will be flagged for review." : "This revision will be marked obsolete and can no longer be released."}
                      >
                        <input type="hidden" name="documentId" value={doc.id} />
                        <input type="hidden" name="revisionId" value={rev.id} />
                        <TextArea label="Reason" name="reason" required rows={2} />
                      </ActionForm>
                    </Disclosure>
                  )}
                </div>
              </Panel>
            ))}
          </div>
        </Section>
      )}

      {upload && (
        <Section title="Add revision">
          <Disclosure label="Add a new revision">
            <ActionForm action={addRevisionAction} submitLabel="Add draft revision" resetOnSuccess>
              <input type="hidden" name="documentId" value={doc.id} />
              <FormGrid>
                <TextField label="Revision label" name="revision" required hint="Must be new — existing revisions are never overwritten." />
                <FileField label="File" name="file" required />
              </FormGrid>
              <TextArea label="What changed" name="changeDescription" required rows={2} />
            </ActionForm>
          </Disclosure>
        </Section>
      )}

      <Section title="Access history">
        <Table head={["When", "Who", "Action", "Revision", "Context", "IP address"]} empty="No downloads or views recorded.">
          {access.map(({ log, user }) => (
            <tr key={log.id}>
              <td className="whitespace-nowrap text-steel">{fmtDateTime(log.at)}</td>
              <td>{user ?? "—"}</td>
              <td>{log.action === "denied" ? <Badge tone="danger">Denied</Badge> : <span className="capitalize">{log.action}</span>}</td>
              <td className="plate">{revByFile.get(log.fileId) ?? "—"}</td>
              <td className="text-steel">{log.context ?? "—"}</td>
              <td className="text-steel">{log.ipAddress ?? "—"}</td>
            </tr>
          ))}
        </Table>
      </Section>
    </>
  );
}
