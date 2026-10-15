import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { getCustomerOrder } from "@/server/services/orders";
import { formatAddress } from "@/server/services/parties";
import { entityHistory, listActiveUsers } from "@/server/services/ui/sales";
import { can, canAny } from "@/server/context";
import { AppError } from "@/server/errors";
import { trimQty } from "@/lib/decimal";
import { fmtDate, fmtDateTime, fmtMoney, fmtQty } from "@/lib/format";
import { JOB_STATUS, ORDER_STATUS, PRIORITY, QUOTE_STATUS } from "@/lib/status";
import { KeyValues, Ref, Section, StatusBadge, Table, Tabs, TitleBlock } from "@/components/ui";
import { ActionForm, FileField, FormGrid, SelectField, SignatureBlock, TextArea, TextField } from "@/components/forms";
import { AuditList } from "@/components/AuditList";
import { convertToJobAction, verifyOrderAction } from "../actions";

export const metadata = { title: "Customer order" };

const TRACE_OPTIONS = [
  { value: "job", label: "Job level" },
  { value: "batch", label: "Batch level" },
  { value: "piece", label: "Piece (serial) level" },
];

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-[13px]">
      <span aria-hidden className={ok ? "text-green" : "text-red"}>
        {ok ? "✓" : "✗"}
      </span>
      <span className="text-ink">
        <span className="sr-only">{ok ? "Done: " : "Missing: "}</span>
        {children}
      </span>
    </li>
  );
}

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageCtx("orders.view");
  const { id } = await params;
  const tab = (await searchParams).tab ?? "overview";
  const data = await getCustomerOrder(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const { o, customer, address, receivedByName, quote, lines, jobs, verifiedByName } = data;
  const commercial = canAny(ctx.actor, "jobs.view_commercial", "customers.view_commercial", "quotations.view");
  const canVerify = can(ctx.actor, "orders.verify") && o.status === "received";
  const canConvert = can(ctx.actor, "jobs.create") && o.status === "verified";
  const quoteOk = quote?.rev.status === "accepted" && !!quote.rev.acceptanceVerifiedAt;
  const [users, history] = await Promise.all([canConvert ? listActiveUsers(ctx) : Promise.resolve([]), tab === "history" ? entityHistory(ctx, "customer_order", id) : Promise.resolve([])]);
  const seeJobs = canAny(ctx.actor, "jobs.view", "production.view_all");

  return (
    <>
      <TitleBlock
        kind="Customer order"
        refNo={o.ref}
        title={`${customer.name} — PO ${o.customerPoNumber}`}
        status={<StatusBadge map={ORDER_STATUS} status={o.status} />}
        cells={[
          { label: "Customer PO", value: <span className="plate">{o.customerPoNumber}</span> },
          { label: "PO date", value: fmtDate(o.poDate) },
          { label: "Required", value: fmtDate(o.requiredDate) },
          {
            label: "Quotation",
            value: quote ? (
              can(ctx.actor, "quotations.view") ? (
                <Link href={`/quotations/${quote.q.id}?rev=${quote.rev.revisionNo}`} className="link">
                  {quote.q.ref} rev {quote.rev.revisionNo}
                </Link>
              ) : (
                `${quote.q.ref} rev ${quote.rev.revisionNo}`
              )
            ) : (
              "Not linked"
            ),
          },
          { label: "Order value", value: commercial ? (o.orderValue ? fmtMoney(o.orderValue, o.currency) : "—") : "Restricted" },
          {
            label: "PO document",
            value: o.poFileId ? (
              <a className="link" href={`/api/files/${o.poFileId}`}>
                Open PO
              </a>
            ) : (
              <span className="text-red">Missing</span>
            ),
          },
        ]}
      />
      <Tabs
        base={`/orders/${id}`}
        current={tab}
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "history", label: "History" },
        ]}
      />

      {tab === "overview" && (
        <>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Section title="Order details">
              <KeyValues
                cols={2}
                items={[
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
                  { label: "Received", value: `${fmtDateTime(o.receivedAt)}${receivedByName ? ` by ${receivedByName}` : ""}` },
                  { label: "Delivery address", value: address ? formatAddress(address) : "Customer default delivery address", wide: true },
                  { label: "Commercial terms on PO", value: o.commercialTerms, wide: true },
                  { label: "Notes", value: o.notes, wide: true },
                ]}
              />
            </Section>
            <Section title="Contract review">
              {o.status === "received" ? (
                <>
                  <ul className="mb-3 space-y-1">
                    <Check ok={!!o.poFileId}>Customer PO document attached</Check>
                    <Check ok={!!quote}>Quotation revision linked</Check>
                    <Check ok={quoteOk}>Quotation acceptance recorded and verified{quote && !quoteOk && <> (currently {QUOTE_STATUS[quote.rev.status as keyof typeof QUOTE_STATUS]?.label.toLowerCase() ?? quote.rev.status})</>}</Check>
                  </ul>
                  {!quote && <p className="mb-3 text-[12.5px] text-amber">Linking a quotation to an order after registration is not available yet. Register the PO again with the quotation selected if this one was registered without it.</p>}
                  {canVerify ? (
                    <ActionForm action={verifyOrderAction} submitLabel="Sign contract review">
                      <input type="hidden" name="orderId" value={o.id} />
                      {!o.poFileId && <FileField label="PO document" name="poFile" required hint="Attach the customer’s PO before verifying." />}
                      <TextArea label="Discrepancies" name="discrepancies" rows={3} hint="Differences between the PO and the quotation (price, quantity, revision, delivery, terms). Leave blank if none." />
                      <TextArea label="Comment" name="comment" rows={2} />
                      <SignatureBlock meaning={`By signing I confirm I have checked customer PO ${o.customerPoNumber} against the accepted quotation — parts, drawing revisions, quantities, prices, delivery and terms — and recorded any discrepancies above.`} />
                    </ActionForm>
                  ) : (
                    <p className="text-[13px] text-steel">Awaiting contract review by someone with permission to verify customer orders.</p>
                  )}
                </>
              ) : (
                <KeyValues
                  cols={2}
                  items={[
                    { label: "Verified by", value: verifiedByName ? `${verifiedByName}, ${fmtDateTime(o.verifiedAt)}` : o.status === "cancelled" ? "Not verified" : "—" },
                    { label: "Discrepancies", value: o.discrepancies ?? (o.verifiedAt ? "None recorded" : null), wide: true },
                  ]}
                />
              )}
            </Section>
          </div>

          <Section title={quote ? `Quoted lines — ${quote.q.ref} rev ${quote.rev.revisionNo}` : "Quoted lines"}>
            <Table head={["#", "Part number", "Description", "Drawing", "Material", "Qty", ...(commercial ? ["Unit price", "Line total"] : [])]} empty={quote ? "The quotation revision has no lines." : "No quotation linked."}>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="text-steel">{l.lineNo}</td>
                  <td className="plate whitespace-nowrap text-[13px]">{l.partNumber}</td>
                  <td>{l.description}</td>
                  <td className="whitespace-nowrap">
                    {l.drawingNumber ?? "—"}
                    {l.drawingRevision && <span className="text-steel"> rev {l.drawingRevision}</span>}
                  </td>
                  <td>{l.materialSpec ?? "—"}</td>
                  <td className="text-right tabular-nums">{fmtQty(l.quantity)}</td>
                  {commercial && <td className="whitespace-nowrap text-right tabular-nums">{fmtMoney(l.unitPrice, quote?.rev.currency)}</td>}
                  {commercial && <td className="whitespace-nowrap text-right tabular-nums">{fmtMoney(l.lineTotal, quote?.rev.currency)}</td>}
                </tr>
              ))}
            </Table>
            {quote && commercial && (
              <p className="mt-2 text-right text-[13px] text-steel">
                Quoted subtotal {fmtMoney(quote.rev.subtotal, quote.rev.currency)} · total {fmtMoney(quote.rev.total, quote.rev.currency)}
                {o.orderValue && <> · PO value {fmtMoney(o.orderValue, o.currency)}</>}
              </p>
            )}
          </Section>

          {canConvert && quote && (
            <Section title="Create job">
              <ActionForm action={convertToJobAction} submitLabel="Create job" confirm="A permanent job number will be issued and this order marked as converted.">
                <input type="hidden" name="orderId" value={o.id} />
                <FormGrid cols={4}>
                  <TextField label="Job title" name="title" required defaultValue={quote.q.title} className="sm:col-span-2" />
                  <SelectField label="Owner" name="ownerId" placeholder="Me" defaultValue={ctx.actor.userId} options={users.map((u) => ({ value: u.id, label: u.name }))} />
                  <SelectField label="Priority" name="priority" defaultValue="3" options={Object.entries(PRIORITY).map(([k, v]) => ({ value: k, label: v.label }))} />
                  <TextField label="Required date" name="requiredDate" type="date" defaultValue={o.requiredDate} />
                  <SelectField label="Traceability" name="traceabilityLevel" defaultValue="job" options={TRACE_OPTIONS} hint="Default for lines without an override" />
                </FormGrid>
                <div className="overflow-x-auto rounded-md border border-line">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Include</th>
                        <th scope="col">Part number</th>
                        <th scope="col">Description</th>
                        <th scope="col">Quoted qty</th>
                        <th scope="col">Job qty</th>
                        <th scope="col">Traceability</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => (
                        <tr key={l.id}>
                          <td>
                            <input type="hidden" name="lineIds" value={l.id} />
                            <input type="checkbox" name={`inc_${l.id}`} defaultChecked className="h-4 w-4 accent-dykem" aria-label={`Include ${l.partNumber}`} />
                          </td>
                          <td className="plate whitespace-nowrap text-[13px]">{l.partNumber}</td>
                          <td>{l.description}</td>
                          <td className="text-right tabular-nums">{fmtQty(l.quantity)}</td>
                          <td className="w-28">
                            <input name={`qty_${l.id}`} inputMode="decimal" placeholder={trimQty(l.quantity)} className="field-input" aria-label={`Job quantity for ${l.partNumber}`} />
                          </td>
                          <td className="w-44">
                            <select name={`trace_${l.id}`} defaultValue="" className="field-input" aria-label={`Traceability for ${l.partNumber}`}>
                              <option value="">Part default / job default</option>
                              {TRACE_OPTIONS.map((t) => (
                                <option key={t.value} value={t.value}>
                                  {t.label}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[12px] text-steel">Leave job quantity blank to use the quoted quantity. Customer quality, certification and packaging requirements are copied onto the job.</p>
              </ActionForm>
            </Section>
          )}
          {o.status === "verified" && !can(ctx.actor, "jobs.create") && <p className="mb-6 text-[13px] text-steel">Verified — ready for someone with permission to create jobs.</p>}

          <Section title="Jobs from this order">
            <Table head={["Job", "Title", "Priority", "Required", "Status"]} empty="No job created yet.">
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>{seeJobs ? <Ref href={`/jobs/${j.id}`} size="sm">{j.jobNumber}</Ref> : <Ref size="sm">{j.jobNumber}</Ref>}</td>
                  <td>{j.title}</td>
                  <td>
                    <StatusBadge map={PRIORITY} status={String(j.priority)} />
                  </td>
                  <td>{fmtDate(j.requiredDate)}</td>
                  <td>
                    <StatusBadge map={JOB_STATUS} status={j.status} />
                  </td>
                </tr>
              ))}
            </Table>
          </Section>
        </>
      )}

      {tab === "history" && (
        <Section title="Record changes">
          <AuditList events={history} />
          <p className="mt-2 text-[12px] text-steel">Job creation is recorded on the job’s own history.</p>
        </Section>
      )}
    </>
  );
}
