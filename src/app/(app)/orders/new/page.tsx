import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { acceptedRevisionsFor } from "@/server/services/orders";
import { formatAddress } from "@/server/services/parties";
import { customerAddressOptions, customerOptions } from "@/server/services/ui/sales";
import { canAny } from "@/server/context";
import { fmtDate, fmtMoney } from "@/lib/format";
import { QUOTE_STATUS, statusDef } from "@/lib/status";
import { Notice, PageHeader, Panel, Section } from "@/components/ui";
import { ActionForm, FileField, FormGrid, NumberField, SelectField, TextArea, TextField } from "@/components/forms";
import { registerOrderAction } from "../actions";

export const metadata = { title: "Register customer PO" };

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ customerId?: string; revisionId?: string }> }) {
  const ctx = await requirePageCtx("orders.manage");
  const sp = await searchParams;
  const customers = await customerOptions(ctx);
  const customer = customers.find((c) => c.id === sp.customerId);

  if (!customer) {
    return (
      <>
        <PageHeader title="Register customer PO" description="Step 1 of 2 — choose the customer who sent the purchase order." />
        {sp.customerId && <Notice tone="warning">That customer was not found or is inactive.</Notice>}
        <Panel className="max-w-xl p-4">
          <form className="space-y-3" method="get">
            <label className="block text-[12.5px] font-medium text-ink-2" htmlFor="customerId">
              Customer
            </label>
            <select id="customerId" name="customerId" required className="field-input" defaultValue="">
              <option value="" disabled>
                Select a customer
              </option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
            <button className="inline-flex h-8.5 items-center rounded-sm border border-dykem bg-dykem px-3 text-[13.5px] font-medium text-white hover:bg-dykem-2">Continue</button>
          </form>
        </Panel>
      </>
    );
  }

  const commercial = canAny(ctx.actor, "jobs.view_commercial", "customers.view_commercial", "quotations.view");
  const [revs, addresses] = await Promise.all([acceptedRevisionsFor(ctx, customer.id), customerAddressOptions(ctx, customer.id)]);
  const delivery = addresses.filter((a) => a.kind !== "billing");
  const preselect = revs.find((x) => x.rev.id === sp.revisionId) ?? revs.find((x) => x.rev.status === "accepted") ?? null;
  const unverified = revs.filter((x) => x.rev.status !== "accepted").length;

  return (
    <>
      <PageHeader
        title="Register customer PO"
        description={
          <>
            Step 2 of 2 — {customer.name}.{" "}
            <Link href="/orders/new" className="link">
              Change customer
            </Link>
          </>
        }
      />
      {revs.length === 0 && (
        <Notice tone="warning" title="No sent or accepted quotation for this customer.">
          You can still register the PO now and link the quotation revision on the order page later. It cannot be verified or converted to a job until that revision is accepted and verified.
        </Notice>
      )}
      <Panel className="max-w-5xl p-4">
        <ActionForm action={registerOrderAction} submitLabel="Register PO">
          <input type="hidden" name="customerId" value={customer.id} />
          <Section title="Purchase order">
            <FormGrid cols={3}>
              <TextField label="Customer PO number" name="customerPoNumber" required autoFocus />
              <TextField label="PO date" name="poDate" type="date" />
              <TextField label="Required date" name="requiredDate" type="date" hint="As stated on the PO" />
              <SelectField
                label="Quotation revision"
                name="quotationRevisionId"
                placeholder="Not linked"
                defaultValue={preselect?.rev.id}
                className="sm:col-span-2"
                options={revs.map(({ rev, q }) => ({
                  value: rev.id,
                  label: `${q.ref} rev ${rev.revisionNo} — ${q.title} — ${statusDef(QUOTE_STATUS, rev.status).label}${rev.acceptanceVerifiedAt ? "" : rev.acceptanceRecordedAt ? " (acceptance not yet verified)" : ""}${commercial ? ` — ${fmtMoney(rev.total, rev.currency)}` : ""}`,
                }))}
                hint={unverified ? "Sent revisions are listed too; verification needs the acceptance to be recorded and verified first." : undefined}
              />
              {commercial && <NumberField label="Order value" name="orderValue" unit={customer.currency} hint={preselect ? `Quoted total ${fmtMoney(preselect.rev.total, preselect.rev.currency)}` : undefined} />}
              <SelectField
                label="Delivery address"
                name="deliveryAddressId"
                placeholder={delivery.length ? "Customer default delivery address" : "No addresses recorded"}
                className="sm:col-span-3"
                options={delivery.map((a) => ({ value: a.id, label: `${a.label ? `${a.label} — ` : ""}${formatAddress(a).replace(/\n/g, ", ")}${a.isDefault ? " (default)" : ""}` }))}
              />
            </FormGrid>
          </Section>
          <Section title="Terms and document">
            <FormGrid cols={2}>
              <TextArea label="Commercial terms on the PO" name="commercialTerms" rows={3} hint="Record any terms that differ from the quotation." />
              <TextArea label="Notes" name="notes" rows={3} />
            </FormGrid>
            <div className="mt-3">
              <FileField label="PO document" name="poFile" hint="The customer’s PO (PDF or email). Required before contract review; stored unaltered." />
            </div>
          </Section>
          {preselect && preselect.rev.validUntil && <p className="text-[12px] text-steel">Selected quotation valid until {fmtDate(preselect.rev.validUntil)}.</p>}
        </ActionForm>
      </Panel>
    </>
  );
}
