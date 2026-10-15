"use client";

import { useState } from "react";
import { CheckboxField, SelectField, TextField } from "@/components/forms";
import { buttonClass } from "@/components/ui";

export const CHAR_TYPE_OPTIONS = [
  { value: "dimensional", label: "Dimensional (measured)" },
  { value: "hardness", label: "Hardness (measured)" },
  { value: "surface", label: "Surface finish (measured)" },
  { value: "visual", label: "Visual (pass/fail)" },
  { value: "attribute", label: "Attribute / gauge (pass/fail)" },
  { value: "document", label: "Document check (pass/fail)" },
  { value: "functional", label: "Functional (pass/fail)" },
];

export type CharPrefill = Partial<{
  balloonNo: string | null;
  name: string;
  charType: string;
  specification: string | null;
  nominal: string | null;
  tolMinus: string | null;
  tolPlus: string | null;
  unit: string | null;
  method: string | null;
  instrumentType: string | null;
  sampleSize: string;
  frequency: string | null;
  acceptanceCriteria: string | null;
  evidenceRequired: boolean;
  isCritical: boolean;
}>;

/** One characteristic's fields, named `<prefix><field>` (e.g. ch0_name). */
export function CharacteristicFields({ prefix, c = {}, required = false }: { prefix: string; c?: CharPrefill; required?: boolean }) {
  const t = (v: string | null | undefined) => v ?? undefined;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <TextField label="Balloon no." name={`${prefix}balloonNo`} defaultValue={t(c.balloonNo)} />
        <TextField label="Characteristic" name={`${prefix}name`} defaultValue={t(c.name)} required={required} className="lg:col-span-2" placeholder="e.g. Bore Ø25 H7" />
        <SelectField label="Type" name={`${prefix}charType`} options={CHAR_TYPE_OPTIONS} defaultValue={c.charType ?? "dimensional"} className="lg:col-span-2" />
        <TextField label="Unit" name={`${prefix}unit`} defaultValue={t(c.unit) ?? "mm"} />
        <TextField label="Specification" name={`${prefix}specification`} defaultValue={t(c.specification)} className="lg:col-span-2" placeholder="e.g. Ø25 +0.021/0" />
        <TextField label="Nominal" name={`${prefix}nominal`} defaultValue={t(c.nominal)} inputMode="decimal" hint="Required for measured types" />
        <TextField label="Tol − (deviation)" name={`${prefix}tolMinus`} defaultValue={t(c.tolMinus)} inputMode="decimal" placeholder="e.g. -0.02" />
        <TextField label="Tol + (deviation)" name={`${prefix}tolPlus`} defaultValue={t(c.tolPlus)} inputMode="decimal" placeholder="e.g. 0.02" />
        <TextField label="Sample size" name={`${prefix}sampleSize`} defaultValue={c.sampleSize ?? "1"} inputMode="numeric" />
        <TextField label="Method" name={`${prefix}method`} defaultValue={t(c.method)} placeholder="e.g. Measure at 3 positions" />
        <TextField label="Instrument type" name={`${prefix}instrumentType`} defaultValue={t(c.instrumentType)} placeholder="e.g. bore_gauge" />
        <TextField label="Frequency" name={`${prefix}frequency`} defaultValue={t(c.frequency)} placeholder="e.g. 1 in 10" />
        <TextField label="Acceptance criteria" name={`${prefix}acceptanceCriteria`} defaultValue={t(c.acceptanceCriteria)} className="lg:col-span-3" />
      </div>
      <div className="flex flex-wrap gap-5">
        <CheckboxField label="Evidence required (photo / report must be attached)" name={`${prefix}evidenceRequired`} defaultChecked={c.evidenceRequired} />
        <CheckboxField label="Critical characteristic" name={`${prefix}isCritical`} defaultChecked={c.isCritical} />
      </div>
    </div>
  );
}

/** Repeated characteristic rows for a new plan. Blank rows (no name) are ignored. */
export function CharacteristicRows({ prefill = [], max = 10 }: { prefill?: CharPrefill[]; max?: number }) {
  const limit = Math.max(max, prefill.length);
  const [count, setCount] = useState(Math.min(limit, Math.max(1, prefill.length)));
  return (
    <div className="space-y-3">
      <input type="hidden" name="rows" value={count} />
      {Array.from({ length: count }, (_, i) => (
        <fieldset key={i} className="rounded-md border border-line bg-paper p-3">
          <legend className="px-1 text-[12.5px] font-semibold text-ink">Characteristic {i + 1}</legend>
          <CharacteristicFields prefix={`ch${i}_`} c={prefill[i]} />
        </fieldset>
      ))}
      <div className="flex items-center gap-3">
        {count < limit && (
          <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setCount((n) => Math.min(limit, n + 1))}>
            Add characteristic
          </button>
        )}
        <span className="text-[12px] text-steel">
          {count} of {limit} rows. Rows without a characteristic name are ignored. More can be added to a draft plan after it is created.
        </span>
      </div>
    </div>
  );
}
