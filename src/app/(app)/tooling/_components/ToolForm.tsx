"use client";

import { useState } from "react";
import { ActionForm, CheckboxField, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import type { ActionResult } from "@/server/boundary";
import { LIFE_UNITS, TOOL_TYPES } from "./vocab";

type Tool = {
  id: string;
  assetNo: string;
  description: string;
  toolType: string;
  location: string | null;
  ownership: string;
  boxheroItemId: string | null;
  lifeUnit: string;
  lifeLimit: string | null;
  inspectionRequired: boolean;
  inspectionIntervalDays: number | null;
  nextInspectionDue: string | null;
  notes: string | null;
};

export function ToolForm({
  action,
  tool,
  machineIds = [],
  machines,
  boxheroItems,
  submitLabel,
}: {
  action: (p: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  tool?: Tool;
  machineIds?: string[];
  machines: { id: string; code: string; name: string }[];
  boxheroItems: { id: string; name: string; sku: string | null }[];
  submitLabel: string;
}) {
  const t = tool;
  const [ownership, setOwnership] = useState(t?.ownership ?? "mjms");
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      {t && <input type="hidden" name="id" value={t.id} />}
      <FormGrid cols={3}>
        <TextField label="Asset number" name="assetNo" required defaultValue={t?.assetNo} hint="Stored in upper case, must be unique." />
        <TextField label="Description" name="description" required defaultValue={t?.description} className="sm:col-span-2" />
        <SelectField label="Type" name="toolType" required options={TOOL_TYPES} defaultValue={t?.toolType ?? "cutting_tool"} />
        <TextField label="Location" name="location" defaultValue={t?.location} placeholder="e.g. Crib A, drawer 3" />
      </FormGrid>

      <fieldset className="rounded-sm border border-line p-3">
        <legend className="px-1 text-[12.5px] font-semibold text-ink">Record ownership</legend>
        <div className="flex flex-wrap gap-4 text-[13.5px]">
          <label className="flex items-center gap-2">
            <input type="radio" name="ownership" value="mjms" checked={ownership === "mjms"} onChange={() => setOwnership("mjms")} className="accent-dykem" />
            MJMS (asset managed here)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="ownership" value="boxhero" checked={ownership === "boxhero"} onChange={() => setOwnership("boxhero")} className="accent-dykem" />
            BoxHero (consumable stock managed in BoxHero)
          </label>
        </div>
        <p className="mt-1.5 text-[12px] text-steel">
          Stock quantities for consumables live in BoxHero. MJMS only references the BoxHero item — it never duplicates or edits BoxHero stock. Life, inspection and machine links are tracked here either way.
        </p>
        <div className="mt-2 max-w-xl">
          <SelectField
            label="BoxHero item"
            name="boxheroItemId"
            required={ownership === "boxhero"}
            options={boxheroItems.map((b) => ({ value: b.id, label: b.sku ? `${b.name} (${b.sku})` : b.name }))}
            defaultValue={t?.boxheroItemId}
            placeholder={boxheroItems.length ? "Not linked" : "No BoxHero items synced yet"}
            hint={ownership === "boxhero" ? "Required for BoxHero-owned tooling." : "Optional link for MJMS-owned assets."}
          />
        </div>
      </fieldset>

      <FormGrid cols={3}>
        <SelectField label="Life unit" name="lifeUnit" options={LIFE_UNITS} defaultValue={t?.lifeUnit ?? "none"} />
        <TextField label="Life limit" name="lifeLimit" inputMode="decimal" defaultValue={t?.lifeLimit} hint="Required when life-tracked. At the limit the tool is flagged for maintenance." />
      </FormGrid>

      <div className="space-y-2">
        <CheckboxField label="Periodic inspection required" name="inspectionRequired" defaultChecked={t?.inspectionRequired} />
        <FormGrid cols={3}>
          <TextField label="Inspection interval (days)" name="inspectionIntervalDays" inputMode="numeric" defaultValue={t?.inspectionIntervalDays} />
          <TextField label="Next inspection due" name="nextInspectionDue" type="date" defaultValue={t?.nextInspectionDue} hint="Blank = today + interval." />
        </FormGrid>
      </div>

      <fieldset>
        <legend className="mb-1 text-[12.5px] font-medium text-ink-2">Used on machines</legend>
        {machines.length === 0 ? (
          <p className="text-[12.5px] text-steel">No active machines.</p>
        ) : (
          <div className="grid gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
            {machines.map((m) => (
              <CheckboxField key={m.id} label={`${m.code} — ${m.name}`} name="machineIds" value={m.id} defaultChecked={machineIds.includes(m.id)} />
            ))}
          </div>
        )}
      </fieldset>

      <TextArea label="Notes" name="notes" defaultValue={t?.notes} rows={2} />
    </ActionForm>
  );
}
