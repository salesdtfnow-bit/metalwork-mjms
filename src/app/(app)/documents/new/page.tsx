import { requirePageCtx } from "@/server/auth/next";
import { DOC_TYPES } from "@/server/services/documents";
import { documentFormOptions } from "@/server/services/ui/records";
import { PageHeader, Panel } from "@/components/ui";
import { ActionForm, CheckboxField, FileField, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { createDocumentAction } from "../actions";
import { docTypeLabel } from "../_components/labels";

export const metadata = { title: "New document" };

export default async function NewDocumentPage() {
  const ctx = await requirePageCtx("documents.upload");
  const o = await documentFormOptions(ctx);
  return (
    <>
      <PageHeader
        title="New controlled document"
        description="The first revision is created as a draft. It becomes valid for production only after review, approval and release."
      />
      <Panel className="max-w-4xl p-4">
        <ActionForm action={createDocumentAction} submitLabel="Create document">
          <FormGrid cols={3}>
            <TextField label="Document number" name="docNumber" hint="Leave blank to allocate the next number automatically." />
            <TextField label="Title" name="title" required className="sm:col-span-2" />
            <SelectField label="Type" name="docType" required options={DOC_TYPES.map((t) => ({ value: t, label: docTypeLabel(t) }))} defaultValue="drawing" />
            <TextField label="First revision label" name="revision" required defaultValue="A" hint="e.g. A, 01, 1.0" />
          </FormGrid>
          <FormGrid cols={2}>
            <SelectField label="Customer" name="customerId" placeholder="— None —" options={o.customers.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))} />
            <SelectField label="Part" name="partId" placeholder="— None —" options={o.parts.map((p) => ({ value: p.id, label: `${p.partNumber} — ${p.description}` }))} />
            <SelectField label="Machine" name="machineId" placeholder="— None —" options={o.machines.map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` }))} />
            <SelectField label="Supplier" name="supplierId" placeholder="— None —" options={o.suppliers.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }))} />
          </FormGrid>
          <CheckboxField label="Customer-supplied document" name="isCustomerSupplied" hint="The original file is preserved unchanged as the customer's master copy." />
          <TextArea label="Change description" name="changeDescription" rows={2} placeholder="Initial issue" />
          <FileField label="File" name="file" required />
        </ActionForm>
      </Panel>
    </>
  );
}
