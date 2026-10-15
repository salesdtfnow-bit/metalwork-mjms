import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { can, canAny } from "@/server/context";
import { AppError } from "@/server/errors";
import { getProgram } from "@/server/services/programs";
import { documentRevisionLabels, documentRevisionOptions } from "@/server/services/ui/shopfloor";
import { fmtDateTime } from "@/lib/format";
import { OP_STATUS, REVISION_STATUS } from "@/lib/status";
import { Badge, KeyValues, Notice, Panel, Ref, Section, StatusBadge, Table, TitleBlock } from "@/components/ui";
import { ActionForm, Disclosure, FileField, FormGrid, SelectField, SignatureBlock, TextArea, TextField } from "@/components/forms";
import { addRevisionAction, approveRevisionAction, rejectRevisionAction, releaseRevisionAction, submitRevisionAction, verificationAction } from "../actions";
import { FILE_ACTION, VERIFICATION_OPTIONS, VERIFICATION_STATUS } from "../labels";

export const metadata = { title: "CNC program" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageCtx("programs.view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await getProgram(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const { program: p, part, job, operationType, machines, revisions, access, usedBy } = data;
  const canCreate = can(ctx.actor, "programs.create");
  const canApprove = can(ctx.actor, "programs.approve");
  const canRelease = can(ctx.actor, "programs.release");
  const current = revisions.find((r) => r.rev.id === p.currentReleasedRevisionId);
  const [docLabels, drawings, setupSheets] = await Promise.all([
    documentRevisionLabels(ctx, revisions.flatMap((r) => [r.rev.drawingRevisionId, r.rev.setupSheetRevisionId])),
    canCreate ? documentRevisionOptions(ctx, ["drawing"]) : Promise.resolve([]),
    canCreate ? documentRevisionOptions(ctx, ["setup_sheet"]) : Promise.resolve([]),
  ]);
  const revByFile = new Map(revisions.map((r) => [r.file.id, r.rev.revision]));
  const revById = new Map(revisions.map((r) => [r.rev.id, r.rev.revision]));
  const actionable = revisions.filter(
    (r) =>
      (r.rev.status === "draft" && canCreate) ||
      (["draft", "submitted", "approved"].includes(r.rev.status) && canAny(ctx.actor, "programs.create", "programs.approve")) ||
      (r.rev.status === "submitted" && canApprove) ||
      (r.rev.status === "approved" && (canRelease || canApprove)),
  );
  const openUsers = usedBy.filter((u) => !["complete", "cancelled"].includes(u.op.status));

  return (
    <>
      <TitleBlock
        kind="CNC program"
        refNo={p.programNumber}
        title={p.name}
        status={
          <>
            {current ? <Badge tone="success">Rev {current.rev.revision} released</Badge> : <Badge tone="warning">No revision released</Badge>}
            {!p.isActive && <Badge tone="muted">Inactive</Badge>}
          </>
        }
        cells={[
          { label: "Released revision", value: current ? `Rev ${current.rev.revision} — ${fmtDateTime(current.rev.releasedAt)}` : "None" },
          { label: "Part", value: part ? part.partNumber : null },
          { label: "Job", value: job ? <Link href={`/jobs/${job.id}`} className="link">{job.jobNumber}</Link> : null },
          { label: "Operation", value: [operationType?.name, p.opNumber && `op ${p.opNumber}`].filter(Boolean).join(" · ") || null },
          { label: "Machines", value: machines.map((m) => m.code).join(", ") || "—" },
          { label: "Checksum (released)", value: current?.rev.checksum ? <span className="plate">{current.rev.checksum.slice(0, 12)}</span> : "—" },
        ]}
      />
      {p.description && <p className="-mt-2 mb-4 max-w-[80ch] whitespace-pre-wrap text-[13.5px] text-ink-2">{p.description}</p>}

      <Section title="Revisions" actions={<span className="text-[12px] text-steel">Released revisions are never overwritten — every change is a new revision.</span>}>
        <Table head={["Rev", "Status", "Change", "Programmer", "Verification", "Approved", "Released", "Checksum", "File", "Linked documents"]} empty="No revisions.">
          {revisions.map(({ rev, file, programmer, approvedByName, releasedByName, downloadable }) => (
            <tr key={rev.id} id={`row-${rev.id}`}>
              <td className="plate text-[15px]">{rev.revision}</td>
              <td>
                <StatusBadge map={REVISION_STATUS} status={rev.status} />
              </td>
              <td className="max-w-[280px] whitespace-pre-wrap">
                {rev.changeDescription}
                {rev.rejectionReason && <span className="block text-[12px] text-red">Rejected: {rev.rejectionReason}</span>}
              </td>
              <td>{programmer ?? "—"}</td>
              <td>
                <StatusBadge map={VERIFICATION_STATUS} status={rev.verificationStatus} />
                {rev.verificationNotes && <span className="block max-w-[200px] text-[12px] text-steel">{rev.verificationNotes}</span>}
              </td>
              <td className="whitespace-nowrap">
                {approvedByName ?? "—"}
                {rev.approvedAt && <span className="block text-[12px] text-steel">{fmtDateTime(rev.approvedAt)}</span>}
              </td>
              <td className="whitespace-nowrap">
                {releasedByName ?? "—"}
                {rev.releasedAt && <span className="block text-[12px] text-steel">{fmtDateTime(rev.releasedAt)}</span>}
              </td>
              <td className="plate text-[13px]">{rev.checksum ? rev.checksum.slice(0, 12) : "—"}</td>
              <td>
                {downloadable ? (
                  <a className="link" href={`/api/files/${file.id}`}>
                    {file.originalName}
                  </a>
                ) : (
                  <span className="text-steel" title="Only the current released revision can be downloaded without elevated permission.">
                    Restricted
                  </span>
                )}
              </td>
              <td className="text-[13px]">
                {[rev.drawingRevisionId && `Drawing: ${docLabels.get(rev.drawingRevisionId) ?? "—"}`, rev.setupSheetRevisionId && `Setup: ${docLabels.get(rev.setupSheetRevisionId) ?? "—"}`].filter(Boolean).join(" · ") || "—"}
              </td>
            </tr>
          ))}
        </Table>
        {canCreate && (
          <div className="mt-3">
            <Disclosure label="Add revision">
              <ActionForm action={addRevisionAction} submitLabel="Add revision" resetOnSuccess>
                <input type="hidden" name="programId" value={p.id} />
                <FormGrid cols={3}>
                  <TextField label="Revision" name="revision" required />
                  <SelectField label="Drawing revision" name="drawingRevisionId" placeholder="None" options={drawings} />
                  <SelectField label="Setup sheet revision" name="setupSheetRevisionId" placeholder="None" options={setupSheets} />
                </FormGrid>
                <TextArea label="Change description" name="changeDescription" required rows={2} />
                <FileField label="Program file" name="file" required />
                <p className="text-[12px] text-steel">The new revision starts as a draft. The current released revision stays in force until the new one is released.</p>
              </ActionForm>
            </Disclosure>
          </div>
        )}
      </Section>

      {actionable.length > 0 && (
        <Section title="Revision actions">
          <div className="grid gap-3 xl:grid-cols-2">
            {actionable.map(({ rev }) => {
              const own = rev.programmerId === ctx.actor.userId;
              const verified = ["simulated", "proved_out", "not_required"].includes(rev.verificationStatus);
              return (
                <Panel key={rev.id} className="p-4">
                  <div id={`rev-${rev.id}`} className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="plate text-[18px]">Rev {rev.revision}</span>
                    <StatusBadge map={REVISION_STATUS} status={rev.status} />
                    <StatusBadge map={VERIFICATION_STATUS} status={rev.verificationStatus} />
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    {canAny(ctx.actor, "programs.create", "programs.approve") && ["draft", "submitted", "approved"].includes(rev.status) && (
                      <Disclosure label="Record verification">
                        <ActionForm action={verificationAction} submitLabel="Record verification">
                          <input type="hidden" name="programId" value={p.id} />
                          <input type="hidden" name="revisionId" value={rev.id} />
                          <SelectField label="Result" name="status" required options={VERIFICATION_OPTIONS} defaultValue={rev.verificationStatus === "pending" ? "simulated" : rev.verificationStatus} />
                          <TextArea label="Notes" name="notes" rows={2} hint="Required when verification failed." defaultValue={rev.verificationNotes} />
                        </ActionForm>
                      </Disclosure>
                    )}
                    {rev.status === "draft" && canCreate && (
                      <ActionForm action={submitRevisionAction} submitLabel="Submit for approval" submitSize="sm">
                        <input type="hidden" name="programId" value={p.id} />
                        <input type="hidden" name="revisionId" value={rev.id} />
                      </ActionForm>
                    )}
                    {rev.status === "submitted" && canApprove && (
                      <Disclosure label="Approve" variant="primary">
                        {!verified && <Notice tone="warning">Verification is “{VERIFICATION_STATUS[rev.verificationStatus]?.label ?? rev.verificationStatus}”. Record simulation or prove-out (or mark not required) before approving.</Notice>}
                        {own && <Notice tone="warning">You wrote this revision. If independent approval is required, another approver must sign.</Notice>}
                        <ActionForm action={approveRevisionAction} submitLabel="Approve revision">
                          <input type="hidden" name="programId" value={p.id} />
                          <input type="hidden" name="revisionId" value={rev.id} />
                          <TextArea label="Comment (optional)" name="comment" rows={2} />
                          <SignatureBlock meaning={`I have reviewed CNC program ${p.programNumber} revision ${rev.revision} (checksum ${rev.checksum?.slice(0, 12) ?? "—"}…) against the drawing and setup, and approve it.`} />
                        </ActionForm>
                      </Disclosure>
                    )}
                    {rev.status === "approved" && canRelease && (
                      <Disclosure label="Release to production" variant="primary">
                        <Notice tone="warning" title="Releasing replaces the current revision">
                          {current ? `Rev ${current.rev.revision} will be superseded and can no longer be used. ` : ""}
                          {openUsers.length ? `${openUsers.length} open operation(s) using an earlier revision of this program will be flagged for review before work continues.` : "Open operations pinned to the previous revision will be flagged for review."}
                        </Notice>
                        <ActionForm action={releaseRevisionAction} submitLabel="Release revision">
                          <input type="hidden" name="programId" value={p.id} />
                          <input type="hidden" name="revisionId" value={rev.id} />
                          <TextArea label="Comment (optional)" name="comment" rows={2} />
                          <SignatureBlock meaning={`I release CNC program ${p.programNumber} revision ${rev.revision} for production use. Previous revisions must not be used.`} />
                        </ActionForm>
                      </Disclosure>
                    )}
                    {(rev.status === "submitted" || rev.status === "approved") && canApprove && (
                      <Disclosure label="Reject" variant="ghost">
                        <ActionForm action={rejectRevisionAction} submitLabel="Reject revision" submitVariant="danger" confirm={`Reject revision ${rev.revision}? A new revision will be needed to continue.`}>
                          <input type="hidden" name="programId" value={p.id} />
                          <input type="hidden" name="revisionId" value={rev.id} />
                          <TextArea label="Reason" name="reason" required rows={2} />
                        </ActionForm>
                      </Disclosure>
                    )}
                  </div>
                </Panel>
              );
            })}
          </div>
        </Section>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Used by operations">
          <Table head={["Job / op", "Operation", "Revision", "Status", "Review"]} empty="No operations use this program yet.">
            {usedBy.map(({ op, job: jobNumber }) => (
              <tr key={op.id}>
                <td className="whitespace-nowrap">
                  <Ref href={`/jobs/${op.jobId}?tab=route`}>{`${jobNumber} / ${op.opNumber}`}</Ref>
                </td>
                <td>{op.title}</td>
                <td className="plate">{op.programRevisionId ? revById.get(op.programRevisionId) ?? "—" : "—"}</td>
                <td>
                  <StatusBadge map={OP_STATUS} status={op.status} />
                </td>
                <td>{op.reviewRequired ? <Badge tone="danger">Review required</Badge> : <span className="text-steel">—</span>}</td>
              </tr>
            ))}
          </Table>
        </Section>
        <Section title="File access history" actions={<span className="text-[12px] text-steel">Latest 100 — every download and denied attempt is logged</span>}>
          <Table head={["When", "Who", "Action", "Revision", "Context"]} empty="No access recorded.">
            {access.map(({ log, user }) => (
              <tr key={log.id}>
                <td className="whitespace-nowrap">{fmtDateTime(log.at)}</td>
                <td>{user ?? "—"}</td>
                <td>
                  <StatusBadge map={FILE_ACTION} status={log.action} />
                </td>
                <td className="plate">{revByFile.get(log.fileId) ?? "—"}</td>
                <td className="max-w-[220px] truncate text-[12px] text-steel">{log.context ?? ""}</td>
              </tr>
            ))}
          </Table>
        </Section>
      </div>

      <Section title="Program record">
        <KeyValues
          cols={4}
          items={[
            { label: "Created", value: fmtDateTime(p.createdAt) },
            { label: "Part description", value: part?.description },
            { label: "Compatible machines", value: machines.map((m) => `${m.code} — ${m.name}`).join("\n") },
            { label: "Revisions", value: revisions.length },
          ]}
        />
      </Section>
    </>
  );
}
