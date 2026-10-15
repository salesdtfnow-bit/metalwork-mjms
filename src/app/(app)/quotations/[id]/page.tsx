import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { getQuotation } from "@/server/services/quotations";
import { getSettings } from "@/server/services/settings";
import { entityHistory } from "@/server/services/ui/sales";
import { can, canAny } from "@/server/context";
import { AppError } from "@/server/errors";
import { costLine } from "@/lib/costing";
import { d, trimQty } from "@/lib/decimal";
import { fmtDate, fmtDateTime, fmtMinutes, fmtMoney, fmtPct, fmtQty, todayISO } from "@/lib/format";
import { QUOTE_STATUS } from "@/lib/status";
import { Badge, KeyValues, LinkButton, Notice, Ref, Section, StatusBadge, Table, Tabs, TitleBlock, cx } from "@/components/ui";
import { ActionForm, CheckboxField, Disclosure, FileField, FormGrid, NumberField, SelectField, SignatureBlock, TextArea, TextField } from "@/components/forms";
import { AuditList } from "@/components/AuditList";
import { QuoteLineForm, type QuoteLineValues } from "../_components/QuoteLineForm";
import { LINE_COST_FIELDS, TAX_OPTIONS, taxLabel } from "../_components/labels";
import {
  createRevisionAction,
  followUpAction,
  markSentAction,
  recordAcceptanceAction,
  recordRejectionAction,
  removeQuoteLineAction,
  reviewQuotationAction,
  saveQuoteLineAction,
  submitForReviewAction,
  updateTermsAction,
  verifyAcceptanceAction,
} from "../actions";

type Data = Awaited<ReturnType<typeof getQuotation>>;
type Rev = Data["revisions"][number];
type Line = Rev["lines"][number];

