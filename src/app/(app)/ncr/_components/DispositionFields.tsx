"use client";

import { useState } from "react";
import { TextArea, TextField } from "@/components/forms";

export const DISPOSITION_INFO: Record<string, { label: string; explain: string }> = {
  rework: { label: "Rework", explain: "Bring the parts into full conformance with the drawing. A rework operation is added to the job route; when it is signed off a reinspection opens automatically." },
  repair: { label: "Repair", explain: "Make the parts usable although they will not fully meet the drawing. Requires a customer concession / deviation reference. A repair operation and reinspection follow." },
  use_as_is: { label: "Use as is", explain: "Accept the parts without further work. Requires a customer concession / deviation reference." },
  scrap: { label: "Scrap", explain: "The affected quantity is written off and added to the line's scrapped quantity." },
  return_to_supplier: { label: "Return to supplier", explain: "The material lot is marked as returned and stays out of production." },
  awaiting_investigation: { label: "Awaiting investigation", explain: "Records an interim decision. The NCR cannot be closed until a final disposition is approved." },
};

/** Disposition select with live explanation and conditional fields (inside an ActionForm). */
export function DispositionFields({ hasJobLine }: { hasJobLine: boolean }) {
  const [disp, setDisp] = useState("");
  const info = DISPOSITION_INFO[disp];
  const needsConcession = disp === "use_as_is" || disp === "repair";
  const createsOps = disp === "rework" || disp === "repair";
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="disp-select" className="mb-1 block text-[12.5px] font-medium text-ink-2">
          Disposition<span className="text-red" aria-hidden> *</span>
        </label>
        <select id="disp-select" name="disposition" required value={disp} onChange={(e) => setDisp(e.target.value)} className="field-input max-w-sm">
          <option value="">Select…</option>
          {Object.entries(DISPOSITION_INFO).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        {info && <p className="mt-1 max-w-[70ch] text-[12.5px] text-steel">{info.explain}</p>}
        {createsOps && !hasJobLine && <p className="mt-1 text-[12.5px] text-amber">This NCR is not linked to a job line, so no rework operation can be created automatically.</p>}
      </div>
      <TextArea label="Disposition rationale" name="notes" required rows={3} />
      {needsConcession && <TextField label="Customer concession / deviation reference" name="customerConcessionRef" required placeholder="e.g. Customer concession CN-2026-041" />}
      {createsOps && <TextArea label={disp === "rework" ? "Rework instructions" : "Repair instructions"} name="reworkInstructions" rows={3} hint="Shown to the operator on the rework operation. Defaults to the rationale." />}
    </div>
  );
}
