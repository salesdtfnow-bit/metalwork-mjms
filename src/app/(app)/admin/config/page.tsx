import { requirePageCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { PERMISSIONS } from "@/server/auth/permissions";
import { operationTypesList } from "@/server/services/routing";
import { calendarsList, listMachines, machineTypesList } from "@/server/services/machines";
import { listCompetencies } from "@/server/services/employees";
import { getSettings } from "@/server/services/settings";
import { listAllDowntimeReasons, listCalendarExceptions, listChecklistTemplates, listRetentionPolicies, listStatusTransitions } from "@/server/services/ui/records";
import { fmtDate, fmtMoney } from "@/lib/format";
import { JOB_STATUS, statusDef } from "@/lib/status";
import { Badge, Notice, Section, Table, Tabs } from "@/components/ui";
import { ActionForm, CheckboxField, Disclosure, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import {
  addCalendarExceptionAction,
  saveCalendarAction,
  saveChecklistAction,
  saveCompetencyAction,
  saveDowntimeReasonAction,
  saveMachineTypeAction,
  saveOperationTypeAction,
  saveRetentionAction,
  saveTransitionAction,
} from "../actions";

export const metadata = { title: "Configuration" };

const TABS = [
  { key: "optypes", label: "Operation types" },
  { key: "transitions", label: "Job status transitions" },
  { key: "checklists", label: "Release checklist" },
  { key: "downtime", label: "Downtime reasons" },
  { key: "machinetypes", label: "Machine types" },
  { key: "calendars", label: "Work calendars" },
  { key: "competencies", label: "Competencies" },
  { key: "retention", label: "Retention" },
];

const OP_CATEGORIES = ["machining", "cutting", "fabrication", "finishing", "treatment", "assembly", "inspection", "subcontract", "logistics", "other"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const FIELD_TYPES = ["text", "number", "boolean", "date"];

const yes = (b: boolean) => (b ? "Yes" : "—");
const active = (b: boolean) => (b ? <Badge tone="success">Active</Badge> : <Badge tone="muted">Disabled</Badge>);
const permOptions = Object.entries(PERMISSIONS).map(([k, v]) => ({ value: k, label: `${k} — ${v}` }));
const statusOptions = Object.entries(JOB_STATUS).map(([k, v]) => ({ value: k, label: v.label }));
const statusLabel = (s: string) => (s === "*" ? "Any status (*)" : statusDef(JOB_STATUS, s).label);

type Ctx = Awaited<ReturnType<typeof requirePageCtx>>;

export default async function ConfigPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageCtx("admin.config");
  const t = (await searchParams).tab;
  const tab = TABS.some((x) => x.key === t) ? t! : "optypes";
  return (
    <>
      <Tabs base="/admin/config" current={tab} tabs={TABS} />
      {tab === "optypes" && <OperationTypes ctx={ctx} />}
      {tab === "transitions" && <Transitions ctx={ctx} />}
      {tab === "checklists" && <Checklists ctx={ctx} />}
      {tab === "downtime" && <Downtime ctx={ctx} />}
      {tab === "machinetypes" && <MachineTypes ctx={ctx} />}
      {tab === "calendars" && <Calendars ctx={ctx} />}
      {tab === "competencies" && <Competencies ctx={ctx} />}
      {tab === "retention" && <Retention ctx={ctx} />}
    </>
  );
}

// ───────────── Operation types ─────────────

type OpType = Awaited<ReturnType<typeof operationTypesList>>[number];

function OperationTypeFields({ t, competencies }: { t?: OpType; competencies: { value: string; label: string }[] }) {
  return (
    <>
      {t && <input type="hidden" name="id" value={t.id} />}
      <FormGrid cols={4}>
        <TextField label="Code" name="code" required defaultValue={t?.code} hint="e.g. MILL, TURN, SAW" />
        <TextField label="Name" name="name" required defaultValue={t?.name} />
        <SelectField label="Category" name="category" required defaultValue={t?.category ?? "machining"} options={OP_CATEGORIES.map((c) => ({ value: c, label: c.replace(/^\w/, (x) => x.toUpperCase()) }))} />
        <TextField label="Sort order" name="sortOrder" defaultValue={t?.sortOrder ?? 100} inputMode="numeric" />
        <SelectField label="Default competency" name="defaultCompetencyId" placeholder="— None —" defaultValue={t?.defaultCompetencyId} options={competencies} />
        <TextField label="Default rate per hour" name="defaultRatePerHour" defaultValue={t?.defaultRatePerHour} inputMode="decimal" />
      </FormGrid>
      <div className="grid gap-2 sm:grid-cols-3">
        <CheckboxField label="Requires a machine" name="requiresMachine" defaultChecked={t ? t.requiresMachine : true} />
        <CheckboxField label="Requires a CNC program by default" name="requiresProgramDefault" defaultChecked={t?.requiresProgramDefault} />
        <CheckboxField label="Requires first-off by default" name="requiresFirstOffDefault" defaultChecked={t?.requiresFirstOffDefault} />
        <CheckboxField label="Subcontract operation" name="isSubcontract" defaultChecked={t?.isSubcontract} />
        <CheckboxField label="Inspection operation" name="isInspection" defaultChecked={t?.isInspection} />
        <CheckboxField label="Active" name="isActive" defaultChecked={t ? t.isActive : true} hint="Disabled types stay on existing routes but cannot be added to new ones." />
      </div>
    </>
  );
}

async function OperationTypes({ ctx }: { ctx: Ctx }) {
  const [types, comps, settings] = await Promise.all([operationTypesList(ctx, true), listCompetencies(ctx), getSettings(ctx.db)]);
  const compOpts = comps.map((c) => ({ value: c.c.id, label: `${c.c.code} — ${c.c.name}` }));
  return (
    <Section title={`Operation types (${types.length})`}>
      <Table head={["Code", "Name", "Category", "Machine", "Program", "First-off", "Subcon", "Inspection", "Rate / h", "Status", ""]}>
        {types.map((t) => (
          <tr key={t.id} className={t.isActive ? undefined : "text-steel"}>
            <td className="plate">{t.code}</td>
            <td className="font-medium">{t.name}</td>
            <td className="capitalize">{t.category}</td>
            <td>{yes(t.requiresMachine)}</td>
            <td>{yes(t.requiresProgramDefault)}</td>
            <td>{yes(t.requiresFirstOffDefault)}</td>
            <td>{yes(t.isSubcontract)}</td>
            <td>{yes(t.isInspection)}</td>
            <td>{t.defaultRatePerHour ? fmtMoney(t.defaultRatePerHour, settings.currency) : "—"}</td>
            <td>{active(t.isActive)}</td>
            <td>
              <Disclosure label="Edit" variant="ghost">
                <ActionForm action={saveOperationTypeAction} submitLabel="Save operation type">
                  <OperationTypeFields t={t} competencies={compOpts} />
                </ActionForm>
              </Disclosure>
            </td>
          </tr>
        ))}
      </Table>
      <div className="mt-3">
        <Disclosure label="Add operation type" variant="primary">
          <ActionForm action={saveOperationTypeAction} submitLabel="Add operation type" resetOnSuccess>
            <OperationTypeFields competencies={compOpts} />
          </ActionForm>
        </Disclosure>
      </div>
    </Section>
  );
}

// ───────────── Status transitions ─────────────

async function Transitions({ ctx }: { ctx: Ctx }) {
  const rows = await listStatusTransitions(ctx, "job");
  return (
    <Section title={`Job status transitions (${rows.length})`}>
      <Notice tone="warning" title="Production-phase statuses are derived automatically">
        Production-phase statuses are derived automatically and critical gates (material release, program release, first-off, final release, dispatch) are enforced regardless of this table. This table only controls which manual status changes are offered, who may make them, and whether a reason is required.
      </Notice>
      <Table head={["From", "To", "Rule (permission · reason · active)"]} empty="No transitions configured — users cannot change job status manually.">
        {rows.map((r) => (
          <tr key={r.id} className={r.isActive ? undefined : "text-steel"}>
            <td>{statusLabel(r.fromStatus)}</td>
            <td>{statusLabel(r.toStatus)}</td>
            <td>
              <ActionForm action={saveTransitionAction} submitLabel="Save" submitSize="sm" submitVariant="secondary" inline>
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="fromStatus" value={r.fromStatus} />
                <input type="hidden" name="toStatus" value={r.toStatus} />
                <select name="permission" defaultValue={r.permission} aria-label="Permission required" className="field-input h-7 max-w-[260px] text-[12.5px]">
                  {permOptions.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.value}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-[12.5px]">
                  <input type="checkbox" name="requiresReason" defaultChecked={r.requiresReason} className="h-4 w-4 accent-dykem" /> Reason
                </label>
                <label className="flex items-center gap-1 text-[12.5px]">
                  <input type="checkbox" name="isActive" defaultChecked={r.isActive} className="h-4 w-4 accent-dykem" /> Enabled
                </label>
              </ActionForm>
            </td>
          </tr>
        ))}
      </Table>
      <div className="mt-3">
        <Disclosure label="Add transition" variant="primary">
          <ActionForm action={saveTransitionAction} submitLabel="Add transition" resetOnSuccess>
            <FormGrid cols={3}>
              <SelectField label="From status" name="fromStatus" required defaultValue="*" options={[{ value: "*", label: "Any status (*)" }, ...statusOptions]} />
              <SelectField label="To status" name="toStatus" required options={statusOptions} placeholder="Select…" />
              <SelectField label="Permission required" name="permission" required defaultValue="jobs.manage" options={permOptions} />
            </FormGrid>
            <div className="flex flex-wrap gap-4">
              <CheckboxField label="Requires a reason" name="requiresReason" />
              <CheckboxField label="Enabled" name="isActive" defaultChecked />
            </div>
          </ActionForm>
        </Disclosure>
      </div>
    </Section>
  );
}

// ───────────── Release checklist ─────────────

type Checklist = Awaited<ReturnType<typeof listChecklistTemplates>>[number];

function ChecklistFields({ c }: { c?: Checklist }) {
  return (
    <>
      {c && <input type="hidden" name="id" value={c.id} />}
      <FormGrid cols={3}>
        <TextField label="Checklist item" name="label" required defaultValue={c?.label} className="sm:col-span-2" />
        <TextField label="Sort order" name="sortOrder" defaultValue={c?.sortOrder ?? 100} inputMode="numeric" />
      </FormGrid>
      <TextArea label="Guidance for the inspector" name="guidance" rows={2} defaultValue={c?.guidance} />
      <div className="flex flex-wrap gap-4">
        <CheckboxField label="Required (blocks release until confirmed)" name="required" defaultChecked={c ? c.required : true} />
        <CheckboxField label="Active" name="isActive" defaultChecked={c ? c.isActive : true} />
      </div>
    </>
  );
}

async function Checklists({ ctx }: { ctx: Ctx }) {
  const rows = await listChecklistTemplates(ctx);
  return (
    <Section title={`Final release checklist template (${rows.length})`}>
      <p className="mb-2 text-[12.5px] text-steel">Active items are copied onto every new final-release checklist, together with the customer&apos;s mandatory requirements. Changes do not alter checklists already started.</p>
      <Table head={["Order", "Item", "Guidance", "Required", "Status", ""]} empty="No checklist items.">
        {rows.map((c) => (
          <tr key={c.id} className={c.isActive ? undefined : "text-steel"}>
            <td>{c.sortOrder}</td>
            <td className="font-medium">{c.label}</td>
            <td className="max-w-[360px] whitespace-pre-wrap text-steel">{c.guidance ?? "—"}</td>
            <td>{c.required ? <Badge tone="warning">Required</Badge> : "Optional"}</td>
            <td>{active(c.isActive)}</td>
            <td>
              <Disclosure label="Edit" variant="ghost">
                <ActionForm action={saveChecklistAction} submitLabel="Save item">
                  <ChecklistFields c={c} />
                </ActionForm>
              </Disclosure>
            </td>
          </tr>
        ))}
      </Table>
      <div className="mt-3">
        <Disclosure label="Add checklist item" variant="primary">
          <ActionForm action={saveChecklistAction} submitLabel="Add item" resetOnSuccess>
            <ChecklistFields />
          </ActionForm>
        </Disclosure>
      </div>
    </Section>
  );
}

// ───────────── Downtime reasons ─────────────

type Reason = Awaited<ReturnType<typeof listAllDowntimeReasons>>[number];

function ReasonFields({ r }: { r?: Reason }) {
  return (
    <>
      {r && <input type="hidden" name="id" value={r.id} />}
      <FormGrid cols={3}>
        <TextField label="Code" name="code" required defaultValue={r?.code} />
        <TextField label="Name" name="name" required defaultValue={r?.name} />
        <SelectField
          label="Category"
          name="category"
          required
          defaultValue={r?.category ?? "unplanned"}
          options={[
            { value: "unplanned", label: "Unplanned (counts against utilisation)" },
            { value: "planned", label: "Planned (removed from available time)" },
          ]}
        />
      </FormGrid>
      <CheckboxField label="Active" name="isActive" defaultChecked={r ? r.isActive : true} />
    </>
  );
}

async function Downtime({ ctx }: { ctx: Ctx }) {
  const rows = await listAllDowntimeReasons(ctx);
  return (
    <Section title={`Downtime reasons (${rows.length})`}>
      <p className="mb-2 text-[12.5px] text-steel">Planned downtime (e.g. preventive maintenance) is subtracted from available time in the utilisation KPI; unplanned downtime is not.</p>
      <Table head={["Code", "Name", "Category", "Status", ""]} empty="No downtime reasons.">
        {rows.map((r) => (
          <tr key={r.id} className={r.isActive ? undefined : "text-steel"}>
            <td className="plate">{r.code}</td>
            <td className="font-medium">{r.name}</td>
            <td>{r.category === "planned" ? <Badge tone="info">Planned</Badge> : <Badge tone="warning">Unplanned</Badge>}</td>
            <td>{active(r.isActive)}</td>
            <td>
              <Disclosure label="Edit" variant="ghost">
                <ActionForm action={saveDowntimeReasonAction} submitLabel="Save reason">
                  <ReasonFields r={r} />
                </ActionForm>
              </Disclosure>
            </td>
          </tr>
        ))}
      </Table>
      <div className="mt-3">
        <Disclosure label="Add downtime reason" variant="primary">
          <ActionForm action={saveDowntimeReasonAction} submitLabel="Add reason" resetOnSuccess>
            <ReasonFields />
          </ActionForm>
        </Disclosure>
      </div>
    </Section>
  );
}

// ───────────── Machine types ─────────────

type FieldDef = { key: string; label: string; type: string; unit?: string };
type MType = Awaited<ReturnType<typeof machineTypesList>>[number];

function MachineTypeFields({ t }: { t?: MType }) {
  const defs = (Array.isArray(t?.customFieldDefs) ? (t!.customFieldDefs as FieldDef[]) : []).concat(Array.from({ length: 3 }, () => ({ key: "", label: "", type: "text", unit: "" })));
  return (
    <>
      {t && <input type="hidden" name="id" value={t.id} />}
      <FormGrid cols={2}>
        <TextField label="Code" name="code" required defaultValue={t?.code} hint="e.g. VMC, LATHE, SAW" />
        <TextField label="Name" name="name" required defaultValue={t?.name} />
      </FormGrid>
      <fieldset>
        <legend className="mb-1 text-[12.5px] font-medium text-ink-2">Custom fields recorded on machines of this type</legend>
        <p className="mb-1 text-[12px] text-steel">Key: lower-case letters, digits and underscores (e.g. max_rpm). Clear a key to remove a field. Three blank rows are provided for new fields.</p>
        <div className="space-y-1.5">
          {defs.map((d, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <input name="fieldKey" defaultValue={d.key} placeholder="key" aria-label={`Field ${i + 1} key`} className="field-input" />
              <input name="fieldLabel" defaultValue={d.label} placeholder="Label" aria-label={`Field ${i + 1} label`} className="field-input" />
              <select name="fieldType" defaultValue={d.type} aria-label={`Field ${i + 1} type`} className="field-input">
                {FIELD_TYPES.map((ft) => (
                  <option key={ft} value={ft}>
                    {ft}
                  </option>
                ))}
              </select>
              <input name="fieldUnit" defaultValue={d.unit ?? ""} placeholder="Unit (optional)" aria-label={`Field ${i + 1} unit`} className="field-input" />
            </div>
          ))}
        </div>
      </fieldset>
    </>
  );
}

async function MachineTypes({ ctx }: { ctx: Ctx }) {
  const rows = await machineTypesList(ctx);
  return (
    <Section title={`Machine types (${rows.length})`}>
      <Table head={["Code", "Name", "Custom fields", ""]} empty="No machine types.">
        {rows.map((t) => {
          const defs = Array.isArray(t.customFieldDefs) ? (t.customFieldDefs as FieldDef[]) : [];
          return (
            <tr key={t.id}>
              <td className="plate">{t.code}</td>
              <td className="font-medium">{t.name}</td>
              <td className="text-steel">{defs.length ? defs.map((d) => `${d.label} (${d.type}${d.unit ? `, ${d.unit}` : ""})`).join(" · ") : "—"}</td>
              <td>
                <Disclosure label="Edit" variant="ghost">
                  <ActionForm action={saveMachineTypeAction} submitLabel="Save machine type">
                    <MachineTypeFields t={t} />
                  </ActionForm>
                </Disclosure>
              </td>
            </tr>
          );
        })}
      </Table>
      <div className="mt-3">
        <Disclosure label="Add machine type" variant="primary">
          <ActionForm action={saveMachineTypeAction} submitLabel="Add machine type" resetOnSuccess>
            <MachineTypeFields />
          </ActionForm>
        </Disclosure>
      </div>
    </Section>
  );
}

// ───────────── Calendars ─────────────

type Cal = Awaited<ReturnType<typeof calendarsList>>[number];

function CalendarFields({ c }: { c?: Cal }) {
  const hhmm = (s: string) => s.slice(0, 5);
  return (
    <>
      {c && <input type="hidden" name="id" value={c.id} />}
      <TextField label="Calendar name" name="name" required defaultValue={c?.name} className="max-w-sm" />
      <fieldset>
        <legend className="mb-1 text-[12.5px] font-medium text-ink-2">Shifts (leave a row blank for no shift)</legend>
        <div className="space-y-1">
          {WEEKDAYS.map((day, dow) => {
            const existing = (c?.shifts ?? []).filter((s) => s.dayOfWeek === dow).sort((a, b) => a.startTime.localeCompare(b.startTime));
            const rows = [...existing, ...Array.from({ length: Math.max(0, 2 - existing.length) }, () => null)];
            return (
              <div key={dow} className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-[13px] font-medium">{day}</span>
                {rows.map((s, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <input type="hidden" name="shiftDay" value={dow} />
                    <input type="time" name="shiftStart" defaultValue={s ? hhmm(s.startTime) : ""} aria-label={`${day} shift ${i + 1} start`} className="field-input h-8 w-[110px]" />
                    <span className="text-steel">–</span>
                    <input type="time" name="shiftEnd" defaultValue={s ? hhmm(s.endTime) : ""} aria-label={`${day} shift ${i + 1} end`} className="field-input h-8 w-[110px]" />
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      </fieldset>
    </>
  );
}

async function Calendars({ ctx }: { ctx: Ctx }) {
  const [cals, exceptions] = await Promise.all([calendarsList(ctx), listCalendarExceptions(ctx)]);
  const minutes = (c: Cal) =>
    c.shifts.reduce((acc, s) => {
      const [sh, sm] = s.startTime.split(":").map(Number);
      const [eh, em] = s.endTime.split(":").map(Number);
      return acc + (eh * 60 + em - (sh * 60 + sm));
    }, 0);
  return (
    <>
      <Section title={`Work calendars (${cals.length})`}>
        <p className="mb-2 text-[12.5px] text-steel">Calendars define available machine and operator time for scheduling and the utilisation KPI. Times outside shifts are not counted as available.</p>
        <Table head={["Calendar", "Shifts", "Hours / week", ""]} empty="No calendars.">
          {cals.map((c) => (
            <tr key={c.id}>
              <td className="font-medium">{c.name}</td>
              <td className="text-steel">
                {WEEKDAYS.map((d, dow) => {
                  const s = c.shifts.filter((x) => x.dayOfWeek === dow);
                  return s.length ? (
                    <div key={dow}>
                      {d.slice(0, 3)}: {s.map((x) => `${x.startTime.slice(0, 5)}–${x.endTime.slice(0, 5)}`).join(", ")}
                    </div>
                  ) : null;
                })}
              </td>
              <td>{Math.round((minutes(c) / 60) * 10) / 10}</td>
              <td>
                <Disclosure label="Edit" variant="ghost">
                  <ActionForm action={saveCalendarAction} submitLabel="Save calendar">
                    <CalendarFields c={c} />
                  </ActionForm>
                </Disclosure>
              </td>
            </tr>
          ))}
        </Table>
        <div className="mt-3">
          <Disclosure label="Add calendar" variant="primary">
            <ActionForm action={saveCalendarAction} submitLabel="Add calendar" resetOnSuccess>
              <CalendarFields />
            </ActionForm>
          </Disclosure>
        </div>
      </Section>
      <Section title="Exceptions (holidays, shutdowns, extra working days)">
        <Table head={["Date", "Calendar", "Type", "Note"]} empty="No exceptions recorded.">
          {exceptions.map(({ x, calendar }) => (
            <tr key={x.id}>
              <td className="whitespace-nowrap">{fmtDate(x.date)}</td>
              <td>{calendar}</td>
              <td>{x.isWorking ? <Badge tone="info">Extra working day</Badge> : <Badge tone="warning">Non-working</Badge>}</td>
              <td className="text-steel">{x.note ?? "—"}</td>
            </tr>
          ))}
        </Table>
        {cals.length > 0 && (
          <div className="mt-3">
            <Disclosure label="Add exception">
              <ActionForm action={addCalendarExceptionAction} submitLabel="Add exception" resetOnSuccess>
                <FormGrid cols={3}>
                  <SelectField label="Calendar" name="calendarId" required options={cals.map((c) => ({ value: c.id, label: c.name }))} />
                  <TextField label="Date" name="date" type="date" required />
                  <TextField label="Note" name="note" placeholder="e.g. Bank holiday" />
                </FormGrid>
                <CheckboxField label="This is an extra working day (leave unticked for a non-working day)" name="isWorking" />
              </ActionForm>
            </Disclosure>
          </div>
        )}
      </Section>
    </>
  );
}

// ───────────── Competencies ─────────────

type Comp = Awaited<ReturnType<typeof listCompetencies>>[number];
type Opt = { value: string; label: string }[];

function CompetencyFields({ c, opTypes, machineTypes, machines }: { c?: Comp["c"]; opTypes: Opt; machineTypes: Opt; machines: Opt }) {
  return (
    <>
      {c && <input type="hidden" name="id" value={c.id} />}
      <FormGrid cols={3}>
        <TextField label="Code" name="code" required defaultValue={c?.code} hint="e.g. MILL-5AX" />
        <TextField label="Name" name="name" required defaultValue={c?.name} className="sm:col-span-2" />
        <SelectField label="Operation type" name="operationTypeId" placeholder="— Any —" defaultValue={c?.operationTypeId} options={opTypes} />
        <SelectField label="Machine type" name="machineTypeId" placeholder="— Any —" defaultValue={c?.machineTypeId} options={machineTypes} />
        <SelectField label="Specific machine" name="machineId" placeholder="— Any —" defaultValue={c?.machineId} options={machines} />
      </FormGrid>
      <TextArea label="Description" name="description" rows={2} defaultValue={c?.description} />
      <FormGrid cols={3}>
        <CheckboxField label="Expires (requires re-verification)" name="requiresExpiry" defaultChecked={c?.requiresExpiry} />
        <TextField label="Validity (months)" name="validityMonths" defaultValue={c?.validityMonths} inputMode="numeric" hint="Required when the competency expires." />
      </FormGrid>
    </>
  );
}

async function Competencies({ ctx }: { ctx: Ctx }) {
  const [comps, ops, mts, ms] = await Promise.all([listCompetencies(ctx), operationTypesList(ctx, true), machineTypesList(ctx), can(ctx.actor, "machines.view") ? listMachines(ctx) : Promise.resolve([])]);
  const opTypes = ops.map((o) => ({ value: o.id, label: `${o.code} — ${o.name}` }));
  const machineTypes = mts.map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` }));
  const machines = ms.map((m) => ({ value: m.m.id, label: `${m.m.code} — ${m.m.name}` }));
  return (
    <Section title={`Competency catalogue (${comps.length})`}>
      <p className="mb-2 text-[12.5px] text-steel">Competencies are granted to employees (and verified) on the operator record. An operation that requires a competency can only be assigned to operators holding a valid one.</p>
      <Table head={["Code", "Name", "Scope", "Expiry", ""]} empty="No competencies defined.">
        {comps.map((x) => (
          <tr key={x.c.id}>
            <td className="plate">{x.c.code}</td>
            <td className="font-medium">
              {x.c.name}
              {x.c.description && <div className="text-[12px] font-normal text-steel">{x.c.description}</div>}
            </td>
            <td className="text-steel">{[x.opType, x.machineType, x.machine].filter(Boolean).join(" · ") || "General"}</td>
            <td>{x.c.requiresExpiry ? `${x.c.validityMonths ?? "?"} months` : "Does not expire"}</td>
            <td>
              <Disclosure label="Edit" variant="ghost">
                <ActionForm action={saveCompetencyAction} submitLabel="Save competency">
                  <CompetencyFields c={x.c} opTypes={opTypes} machineTypes={machineTypes} machines={machines} />
                </ActionForm>
              </Disclosure>
            </td>
          </tr>
        ))}
      </Table>
      <div className="mt-3">
        <Disclosure label="Add competency" variant="primary">
          <ActionForm action={saveCompetencyAction} submitLabel="Add competency" resetOnSuccess>
            <CompetencyFields opTypes={opTypes} machineTypes={machineTypes} machines={machines} />
          </ActionForm>
        </Disclosure>
      </div>
    </Section>
  );
}

// ───────────── Retention ─────────────

type Policy = Awaited<ReturnType<typeof listRetentionPolicies>>[number];

function RetentionFields({ p }: { p?: Policy }) {
  return (
    <>
      {p && <input type="hidden" name="id" value={p.id} />}
      <FormGrid cols={3}>
        <TextField label="Record type" name="recordType" required defaultValue={p?.recordType} placeholder="e.g. Inspection records" />
        <TextField label="Years" name="years" required defaultValue={p?.years} inputMode="numeric" />
        <TextField label="Basis" name="basis" required defaultValue={p?.basis ?? "from record closure"} />
      </FormGrid>
      <TextArea label="Notes" name="notes" rows={2} defaultValue={p?.notes} placeholder="e.g. Customer contract requires 15 years for aerospace parts" />
    </>
  );
}

async function Retention({ ctx }: { ctx: Ctx }) {
  const rows = await listRetentionPolicies(ctx);
  return (
    <Section title={`Retention policies (${rows.length})`}>
      <Notice tone="info">
        Retention policies document how long each kind of record must be kept. MJMS never deletes quality or manufacturing records automatically — the audit trail and controlled records are append-only. Any disposal at the end of a retention period is a deliberate, separately approved activity.
      </Notice>
      <Table head={["Record type", "Retention", "Basis", "Notes", ""]} empty="No retention policies recorded.">
        {rows.map((p) => (
          <tr key={p.id}>
            <td className="font-medium">{p.recordType}</td>
            <td>{p.years} years</td>
            <td>{p.basis}</td>
            <td className="max-w-[360px] whitespace-pre-wrap text-steel">{p.notes ?? "—"}</td>
            <td>
              <Disclosure label="Edit" variant="ghost">
                <ActionForm action={saveRetentionAction} submitLabel="Save policy">
                  <RetentionFields p={p} />
                </ActionForm>
              </Disclosure>
            </td>
          </tr>
        ))}
      </Table>
      <div className="mt-3">
        <Disclosure label="Add retention policy" variant="primary">
          <ActionForm action={saveRetentionAction} submitLabel="Add policy" resetOnSuccess>
            <RetentionFields />
          </ActionForm>
        </Disclosure>
      </div>
    </Section>
  );
}