export default async function QuotationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; rev?: string }> }) {
  const ctx = await requirePageCtx("quotations.view");
  const { id } = await params;
  const sp = await searchParams;
  const tab = sp.tab ?? "lines";
  const data = await getQuotation(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const { q, customer, contact, enquiry, revisions } = data;
  if (!revisions.length) notFound();
  const latest = revisions[0];
  const r = revisions.find((x) => String(x.revisionNo) === sp.rev) ?? latest;
  const isLatest = r.id === latest.id;
  const me = ctx.actor.userId;

  const manage = can(ctx.actor, "quotations.manage");
  const internal = canAny(ctx.actor, "quotations.manage", "quotations.review");
  const editable = manage && r.status === "draft" && !r.isLocked;
  const hasAccepted = revisions.some((x) => x.status === "accepted");
  const [settings, history] = await Promise.all([getSettings(ctx.db), tab === "history" ? entityHistory(ctx, "quotation", id) : Promise.resolve([])]);
  const cur = r.currency;
  const base = `/quotations/${id}?rev=${r.revisionNo}`;

  return (
    <>
      <TitleBlock
        kind="Quotation"
        refNo={q.ref}
        title={q.title}
        status={
          <>
            <StatusBadge map={QUOTE_STATUS} status={q.status} />
            {latest.acceptanceRecordedAt && !latest.acceptanceVerifiedAt && <Badge tone="warning">Acceptance awaiting verification</Badge>}
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
          { label: "Contact", value: contact ? contact.name : "—" },
          {
            label: "Enquiry",
            value: enquiry ? (
              can(ctx.actor, "enquiries.view") ? (
                <Ref href={`/enquiries/${enquiry.id}`} size="sm">
                  {enquiry.ref}
                </Ref>
              ) : (
                enquiry.ref
              )
            ) : (
              "—"
            ),
          },
          { label: "Latest revision", value: `Rev ${latest.revisionNo}` },
          { label: `Total (rev ${latest.revisionNo})`, value: fmtMoney(latest.total, latest.currency) },
          { label: "Valid until", value: fmtDate(latest.validUntil) },
        ]}
        actions={
          <>
            {r.pdfFileId ? (
              <LinkButton href={`/api/files/${r.pdfFileId}`} size="sm" prefetch={false}>
                Issued PDF (rev {r.revisionNo})
              </LinkButton>
            ) : (
              ["draft", "internal_review"].includes(r.status) && (
                <LinkButton href={`/api/pdf/quotation-preview/${r.id}`} size="sm" prefetch={false}>
                  Preview PDF
                </LinkButton>
              )
            )}
          </>
        }
      />

      {revisions.length > 1 && (
        <nav aria-label="Revisions" className="mb-4 flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="mr-1 text-steel">Revision</span>
          {[...revisions].reverse().map((x) => (
            <Link
              key={x.id}
              href={`/quotations/${id}?rev=${x.revisionNo}`}
              aria-current={x.id === r.id ? "page" : undefined}
              className={cx("inline-flex items-center gap-1.5 rounded-sm border px-2 py-1", x.id === r.id ? "border-ink bg-sheet font-semibold text-ink" : "border-line text-steel hover:border-steel-2 hover:text-ink")}
            >
              <span className="plate">{x.revisionNo}</span>
              <StatusBadge map={QUOTE_STATUS} status={x.status} />
            </Link>
          ))}
        </nav>
      )}

      <NextStep ctx={{ manage, me, actor: ctx.actor, settings }} q={q} r={r} isLatest={isLatest} hasAccepted={hasAccepted} contactEmail={contact?.email ?? null} customerId={customer.id} />

      <Tabs
        base={base}
        current={tab}
        tabs={[
          { key: "lines", label: `Rev ${r.revisionNo} lines`, count: r.lines.length },
          { key: "terms", label: "Terms" },
          { key: "record", label: "Approval record" },
          { key: "history", label: "History" },
        ]}
      />

      {tab === "lines" && (
        <>
          <Totals r={r} internal={internal} />
          <Section title="Lines" actions={!editable && r.isLocked && <span className="text-[12px] text-steel">Revision {r.revisionNo} is locked. Create a new revision to change it.</span>}>
            <Table
              head={["#", "Part number", "Description", "Drawing", "Material", "Qty", ...(internal ? ["Unit cost"] : []), "Unit price", "Line total", ""]}
              empty={editable ? "No lines yet. Add the first line below." : "No lines on this revision."}
            >
              {r.lines.map((l) => (
                <LineRows key={l.id} l={l} r={r} q={q} internal={internal} editable={editable} cols={internal ? 10 : 9} />
              ))}
            </Table>
            {editable && (
              <div className="mt-3">
                <Disclosure label="Add line" defaultOpen={r.lines.length === 0}>
                  <QuoteLineForm action={saveQuoteLineAction} quotationId={q.id} revisionId={r.id} defaultMarginPct={r.defaultMarginPct} currency={cur} submitLabel="Add line" />
                </Disclosure>
              </div>
            )}
          </Section>
        </>
      )}

      {tab === "terms" && (
        <Section title={`Terms — revision ${r.revisionNo}`}>
          <KeyValues
            items={[
              { label: "Currency", value: r.currency },
              { label: "Tax", value: r.taxTreatment === "standard" ? `${taxLabel(r.taxTreatment)} (${fmtPct(r.taxRate)})` : taxLabel(r.taxTreatment) },
              { label: "Validity", value: `${r.validityDays} days${r.validUntil ? ` — until ${fmtDate(r.validUntil)}` : " from issue"}` },
              ...(internal ? [{ label: "Default margin (internal)", value: fmtPct(r.defaultMarginPct) }] : []),
              { label: "Lead time", value: r.leadTime },
              { label: "Commercial terms", value: r.commercialTerms, wide: true },
              { label: "Delivery terms", value: r.deliveryTerms, wide: true },
              { label: "Notes to customer", value: r.notes, wide: true },
              ...(internal ? [{ label: "Internal notes", value: r.internalNotes, wide: true }] : []),
            ]}
          />
          {editable && (
            <div className="mt-4">
              <Disclosure label="Edit terms">
                <ActionForm action={updateTermsAction} submitLabel="Save terms">
                  <input type="hidden" name="quotationId" value={q.id} />
                  <input type="hidden" name="revisionId" value={r.id} />
                  <FormGrid cols={4}>
                    <SelectField label="Tax treatment" name="taxTreatment" options={TAX_OPTIONS} defaultValue={r.taxTreatment} />
                    <NumberField label="Tax rate" name="taxRate" unit="%" required defaultValue={trimQty(r.taxRate)} />
                    <NumberField label="Default margin" name="defaultMarginPct" unit="%" required defaultValue={trimQty(r.defaultMarginPct)} hint="Re-prices lines without their own margin" />
                    <NumberField label="Validity" name="validityDays" unit="days" required defaultValue={r.validityDays} />
                    <TextField label="Lead time" name="leadTime" defaultValue={r.leadTime} className="sm:col-span-2 lg:col-span-4" />
                  </FormGrid>
                  <FormGrid cols={2}>
                    <TextArea label="Commercial terms" name="commercialTerms" rows={5} defaultValue={r.commercialTerms} />
                    <TextArea label="Delivery terms" name="deliveryTerms" rows={5} defaultValue={r.deliveryTerms} />
                    <TextArea label="Notes to customer" name="notes" rows={3} defaultValue={r.notes} />
                    <TextArea label="Internal notes" name="internalNotes" rows={3} defaultValue={r.internalNotes} hint="Not printed on the quotation." />
                  </FormGrid>
                </ActionForm>
              </Disclosure>
            </div>
          )}
        </Section>
      )}

      {tab === "record" && (
        <Section title={`Approval record — revision ${r.revisionNo}`}>
          <KeyValues
            cols={3}
            items={[
              { label: "Prepared by", value: r.preparedByName },
              { label: "Created", value: fmtDateTime(r.createdAt) },
              { label: "Submitted for review", value: r.submittedForReviewAt ? fmtDateTime(r.submittedForReviewAt) : null },
              { label: "Reviewed and approved by", value: r.reviewedByName ? `${r.reviewedByName}, ${fmtDateTime(r.reviewedAt)}` : null },
              { label: "Sent by", value: r.sentByName ? `${r.sentByName}, ${fmtDateTime(r.sentAt)}` : null },
              { label: "Sent to", value: r.sentTo },
              { label: "Valid until", value: r.validUntil ? fmtDate(r.validUntil) : null },
              { label: "Customer responded", value: r.respondedAt ? fmtDateTime(r.respondedAt) : null },
              {
                label: "Issued PDF",
                value: r.pdfFileId ? (
                  <a className="link" href={`/api/files/${r.pdfFileId}`}>
                    {q.ref}-rev{r.revisionNo}.pdf
                  </a>
                ) : null,
              },
              { label: "Acceptance recorded by", value: r.acceptanceRecordedByName ? `${r.acceptanceRecordedByName}, ${fmtDateTime(r.acceptanceRecordedAt)}` : null },
              { label: "Acceptance reference", value: r.acceptanceReference },
              {
                label: "Acceptance evidence",
                value: r.acceptanceEvidenceFileId ? (
                  <a className="link" href={`/api/files/${r.acceptanceEvidenceFileId}`}>
                    Open evidence file
                  </a>
                ) : null,
              },
              { label: "Acceptance verified by", value: r.acceptanceVerifiedByName ? `${r.acceptanceVerifiedByName}, ${fmtDateTime(r.acceptanceVerifiedAt)}` : null },
              { label: "Customer feedback and follow-ups", value: r.customerFeedback, wide: true },
            ]}
          />
          <p className="mt-4 text-[12px] text-steel">Signed approvals (internal review and acceptance verification) are recorded with the signer’s re-entered password and appear in the History tab as “Signed”.</p>
        </Section>
      )}

      {tab === "history" && (
        <Section title="Record changes">
          <AuditList events={history} />
        </Section>
      )}
    </>
  );
}

