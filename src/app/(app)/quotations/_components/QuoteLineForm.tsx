"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ActionForm, FormGrid, NumberField, TextArea, TextField } from "@/components/forms";
import { costLine, type CostBreakdown } from "@/lib/costing";
import { trimQty } from "@/lib/decimal";
import { fmtMoney, fmtPct } from "@/lib/format";
import type { ActionResult } from "@/server/boundary";

type Op = { description: string; setupMinutes: string; cycleMinutes: string; ratePerHour: string };
export type QuoteLineValues = { id?: string; values: Partial<Record<string, string | null>>; operations: Op[] };

const MAX_OPS = 6;

const OTHER_COSTS: { name: string; label: string; hint?: string }[] = [
  { name: "programmingCost", label: "Programming", hint: "One-off, whole line" },
  { name: "setupCostPerBatch", label: "Setup per batch", hint: "× number of batches" },
  { name: "labourCost", label: "Labour (other)", hint: "Deburr, assembly…" },
  { name: "toolingCost", label: "Tooling" },
  { name: "consumablesCost", label: "Consumables" },
  { name: "subcontractCost", label: "Subcontract" },
  { name: "finishingCost", label: "Finishing" },
  { name: "inspectionCost", label: "Inspection" },
  { name: "certificationCost", label: "Certification" },
  { name: "packagingCost", label: "Packaging" },
  { name: "deliveryCost", label: "Delivery" },
  { name: "otherCost", label: "Other" },
];

const clean = (v: FormDataEntryValue | null | undefined) => String(v ?? "").trim().replace(/,/g, "");
const show = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? "" : trimQty(v));

/**
 * Add/edit form for a quotation line with a live cost preview. The preview uses the same
 * costing function as the server; the server recalculates and stores the result on save.
 */
