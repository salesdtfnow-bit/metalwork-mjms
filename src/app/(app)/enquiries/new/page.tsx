import { requirePageCtx } from "@/server/auth/next";
import { customerContactOptions, customerOptions, listActiveUsers } from "@/server/services/ui/sales";
import { PageHeader, Panel, Section } from "@/components/ui";
import { ActionForm, FileField, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { CustomerContactFields } from "../_components/CustomerContactFields";
import { RECEIVED_VIA_OPTIONS } from "../_components/labels";
import { createEnquiryAction } from "../actions";

export const metadata = { title: "New enquiry" };

const INITIAL_LINES = 3;

export default async function NewEnquiryPage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  const ctx = await requirePageCtx("enquiries.manage");
  const sp = await searchParams;
  const [customers, contacts, users] = await Promise.all([customerOptions(ctx), customerContactOptions(ctx), listActiveUsers(ctx)]);
  return (
    <>
      <PageHeader title="New enquiry" description="Record what the customer asked for. More lines and files can be added on the enquiry page afterwards." />
      <Panel className="max-w-5xl p-4">
        <ActionForm action={createEnquiryAction} submitLabel="Create enquiry">
          <Section title="Customer and request">
            <FormGrid cols={3}>
              <CustomerContactFields customers={customers} contacts={contacts} defaultCustomerId={sp.customerId} />
              <TextField label="Customer reference" name="customerReference" placeholder="Their RFQ number, if any" />
              <TextField label="Subject" name="subject" required className="sm:col-span-2" placeholder="e.g. RFQ — 4 off machined brackets, 6082-T6" />
              <SelectField label="Owner" name="ownerId" placeholder="Me" options={users.map((u) => ({ value: u.id, label: u.name }))} defaultValue={ctx.actor.userId} />
              <TextField label="Received at" name="receivedAt" type="datetime-local" hint="Leave blank for now." />
              <SelectField label="Received via" name="receivedVia" options={RECEIVED_VIA_OPTIONS} defaultValue="email" />
              <TextField label="Requested delivery date" name="requestedDeliveryDate" type="date" />
            </FormGrid>
            <div className="mt-3">
              <TextArea label="Description" name="description" rows={4} placeholder="Scope, quantities, finishes, certification, anything the customer said that affects the price." />
            </div>
          </Section>

          <Section title="Lines (optional)" actions={<span className="text-[12px] text-steel">Rows without a part number are ignored.</span>}>
            <div className="overflow-x-auto">
              <table className="data-table min-w-[760px]">
                <thead>
                  <tr>
                    <th scope="col">Part number</th>
                    <th scope="col">Description</th>
                    <th scope="col">Qty</th>
                    <th scope="col">Drawing no.</th>
                    <th scope="col">Rev</th>
                    <th scope="col">Material</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: INITIAL_LINES }, (_, n) => (
                    <tr key={n}>
                      <td>
                        <input name="line_part" className="field-input" aria-label={`Line ${n + 1} part number`} />
                      </td>
                      <td>
                        <input name="line_desc" className="field-input" aria-label={`Line ${n + 1} description`} />
                      </td>
                      <td className="w-24">
                        <input name="line_qty" inputMode="decimal" className="field-input" aria-label={`Line ${n + 1} quantity`} />
                      </td>
                      <td>
                        <input name="line_drg" className="field-input" aria-label={`Line ${n + 1} drawing number`} />
                      </td>
                      <td className="w-20">
                        <input name="line_rev" className="field-input" aria-label={`Line ${n + 1} drawing revision`} />
                      </td>
                      <td>
                        <input name="line_mat" className="field-input" aria-label={`Line ${n + 1} material`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Customer files">
            <FileField label="Drawings, models and documents" name="files" multiple hint="Kept unaltered as customer originals. The type is guessed from the file extension; you can register drawings as controlled documents later." />
          </Section>
        </ActionForm>
      </Panel>
    </>
  );
}