// ───────────────────────── Totals ─────────────────────────

function Totals({ r, internal }: { r: Rev; internal: boolean }) {
  const sub = d(r.subtotal);
  const margin = sub.minus(d(r.totalCost));
  const pct = sub.isZero() ? null : margin.dividedBy(sub).times(100).toDecimalPlaces(1).toString();
  const cells: { label: string; value: string; sub?: string; internal?: boolean; tone?: string }[] = [
    { label: "Subtotal", value: fmtMoney(r.subtotal, r.currency) },
    { label: "Tax", value: fmtMoney(r.taxAmount, r.currency), sub: r.taxTreatment === "standard" ? `${fmtPct(r.taxRate)} standard` : taxLabel(r.taxTreatment) },
    { label: "Total", value: fmtMoney(r.total, r.currency) },
  ];
  if (internal) {
    cells.push({ label: "Cost", value: fmtMoney(r.totalCost, r.currency), internal: true });
    cells.push({ label: "Margin", value: fmtMoney(margin.toFixed(2), r.currency), sub: pct !== null ? `${pct}% of subtotal` : undefined, internal: true, tone: pct !== null && Number(pct) < 10 ? "text-red" : undefined });
  }
  return (
    <div className="mb-5 grid grid-cols-2 border border-line bg-sheet sm:grid-cols-3 lg:grid-cols-5">
      {cells.map((c) => (
        <div key={c.label} className="border-line px-3 py-2 [&:not(:last-child)]:border-r">
          <div className="flex items-center gap-1.5 text-[11.5px] text-steel">
            {c.label}
            {c.internal && <span className="rounded-sm bg-line-2 px-1 text-[10.5px] uppercase tracking-wide">Internal</span>}
          </div>
          <div className={cx("mt-0.5 text-[16px] font-semibold tabular-nums text-ink", c.tone)}>{c.value}</div>
          {c.sub && <div className="text-[11.5px] text-steel">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ───────────────────────── Lines ─────────────────────────

function lineValues(l: Line): QuoteLineValues {
  return {
    id: l.id,
    values: {
    partNumber: l.partNumber,
    description: l.description,
    drawingNumber: l.drawingNumber,
    drawingRevision: l.drawingRevision,
    materialSpec: l.materialSpec,
    quantity: l.quantity,
    batchSize: l.batchSize,
    ...Object.fromEntries(LINE_COST_FIELDS.map(([k]) => [k, l[k]])),
    marginPct: l.marginPct,
    priceOverridePerUnit: l.priceOverridePerUnit,
    priceOverrideReason: l.priceOverrideReason,
    notes: l.notes,
    },
    operations: l.operations.map((o) => ({ description: o.op.description, setupMinutes: o.op.setupMinutes, cycleMinutes: o.op.cycleMinutes, ratePerHour: o.op.ratePerHour })),
  };
}

function LineRows({ l, r, q, internal, editable, cols }: { l: Line; r: Rev; q: Data["q"]; internal: boolean; editable: boolean; cols: number }) {
  const cur = r.currency;
  const overridden = !!l.priceOverridePerUnit;
  let b: ReturnType<typeof costLine> | null = null;
  try {
    b = costLine({ ...l, operations: l.operations.map((o) => o.op) }, r.defaultMarginPct);
  } catch {
    b = null;
  }
  return (
    <>
      <tr className="[&>td]:border-b-0">
        <td className="text-steel">{l.lineNo}</td>
        <td className="plate whitespace-nowrap text-[13px]">{l.partNumber}</td>
        <td className="max-w-[300px]">
          {l.description}
          {l.notes && <span className="block whitespace-pre-wrap text-[12px] text-steel">{l.notes}</span>}
        </td>
        <td className="whitespace-nowrap">
          {l.drawingNumber ?? "—"}
          {l.drawingRevision && <span className="text-steel"> rev {l.drawingRevision}</span>}
        </td>
        <td className="max-w-[180px]">{l.materialSpec ?? "—"}</td>
        <td className="whitespace-nowrap text-right tabular-nums">{fmtQty(l.quantity)}</td>
        {internal && <td className="whitespace-nowrap text-right tabular-nums text-steel">{fmtMoney(l.unitCost, cur)}</td>}
        <td className="whitespace-nowrap text-right tabular-nums">
          {fmtMoney(l.unitPrice, cur)}
          {overridden && (
            <span className="ml-1.5 align-middle">
              <Badge tone="warning">Override</Badge>
            </span>
          )}
        </td>
        <td className="whitespace-nowrap text-right font-medium tabular-nums">{fmtMoney(l.lineTotal, cur)}</td>
        <td />
      </tr>
      <tr>
        <td colSpan={cols} className="pt-0">
          <div className="flex flex-wrap items-start gap-2 pb-1">
            {internal && (
              <Disclosure label="Cost breakdown" variant="ghost">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div>
                    <p className="mb-1 text-[12.5px] font-semibold text-ink">Operations</p>
                    {l.operations.length ? (
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Operation</th>
                            <th>Setup / batch</th>
                            <th>Cycle / part</th>
                            <th>Rate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {l.operations.map((o) => (
                            <tr key={o.op.id}>
                              <td>
                                {o.op.description}
                                {o.type && <span className="text-steel"> ({o.type})</span>}
                              </td>
                              <td className="tabular-nums">{fmtMinutes(o.op.setupMinutes)}</td>
                              <td className="tabular-nums">{fmtMinutes(o.op.cycleMinutes)}</td>
                              <td className="tabular-nums">{fmtMoney(o.op.ratePerHour, cur)}/h</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-[12.5px] text-steel">No machining operations estimated.</p>
                    )}
                    <p className="mb-1 mt-3 text-[12.5px] font-semibold text-ink">Cost inputs</p>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[12.5px]">
                      {LINE_COST_FIELDS.filter(([k]) => !d(l[k]).isZero()).map(([k, label]) => (
                        <div key={k} className="flex justify-between gap-2">
                          <dt className="text-steel">{label}</dt>
                          <dd className="tabular-nums">{k === "materialWastagePct" ? fmtPct(l[k]) : fmtMoney(l[k], cur)}</dd>
                        </div>
                      ))}
                      {l.batchSize && (
                        <div className="flex justify-between gap-2">
                          <dt className="text-steel">Batch size</dt>
                          <dd className="tabular-nums">{fmtQty(l.batchSize)}</dd>
                        </div>
                      )}
                    </dl>
                    {LINE_COST_FIELDS.every(([k]) => d(l[k]).isZero()) && <p className="text-[12.5px] text-steel">No other cost inputs.</p>}
                  </div>
                  <div>
                    <p className="mb-1 text-[12.5px] font-semibold text-ink">Calculation</p>
                    {b ? (
                      <dl className="space-y-0.5 text-[12.5px]">
                        {(
                          [
                            ["Batches", String(b.batches)],
                            ["Material", fmtMoney(b.materialCost, cur)],
                            ["Machining", fmtMoney(l.machiningCost, cur)],
                            ["Setup", fmtMoney(b.setupCost, cur)],
                            ["Other costs", fmtMoney(b.oneOffCost, cur)],
                            ["Total cost (stored)", fmtMoney(l.totalCost, cur)],
                            ["Margin applied", l.marginPct ? `${fmtPct(l.marginPct)} (line override)` : `${fmtPct(r.defaultMarginPct)} (revision default)`],
                            ["Calculated unit price", fmtMoney(b.calculatedUnitPrice, cur)],
                            ["Unit price (stored)", fmtMoney(l.unitPrice, cur)],
                            ["Achieved margin", fmtPct(b.achievedMarginPct)],
                          ] as const
                        ).map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-3">
                            <dt className="text-steel">{k}</dt>
                            <dd className="tabular-nums">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="text-[12.5px] text-steel">The breakdown could not be recalculated from the stored inputs.</p>
                    )}
                    {overridden && (
                      <Notice tone="warning" title="Price overridden">
                        {fmtMoney(l.priceOverridePerUnit, cur)} per unit — {l.priceOverrideReason ?? "no reason recorded"}
                      </Notice>
                    )}
                  </div>
                </div>
              </Disclosure>
            )}
            {editable && (
              <Disclosure label="Edit line" variant="ghost">
                <QuoteLineForm action={saveQuoteLineAction} quotationId={q.id} revisionId={r.id} defaultMarginPct={r.defaultMarginPct} currency={cur} line={lineValues(l)} submitLabel="Save line" />
              </Disclosure>
            )}
            {editable && (
              <ActionForm action={removeQuoteLineAction} submitLabel="Remove line" submitVariant="ghost" submitSize="sm" confirm={`Remove line ${l.lineNo} (${l.partNumber}) from revision ${r.revisionNo}?`}>
                <input type="hidden" name="quotationId" value={q.id} />
                <input type="hidden" name="lineId" value={l.id} />
              </ActionForm>
            )}
          </div>
        </td>
      </tr>
    </>
  );
}

// ───────────────────────── Next step (workflow) ─────────────────────────

function NextStep({
  ctx,
  q,
  r,
  isLatest,
  hasAccepted,
  contactEmail,
  customerId,
}: {
  ctx: { manage: boolean; me: string; actor: Parameters<typeof can>[0]; settings: Awaited<ReturnType<typeof getSettings>> };
  q: Data["q"];
  r: Rev;
  isLatest: boolean;
  hasAccepted: boolean;
  contactEmail: string | null;
  customerId: string;
}) {
  const a = ctx.actor;
  const hidden = (
    <>
      <input type="hidden" name="quotationId" value={q.id} />
      <input type="hidden" name="revisionId" value={r.id} />
    </>
  );
  const parts: ReactNode[] = [];
  const expired = !!r.validUntil && r.validUntil < todayISO();

  if (r.status === "draft") {
    if (ctx.manage) {
      parts.push(
        r.lines.length === 0 ? (
          <p key="s" className="text-[13px] text-steel">
            Add at least one costed line, then submit revision {r.revisionNo} for internal review.
          </p>
        ) : (
          <ActionForm key="s" action={submitForReviewAction} submitLabel="Submit for review">
            {hidden}
            <p className="text-[13px] text-steel">
              Revision {r.revisionNo} is a draft with {r.lines.length} {r.lines.length === 1 ? "line" : "lines"}. Check the preview PDF, then submit it for internal review.
            </p>
          </ActionForm>
        ),
      );
    } else parts.push(<p key="s" className="text-[13px] text-steel">Draft — being prepared.</p>);
  }

  if (r.status === "internal_review" && !r.reviewedAt) {
    const own = ctx.settings.requireIndependentApproval && r.preparedBy === ctx.me;
    if (can(a, "quotations.review") && !own) {
      parts.push(
        <ActionForm key="rv" action={reviewQuotationAction} submitLabel="Sign review decision">
          {hidden}
          <FormGrid cols={2}>
            <SelectField
              label="Decision"
              name="decision"
              required
              defaultValue="approved"
              options={[
                { value: "approved", label: "Approve for issue to the customer" },
                { value: "rejected", label: "Return to draft for correction" },
              ]}
            />
            <TextArea label="Comment" name="comment" rows={2} hint="Required when returning the quotation." />
          </FormGrid>
          <SignatureBlock meaning={`By signing I confirm I have reviewed ${q.ref} revision ${r.revisionNo} — pricing, capability, lead time and terms — and record the decision selected above.`} />
        </ActionForm>,
      );
    } else if (own && can(a, "quotations.review")) {
      parts.push(
        <Notice key="rv" tone="warning" title="Independent approval required">
          You prepared this revision, so another reviewer must approve it.
        </Notice>,
      );
    } else parts.push(<p key="rv" className="text-[13px] text-steel">Awaiting internal review by a quotation reviewer.</p>);
  }

  if (r.status === "internal_review" && r.reviewedAt) {
    if (can(a, "quotations.send")) {
      parts.push(
        <ActionForm key="send" action={markSentAction} submitLabel="Mark as sent" confirm={`Revision ${r.revisionNo} will be locked and the issued PDF stored. Changes after this need a new revision.`}>
          {hidden}
          <p className="text-[13px] text-steel">
            Approved by {r.reviewedByName ?? "a reviewer"} on {fmtDateTime(r.reviewedAt)}. Marking as sent locks the revision, stores the issued PDF and starts the {r.validityDays}-day validity.
          </p>
          <FormGrid cols={2}>
            <TextField label="Sent to" name="sentTo" required defaultValue={contactEmail} hint="Email address, or how it was sent (e.g. handed to buyer)" />
            <div className="pt-6">
              <CheckboxField label="Email the PDF to this address now" name="emailToCustomer" defaultChecked={!!contactEmail} />
            </div>
          </FormGrid>
          <TextArea label="Message (for the email)" name="message" rows={2} />
        </ActionForm>,
      );
    } else parts.push(<p key="send" className="text-[13px] text-steel">Approved — waiting to be sent to the customer.</p>);
  }

  if (["sent", "awaiting_response"].includes(r.status)) {
    if (!r.acceptanceRecordedAt) {
      const row: ReactNode[] = [];
      if (can(a, "quotations.record_response")) {
        row.push(
          <Disclosure key="acc" label="Record acceptance" variant="primary">
            {expired ? (
              <p className="text-[13px] text-red">This revision expired on {fmtDate(r.validUntil)}. Create a new revision before accepting.</p>
            ) : (
              <ActionForm action={recordAcceptanceAction} submitLabel="Record acceptance" className="w-[min(520px,80vw)]">
                {hidden}
                <FileField label="Acceptance evidence" name="evidence" hint="The customer’s email (.eml/.pdf) or PO" />
                <TextField label="Reference" name="reference" hint="e.g. PO number or email date — required if no file" />
                <TextArea label="Customer comments" name="feedback" rows={2} />
                <p className="text-[12px] text-steel">A second person must verify the acceptance before a job can be created.</p>
              </ActionForm>
            )}
          </Disclosure>,
          <Disclosure key="rej" label="Record rejection">
            <ActionForm action={recordRejectionAction} submitLabel="Record rejection" submitVariant="danger" className="w-[min(520px,80vw)]" confirm="The quotation will be marked as rejected and the enquiry as lost.">
              {hidden}
              <TextArea label="Customer feedback" name="feedback" rows={3} required placeholder="e.g. Price — lost to competitor at 12% lower; lead time too long" />
            </ActionForm>
          </Disclosure>,
        );
      }
      if (can(a, "quotations.send")) {
        row.push(
          <Disclosure key="fu" label="Record follow-up">
            <ActionForm action={followUpAction} submitLabel="Record follow-up" resetOnSuccess className="w-[min(520px,80vw)]">
              {hidden}
              <TextArea label="Follow-up note" name="note" rows={2} required placeholder="e.g. Phoned buyer — decision expected Friday" />
            </ActionForm>
          </Disclosure>,
        );
      }
      parts.push(
        <div key="resp">
          <p className="mb-2 text-[13px] text-steel">
            Sent to {r.sentTo ?? "the customer"} on {fmtDate(r.sentAt)}; valid until{" "}
            <span className={expired ? "font-medium text-red" : "text-ink"}>{fmtDate(r.validUntil)}</span>.
          </p>
          {row.length > 0 && <div className="flex flex-wrap items-start gap-2">{row}</div>}
        </div>,
      );
    } else if (!r.acceptanceVerifiedAt) {
      const sameUser = r.acceptanceRecordedBy === ctx.me;
      const info = (
        <p className="text-[13px] text-steel">
          Acceptance recorded by {r.acceptanceRecordedByName ?? "—"} on {fmtDateTime(r.acceptanceRecordedAt)}
          {r.acceptanceReference && <> — reference {r.acceptanceReference}</>}.{" "}
          {r.acceptanceEvidenceFileId && (
            <a className="link" href={`/api/files/${r.acceptanceEvidenceFileId}`}>
              Open evidence
            </a>
          )}
        </p>
      );
      if (can(a, "quotations.verify_acceptance") && !sameUser) {
        parts.push(
          <ActionForm key="ver" action={verifyAcceptanceAction} submitLabel="Verify acceptance">
            {hidden}
            {info}
            <TextArea label="Comment" name="comment" rows={2} />
            <SignatureBlock meaning={`By signing I confirm I have checked the customer’s acceptance evidence against ${q.ref} revision ${r.revisionNo} (price, quantity, revision and terms) and that it is genuine.`} />
          </ActionForm>,
        );
      } else {
        parts.push(
          <div key="ver">
            {info}
            <p className="mt-1 text-[13px] text-amber">
              {sameUser ? "You recorded this acceptance, so a different person must verify it." : "Waiting for verification by someone with permission to verify acceptances."}
            </p>
          </div>,
        );
      }
    }
  }

  if (r.status === "accepted") {
    parts.push(
      <div key="acc" className="flex flex-wrap items-center gap-3">
        <p className="text-[13px] text-green">
          Accepted and verified by {r.acceptanceVerifiedByName ?? "—"} on {fmtDateTime(r.acceptanceVerifiedAt)}.
        </p>
        {can(a, "orders.manage") && (
          <LinkButton href={`/orders/new?customerId=${customerId}&revisionId=${r.id}`} variant="primary" size="sm">
            Register customer PO
          </LinkButton>
        )}
      </div>,
    );
  }
  if (r.status === "rejected") parts.push(<p key="x" className="text-[13px] text-steel">Rejected by the customer{r.customerFeedback ? `: ${r.customerFeedback}` : "."}</p>);
  if (r.status === "expired") parts.push(<p key="x" className="text-[13px] text-steel">Expired on {fmtDate(r.validUntil)} without a recorded acceptance.</p>);
  if (r.status === "superseded") parts.push(<p key="x" className="text-[13px] text-steel">Superseded by a later revision — do not use.</p>);

  const canRevise = ctx.manage && isLatest && !hasAccepted && r.status !== "draft";
  if (!parts.length && !canRevise) return null;

  return (
    <Section title={isLatest ? "Next step" : `Revision ${r.revisionNo} (not the latest)`} className="rounded-md border border-ink/30 bg-sheet p-3 [&>div:first-child]:mb-3">
      <div className="space-y-3">{parts}</div>
      {canRevise && (
        <div className="mt-3 border-t border-line pt-3">
          <Disclosure label="Create new revision">
            <ActionForm action={createRevisionAction} submitLabel="Create revision" className="w-[min(520px,80vw)]">
              <input type="hidden" name="quotationId" value={q.id} />
              <TextArea label="Reason for the new revision" name="reason" rows={2} required placeholder="e.g. Customer asked for 50 off instead of 20; revised drawing rev C" />
              <p className="text-[12px] text-steel">Lines and terms are copied into a new draft. The earlier revision is superseded when the new one is sent.</p>
            </ActionForm>
          </Disclosure>
        </div>
      )}
    </Section>
  );
}

export const metadata = { title: "Quotation" };
