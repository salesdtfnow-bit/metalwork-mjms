import { requirePageCtx } from "@/server/auth/next";
import { machineOptions, maintenanceProviders } from "@/server/services/ui/workshop";
import { MACHINE_STATUS, statusDef } from "@/lib/status";
import { Notice, PageHeader, Panel } from "@/components/ui";
import { ActionForm, CheckboxField, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { PRIORITY_OPTIONS, WO_KINDS } from "../_components/vocab";
import { raiseWorkOrderAction } from "../actions";

export const metadata = { title: "Raise work order" };

export default async function NewWorkOrderPage({ searchParams }: { searchParams: Promise<{ machineId?: string; kind?: string }> }) {
  const ctx = await requirePageCtx("maintenance.manage");
  const sp = await searchParams;
  const [machines, providers] = await Promise.all([machineOptions(ctx), maintenanceProviders(ctx)]);
  return (
    <>
      <PageHeader title="Raise work order" description="Report a breakdown or plan maintenance work on a machine." />
      <Notice tone="warning" title="Breakdowns take effect immediately">
        A <span className="font-semibold">breakdown</span> work order starts straight away and sets the machine&apos;s status to <span className="font-semibold">Maintenance</span>, so it cannot be scheduled or
        started until the work order is completed and the machine is returned to service.
      </Notice>
      <Panel className="max-w-4xl p-4">
        <ActionForm action={raiseWorkOrderAction} submitLabel="Raise work order">
          <FormGrid cols={3}>
            <SelectField
              label="Machine"
              name="machineId"
              required
              options={machines.map((m) => ({ value: m.id, label: `${m.code} — ${m.name} (${statusDef(MACHINE_STATUS, m.status).label})` }))}
              defaultValue={sp.machineId}
              placeholder="Select…"
            />
            <SelectField label="Kind" name="kind" required options={WO_KINDS} defaultValue={WO_KINDS.some((k) => k.value === sp.kind) ? sp.kind : "corrective"} hint="Breakdown = machine out of service now." />
            <SelectField label="Priority" name="priority" required options={PRIORITY_OPTIONS} defaultValue="3" />
            <TextField label="Title" name="title" required placeholder="e.g. Coolant pump leaking" className="sm:col-span-3" />
          </FormGrid>
          <TextArea label="Description" name="description" rows={3} placeholder="Symptoms, alarms, what was being run when it happened…" />
          <FormGrid cols={3}>
            <TextField label="Scheduled start" name="scheduledStart" type="datetime-local" step="900" hint="Leave blank if not yet scheduled." />
            <TextField label="Scheduled end" name="scheduledEnd" type="datetime-local" step="900" />
            <SelectField label="Service provider" name="serviceProviderId" options={providers.map((p) => ({ value: p.id, label: p.approvalStatus === "approved" ? p.name : `${p.name} (${p.approvalStatus.replace(/_/g, " ")})` }))} placeholder="In-house" hint="Suppliers in the maintenance category." />
          </FormGrid>
          <CheckboxField label="Locks the machine" name="locksMachine" defaultChecked hint="While in progress (or inside the scheduled window) the machine cannot be scheduled or started." />
        </ActionForm>
      </Panel>
    </>
  );
}
