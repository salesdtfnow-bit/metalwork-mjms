import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { formatAddress, getSupplier, listPartyFiles, supplierUsable } from "@/server/services/parties";
import { listPurchaseOrders } from "@/server/services/purchasing";
import { supplierPerformance } from "@/server/services/reports";
import { entityHistory, userNames } from "@/server/services/ui/sales";
import { can } from "@/server/context";
import { AppError } from "@/server/errors";
import { fmtDate, fmtDateTime, fmtMoney, todayISO } from "@/lib/format";
import { PO_STATUS } from "@/lib/status";
import { Badge, KeyValues, Notice, Ref, Section, Stat, StatusBadge, Table, Tabs, TitleBlock } from "@/components/ui";
import { ActionForm, CheckboxField, Disclosure, FileField, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { AuditList } from "@/components/AuditList";
import { SupplierForm } from "../_components/SupplierForm";
import { ApprovalBadge, APPROVAL_OPTIONS, categoryLabel } from "../_components/approval";
import { addSupplierAddressAction, addSupplierContactAction, attachSupplierFileAction, setApprovalAction, setSupplierActiveAction, updateSupplierAction } from "../actions";

export default async function SupplierPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageCtx("suppliers.view");
  const { id } = await params;
  const tab = (await searchParams).tab ?? "overview";
  const data = await getSupplier(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const { supplier: s, contacts, addresses } = data;
  const manage = can(ctx.actor, "suppliers.manage");
  const approve = can(ctx.actor, "suppliers.approve");
  const seePOs = can(ctx.actor, "purchasing.view");
  const today = todayISO();
  const usable = supplierUsable(s, today);

  const [names, files, perf, pos, history] = await Promise.all([
    tab === "approval" ? userNames(ctx, [s.approvedBy]) : Promise.resolve({} as Record<string, string>),
    tab === "files" ? listPartyFiles(ctx, { supplierId: id }) : Promise.resolve([]),
    tab === "performance" ? supplierPerformance(ctx).then((rows) => rows.find((r) => r.supplier.id === id) ?? null) : Promise.resolve(null),
    tab === "performance" && seePOs ? listPurchaseOrders(ctx, { supplierId: id }) : Promise.resolve([]),
    tab === "history" ? entityHistory(ctx, "supplier", id) : Promise.resolve([]),
  ]);

  return (
    <>
      <TitleBlock
        kind="Supplier"
        refNo={s.code}
        title={s.name}
        status={
          <>
            <ApprovalBadge status={s.approvalStatus} expiresOn={s.approvalExpiresOn} today={today} />
            {!s.isActive && <Badge tone="muted">Inactive</Badge>}
          </>
        }
        actions={
          manage && (
            <Disclosure label={s.isActive ? "Deactivate" : "Reactivate"} variant="ghost">
              <ActionForm
                action={setSupplierActiveAction}
                submitLabel={s.isActive ? "Deactivate supplier" : "Reactivate supplier"}
                submitVariant={s.isActive ? "danger" : "primary"}
                confirm={s.isActive ? "Deactivated suppliers cannot be used on new purchase orders or subcontract orders. Existing records are kept." : undefined}
                className="w-[min(420px,80vw)]"
              >
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="active" value={s.isActive ? "false" : "true"} />
                <TextArea label="Reason" name="reason" rows={2} required placeholder={s.isActive ? "e.g. Ceased trading; replaced by another supplier" : "e.g. Re-engaged after review"} />
              </ActionForm>
            </Disclosure>
          )
        }
        cells={[
          { label: "Categories", value: s.categories.length ? s.categories.map(categoryLabel).join(", ") : "—" },
          { label: "Approval scope", value: s.approvalScope ?? "—" },
          { label: "Approval expires", value: fmtDate(s.approvalExpiresOn) },
          { label: "Email", value: s.email },
          { label: "Phone", value: s.phone },
          { label: "Contacts", value: contacts.length },
        ]}
      />
      {!usable && s.isActive && (
        <Notice tone="warning" title="Not usable for new purchase orders">
          This supplier is not currently approved (or its approval has expired). Purchasing and subcontract checks will block or warn until approval is renewed.
        </Notice>
      )}
      <Tabs
        base={`/suppliers/${id}`}
        current={tab}
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "approval", label: "Approval" },
          { key: "contacts", label: "Contacts & addresses", count: contacts.length + addresses.length },
          { key: "files", label: "Files" },
          { key: "performance", label: "Performance" },
          { key: "history", label: "History" },
        ]}
      />

      {tab === "overview" && (
        <>
          <Section title="Details">
            <KeyValues
              items={[
                { label: "Website", value: s.website },
                { label: "VAT number", value: s.vatNumber },
                { label: "Currency", value: s.currency },
                { label: "Account reference", value: s.accountRef },
                { label: "Payment terms", value: s.paymentTerms },
                { label: "BoxHero partner ID", value: s.boxheroPartnerId },
                { label: "Certifications", value: s.certifications, wide: true },
                { label: "Notes", value: s.notes, wide: true },
              ]}
            />
          </Section>
          {manage && (
            <Disclosure label="Edit details">
              <SupplierForm
                action={updateSupplierAction}
                supplier={{
                  id: s.id,
                  code: s.code,
                  name: s.name,
                  email: s.email,
                  phone: s.phone,
                  website: s.website,
                  vatNumber: s.vatNumber,
                  accountRef: s.accountRef,
                  paymentTerms: s.paymentTerms,
                  currency: s.currency,
                  certifications: s.certifications,
                  notes: s.notes,
                  boxheroPartnerId: s.boxheroPartnerId,
                }}
                categories={s.categories}
                submitLabel="Save changes"
              />
            </Disclosure>
          )}
        </>
      )}

      {tab === "approval" && (
        <Section title="Approved-supplier status">
          <KeyValues
            items={[
              { label: "Status", value: <ApprovalBadge status={s.approvalStatus} expiresOn={s.approvalExpiresOn} today={today} /> },
              { label: "Expires on", value: fmtDate(s.approvalExpiresOn) },
              { label: "Usable today", value: usable ? "Yes" : "No" },
              { label: "Scope of approval", value: s.approvalScope, wide: true },
              { label: "Last changed by", value: s.approvedBy ? `${names[s.approvedBy] ?? "Unknown user"}, ${fmtDateTime(s.approvedAt)}` : null },
              { label: "Certifications held", value: s.certifications, wide: true },
            ]}
          />
          <p className="mt-3 text-[12px] text-steel">Every change is recorded with its reason in the History tab.</p>
          {approve && (
            <div className="mt-3">
              <Disclosure label="Change approval status">
                <ActionForm action={setApprovalAction} submitLabel="Update approval" className="max-w-2xl">
                  <input type="hidden" name="id" value={s.id} />
                  <FormGrid cols={2}>
                    <SelectField label="Status" name="status" required options={APPROVAL_OPTIONS} defaultValue={s.approvalStatus} />
                    <TextField label="Approval expires on" name="expiresOn" type="date" defaultValue={s.approvalExpiresOn} hint="e.g. the expiry of their ISO 9001 certificate" />
                  </FormGrid>
                  <TextArea label="Scope" name="scope" rows={2} defaultValue={s.approvalScope} placeholder="e.g. Aluminium and stainless bar to EN 10204 3.1; anodising Type II only" />
                  <TextArea label="Reason" name="reason" rows={2} required placeholder="e.g. Annual review passed; audit report QA-2026-14" />
                </ActionForm>
              </Disclosure>
            </div>
          )}
        </Section>
      )}

      {tab === "contacts" && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Section title="Contacts">
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
                  <ActionForm action={addSupplierContactAction} submitLabel="Add contact" resetOnSuccess>
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
            <Table head={["Type", "Address", "Instructions", ""]} empty="No addresses yet.">
              {addresses.map((a) => (
                <tr key={a.id}>
                  <td className="capitalize">
                    {a.kind}
                    {a.label ? ` — ${a.label}` : ""}
                  </td>
                  <td className="whitespace-pre-line">{formatAddress(a)}</td>
                  <td className="text-steel">{a.deliveryInstructions ?? ""}</td>
                  <td>{a.isDefault && <Badge tone="info">Default</Badge>}</td>
                </tr>
              ))}
            </Table>
            {manage && (
              <div className="mt-3">
                <Disclosure label="Add address">
                  <ActionForm action={addSupplierAddressAction} submitLabel="Add address" resetOnSuccess>
                    <input type="hidden" name="ownerId" value={id} />
                    <FormGrid>
                      <SelectField
                        label="Type"
                        name="kind"
                        options={[
                          { value: "site", label: "Site / collection" },
                          { value: "delivery", label: "Delivery (send work here)" },
                          { value: "billing", label: "Billing" },
                        ]}
                        defaultValue="site"
                      />
                      <TextField label="Label" name="label" placeholder="e.g. Works, Goods-in" />
                      <TextField label="Address line 1" name="line1" required />
                      <TextField label="Address line 2" name="line2" />
                      <TextField label="Town / city" name="city" />
                      <TextField label="County" name="county" />
                      <TextField label="Postcode" name="postcode" />
                      <TextField label="Country" name="country" defaultValue="United Kingdom" />
                    </FormGrid>
                    <TextArea label="Instructions" name="deliveryInstructions" rows={2} />
                    <CheckboxField label="Default address of this type" name="isDefault" />
                  </ActionForm>
                </Disclosure>
              </div>
            )}
          </Section>
        </div>
      )}

      {tab === "files" && (
        <Section title="Files" actions={<span className="text-[12px] text-steel">Certificates, approval questionnaires, audit reports.</span>}>
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
                <ActionForm action={attachSupplierFileAction} submitLabel="Upload" resetOnSuccess>
                  <input type="hidden" name="ownerId" value={id} />
                  <FileField label="File" name="file" required />
                  <TextField label="Description" name="description" placeholder="e.g. ISO 9001 certificate, expires Mar 2027" />
                </ActionForm>
              </Disclosure>
            </div>
          )}
        </Section>
      )}

      {tab === "performance" && (
        <>
          <Section title="Performance summary">
            {perf ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="PO lines placed" value={perf.poLines} />
                <Stat label="PO lines fully received" value={perf.received} sub={perf.poLines ? `${Math.round((perf.received / perf.poLines) * 100)}% of lines` : undefined} />
                <Stat label="Non-conformances" value={perf.ncrs} tone={perf.ncrs > 0 ? "warning" : undefined} />
                <Stat label="Approval" value={<span className="text-[15px]">{usable ? "Usable" : "Blocked"}</span>} tone={usable ? "success" : "danger"} />
              </div>
            ) : (
              <p className="text-[13px] text-steel">No performance figures — the summary only covers active suppliers.</p>
            )}
            <p className="mt-2 text-[12px] text-steel">On-time delivery and quality-rate scoring are not calculated yet; counts come from purchase order lines and NCRs raised against this supplier.</p>
          </Section>
          {seePOs && (
            <Section title="Purchase orders">
              <Table head={["PO", "Status", "Order date", "Required", "Supplier ref", "Total"]} empty="No purchase orders with this supplier yet.">
                {pos.map(({ po }) => (
                  <tr key={po.id}>
                    <td>
                      <Ref href={`/purchasing/${po.id}`} size="sm">
                        {po.ref}
                      </Ref>
                    </td>
                    <td>
                      <StatusBadge map={PO_STATUS} status={po.status} />
                    </td>
                    <td>{fmtDate(po.orderDate)}</td>
                    <td>{fmtDate(po.requiredDate)}</td>
                    <td>{po.supplierReference ?? "—"}</td>
                    <td className="text-right tabular-nums">{fmtMoney(po.total, po.currency)}</td>
                  </tr>
                ))}
              </Table>
            </Section>
          )}
          {!seePOs && (
            <p className="text-[12.5px] text-steel">
              Purchase order details are visible to purchasing users. See <Link href="/reports" className="link">reports</Link> for supplier performance across all suppliers.
            </p>
          )}
        </>
      )}

      {tab === "history" && (
        <Section title="Record changes">
          <AuditList events={history} />
        </Section>
      )}
    </>
  );
}

export const metadata = { title: "Supplier" };
