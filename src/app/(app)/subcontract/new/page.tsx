import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { canAny } from "@/server/context";
import { approvedSubcontractors, openSubcontractOperations } from "@/server/services/ui/workshop";
import { fmtDate, fmtQty } from "@/lib/format";
import { OP_STATUS } from "@/lib/status";
import { Empty, KeyValues, Notice, PageHeader, Panel, Section, StatusBadge } from "@/components/ui";
import { ActionForm, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { PROCESSES } from "../_components/vocab";
import { createSubcontractAction } from "../actions";

export const metadata = { title: "New subcontract order" };

/** Guess the process from the operation type / title (user can change it). */
function guessProcess(text: string) {
  const t = text.toLowerCase();
  if (/heat|harden|temper|anneal|nitrid/.test(t)) return "heat_treatment";
  if (/anodis|anodiz/.test(t)) return "anodising";
  if (/plat|zinc|nickel|chrom/.test(t)) return "plating";
  if (/grind/.test(t)) return "grinding";
  if (/paint|powder|coat/.test(t)) return "painting";
  if (/machin|mill|turn/.test(t)) return "machining";
  return "other";
}

export default async function NewSubcontractPage({ searchParams }: { searchParams: Promise<{ operationId?: string }> }) {
  const ctx = await requirePageCtx("subcontract.manage");
  const { operationId } = await searchParams;
  const [ops, suppliers] = await Promise.all([openSubcontractOperations(ctx), approvedSubcontractors(ctx)]);
  const selected = operationId ? ops.find((o) => o.op.id === operationId) : undefined;
  const showCost = canAny(ctx.actor, "purchasing.view", "jobs.view_commercial");

  return (
    <>
      <PageHeader title="New subcontract order" description="Raise an order to send parts out for an external process. Only external subcontract operations on a job's route can be subcontracted." />
      {operationId && !selected && (
        <Notice tone="warning" title="That operation can't be subcontracted">
          It is not an open external subcontract operation, or it already has a live subcontract order. Choose one from the list below.
        </Notice>
      )}
      {ops.length === 0 ? (
        <Empty title="No subcontract operations waiting">
          Add an operation with an external subcontract operation type to a job&apos;s route first. Operations already covered by a live order are not listed.
        </Empty>
      ) : suppliers.length === 0 ? (
        <Empty title="No approved subcontractors">
          A supplier must be active, approved (or conditionally approved and in date) and in the &quot;subcontract&quot; category. See <Link href="/suppliers" className="link">Suppliers</Link>.
        </Empty>
      ) : (
        <>
          {!selected && (
            <form className="mb-4 flex flex-wrap items-end gap-2" action="/subcontract/new">
              <label className="block">
                <span className="mb-1 block text-[12.5px] font-medium text-ink-2">Operation</span>
                <select name="operationId" className="field-input min-w-[360px]" defaultValue="" required>
                  <option value="" disabled>
                    Select an operation…
                  </option>
                  {ops.map((o) => (
                    <option key={o.op.id} value={o.op.id}>
                      {o.job.jobNumber} op {o.op.opNumber} — {o.part} — {o.op.title}
                    </option>
                  ))}
                </select>
              </label>
              <button className="h-8.5 rounded-sm border border-line bg-sheet px-3 text-[13.5px]">Continue</button>
            </form>
          )}
          {selected && (
            <Section title="Operation">
              <Panel className="p-3">
                <KeyValues
                  cols={4}
                  items={[
                    {
                      label: "Job",
                      value: (
                        <Link href={`/jobs/${selected.job.id}?tab=route`} className="link">
                          {selected.job.jobNumber}
                        </Link>
                      ),
                    },
                    { label: "Customer", value: selected.customer },
                    { label: "Operation", value: `${selected.op.opNumber} — ${selected.op.title}` },
                    { label: "Type", value: selected.type },
                    { label: "Part", value: `${selected.part} — ${selected.partDescription}` },
                    { label: "Planned quantity", value: fmtQty(selected.op.plannedQty) },
                    { label: "Status", value: <StatusBadge map={OP_STATUS} status={selected.op.status} /> },
                    { label: "Job required", value: fmtDate(selected.job.requiredDate) },
                  ]}
                />
                <p className="mt-2 text-[12px]">
                  <Link href="/subcontract/new" className="link">
                    Choose a different operation
                  </Link>
                </p>
              </Panel>
            </Section>
          )}
          {selected && (
            <Panel className="max-w-4xl p-4">
              <ActionForm action={createSubcontractAction} submitLabel="Create subcontract order">
                <input type="hidden" name="operationId" value={selected.op.id} />
                <FormGrid cols={2}>
                  <SelectField
                    label="Subcontractor"
                    name="supplierId"
                    required
                    options={suppliers.map((s) => ({ value: s.id, label: `${s.name} (${s.code})${s.approvalStatus === "conditional" ? " — conditional approval" : ""}` }))}
                    placeholder="Select…"
                    hint="Approved suppliers in the subcontract category only."
                  />
                  <SelectField label="Process" name="process" required options={PROCESSES} defaultValue={guessProcess(`${selected.type} ${selected.op.title}`)} />
                </FormGrid>
                <TextArea label="Process specification" name="specification" required rows={3} defaultValue={selected.op.instructions} placeholder="e.g. Harden & temper to 40–45 HRC per BS EN ISO 18265; certificate required" />
                <FormGrid cols={3}>
                  <TextField label="Required return date" name="requiredReturnDate" type="date" />
                  {showCost && <TextField label="Estimated cost" name="estimatedCost" inputMode="decimal" />}
                </FormGrid>
                <TextArea label="Notes" name="notes" rows={2} />
              </ActionForm>
            </Panel>
          )}
        </>
      )}
    </>
  );
}
