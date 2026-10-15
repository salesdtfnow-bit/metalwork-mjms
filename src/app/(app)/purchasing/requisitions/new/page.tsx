import { requirePageCtx } from "@/server/auth/next";
import { listMaterialSpecs } from "@/server/services/materials";
import { jobOptions } from "@/server/services/ui/materials";
import { PageHeader, Panel } from "@/components/ui";
import { ActionForm, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { createRequisitionAction } from "../../actions";

export const metadata = { title: "New requisition" };

export default async function NewRequisitionPage() {
  const ctx = await requirePageCtx("purchasing.manage");
  const [jobs, specs] = await Promise.all([jobOptions(ctx, { authorisedOnly: true }), listMaterialSpecs(ctx)]);
  return (
    <>
      <PageHeader title="New purchase requisition" description="Request material for a job (or for stock). Only authorised, open jobs can have material requested. Purchasing turns open requisitions into purchase orders." />
      <Panel className="max-w-4xl p-4">
        <ActionForm action={createRequisitionAction} submitLabel="Create requisition">
          <FormGrid cols={2}>
            <SelectField label="Job" name="jobId" placeholder="Stock / no job" options={jobs.map((j) => ({ value: j.id, label: `${j.jobNumber} — ${j.title} (${j.customer})` }))} hint="Only authorised open jobs are listed." />
            <SelectField label="Material spec" name="materialSpecId" placeholder="—" options={specs.filter((s) => s.isActive).map((s) => ({ value: s.id, label: `${s.code} — ${s.grade}` }))} />
            <TextField label="Description" name="description" required className="sm:col-span-2" placeholder="e.g. 6082-T6 round bar for shafts" />
          </FormGrid>
          <FormGrid cols={4}>
            <TextField label="Dimensions" name="dimensions" placeholder="e.g. Ø50 × 3000" />
            <TextField label="Quantity" name="quantity" required inputMode="decimal" />
            <TextField label="Unit" name="uom" defaultValue="pcs" />
            <TextField label="Required date" name="requiredDate" type="date" />
          </FormGrid>
          <TextArea label="Notes" name="notes" rows={2} />
        </ActionForm>
      </Panel>
    </>
  );
}
