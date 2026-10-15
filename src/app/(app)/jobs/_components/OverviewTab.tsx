import Link from "next/link";
import { availableTransitions, PRODUCTION_PHASE } from "@/server/services/jobs";
import { formatAddress } from "@/server/services/parties";
import { customerDeliveryAddresses, jobOwnerOptions, userNames } from "@/server/services/ui/jobs";
import { can } from "@/server/context";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { JOB_STATUS, PRIORITY, type JobStatus } from "@/lib/status";
import { KeyValues, Notice, Panel, Section, StatusBadge, Table } from "@/components/ui";
import { ActionForm, Disclosure, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { authoriseJobAction, cancelJobAction, holdJobAction, releaseJobHoldAction, transitionJobAction, updateJobAction } from "../actions";
import { TERMINAL_JOB, type TabProps } from "./types";

export async function OverviewTab({ ctx, data }: TabProps) {
  const { job: j, address, showCommercial, holds } = data;
  const terminal = TERMINAL_JOB.includes(j.status);
  const manage = can(ctx.actor, "jobs.manage") && !terminal;
  const [transitions, owners, addresses, names] = await Promise.all([
    terminal ? Promise.resolve([]) : availableTransitions(ctx, j.id),
    manage ? jobOwnerOptions(ctx) : Promise.resolve([]),
    manage ? customerDeliveryAddresses(ctx, j.customerId) : Promise.resolve([]),
    userNames(ctx, [j.authorisedBy, j.createdBy, ...holds.map((h) => h.placedBy)]),
  ]);
  const manual = transitions.filter((t) => !["on_hold", "cancelled", "dispatched"].includes(t.toStatus) && !PRODUCTION_PHASE.includes(t.toStatus as JobStatus));
  const canHold = can(ctx.actor, "jobs.hold");
  const canCancel = can(ctx.actor, "jobs.cancel") && !terminal;
  const canAuthorise = can(ctx.actor, "jobs.authorise") && !j.authorisedAt && !terminal;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div>
        <Section title="Job requirements">
          <KeyValues
            items={[
              { label: "Material requirements", value: j.materialRequirements },
              { label: "Inspection requirements", value: j.inspectionRequirements },
              { label: "Certification requirements", value: j.certificationRequirements },
              { label: "Packaging requirements", value: j.packagingRequirements },
              { label: "Delivery requirements", value: j.deliveryRequirements },
              { label: "Delivery address", value: formatAddress(address) },
              ...(showCommercial ? [{ label: "Commercial terms", value: j.commercialTerms, wide: true }] : []),
              { label: "Next action", value: j.nextAction, wide: true },
              { label: "Notes", value: j.notes, wide: true },
            ]}
          />
        </Section>
        <Section title="Record">
          <KeyValues
            cols={4}
            items={[
              { label: "Required date", value: fmtDate(j.requiredDate) },
              { label: "Promised date", value: fmtDate(j.promisedDate) },
              { label: "Priority", value: <StatusBadge map={PRIORITY} status={String(j.priority)} /> },
              { label: "Created", value: `${fmtDateTime(j.createdAt)}${j.createdBy ? ` by ${names.get(j.createdBy) ?? "—"}` : ""}` },
              { label: "Authorised", value: j.authorisedAt ? `${fmtDateTime(j.authorisedAt)} by ${names.get(j.authorisedBy ?? "") ?? "—"}` : "Not authorised" },
              { label: "Repeat of", value: j.repeatOfJobId ? <Link href={`/jobs/${j.repeatOfJobId}`} className="link">Previous job</Link> : null },
              ...(j.status === "cancelled" ? [{ label: "Cancelled", value: `${fmtDateTime(j.cancelledAt)} — ${j.cancelReason ?? ""}`, wide: true }] : []),
              ...(j.completedAt ? [{ label: "Completed", value: fmtDateTime(j.completedAt) }] : []),
            ]}
          />
        </Section>
        {manage && (
          <Disclosure label="Edit job details">
            <ActionForm action={updateJobAction} submitLabel="Save changes">
              <input type="hidden" name="jobId" value={j.id} />
              <FormGrid cols={3}>
                <TextField label="Title" name="title" required defaultValue={j.title} className="sm:col-span-2" />
                <SelectField label="Priority" name="priority" defaultValue={String(j.priority)} options={Object.entries(PRIORITY).map(([k, v]) => ({ value: k, label: v.label }))} />
                <SelectField label="Owner" name="ownerId" defaultValue={j.ownerId} placeholder="No owner" options={owners.map((o) => ({ value: o.id, label: o.name }))} />
                <TextField label="Required date" name="requiredDate" type="date" defaultValue={j.requiredDate} hint="Changing it needs a reason." />
                <TextField label="Promised date" name="promisedDate" type="date" defaultValue={j.promisedDate} />
                <SelectField
                  label="Delivery address"
                  name="deliveryAddressId"
                  defaultValue={j.deliveryAddressId}
                  placeholder="Not set"
                  className="sm:col-span-3"
                  options={addresses.map((a) => ({ value: a.id, label: `${a.kind}${a.label ? ` — ${a.label}` : ""}: ${formatAddress(a).replace(/\n/g, ", ")}` }))}
                />
              </FormGrid>
              <FormGrid cols={2}>
                <TextArea label="Material requirements" name="materialRequirements" defaultValue={j.materialRequirements} rows={2} />
                <TextArea label="Inspection requirements" name="inspectionRequirements" defaultValue={j.inspectionRequirements} rows={2} />
                <TextArea label="Certification requirements" name="certificationRequirements" defaultValue={j.certificationRequirements} rows={2} />
                <TextArea label="Packaging requirements" name="packagingRequirements" defaultValue={j.packagingRequirements} rows={2} />
                <TextArea label="Delivery requirements" name="deliveryRequirements" defaultValue={j.deliveryRequirements} rows={2} />
                <TextArea label="Next action" name="nextAction" defaultValue={j.nextAction} rows={2} />
              </FormGrid>
              <TextArea label="Notes" name="notes" defaultValue={j.notes} rows={2} />
              <TextArea label="Reason for change" name="reason" rows={2} hint="Required when the required date changes; recorded in the job history." />
            </ActionForm>
          </Disclosure>
        )}
      </div>

      <div className="space-y-4">
        <Section title="Status">
          <Panel className="space-y-4 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] text-steel">Current status</span>
              <StatusBadge map={JOB_STATUS} status={j.status} />
            </div>
            {!terminal &&
              (manual.length ? (
                <ActionForm action={transitionJobAction} submitLabel="Change status">
                  <input type="hidden" name="jobId" value={j.id} />
                  <SelectField
                    label="Move to"
                    name="to"
                    required
                    placeholder="Select status"
                    options={manual.map((t) => ({ value: t.toStatus, label: `${JOB_STATUS[t.toStatus as JobStatus]?.label ?? t.toStatus}${t.requiresReason ? " (reason required)" : ""}` }))}
                  />
                  <TextArea label="Reason" name="reason" rows={2} hint="Recorded with the status change. Gates are checked before the change is made." />
                </ActionForm>
              ) : (
                <p className="text-[13px] text-steel">No manual status change is available to you from this status. Production statuses are set automatically from operation, inspection and dispatch records.</p>
              ))}
            {canAuthorise && (
              <div className="border-t border-line pt-3">
                <p className="mb-2 text-[13px] text-ink-2">This job is not authorised. Material cannot be requested and production cannot start until it is.</p>
                <ActionForm action={authoriseJobAction} submitLabel="Authorise job" confirm="Authorise this job for material purchasing and production? Your name is recorded against the authorisation.">
                  <input type="hidden" name="jobId" value={j.id} />
                </ActionForm>
              </div>
            )}
            {canHold && !terminal && j.status !== "on_hold" && (
              <div className="border-t border-line pt-3">
                <Disclosure label="Place on hold">
                  <ActionForm action={holdJobAction} submitLabel="Place on hold" submitVariant="secondary">
                    <input type="hidden" name="jobId" value={j.id} />
                    <TextArea label="Reason" name="reason" required rows={2} placeholder="e.g. Customer requested stop pending drawing change" />
                  </ActionForm>
                </Disclosure>
              </div>
            )}
            {canHold && j.status === "on_hold" && (
              <div className="border-t border-line pt-3">
                <ActionForm action={releaseJobHoldAction} submitLabel="Release hold">
                  <input type="hidden" name="jobId" value={j.id} />
                  <TextArea label="Why can the hold be released?" name="reason" required rows={2} />
                </ActionForm>
                <p className="mt-1 text-[12px] text-steel">Holds raised by a non-conformance need the quality hold-release permission.</p>
              </div>
            )}
            {canCancel && (
              <div className="border-t border-line pt-3">
                <Disclosure label="Cancel job" variant="ghost">
                  <ActionForm action={cancelJobAction} submitLabel="Cancel job" submitVariant="danger" confirm="Cancelling stops all unfinished operations on this job. This cannot be undone.">
                    <input type="hidden" name="jobId" value={j.id} />
                    <TextArea label="Reason" name="reason" required rows={2} />
                  </ActionForm>
                </Disclosure>
              </div>
            )}
          </Panel>
        </Section>

        <Section title="Active holds">
          {holds.length ? (
            <Table head={["Placed", "By", "Reason", "Source"]}>
              {holds.map((h) => (
                <tr key={h.id}>
                  <td className="whitespace-nowrap text-steel">{fmtDateTime(h.placedAt)}</td>
                  <td>{names.get(h.placedBy) ?? "—"}</td>
                  <td className="whitespace-pre-wrap">{h.reason}</td>
                  <td>
                    {h.ncrId ? (
                      <Link href={`/ncr/${h.ncrId}`} className="link">
                        NCR
                      </Link>
                    ) : (
                      <span className="capitalize text-steel">{h.targetType}</span>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="text-[13px] text-steel">No active holds on this job.</p>
          )}
        </Section>
        {terminal && <Notice tone="info">This job is {JOB_STATUS[j.status as JobStatus]?.label.toLowerCase() ?? j.status}. Its record is read-only.</Notice>}
      </div>
    </div>
  );
}
