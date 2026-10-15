import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { getEnquiry } from "@/server/services/enquiries";
import { getSettings } from "@/server/services/settings";
import { customerContactOptions, customerOptions } from "@/server/services/ui/sales";
import { can } from "@/server/context";
import { AppError } from "@/server/errors";
import { fmtQty } from "@/lib/format";
import { Notice, PageHeader, Panel, Ref, Section } from "@/components/ui";
import { ActionForm, CheckboxField, FormGrid, NumberField, SelectField, TextArea, TextField } from "@/components/forms";
import { CustomerContactFields } from "../../enquiries/_components/CustomerContactFields";
import { TAX_OPTIONS } from "../_components/labels";
import { createQuotationAction } from "../actions";

export const metadata = { title: "New quotation" };

export default async function NewQuotationPage({ searchParams }: { searchParams: Promise<{ enquiryId?: string; customerId?: string }> }) {
  const ctx = await requirePageCtx("quotations.manage");
  const sp = await searchParams;
  const enquiry =
    sp.enquiryId && can(ctx.actor, "enquiries.view")
      ? await getEnquiry(ctx, sp.enquiryId).catch((e) => {
          if (e instanceof AppError && e.code === "not_found") return null;
          throw e;
        })
      : null;
  const [settings, customers, contacts] = await Promise.all([getSettings(ctx.db), customerOptions(ctx), customerContactOptions(ctx)]);
  const customerId = enquiry?.customer.id ?? sp.customerId;
  const currency = customers.find((c) => c.id === customerId)?.currency ?? "GBP";

  return (
    <>
      <PageHeader
        title="New quotation"
        description="Set the commercial basis here. Lines and costing are added on the quotation page; revision 1 starts as a draft."
      />
      {sp.enquiryId && !enquiry && <Notice tone="warning">The enquiry could not be found or you cannot view it. The quotation will not be linked to an enquiry.</Notice>}
      {enquiry && (
        <Notice tone="info">
          From enquiry{" "}
          <Ref href={`/enquiries/${enquiry.e.id}`} size="sm">
            {enquiry.e.ref}
          </Ref>{" "}
          — {enquiry.e.subject} ({enquiry.lines.length} {enquiry.lines.length === 1 ? "line" : "lines"}).{" "}
          <span className="text-[12.5px]">Tick “Copy enquiry lines” below to start the draft with them.</span>
        </Notice>
      )}
      <Panel className="max-w-5xl p-4">
        <ActionForm action={createQuotationAction} submitLabel="Create quotation">
          {enquiry && <input type="hidden" name="enquiryId" value={enquiry.e.id} />}
          {enquiry && enquiry.lines.length > 0 && (
            <CheckboxField label="Copy enquiry lines" name="copyLines" defaultChecked hint="Part numbers, descriptions, drawings, materials and quantities are copied with zero costs. Add costing to each line before review." />
          )}
          <Section title="Customer">
            <FormGrid cols={3}>
              <CustomerContactFields customers={customers} contacts={contacts} defaultCustomerId={customerId} defaultContactId={enquiry?.e.contactId} lockCustomer={!!enquiry} />
              <TextField label="Title" name="title" required defaultValue={enquiry?.e.subject} placeholder="e.g. Machined brackets — 4 part numbers" />
            </FormGrid>
          </Section>
          <Section title="Commercial basis">
            <FormGrid cols={4}>
              <TextField label="Currency" name="currency" defaultValue={currency} hint="3-letter code" />
              <SelectField label="Tax treatment" name="taxTreatment" options={TAX_OPTIONS} defaultValue="standard" />
              <NumberField label="Tax rate" name="taxRate" unit="%" defaultValue={settings.defaultTaxRate} />
              <NumberField label="Default margin" name="defaultMarginPct" unit="%" required defaultValue="25" hint="Gross margin on selling price" />
              <NumberField label="Validity" name="validityDays" unit="days" defaultValue={settings.quoteValidityDays} />
              <TextField label="Lead time" name="leadTime" placeholder="e.g. 3–4 weeks from order" className="sm:col-span-3" />
            </FormGrid>
          </Section>
          <Section title="Terms and notes">
            <FormGrid cols={2}>
              <TextArea label="Commercial terms" name="commercialTerms" rows={5} defaultValue={settings.defaultQuoteTerms} hint={settings.defaultQuoteTerms ? "Pre-filled from company settings." : "No default terms set in company settings."} />
              <TextArea label="Delivery terms" name="deliveryTerms" rows={5} placeholder="e.g. Ex works, delivered to customer goods-in" />
            </FormGrid>
            <div className="mt-3">
              <TextArea label="Notes to customer" name="notes" rows={3} />
            </div>
          </Section>
        </ActionForm>
      </Panel>
      {enquiry && enquiry.lines.length > 0 && (
        <Section title="Enquiry lines for reference" className="mt-6 max-w-5xl">
          <ul className="list-disc pl-5 text-[13px] text-ink-2">
            {enquiry.lines.map((l) => (
              <li key={l.id}>
                <span className="plate">{l.partNumber}</span> — {l.description} × {fmtQty(l.quantity)}
                {l.drawingNumber && ` (drawing ${l.drawingNumber}${l.drawingRevision ? ` rev ${l.drawingRevision}` : ""})`}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-steel">
            <Link href={`/enquiries/${enquiry.e.id}?tab=attachments`} className="link">
              Open the enquiry attachments
            </Link>{" "}
            to check drawings while costing.
          </p>
        </Section>
      )}
    </>
  );
}
