import { ActionForm, Disclosure, SelectField, TextField } from "@/components/forms";
import { createEnquiryFromEmailAction, ignoreEmailAction, linkEmailAction } from "../actions";

type Opt = { value: string; label: string };

/** Create / link / ignore controls for one unassigned inbound email. */
export function InboxActions({
  emailId,
  subject,
  suggestedCustomerId,
  customers,
  openEnquiries,
  canManageEnquiries,
}: {
  emailId: string;
  subject: string;
  suggestedCustomerId?: string | null;
  customers: Opt[];
  openEnquiries: Opt[];
  canManageEnquiries: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {canManageEnquiries && (
        <Disclosure label="Create enquiry" variant="primary">
          <ActionForm action={createEnquiryFromEmailAction} submitLabel="Create enquiry" className="w-[min(460px,80vw)]">
            <input type="hidden" name="emailId" value={emailId} />
            <SelectField label="Customer" name="customerId" required placeholder="Select a customer" defaultValue={suggestedCustomerId} options={customers} hint={suggestedCustomerId ? "Suggested from the sender’s email domain — check it." : undefined} />
            <TextField label="Subject" name="subject" defaultValue={subject} />
            <p className="text-[12px] text-steel">The email text becomes the enquiry description, and its attachments are added as customer originals.</p>
          </ActionForm>
        </Disclosure>
      )}
      {canManageEnquiries && (
        <Disclosure label="Link to enquiry">
          {openEnquiries.length ? (
            <ActionForm action={linkEmailAction} submitLabel="Link email" className="w-[min(460px,80vw)]">
              <input type="hidden" name="emailId" value={emailId} />
              <SelectField label="Open enquiry" name="enquiryId" required placeholder="Select an enquiry" options={openEnquiries} />
            </ActionForm>
          ) : (
            <p className="text-[13px] text-steel">There are no open enquiries to link to.</p>
          )}
        </Disclosure>
      )}
      <Disclosure label="Ignore" variant="ghost">
        <ActionForm action={ignoreEmailAction} submitLabel="Ignore email" submitVariant="secondary" className="w-[min(380px,80vw)]">
          <input type="hidden" name="emailId" value={emailId} />
          <TextField label="Reason" name="reason" required placeholder="e.g. Marketing, supplier invoice, duplicate" />
        </ActionForm>
      </Disclosure>
    </div>
  );
}
