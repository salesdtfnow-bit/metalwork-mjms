import type { correctiveActions } from "@/server/db/schema";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { CAPA_STATUS } from "@/lib/status";
import { KeyValues, Panel, Ref, StatusBadge } from "@/components/ui";
import { ActionForm, Disclosure, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { updateCapaAction, verifyCapaAction } from "../actions";

type Capa = typeof correctiveActions.$inferSelect;

/** One corrective action with its update / verification forms (shown only to permitted users). */
export function CapaCard({
  ca,
  names,
  canManage,
  canVerify,
  actorId,
  ncrRef,
}: {
  ca: Capa;
  names: Record<string, string>;
  canManage: boolean;
  canVerify: boolean;
  actorId: string;
  ncrRef?: string | null;
}) {
  const closed = ["verified_effective", "closed", "cancelled"].includes(ca.status);
  const isOwner = ca.ownerId === actorId;
  const nm = (id: string | null) => (id ? names[id] ?? "—" : "—");
  return (
    <Panel className="mb-3 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Ref size="sm">{ca.ref}</Ref>
        <span className="font-semibold text-ink">{ca.title}</span>
        <StatusBadge map={CAPA_STATUS} status={ca.status} />
        {ncrRef && <span className="text-[12px] text-steel">from {ncrRef}</span>}
      </div>
      <KeyValues
        cols={4}
        items={[
          { label: "Owner", value: nm(ca.ownerId) },
          { label: "Due", value: fmtDate(ca.dueDate) },
          { label: "Implemented", value: ca.implementedAt ? fmtDateTime(ca.implementedAt) : null },
          { label: "Verification due", value: fmtDate(ca.verificationDueDate) },
          { label: "Problem", value: ca.problem, wide: true },
          { label: "Root cause", value: ca.rootCause, wide: true },
          { label: "Action", value: ca.action, wide: true },
          { label: "Verification method", value: ca.verificationMethod },
          { label: "Verified", value: ca.verifiedAt ? `${nm(ca.verifiedBy)} · ${fmtDateTime(ca.verifiedAt)} · ${ca.effective ? "effective" : "not effective"}` : null },
          { label: "Verification evidence", value: ca.verificationNotes, wide: true },
        ]}
      />
      <div className="mt-3 flex flex-wrap gap-3">
        {canManage && !closed && ca.status !== "implemented" && (
          <Disclosure label="Update action">
            <ActionForm action={updateCapaAction} submitLabel="Save">
              <input type="hidden" name="capaId" value={ca.id} />
              {ca.ncrId && <input type="hidden" name="ncrId" value={ca.ncrId} />}
              <TextArea label="Root cause" name="rootCause" rows={2} defaultValue={ca.rootCause} />
              <TextArea label="Action taken / planned" name="action" rows={3} defaultValue={ca.action} />
              <FormGrid cols={3}>
                <SelectField
                  label="Status"
                  name="status"
                  placeholder="Keep current status"
                  options={[
                    { value: "in_progress", label: "In progress" },
                    { value: "implemented", label: "Implemented — ready for verification" },
                  ]}
                />
                <TextField label="Verification method" name="verificationMethod" defaultValue={ca.verificationMethod} placeholder="e.g. Audit next 5 batches" />
                <TextField label="Verification due" name="verificationDueDate" type="date" defaultValue={ca.verificationDueDate} />
              </FormGrid>
            </ActionForm>
          </Disclosure>
        )}
        {ca.status === "implemented" && canVerify && !isOwner && (
          <Disclosure label="Verify effectiveness" variant="primary">
            <ActionForm action={verifyCapaAction} submitLabel="Record verification">
              <input type="hidden" name="capaId" value={ca.id} />
              {ca.ncrId && <input type="hidden" name="ncrId" value={ca.ncrId} />}
              <SelectField label="Was the action effective?" name="effective" required placeholder="Select…" options={[{ value: "yes", label: "Yes — effective" }, { value: "no", label: "No — not effective" }]} />
              <TextArea label="Verification evidence" name="notes" required rows={3} />
            </ActionForm>
          </Disclosure>
        )}
        {ca.status === "implemented" && canVerify && isOwner && <p className="text-[12.5px] text-steel">You own this action — effectiveness must be verified by someone else.</p>}
      </div>
    </Panel>
  );
}
