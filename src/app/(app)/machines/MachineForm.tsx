"use client";

import { useState } from "react";
import { ActionForm, CheckboxField, FormGrid, NumberField, SelectField, TextArea, TextField } from "@/components/forms";
import type { ActionResult } from "@/server/boundary";

type Opt = { value: string; label: string };
type FieldDef = { key: string; label: string; type: string; unit?: string };
export type MachineTypeOpt = { id: string; code: string; name: string; customFieldDefs: unknown };
type MachineValues = Partial<Record<string, unknown>> & { id?: string; customFields?: unknown };

const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

export function MachineForm({
  action,
  machine,
  types,
  groups,
  calendars,
  employees,
  operationTypes,
  selectedOperationTypeIds = [],
  showRate,
  submitLabel,
}: {
  action: (p: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  machine?: MachineValues;
  types: MachineTypeOpt[];
  groups: Opt[];
  calendars: Opt[];
  employees: Opt[];
  operationTypes: Opt[];
  selectedOperationTypeIds?: string[];
  showRate: boolean;
  submitLabel: string;
}) {
  const m = machine ?? {};
  const [typeId, setTypeId] = useState<string>(s(m.machineTypeId) ?? "");
  const type = types.find((t) => t.id === typeId);
  const defs = (Array.isArray(type?.customFieldDefs) ? type.customFieldDefs : []) as FieldDef[];
  const cf = (m.customFields && typeof m.customFields === "object" ? m.customFields : {}) as Record<string, unknown>;

  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      {m.id && <input type="hidden" name="id" value={m.id} />}
      <FormGrid cols={3}>
        <TextField label="Machine ID" name="code" required defaultValue={s(m.code)} hint="Short code shown on travellers, e.g. VMC-02" />
        <TextField label="Name" name="name" required defaultValue={s(m.name)} className="sm:col-span-2" />
        <div className="min-w-0">
          <label htmlFor="mf-type" className="mb-1 block text-[12.5px] font-medium text-ink-2">
            Machine type<span className="text-red" aria-hidden> *</span>
          </label>
          <select id="mf-type" name="machineTypeId" required value={typeId} onChange={(e) => setTypeId(e.target.value)} className="field-input">
            <option value="">Select a type</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.code})
              </option>
            ))}
          </select>
        </div>
        <SelectField label="Machine group" name="machineGroupId" options={groups} defaultValue={s(m.machineGroupId)} placeholder="None" />
        <TextField label="Location" name="location" defaultValue={s(m.location)} placeholder="e.g. Bay 2" />
        <TextField label="Manufacturer" name="manufacturer" defaultValue={s(m.manufacturer)} />
        <TextField label="Model" name="model" defaultValue={s(m.model)} />
        <TextField label="Serial number" name="serialNumber" defaultValue={s(m.serialNumber)} />
        <TextField label="Year of manufacture" name="yearOfManufacture" inputMode="numeric" defaultValue={s(m.yearOfManufacture)} />
        <TextField label="Controller" name="controller" defaultValue={s(m.controller)} placeholder="e.g. Heidenhain TNC 640" />
        <TextField label="Axes" name="axes" defaultValue={s(m.axes)} placeholder="e.g. 3+2" />
        <TextField label="Work envelope" name="workEnvelope" defaultValue={s(m.workEnvelope)} placeholder="X × Y × Z mm" />
        <NumberField label="Max workpiece weight" unit="kg" name="maxWeightKg" defaultValue={s(m.maxWeightKg)} />
        <TextField label="Max spindle speed (rpm)" name="spindleSpeedMax" inputMode="numeric" defaultValue={s(m.spindleSpeedMax)} />
        <SelectField label="Responsible person" name="responsibleEmployeeId" options={employees} defaultValue={s(m.responsibleEmployeeId)} placeholder="None" />
        <SelectField label="Working calendar" name="calendarId" options={calendars} defaultValue={s(m.calendarId)} placeholder="Default (Mon–Fri 07:00–15:30)" hint="Used for available time and utilisation." />
        {showRate && <NumberField label="Hourly rate" unit="£/h" name="hourlyRate" defaultValue={s(m.hourlyRate)} />}
      </FormGrid>

      {defs.length > 0 && (
        <fieldset className="rounded-sm border border-line p-3">
          <legend className="px-1 text-[12.5px] font-semibold text-ink">{type?.name} fields</legend>
          <FormGrid cols={3}>
            {defs.map((d) => {
              const name = `cf_${d.key}`;
              const label = d.unit ? `${d.label} (${d.unit})` : d.label;
              const v = cf[d.key];
              if (d.type === "boolean") return <CheckboxField key={d.key} label={label} name={name} defaultChecked={v === true || v === "true"} />;
              if (d.type === "number") return <NumberField key={d.key} label={label} name={name} defaultValue={s(v)} />;
              if (d.type === "date") return <TextField key={d.key} label={label} name={name} type="date" defaultValue={s(v)} />;
              return <TextField key={d.key} label={label} name={name} defaultValue={s(v)} />;
            })}
          </FormGrid>
        </fieldset>
      )}

      <FormGrid cols={2}>
        <TextArea label="Capabilities" name="capabilities" defaultValue={s(m.capabilities)} hint="e.g. 4th axis, probing, through-spindle coolant" />
        <TextArea label="Permitted materials" name="permittedMaterials" defaultValue={s(m.permittedMaterials)} />
        <TextArea label="Accessories" name="accessories" defaultValue={s(m.accessories)} />
        <TextArea label="Setup requirements" name="setupRequirements" defaultValue={s(m.setupRequirements)} />
      </FormGrid>
      <TextArea label="Safety notes" name="safetyNotes" defaultValue={s(m.safetyNotes)} />

      <fieldset className="rounded-sm border border-line p-3">
        <legend className="px-1 text-[12.5px] font-semibold text-ink">Operation types this machine can perform</legend>
        <p className="mb-2 text-[12px] text-steel">If none are ticked, the machine is treated as capable of any operation type.</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {operationTypes.map((o) => (
            <CheckboxField key={o.value} label={o.label} name="operationTypeIds" value={o.value} defaultChecked={selectedOperationTypeIds.includes(o.value)} />
          ))}
        </div>
      </fieldset>
      <CheckboxField label="Allows concurrent operations" name="allowsConcurrent" defaultChecked={m.allowsConcurrent === true} hint="Tick if more than one operation can run on this machine at the same time (e.g. a multi-pallet cell)." />
    </ActionForm>
  );
}
