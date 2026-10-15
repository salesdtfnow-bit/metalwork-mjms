import { requirePageCtx } from "@/server/auth/next";
import { NCR_CATEGORIES } from "@/server/services/ncr";
import { batchOptions, customerOptions, jobOptions, lotOptions, operationOptions, supplierOptions } from "@/server/services/ui/quality";
import { PageHeader, Panel } from "@/components/ui";
import { ActionForm, CheckboxField, FileField, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { raiseNcrAction } from "../actions";

export const metadata = { title: "Raise NCR" };

const SOURCES = [
  { value: "internal", label: "Internal (production / inspection)" },
  { value: "supplier", label: "Supplier / incoming material" },
  { value: "customer_complaint", label: "Customer complaint / return" },
  { value: "audit", label: "Audit finding" },
];

const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export default async function NewNcrPage({ searchParams }: { searchParams: Promise<{ jobId?: string; operationId?: string; lotId?: string }> }) {
  const ctx = await requirePageCtx("ncr.raise");
  const sp = await searchParams;
  const [jobsList, lots, sups, custs] = await Promise.all([jobOptions(ctx), lotOptions(ctx), supplierOptions(ctx), customerOptions(ctx)]);
  const job = jobsList.find((j) => j.id === sp.jobId) ?? null;
  const [ops, bts] = job ? await Promise.all([operationOptions(ctx, job.id), batchOptions(ctx, job.id)]) : [[], []];
  const lot = lots.find((l) => l.id === sp.lotId);

  return (
    <>
      <PageHeader title="Raise non-conformance" description="Record what is wrong, contain it, and place holds so suspect work or material cannot move on. Quality will investigate and decide the disposition." />

      <Panel className="mb-4 max-w-5xl p-4">
        <form className="flex flex-wrap items-end gap-3">
          {sp.lotId && <input type="hidden" name="lotId" value={sp.lotId} />}
          <label className="block min-w-[280px]">
            <span className="mb-1 block text-[12.5px] font-medium text-ink-2">1. Job (optional — loads its operations and batches)</span>
            <select name="jobId" defaultValue={job?.id ?? ""} className="field-input">
              <option value="">No job</option>
              {jobsList.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.jobNumber} — {j.title}
                </option>
              ))}
            </select>
          </label>
          <button className="rounded-sm border border-line bg-sheet px-3 py-1.5 text-[13px]">Load job</button>
        </form>
      </Panel>

      <Panel className="max-w-5xl p-4">
        <ActionForm action={raiseNcrAction} submitLabel="Raise NCR">
          {job && <input type="hidden" name="jobId" value={job.id} />}
          <FormGrid cols={3}>
            <SelectField label="Source" name="source" required options={SOURCES} defaultValue={sp.lotId ? "supplier" : "internal"} />
            <SelectField label="Category" name="category" required placeholder="Select…" options={NCR_CATEGORIES.map((c) => ({ value: c, label: label(c) }))} />
            <TextField label="Quantity affected" name="qtyAffected" required inputMode="decimal" />
            <div>
              <p className="mb-1 text-[12.5px] font-medium text-ink-2">Job</p>
              <p className="text-[13.5px]">{job ? <span className="plate">{job.jobNumber}</span> : <span className="text-steel">None — choose above</span>}</p>
            </div>
            <SelectField
              label="Operation"
              name="operationId"
              placeholder={job ? "Not operation-specific" : "Load a job first"}
              disabled={!job}
              options={ops.map((o) => ({ value: o.id, label: `L${o.lineNo} · ${o.opNumber} ${o.title} (${o.status.replace(/_/g, " ")})` }))}
              defaultValue={sp.operationId}
            />
            <SelectField label="Batch" name="batchId" placeholder={job ? "No batch" : "Load a job first"} disabled={!job} options={bts.map((b) => ({ value: b.id, label: `L${b.lineNo} · ${b.batchNo} (${b.status.replace(/_/g, " ")})` }))} />
            <SelectField label="Material lot" name="lotId" placeholder="No lot" options={lots.map((l) => ({ value: l.id, label: `${l.lotNo} · heat ${l.heatNumber}` }))} defaultValue={lot?.id} />
            <SelectField label="Supplier" name="supplierId" placeholder="From lot / none" options={sups.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }))} hint="Taken from the lot when left blank" />
            <SelectField label="Customer" name="customerId" placeholder="From job / none" options={custs.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))} hint="Taken from the job when left blank" />
          </FormGrid>
          <TextArea label="Description of the non-conformance" name="description" required rows={4} placeholder="What was found, where, how many, against which requirement (drawing ref, spec)…" />
          <TextArea label="Immediate containment action" name="containmentAction" rows={2} placeholder="e.g. Parts segregated in red quarantine bin QB-2, remaining stock checked" hint="Recording containment marks the NCR as contained." />
          <fieldset className="rounded-sm border border-line p-3">
            <legend className="px-1 text-[12.5px] font-semibold text-ink">Containment holds</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <CheckboxField label="Hold the operation" name="holdOperation" defaultChecked hint="Stops further work on the selected operation" />
              <CheckboxField label="Hold the whole job" name="holdJob" hint="Puts the job on hold" />
              <CheckboxField label="Hold the batch" name="holdBatch" defaultChecked hint="Applies when a batch is selected" />
              <CheckboxField label="Quarantine the material lot" name="holdLot" defaultChecked hint="Applies when a lot is selected" />
            </div>
          </fieldset>
          <FileField label="Evidence (photos, reports)" name="evidence" multiple />
        </ActionForm>
      </Panel>
    </>
  );
}
