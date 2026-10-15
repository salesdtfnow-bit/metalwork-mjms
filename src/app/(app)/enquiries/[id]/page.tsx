import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { getEnquiry } from "@/server/services/enquiries";
import { listParts } from "@/server/services/parts";
import { documentsForRevisions, entityHistory, listActiveUsers, quotationsForEnquiry } from "@/server/services/ui/sales";
import { can, canAny } from "@/server/context";
import { AppError } from "@/server/errors";
import { fmtDate, fmtDateTime, fmtMoney, fmtQty } from "@/lib/format";
import { ENQUIRY_STATUS, QUOTE_STATUS, REVISION_STATUS } from "@/lib/status";
import { Badge, Empty, KeyValues, LinkButton, Notice, Ref, Section, StatusBadge, Table, Tabs, TitleBlock } from "@/components/ui";
import { ActionForm, Disclosure, FileField, FormGrid, NumberField, SelectField, TextArea, TextField } from "@/components/forms";
import { AuditList } from "@/components/AuditList";
import { ATTACHMENT_KIND_OPTIONS, DRAWING_KINDS, ENQUIRY_NEXT, OPEN_ENQUIRY, REASON_REQUIRED, RECEIVED_VIA_OPTIONS, attachmentKindLabel, receivedViaLabel } from "../_components/labels";
import { toLocalInput } from "../_components/time";
import { trimQty } from "@/lib/decimal";
import { addAttachmentsAction, addEnquiryLineAction, registerDrawingAction, removeEnquiryLineAction, setEnquiryStatusAction, updateEnquiryAction, updateEnquiryLineAction } from "../actions";

function fileSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`;
  return `${Math.round(n / 104857.6) / 10} MB`;
}

export default async function EnquiryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; upload?: string }> }) {
  const ctx = await requirePageCtx("enquiries.view");
  const { id } = await params;
  const sp = await searchParams;
  const tab = sp.tab ?? "lines";
  const data = await getEnquiry(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const { e, customer, owner, lines, attachments, emails } = data;
  const manage = can(ctx.actor, "enquiries.manage");
  const isOpen = OPEN_ENQUIRY.includes(e.status);
  const editable = manage && !["won", "lost", "no_quote", "cancelled"].includes(e.status);
  const canQuote = can(ctx.actor, "quotations.manage") && isOpen;
  const canRegister = can(ctx.actor, "documents.upload");
  const seeQuotes = can(ctx.actor, "quotations.view");
  const nextStatuses = ENQUIRY_NEXT[e.status] ?? [];

  const [docs, quotes, history, users, parts] = await Promise.all([
    tab === "attachments" ? documentsForRevisions(ctx, attachments.map((x) => x.a.documentRevisionId)) : Promise.resolve({} as Awaited<ReturnType<typeof documentsForRevisions>>),
    seeQuotes ? quotationsForEnquiry(ctx, id) : Promise.resolve([]),
    tab === "history" ? entityHistory(ctx, "enquiry", id) : Promise.resolve([]),
    editable ? listActiveUsers(ctx) : Promise.resolve([]),
    tab === "attachments" && canRegister && canAny(ctx.actor, "jobs.view", "quotations.view", "documents.view", "production.view_all")
      ? listParts(ctx, { customerId: customer.id })
      : Promise.resolve([]),
  ]);

  return (
    <>
      <TitleBlock
        kind="Enquiry"
        refNo={e.ref}
        title={e.subject}
        status={
          <>
            <StatusBadge map={ENQUIRY_STATUS} status={e.status} />
            {e.closedReason && !isOpen && <span className="text-[12.5px] text-steel">{e.closedReason}</span>}
          </>
        }
        cells={[
          {
            label: "Customer",
            value: can(ctx.actor, "customers.view") ? (
              <Link href={`/customers/${customer.id}`} className="link">
                {customer.name}
              </Link>
            ) : (
              customer.name
            ),
          },
          { label: "Received", value: `${fmtDate(e.receivedAt)} · ${receivedViaLabel(e.receivedVia)}` },
          { label: "Requested delivery", value: fmtDate(e.requestedDeliveryDate) },
          { label: "Owner", value: owner ?? "—" },
          { label: "Customer ref", value: e.customerReference ?? "—" },
          { label: "Lines", value: lines.length },
        ]}
        actions={
          canQuote && (
            <LinkButton href={`/quotations/new?enquiryId=${e.id}`} variant="primary" size="sm">
              Create quotation
            </LinkButton>
          )
        }
      />

      {manage && (nextStatuses.length > 0 || editable) && (
        <div className="mb-4 flex flex-wrap items-start gap-2">
          {nextStatuses.length > 0 && (
            <Disclosure label="Change status">
              <ActionForm action={setEnquiryStatusAction} submitLabel="Update status" className="w-[min(420px,80vw)]">
                <input type="hidden" name="id" value={e.id} />
                <SelectField
                  label="New status"
                  name="status"
                  required
                  placeholder="Choose…"
                  options={nextStatuses.map((s) => ({ value: s, label: ENQUIRY_STATUS[s as keyof typeof ENQUIRY_STATUS]?.label ?? s }))}
                />
                <TextArea label="Reason" name="reason" rows={2} hint={`Required for ${REASON_REQUIRED.map((s) => ENQUIRY_STATUS[s as keyof typeof ENQUIRY_STATUS].label.toLowerCase()).join(", ")}.`} />
              </ActionForm>
            </Disclosure>
          )}
          {editable && (
            <Disclosure label="Edit details">
              <ActionForm action={updateEnquiryAction} submitLabel="Save changes" className="w-[min(760px,85vw)]">
                <input type="hidden" name="id" value={e.id} />
                <FormGrid cols={2}>
                  <TextField label="Subject" name="subject" required defaultValue={e.subject} className="sm:col-span-2" />
                  <TextField label="Customer reference" name="customerReference" defaultValue={e.customerReference} />
                  <SelectField label="Owner" name="ownerId" placeholder="Unassigned" defaultValue={e.ownerId} options={users.map((u) => ({ value: u.id, label: u.name }))} />
                  <TextField label="Received at" name="receivedAt" type="datetime-local" defaultValue={toLocalInput(e.receivedAt)} />
                  <SelectField label="Received via" name="receivedVia" options={RECEIVED_VIA_OPTIONS} defaultValue={e.receivedVia} />
                  <TextField label="Requested delivery date" name="requestedDeliveryDate" type="date" defaultValue={e.requestedDeliveryDate} />
                </FormGrid>
                <TextArea label="Description" name="description" rows={4} defaultValue={e.description} />
              </ActionForm>
            </Disclosure>
          )}
        </div>
      )}

      <Tabs
        base={`/enquiries/${id}`}
        current={tab}
        tabs={[
          { key: "lines", label: "Lines", count: lines.length },
          { key: "attachments", label: "Attachments", count: attachments.length },
          { key: "emails", label: "Emails", count: emails.length },
          ...(seeQuotes ? [{ key: "quotations", label: "Quotations", count: quotes.length }] : []),
          { key: "history", label: "History" },
        ]}
      />

      {tab === "lines" && (
        <>
          {e.description && (
            <Section title="Description">
              <p className="max-w-[100ch] whitespace-pre-wrap text-[13.5px] text-ink">{e.description}</p>
            </Section>
          )}
          <Section title="Requested parts">
            <Table head={["#", "Part number", "Description", "Qty", "Drawing", "Material", "Tolerances", "Finish", "Special requirements", ...(editable ? [""] : [])]} empty="No lines recorded yet.">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="text-steel">{l.lineNo}</td>
                  <td className="plate whitespace-nowrap text-[13px]">{l.partNumber}</td>
                  <td className="max-w-[280px]">{l.description}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{fmtQty(l.quantity)}</td>
                  <td className="whitespace-nowrap">
                    {l.drawingNumber ?? "—"}
                    {l.drawingRevision && <span className="text-steel"> rev {l.drawingRevision}</span>}
                  </td>
                  <td>{l.materialGrade ?? "—"}</td>
                  <td className="max-w-[160px] whitespace-pre-wrap text-steel">{l.tolerances ?? ""}</td>
                  <td className="max-w-[160px] whitespace-pre-wrap text-steel">{l.surfaceFinish ?? ""}</td>
                  <td className="max-w-[220px] whitespace-pre-wrap text-steel">{l.specialRequirements ?? ""}</td>
                  {editable && (
                    <td>
                      <div className="flex flex-wrap items-start gap-1">
                        <Disclosure label="Edit" variant="ghost">
                          <ActionForm action={updateEnquiryLineAction} submitLabel="Save line" className="w-[min(720px,80vw)]">
                            <input type="hidden" name="enquiryId" value={e.id} />
                            <input type="hidden" name="lineId" value={l.id} />
                            <FormGrid cols={3}>
                              <TextField label="Part number" name="partNumber" required defaultValue={l.partNumber} />
                              <TextField label="Description" name="description" required defaultValue={l.description} className="sm:col-span-2" />
                              <NumberField label="Quantity" name="quantity" required defaultValue={trimQty(l.quantity)} />
                              <TextField label="Drawing number" name="drawingNumber" defaultValue={l.drawingNumber} />
                              <TextField label="Drawing revision" name="drawingRevision" defaultValue={l.drawingRevision} />
                              <TextField label="Material grade" name="materialGrade" defaultValue={l.materialGrade} className="sm:col-span-3" />
                              <TextArea label="Tolerances" name="tolerances" rows={2} defaultValue={l.tolerances} />
                              <TextArea label="Surface finish" name="surfaceFinish" rows={2} defaultValue={l.surfaceFinish} />
                              <TextArea label="Special requirements" name="specialRequirements" rows={2} defaultValue={l.specialRequirements} />
                            </FormGrid>
                          </ActionForm>
                        </Disclosure>
                        <ActionForm action={removeEnquiryLineAction} submitLabel="Remove" submitVariant="ghost" submitSize="sm" confirm={`Remove line ${l.lineNo} (${l.partNumber}) from this enquiry?`}>
                          <input type="hidden" name="enquiryId" value={e.id} />
                          <input type="hidden" name="lineId" value={l.id} />
                        </ActionForm>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </Table>
            {editable && (
              <div className="mt-3">
                <Disclosure label="Add line" defaultOpen={lines.length === 0}>
                  <ActionForm action={addEnquiryLineAction} submitLabel="Add line" resetOnSuccess>
                    <input type="hidden" name="enquiryId" value={e.id} />
                    <FormGrid cols={4}>
                      <TextField label="Part number" name="partNumber" required />
                      <TextField label="Description" name="description" required className="sm:col-span-2" />
                      <NumberField label="Quantity" name="quantity" required />
                      <TextField label="Drawing number" name="drawingNumber" />
                      <TextField label="Drawing revision" name="drawingRevision" />
                      <TextField label="Material grade" name="materialGrade" placeholder="e.g. 316L, EN24T, 6082-T6" className="sm:col-span-2" />
                    </FormGrid>
                    <FormGrid cols={3}>
                      <TextArea label="Tolerances" name="tolerances" rows={2} />
                      <TextArea label="Surface finish" name="surfaceFinish" rows={2} placeholder="e.g. Ra 1.6, anodise black" />
                      <TextArea label="Special requirements" name="specialRequirements" rows={2} placeholder="e.g. 3.1 certs, FAIR, marking" />
                    </FormGrid>
                  </ActionForm>
                </Disclosure>
              </div>
            )}
          </Section>
        </>
      )}

      {tab === "attachments" && (
        <Section title="Attachments" actions={<span className="text-[12px] text-steel">Customer originals are stored unaltered. Production uses released controlled drawings only.</span>}>
          {sp.upload === "failed" && (
            <Notice tone="warning" title="The enquiry was created, but the files were not stored.">
              Upload them again below. Blocked file types and oversized files are rejected.
            </Notice>
          )}
          <Table head={["File", "Type", "Size", "Added", "Source", "Controlled document", ""]} empty="No files attached yet.">
            {attachments.map(({ a, f: file }) => {
              const doc = a.documentRevisionId ? docs[a.documentRevisionId] : undefined;
              return (
                <tr key={a.id}>
                  <td className="max-w-[320px]">
                    <a className="link break-all" href={`/api/files/${file.id}`}>
                      {file.originalName}
                    </a>
                    {a.note && <span className="block text-[12px] text-steel">{a.note}</span>}
                  </td>
                  <td className="whitespace-nowrap">{attachmentKindLabel(a.kind)}</td>
                  <td className="whitespace-nowrap text-steel">{fileSize(file.sizeBytes)}</td>
                  <td className="whitespace-nowrap text-steel">{fmtDateTime(a.createdAt)}</td>
                  <td className="whitespace-nowrap">
                    {file.isCustomerOriginal && <Badge tone="info">Customer original</Badge>} {a.inboundEmailId && <Badge tone="muted">From email</Badge>}
                  </td>
                  <td className="whitespace-nowrap">
                    {a.documentRevisionId ? (
                      doc ? (
                        <span className="inline-flex items-center gap-2">
                          <Link href={`/documents/${doc.documentId}`} className="link plate text-[13px]">
                            {doc.docNumber} rev {doc.revision}
                          </Link>
                          <StatusBadge map={REVISION_STATUS} status={doc.status} />
                        </span>
                      ) : (
                        <Badge tone="info">Registered</Badge>
                      )
                    ) : (
                      <span className="text-steel">—</span>
                    )}
                  </td>
                  <td>
                    {canRegister && !a.documentRevisionId && DRAWING_KINDS.includes(a.kind) && (
                      <Disclosure label="Register as controlled drawing">
                        <ActionForm action={registerDrawingAction} submitLabel="Register drawing" className="w-[min(520px,80vw)]">
                          <input type="hidden" name="enquiryId" value={e.id} />
                          <input type="hidden" name="attachmentId" value={a.id} />
                          <p className="text-[12.5px] text-steel">
                            Creates a draft revision of a controlled drawing from this file (the original stays attached here). It must be reviewed and released in Documents before the shop floor can use it.
                          </p>
                          <FormGrid cols={2}>
                            <TextField label="Document number" name="docNumber" required defaultValue={lines.find((l) => l.drawingNumber)?.drawingNumber ?? file.originalName.replace(/\.[^.]+$/, "")} />
                            <TextField label="Revision" name="revision" required defaultValue={lines.find((l) => l.drawingRevision)?.drawingRevision ?? "A"} />
                            <TextField label="Title" name="title" required defaultValue={lines[0]?.description ?? file.originalName} className="sm:col-span-2" />
                            {parts.length > 0 && (
                              <SelectField
                                label="Part (optional)"
                                name="partId"
                                placeholder="Not linked to a part"
                                options={parts.map((p) => ({ value: p.part.id, label: `${p.part.partNumber} — ${p.part.description}` }))}
                                className="sm:col-span-2"
                              />
                            )}
                          </FormGrid>
                        </ActionForm>
                      </Disclosure>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
          {manage && (
            <div className="mt-3">
              <Disclosure label="Upload files">
                <ActionForm action={addAttachmentsAction} submitLabel="Upload" resetOnSuccess>
                  <input type="hidden" name="enquiryId" value={e.id} />
                  <FileField label="Files" name="files" multiple required />
                  <FormGrid cols={2}>
                    <SelectField label="Type" name="kind" placeholder="Guess from file extension" options={ATTACHMENT_KIND_OPTIONS} />
                    <TextField label="Note" name="note" placeholder="e.g. Revised drawing sent by phone call 14 Oct" />
                  </FormGrid>
                </ActionForm>
              </Disclosure>
            </div>
          )}
        </Section>
      )}

      {tab === "emails" && (
        <Section
          title="Linked emails"
          actions={can(ctx.actor, "email.import") && <Link href="/enquiries/inbox" className="link text-[13px]">Open email inbox</Link>}
        >
          {emails.length === 0 ? (
            <Empty title="No emails linked">Link inbound emails to this enquiry from the email inbox. Their attachments are added to this enquiry automatically.</Empty>
          ) : (
            <div className="space-y-3">
              {emails.map((m) => (
                <article key={m.id} className="rounded-md border border-line bg-sheet">
                  <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-3 py-2">
                    <div>
                      <p className="font-semibold text-ink">{m.subject || "(no subject)"}</p>
                      <p className="text-[12.5px] text-steel">
                        From {m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress}
                        {m.toAddresses.length > 0 && <> · To {m.toAddresses.join(", ")}</>}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-[12.5px] text-steel">
                      {fmtDateTime(m.receivedAt)}
                      {m.rawFileId && (
                        <a className="link" href={`/api/files/${m.rawFileId}`}>
                          Original .eml
                        </a>
                      )}
                      {can(ctx.actor, "email.import") && (
                        <Link className="link" href={`/enquiries/inbox/${m.id}`}>
                          Details
                        </Link>
                      )}
                    </div>
                  </header>
                  <details className="px-3 py-2">
                    <summary className="cursor-pointer text-[13px] text-dykem">Show message text</summary>
                    {m.textBody ? (
                      <pre className="mt-2 max-h-[480px] overflow-auto whitespace-pre-wrap break-words font-sans text-[13px] text-ink">{m.textBody}</pre>
                    ) : (
                      <p className="mt-2 text-[13px] text-steel">This email has no plain-text body. Download the original .eml to read the formatted version.</p>
                    )}
                  </details>
                </article>
              ))}
            </div>
          )}
        </Section>
      )}

      {tab === "quotations" && seeQuotes && (
        <Section
          title="Quotations"
          actions={
            canQuote && (
              <LinkButton href={`/quotations/new?enquiryId=${e.id}`} size="sm">
                Create quotation
              </LinkButton>
            )
          }
        >
          <Table head={["Quotation", "Title", "Latest rev", "Status", "Total", "Valid until", "Owner"]} empty="No quotations raised for this enquiry yet.">
            {quotes.map(({ quote, latest, owner: qOwner }) => (
              <tr key={quote.id}>
                <td>
                  <Ref href={`/quotations/${quote.id}`} size="sm">
                    {quote.ref}
                  </Ref>
                </td>
                <td>{quote.title}</td>
                <td className="text-center">{latest?.revisionNo ?? quote.latestRevisionNo}</td>
                <td>
                  <StatusBadge map={QUOTE_STATUS} status={quote.status} />
                </td>
                <td className="whitespace-nowrap text-right tabular-nums">{latest ? fmtMoney(latest.total, latest.currency) : "—"}</td>
                <td className="whitespace-nowrap">{fmtDate(latest?.validUntil)}</td>
                <td>{qOwner ?? "—"}</td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      {tab === "history" && (
        <Section title="Record changes">
          <AuditList events={history} />
          <div className="mt-4" />
          <KeyValues
            cols={3}
            items={[
              { label: "Created", value: fmtDateTime(e.createdAt) },
              { label: "Last updated", value: fmtDateTime(e.updatedAt) },
            ]}
          />
        </Section>
      )}
    </>
  );
}

