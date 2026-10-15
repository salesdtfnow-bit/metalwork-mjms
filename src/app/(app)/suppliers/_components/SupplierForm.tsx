"use client";

import { ActionForm, CheckboxField, FormGrid, TextArea, TextField } from "@/components/forms";
import type { ActionResult } from "@/server/boundary";
import { CATEGORY_OPTIONS } from "./categories";

type Supplier = Partial<Record<string, string | null>>;

export function SupplierForm({
  action,
  supplier,
  categories,
  submitLabel,
}: {
  action: (p: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  supplier?: Supplier;
  categories?: string[];
  submitLabel: string;
}) {
  const s = supplier ?? {};
  const cats = categories ?? [];
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      {s.id && <input type="hidden" name="id" value={s.id} />}
      <FormGrid cols={3}>
        <TextField label="Supplier code" name="code" required defaultValue={s.code} hint="Short unique code, e.g. SMITHMET" />
        <TextField label="Company name" name="name" required defaultValue={s.name} className="sm:col-span-2" />
        <TextField label="Email" name="email" type="email" defaultValue={s.email} />
        <TextField label="Phone" name="phone" defaultValue={s.phone} />
        <TextField label="Website" name="website" defaultValue={s.website} />
        <TextField label="VAT number" name="vatNumber" defaultValue={s.vatNumber} />
        <TextField label="Currency" name="currency" defaultValue={s.currency ?? "GBP"} />
        <TextField label="BoxHero partner ID" name="boxheroPartnerId" defaultValue={s.boxheroPartnerId} hint="Optional — links stock receipts" />
        <TextField label="Account reference" name="accountRef" defaultValue={s.accountRef} />
        <TextField label="Payment terms" name="paymentTerms" defaultValue={s.paymentTerms} placeholder="e.g. 30 days end of month" />
      </FormGrid>
      <fieldset>
        <legend className="mb-1 text-[12.5px] font-medium text-ink-2">Categories</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {CATEGORY_OPTIONS.map((c) => (
            <CheckboxField key={c.value} label={c.label} name="categories" value={c.value} defaultChecked={cats.includes(c.value)} />
          ))}
        </div>
      </fieldset>
      <FormGrid cols={2}>
        <TextArea label="Certifications" name="certifications" defaultValue={s.certifications} hint="e.g. ISO 9001:2015 cert 12345, expires 03/2027; NADCAP heat treat" />
        <TextArea label="Notes" name="notes" defaultValue={s.notes} />
      </FormGrid>
    </ActionForm>
  );
}