export function QuoteLineForm({
  action,
  quotationId,
  revisionId,
  defaultMarginPct,
  currency,
  line,
  submitLabel,
}: {
  action: (p: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  quotationId: string;
  revisionId: string;
  defaultMarginPct: string;
  currency: string;
  line?: QuoteLineValues;
  submitLabel: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<CostBreakdown | { error: string } | null>(null);
  const l = line?.values ?? {};
  const ops = line?.operations ?? [];
  const lineId = line?.id;

  const recalc = useCallback(() => {
    const form = wrap.current?.closest("form");
    if (!form) return;
    const fd = new FormData(form);
    const g = (k: string) => clean(fd.get(k));
    const descs = fd.getAll("ops_desc");
    const setups = fd.getAll("ops_setup");
    const cycles = fd.getAll("ops_cycle");
    const rates = fd.getAll("ops_rate");
    const operations = descs
      .map((desc, i) => ({ desc: String(desc).trim(), setupMinutes: clean(setups[i]), cycleMinutes: clean(cycles[i]), ratePerHour: clean(rates[i]) }))
      .filter((o) => o.desc);
    const all = [g("quantity"), g("batchSize"), g("marginPct"), g("priceOverridePerUnit"), g("materialCostPerUnit"), g("materialWastagePct"), ...OTHER_COSTS.map((c) => g(c.name)), ...operations.flatMap((o) => [o.setupMinutes, o.cycleMinutes, o.ratePerHour])];
    if (all.some((v) => v !== "" && !/^-?\d+(\.\d+)?$/.test(v))) {
      setPreview({ error: "Enter numbers only (no currency symbols or units)." });
      return;
    }
    try {
      setPreview(
        costLine(
          {
            quantity: g("quantity"),
            batchSize: g("batchSize") || undefined,
            materialCostPerUnit: g("materialCostPerUnit"),
            materialWastagePct: g("materialWastagePct"),
            ...Object.fromEntries(OTHER_COSTS.map((c) => [c.name, g(c.name)])),
            marginPct: g("marginPct") || undefined,
            priceOverridePerUnit: g("priceOverridePerUnit") || undefined,
            operations,
          },
          defaultMarginPct,
        ),
      );
    } catch (e) {
      setPreview({ error: (e as Error).message });
    }
  }, [defaultMarginPct]);

  useEffect(() => {
    recalc();
  }, [recalc]);

  return (
    <ActionForm action={action} submitLabel={submitLabel} resetOnSuccess={!lineId}>
      <input type="hidden" name="quotationId" value={quotationId} />
      <input type="hidden" name="revisionId" value={revisionId} />
      {lineId && <input type="hidden" name="lineId" value={lineId} />}
      <div ref={wrap} onInput={recalc} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-[12.5px] font-semibold text-ink">Part</legend>
            <FormGrid cols={4}>
              <TextField label="Part number" name="partNumber" required defaultValue={l.partNumber} />
              <TextField label="Description" name="description" required defaultValue={l.description} className="sm:col-span-2 lg:col-span-3" />
              <TextField label="Drawing number" name="drawingNumber" defaultValue={l.drawingNumber} />
              <TextField label="Drawing revision" name="drawingRevision" defaultValue={l.drawingRevision} />
              <TextField label="Material" name="materialSpec" defaultValue={l.materialSpec} placeholder="e.g. 6082-T6 Ø50 bar" className="sm:col-span-2" />
              <NumberField label="Quantity" name="quantity" required defaultValue={show(l.quantity)} />
              <NumberField label="Batch size" name="batchSize" defaultValue={show(l.batchSize)} hint="Blank = one batch" />
              <NumberField label="Material cost per unit" name="materialCostPerUnit" unit={currency} defaultValue={show(l.materialCostPerUnit)} />
              <NumberField label="Material wastage" name="materialWastagePct" unit="%" defaultValue={show(l.materialWastagePct)} />
            </FormGrid>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-[12.5px] font-semibold text-ink">Machining operations (estimate)</legend>
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="data-table min-w-[560px]">
                <thead>
                  <tr>
                    <th scope="col">Operation</th>
                    <th scope="col">Setup (min / batch)</th>
                    <th scope="col">Cycle (min / part)</th>
                    <th scope="col">Rate ({currency}/h)</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: MAX_OPS }, (_, n) => {
                    const o = ops[n];
                    return (
                      <tr key={n}>
                        <td>
                          <input name="ops_desc" defaultValue={o?.description ?? ""} placeholder={n === 0 ? "e.g. CNC mill op 1" : ""} className="field-input" aria-label={`Operation ${n + 1} description`} />
                        </td>
                        <td className="w-32">
                          <input name="ops_setup" inputMode="decimal" defaultValue={o ? show(o.setupMinutes) : ""} className="field-input" aria-label={`Operation ${n + 1} setup minutes`} />
                        </td>
                        <td className="w-32">
                          <input name="ops_cycle" inputMode="decimal" defaultValue={o ? show(o.cycleMinutes) : ""} className="field-input" aria-label={`Operation ${n + 1} cycle minutes`} />
                        </td>
                        <td className="w-32">
                          <input name="ops_rate" inputMode="decimal" defaultValue={o ? show(o.ratePerHour) : ""} className="field-input" aria-label={`Operation ${n + 1} rate per hour`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[12px] text-steel">Rows without a description are ignored. Machining = setup × batches + cycle × quantity, at the hourly rate.</p>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-[12.5px] font-semibold text-ink">Other costs ({currency}, whole line)</legend>
            <FormGrid cols={4}>
              {OTHER_COSTS.map((c) => (
                <NumberField key={c.name} label={c.label} name={c.name} defaultValue={show(l[c.name])} hint={c.hint} />
              ))}
            </FormGrid>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-[12.5px] font-semibold text-ink">Pricing</legend>
            <FormGrid cols={3}>
              <NumberField label="Margin override" name="marginPct" unit="%" defaultValue={show(l.marginPct)} hint={`Blank = revision default (${trimQty(defaultMarginPct)}%)`} />
              <NumberField label="Price override per unit" name="priceOverridePerUnit" unit={currency} defaultValue={show(l.priceOverridePerUnit)} hint="Replaces the calculated price" />
              <TextField label="Override reason" name="priceOverrideReason" defaultValue={l.priceOverrideReason} hint="Required with a price override" />
            </FormGrid>
            <div className="mt-3">
              <TextArea label="Line notes" name="notes" rows={2} defaultValue={l.notes} hint="Kept with the line; not printed on the quotation PDF." />
            </div>
          </fieldset>
        </div>

        <aside aria-live="polite" className="self-start rounded-md border border-ink/30 bg-paper p-3 lg:sticky lg:top-4">
          <p className="text-[12.5px] font-semibold text-ink">Calculated price</p>
          {!preview ? null : "error" in preview ? (
            <p className="mt-2 text-[12.5px] text-steel">{preview.error}</p>
          ) : (
            <dl className="mt-2 space-y-1 text-[12.5px]">
              <Row label="Batches" value={String(preview.batches)} />
              <Row label="Material" value={fmtMoney(preview.materialCost, currency)} />
              <Row label="Machining" value={fmtMoney(preview.machiningCost, currency)} />
              <Row label="Setup" value={fmtMoney(preview.setupCost, currency)} />
              <Row label="Other costs" value={fmtMoney(preview.oneOffCost, currency)} />
              <Row label="Total cost" value={fmtMoney(preview.totalCost, currency)} strong />
              <Row label="Cost per unit" value={fmtMoney(preview.unitCost, currency)} />
              <Row label="Margin used" value={fmtPct(preview.marginPct)} />
              <Row label="Calculated unit price" value={fmtMoney(preview.calculatedUnitPrice, currency)} />
              {preview.overridden && <Row label="Override unit price" value={fmtMoney(preview.unitPrice, currency)} />}
              <div className="my-1 border-t border-line" />
              <Row label="Unit price" value={fmtMoney(preview.unitPrice, currency)} strong />
              <Row label="Line total" value={fmtMoney(preview.lineTotal, currency)} strong />
              <Row label="Achieved margin" value={fmtPct(preview.achievedMarginPct)} warn={Number(preview.achievedMarginPct) < 10} />
            </dl>
          )}
          <p className="mt-2 text-[11.5px] text-steel">Preview only. The server recalculates when you save.</p>
        </aside>
      </div>
    </ActionForm>
  );
}

function Row({ label, value, strong, warn }: { label: string; value: string; strong?: boolean; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-steel">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold text-ink" : "text-ink"} ${warn ? "text-red" : ""}`}>{value}</dd>
    </div>
  );
}
