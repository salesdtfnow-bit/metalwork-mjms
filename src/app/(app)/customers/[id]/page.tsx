import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { customerHistory, formatAddress, getCustomer, listPartyFiles } from "@/server/services/parties";
import { can } from "@/server/context";
import { AppError } from "@/server/errors";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { ENQUIRY_STATUS, JOB_STATUS, QUOTE_STATUS } from "@/lib/status";
import { Badge, KeyValues, Ref, Section, StatusBadge, Table, Tabs, TitleBlock } from "@/components/ui";
import { ActionForm, CheckboxField, Disclosure, FileField, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { AuditList } from "@/components/AuditList";
import { CustomerForm } from "../CustomerForm";
import {
  addAddressAction,
  addContactAction,
  addRequirementAction,
  attachCustomerFileAction,
  setCustomerActiveAction,
  toggleRequirementAction,
  updateCustomerAction,
} from "../actions";

const REQ_KINDS = [
  { value: "inspection", label: "Inspection" },
  { value: "material_cert", label: "Material certification" },
  { value: "packaging", label: "Packaging" },
  { value: "documentation", label: "Documentation" },
  { value: "marking", label: "Marking / identification" },
  { value: "other", label: "Other" },
];

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageCtx("customers.view");
  const { id } = await params;
  const tab = (await searchParams).tab ?? "overview";
  const data = await getCustomer(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const { customer: c, contacts, addresses, requirements } = data;
  const manage = can(ctx.actor, "customers.manage");
  const commercial = can(ctx.actor, "customers.view_commercial");
  const history = tab === "history" ? await customerHistory(ctx, id) : null;
  const files = tab === "files" ? await listPartyFiles(ctx, { customerId: id }) : [];

  return (
    <>
      <TitleBlock
        kind="Customer"
        refNo={c.code}
        title={c.name}
        status={c.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="muted">Inactive</Badge>}
        cells={[
          { label: "Email", value: c.email },
          { label: "Phone", value: c.phone },
          { label: "Currency", value: c.currency },
          { label: "Payment terms", value: commercial ? c.paymentTerms : "Restricted" },
          { label: "Contacts", value: contacts.length },
          { label: "Requirements", value: requirements.filter((r) => r.isActive).length },
        ]}
        actions={
          manage && (
            <ActionForm action={setCustomerActiveAction} submitLabel={c.isActive ? "Deactivate" : "Reactivate"} submitVariant="secondary" submitSize="sm" confirm={c.isActive ? "Deactivated customers cannot receive new enquiries or quotations. Existing records are kept." : undefined}>
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="active" value={c.isActive ? "false" : "true"} />
            </ActionForm>
          )
        }
      />
      <Tabs
        base={`/customers/${id}`}
        current={tab}
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "contacts", label: "Contacts & addresses", count: contacts.length + addresses.length },
          { key: "requirements", label: "Requirements", count: requirements.length },
          { key: "files", label: "Files" },
          { key: "history", label: "History" },
        ]}
      />

      {tab === "overview" && (
        <>
          <Section title="Details">
            <KeyValues
              items={[
                { label: "Website", value: c.website },
                { label: "VAT number", value: c.vatNumber },
                { label: "Account reference", value: commercial ? c.accountRef : "Restricted" },
                { label: "Credit limit", value: commercial ? c.creditLimit : "Restricted" },
                { label: "Quality requirements", value: c.qualityRequirements, wide: true },
                { label: "Required certificates", value: c.requiredCertificates, wide: true },
                { label: "Delivery preferences", value: c.deliveryPreferences },
                { label: "Packaging requirements", value: c.packagingRequirements },
                { label: "Notes", value: c.notes, wide: true },
              ]}
            />
          </Section>
          {manage && (
            <Disclosure label="Edit details">
              <CustomerForm action={updateCustomerAction} customer={c as never} showCommercial={commercial} submitLabel="Save changes" />
            </Disclosure>
          )}
        </>
      )}

      {tab === "contacts" && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Section title="Contacts" actions={manage && <span />}>
            <Table head={["Name", "Role", "Email", "Phone", ""]} empty="No contacts yet.">
              {contacts.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.name}</td>
                  <td>{p.jobTitle ?? "—"}</td>
                  <td>{p.email ?? "—"}</td>
                  <td>{p.phone ?? "—"}</td>
                  <td>{p.isPrimary && <Badge tone="info">Primary</Badge>}</td>
                </tr>
              ))}
            </Table>
            {manage && (
              <div className="mt-3">
                <Disclosure label="Add contact">
                  <ActionForm action={addContactAction} submitLabel="Add contact" resetOnSuccess>
                    <input type="hidden" name="ownerId" value={id} />
                    <FormGrid>
                      <TextField label="Name" name="name" required />
                      <TextField label="Job title" name="jobTitle" />
                      <TextField label="Email" name="email" type="email" />
                      <TextField label="Phone" name="phone" />
                    </FormGrid>
                    <CheckboxField label="Primary contact" name="isPrimary" />
                  </ActionForm>
                </Disclosure>
              </div>
            )}
          </Section>
          <Section title="Addresses">
            <Table head={["Type", "Address", "Instructions", ""]} empty="No addresses yet. Add a delivery address before creating jobs.">
              {addresses.map((a) => (
                <tr key={a.id}>
                  <td className="capitalize">{a.kind}{a.label ? ` — ${a.label}` : ""}</td>
                  <td className="whitespace-pre-line">{formatAddress(a)}</td>
                  <td className="text-steel">{a.deliveryInstructions ?? ""}</td>
                  <td>{a.isDefault && <Badge tone="info">Default</Badge>}</td>
                </tr>
              ))}
            </Table>
            {manage && (
              <div className="mt-3">
                <Disclosure label="Add address">
                  <ActionForm action={addAddressAction} submitLabel="Add address" resetOnSuccess>
                    <input type="hidden" name="ownerId" value={id} />
                    <FormGrid>
                      <SelectField label="Type" name="kind" options={[{ value: "delivery", label: "Delivery" }, { value: "billing", label: "Billing" }, { value: "site", label: "Site" }]} defaultValue="delivery" />
                      <TextField label="Label" name="label" placeholder="e.g. Goods-in, Unit 4" />
                      <TextField label="Address line 1" name="line1" required />
                      <TextField label="Address line 2" name="line2" />
                      <TextField label="Town / city" name="city" />
                      <TextField label="County" name="county" />
                      <TextField label="Postcode" name="postcode" />
                      <TextField label="Country" name="country" defaultValue="United Kingdom" />
                    </FormGrid>
                    <TextArea label="Delivery instructions" name="deliveryInstructions" rows={2} />
                    <CheckboxField label="Default address of this type" name="isDefault" />
                  </ActionForm>
                </Disclosure>
              </div>
            )}
          </Section>
        </div>
      )}

      {tab === "requirements" && (
        <Section title="Customer-specific requirements" actions={<span className="text-[12px] text-steel">Active mandatory requirements appear on every final-release checklist for this customer.</span>}>
          <Table head={["Type", "Requirement", "Mandatory", "Status", ""]} empty="No customer-specific requirements recorded.">
            {requirements.map((r) => (
              <tr key={r.id}>
                <td>{REQ_KINDS.find((k) => k.value === r.kind)?.label ?? r.kind}</td>
                <td className="whitespace-pre-wrap">{r.description}</td>
                <td>{r.mandatory ? "Yes" : "No"}</td>
                <td>{r.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="muted">Disabled</Badge>}</td>
                <td>
                  {manage && (
                    <ActionForm action={toggleRequirementAction} submitLabel={r.isActive ? "Disable" : "Enable"} submitVariant="ghost" submitSize="sm">
                      <input type="hidden" name="ownerId" value={id} />
                      <input type="hidden" name="requirementId" value={r.id} />
                      <input type="hidden" name="active" value={r.isActive ? "false" : "true"} />
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          {manage && (
            <div className="mt-3">
              <Disclosure label="Add requirement">
                <ActionForm action={addRequirementAction} submitLabel="Add requirement" resetOnSuccess>
                  <input type="hidden" name="ownerId" value={id} />
                  <SelectField label="Type" name="kind" options={REQ_KINDS} defaultValue="documentation" />
                  <TextArea label="Requirement" name="description" required placeholder="e.g. Certificate of Conformity signed by quality manager with each delivery" />
                  <CheckboxField label="Mandatory (blocks final release until confirmed)" name="mandatory" defaultChecked />
                </ActionForm>
              </Disclosure>
            </div>
          )}
        </Section>
      )}

      {tab === "files" && (
        <Section title="Files">
          <Table head={["File", "Description", "Uploaded"]} empty="No files attached.">
            {files.map(({ pf, file }) => (
              <tr key={pf.id}>
                <td>
                  <a className="link" href={`/api/files/${file.id}`}>
                    {file.originalName}
                  </a>
                </td>
                <td>{pf.description ?? ""}</td>
                <td className="text-steel">{fmtDateTime(file.uploadedAt)}</td>
              </tr>
            ))}
          </Table>
          {manage && (
            <div className="mt-3">
              <Disclosure label="Attach file">
                <ActionForm action={attachCustomerFileAction} submitLabel="Upload" resetOnSuccess>
                  <input type="hidden" name="ownerId" value={id} />
                  <FileField label="File" name="file" required />
                  <TextField label="Description" name="description" placeholder="e.g. Customer quality manual rev 4" />
                </ActionForm>
              </Disclosure>
            </div>
          )}
        </Section>
      )}

      {tab === "history" && history && (
        <>
          <Section title="Jobs">
            <Table head={["Job", "Title", "Status", "Required"]} empty="No jobs yet.">
              {history.jobs.map((j) => (
                <tr key={j.id}>
                  <td><Ref href={`/jobs/${j.id}`}>{j.jobNumber}</Ref></td>
                  <td>{j.title}</td>
                  <td><StatusBadge map={JOB_STATUS} status={j.status} /></td>
                  <td>{fmtDate(j.requiredDate)}</td>
                </tr>
              ))}
            </Table>
          </Section>
          <Section title="Quotations">
            <Table head={["Quotation", "Title", "Status", "Created"]} empty="No quotations yet.">
              {history.quotations.map((q) => (
                <tr key={q.id}>
                  <td><Ref href={`/quotations/${q.id}`}>{q.ref}</Ref></td>
                  <td>{q.title}</td>
                  <td><StatusBadge map={QUOTE_STATUS} status={q.status} /></td>
                  <td>{fmtDate(q.createdAt)}</td>
                </tr>
              ))}
            </Table>
          </Section>
          <Section title="Enquiries">
            <Table head={["Enquiry", "Subject", "Status", "Received"]} empty="No enquiries yet.">
              {history.enquiries.map((e) => (
                <tr key={e.id}>
                  <td><Ref href={`/enquiries/${e.id}`}>{e.ref}</Ref></td>
                  <td>{e.subject}</td>
                  <td><StatusBadge map={ENQUIRY_STATUS} status={e.status} /></td>
                  <td>{fmtDate(e.receivedAt)}</td>
                </tr>
              ))}
            </Table>
          </Section>
          <Section title="Record changes">
            <AuditList events={history.events} />
          </Section>
          <p className="text-[12px] text-steel">
            Full traceability for a job is on the job&apos;s <Link href="/traceability" className="link">traceability</Link> page.
          </p>
        </>
      )}
    </>
  );
}
