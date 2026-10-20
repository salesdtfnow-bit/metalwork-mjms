"use client";

import { useState } from "react";
import { ActionForm, FileField, FormGrid, SignatureBlock, SubmitButton, TextArea, TextField } from "@/components/forms";
import { buttonClass, cx } from "@/components/ui";
import { registerOrderAction } from "../actions";

export type OrderLineDraft = { partNumber: string; description: string; drawingRevision?: string | null; materialSpec?: string | null; quantity: string; unitPrice?: string | null };
export type OrderDraft = {
  customerPoNumber?: string | null;
  poDate?: string | null;
  requiredDate?: string | null;
  commercialTerms?: string | null;
  notes?: string | null;
  lines?: OrderLineDraft[];
};

const blank: OrderLineDraft = { partNumber: "", description: "", drawingRevision: "", materialSpec: "", quantity: "", unitPrice: "" };

/**
 * Register a customer PO — against a quotation, or with the PO's own lines when there was no quote.
 * Optionally signs the contract review and creates the job in the same step.
 */
export function OrderForm({
  customer,
  quotations,
  preselectRevisionId,
  addresses,
  commercial,
  canFastTrack,
  draft,
  poFileId,
  poFileName,
}: {
  customer: { id: string; currency: string };
  quotations: { value: string; label: string }[];
  preselectRevisionId?: string | null;
  addresses: { value: string; label: string }[];
  commercial: boolean;
  canFastTrack: boolean;
  draft?: OrderDraft;
  /** A PO PDF already uploaded (e.g. read by the assistant) — used instead of a new upload. */
  poFileId?: string | null;
  poFileName?: string | null;
}) {
  const [revisionId, setRevisionId] = useState(draft?.lines?.length ? "" : (preselectRevisionId ?? ""));
  const [lines, setLines] = useState<OrderLineDraft[]>(draft?.lines?.length ? draft.lines : [{ ...blank }, { ...blank }]);
  const [createJob, setCreateJob] = useState(canFastTrack);
  const withQuote = !!revisionId;
  const update = (i: number, k: keyof OrderLineDraft, v: string) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, [k]: v } : l)));
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);

  return (
    <ActionForm action={registerOrderAction} hideSubmit className="space-y-5">
      <input type="hidden" name="customerId" value={customer.id} />
      {poFileId && <input type="hidden" name="poFileId" value={poFileId} />}

      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold text-ink">Purchase order</legend>
        <FormGrid cols={3}>
          <TextField label="Customer PO number" name="customerPoNumber" required autoFocus defaultValue={draft?.customerPoNumber} />
          <TextField label="PO date" name="poDate" type="date" defaultValue={draft?.poDate} />
          <TextField label="Required date" name="requiredDate" type="date" defaultValue={draft?.requiredDate} hint="As stated on the PO" />
        </FormGrid>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="quotationRevisionId" className="mb-1 block text-[12.5px] font-medium text-ink-2">
              Quotation
            </label>
            <select id="quotationRevisionId" name="quotationRevisionId" value={revisionId} onChange={(e) => setRevisionId(e.target.value)} className="field-input">
              <option value="">No quotation — enter the lines from the PO</option>
              {quotations.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[12px] text-steel">Repeat or call-off orders often arrive without a quote — that&apos;s fine.</p>
          </div>
          {addresses.length > 0 && (
            <div>
              <label htmlFor="deliveryAddressId" className="mb-1 block text-[12.5px] font-medium text-ink-2">
                Delivery address
              </label>
              <select id="deliveryAddressId" name="deliveryAddressId" defaultValue="" className="field-input">
                <option value="">Customer default delivery address</option>
                {addresses.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </fieldset>

      {!withQuote && (
        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold text-ink">Ordered lines</legend>
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="data-table min-w-[760px]">
              <thead>
                <tr>
                  <th scope="col">Part number</th>
                  <th scope="col">Description</th>
                  <th scope="col">Drawing rev</th>
                  <th scope="col">Material</th>
                  <th scope="col" className="w-24">
                    Qty
                  </th>
                  {commercial && (
                    <th scope="col" className="w-28">
                      Unit price ({customer.currency})
                    </th>
                  )}
                  <th scope="col" className="w-10">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <input name="line_part" value={l.partNumber} onChange={(e) => update(i, "partNumber", e.target.value)} className="field-input" aria-label={`Line ${i + 1} part number`} />
                    </td>
                    <td>
                      <input name="line_desc" value={l.description} onChange={(e) => update(i, "description", e.target.value)} className="field-input" aria-label={`Line ${i + 1} description`} />
                    </td>
                    <td className="w-24">
                      <input name="line_rev" value={l.drawingRevision ?? ""} onChange={(e) => update(i, "drawingRevision", e.target.value)} className="field-input" aria-label={`Line ${i + 1} drawing revision`} />
                    </td>
                    <td>
                      <input name="line_mat" value={l.materialSpec ?? ""} onChange={(e) => update(i, "materialSpec", e.target.value)} className="field-input" aria-label={`Line ${i + 1} material`} />
                    </td>
                    <td>
                      <input name="line_qty" inputMode="decimal" value={l.quantity} onChange={(e) => update(i, "quantity", e.target.value)} className="field-input text-right" aria-label={`Line ${i + 1} quantity`} />
                    </td>
                    {commercial && (
                      <td>
                        <input name="line_price" inputMode="decimal" value={l.unitPrice ?? ""} onChange={(e) => update(i, "unitPrice", e.target.value)} className="field-input text-right" aria-label={`Line ${i + 1} unit price`} />
                      </td>
                    )}
                    <td>
                      <button type="button" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, n) => n !== i) : [{ ...blank }]))} className={buttonClass("ghost", "sm")} aria-label={`Remove line ${i + 1}`}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={() => setLines((ls) => [...ls, { ...blank }])} className={buttonClass("secondary", "sm")}>
              Add line
            </button>
            {commercial && total > 0 && <p className="text-[13px] text-steel">Lines total {new Intl.NumberFormat("en-GB", { style: "currency", currency: customer.currency }).format(total)} (ex VAT)</p>}
          </div>
          <p className="mt-1 text-[12px] text-steel">Empty rows are ignored.</p>
        </fieldset>
      )}

      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold text-ink">Terms and document</legend>
        <FormGrid cols={2}>
          <TextArea label="Commercial terms on the PO" name="commercialTerms" rows={2} defaultValue={draft?.commercialTerms} />
          <TextArea label="Notes" name="notes" rows={2} defaultValue={draft?.notes} />
        </FormGrid>
        <div className="mt-3">
          {poFileId ? (
            <p className="text-[13px] text-steel">
              PO document: <span className="text-ink">{poFileName ?? "uploaded PDF"}</span> (stored unaltered as the customer original).
            </p>
          ) : (
            <FileField label="PO document" name="poFile" hint="The customer's PO (PDF or email). Needed for the contract review; stored unaltered." />
          )}
        </div>
      </fieldset>

      {canFastTrack && (
        <fieldset className={cx("rounded-md border p-3", createJob ? "border-dykem bg-dykem-50" : "border-line")}>
          <legend className="px-1 text-[13px] font-semibold text-ink">Create the job now</legend>
          <label className="flex items-start gap-2 text-[13.5px] text-ink">
            <input type="checkbox" name="createJob" checked={createJob} onChange={(e) => setCreateJob(e.target.checked)} className="mt-0.5 h-4 w-4 accent-dykem" />
            <span>
              Sign the contract review and create the job in one go, so the work can be planned straight away.
              <span className="block text-[12px] text-steel">Untick to register the PO only and review it later.</span>
            </span>
          </label>
          {createJob && (
            <div className="mt-3 space-y-3">
              <FormGrid cols={3}>
                <TextField label="Job title" name="jobTitle" required defaultValue={draft?.lines?.[0]?.description ?? ""} className="sm:col-span-2" hint="Defaults to the first line's description" />
                <div>
                  <label htmlFor="priority" className="mb-1 block text-[12.5px] font-medium text-ink-2">
                    Priority
                  </label>
                  <select id="priority" name="priority" defaultValue="3" className="field-input">
                    <option value="1">Urgent</option>
                    <option value="2">High</option>
                    <option value="3">Normal</option>
                    <option value="4">Low</option>
                  </select>
                </div>
              </FormGrid>
              <TextArea label="Concerns or exceptions" name="discrepancies" rows={2} hint="Anything on the PO we can't meet or that needs checking. Leave blank if none." />
              <SignatureBlock meaning="By signing I confirm I have checked this PO — parts, drawing revisions, quantities, prices, delivery date and terms — and that we can meet it, with any exceptions recorded above." />
            </div>
          )}
        </fieldset>
      )}

      <SubmitButton size="lg">{createJob && canFastTrack ? "Register PO and create job" : "Register PO"}</SubmitButton>
    </ActionForm>
  );
}
