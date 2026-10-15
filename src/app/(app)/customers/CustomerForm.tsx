"use client";

import { ActionForm, FormGrid, TextArea, TextField } from "@/components/forms";
import type { ActionResult } from "@/server/boundary";

type Customer = Partial<Record<string, string | null>> & { id?: string };

export function CustomerForm({
  action,
  customer,
  showCommercial,
  submitLabel,
}: {
  action: (p: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  customer?: Customer;
  showCommercial: boolean;
  submitLabel: string;
}) {
  const c = customer ?? {};
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      {c.id && <input type="hidden" name="id" value={c.id} />}
      <FormGrid cols={3}>
        <TextField label="Customer code" name="code" required defaultValue={c.code} hint="Short unique code, e.g. ACME" />
        <TextField label="Company name" name="name" required defaultValue={c.name} className="sm:col-span-2" />
        <TextField label="Email" name="email" type="email" defaultValue={c.email} />
        <TextField label="Phone" name="phone" defaultValue={c.phone} />
        <TextField label="Website" name="website" defaultValue={c.website} />
        <TextField label="VAT number" name="vatNumber" defaultValue={c.vatNumber} />
        <TextField label="Currency" name="currency" defaultValue={c.currency ?? "GBP"} />
        {showCommercial && (
          <>
            <TextField label="Account reference" name="accountRef" defaultValue={c.accountRef} />
            <TextField label="Payment terms" name="paymentTerms" defaultValue={c.paymentTerms} placeholder="e.g. 30 days end of month" />
            <TextField label="Credit limit" name="creditLimit" defaultValue={c.creditLimit} />
          </>
        )}
      </FormGrid>
      <FormGrid cols={2}>
        <TextArea label="Quality requirements" name="qualityRequirements" defaultValue={c.qualityRequirements} hint="e.g. AS9100 flow-down, FAIR on first article" />
        <TextArea label="Required certificates" name="requiredCertificates" defaultValue={c.requiredCertificates} hint="e.g. EN 10204 3.1 material certs, CoC with every delivery" />
        <TextArea label="Delivery preferences" name="deliveryPreferences" defaultValue={c.deliveryPreferences} />
        <TextArea label="Packaging requirements" name="packagingRequirements" defaultValue={c.packagingRequirements} />
      </FormGrid>
      <TextArea label="Notes" name="notes" defaultValue={c.notes} />
    </ActionForm>
  );
}
