import { requirePageCtx } from "@/server/auth/next";
import { canAny } from "@/server/context";
import { listMachines } from "@/server/services/machines";
import { listParts } from "@/server/services/parts";
import { operationTypesList } from "@/server/services/routing";
import { documentRevisionOptions, openJobOptions } from "@/server/services/ui/shopfloor";
import { PageHeader, Panel } from "@/components/ui";
import { ActionForm, CheckboxField, FileField, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { createProgramAction } from "../actions";

export const metadata = { title: "New CNC program" };

export default async function NewProgramPage() {
  const ctx = await requirePageCtx("programs.create");
  const [parts, machines, opTypes, jobs, drawings, setupSheets] = await Promise.all([
    canAny(ctx.actor, "jobs.view", "quotations.view", "documents.view", "production.view_all") ? listParts(ctx) : Promise.resolve([]),
    canAny(ctx.actor, "machines.view") ? listMachines(ctx) : Promise.resolve([]),
    operationTypesList(ctx),
    openJobOptions(ctx),
    documentRevisionOptions(ctx, ["drawing"]),
    documentRevisionOptions(ctx, ["setup_sheet"]),
  ]);
  return (
    <>
      <PageHeader title="New CNC program" description="The first revision is created as a draft. It must be verified, submitted, approved and released before operators can use it." />
      <Panel className="max-w-5xl p-4">
        <ActionForm action={createProgramAction} submitLabel="Create program">
          <h2 className="text-[14.5px] font-semibold text-ink">Program</h2>
          <FormGrid cols={3}>
            <TextField label="Program number" name="programNumber" hint="Leave blank to assign the next number automatically." />
            <TextField label="Name" name="name" required className="sm:col-span-2" placeholder="e.g. Bracket 4471 — op 20 mill" />
            <SelectField label="Part" name="partId" placeholder="Not part-specific" options={parts.map((p) => ({ value: p.part.id, label: `${p.part.partNumber} — ${p.part.description}${p.customer ? ` (${p.customer})` : ""}` }))} />
            <SelectField label="Job (optional)" name="jobId" placeholder="Not job-specific" options={jobs} />
            <SelectField label="Operation type" name="operationTypeId" placeholder="Any" options={opTypes.map((o) => ({ value: o.id, label: o.name }))} />
            <TextField label="Op number" name="opNumber" placeholder="e.g. 20" />
          </FormGrid>
          <TextArea label="Description" name="description" rows={2} />
          <fieldset className="rounded-sm border border-line p-3">
            <legend className="px-1 text-[12.5px] font-semibold text-ink">
              Compatible machines<span className="text-red" aria-hidden> *</span>
            </legend>
            <p className="mb-2 text-[12px] text-steel">Operators can only use this program on the machines ticked here.{machines.length === 0 && " No machines are available to you — you need permission to view machines."}</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {machines.map((m) => (
                <CheckboxField key={m.m.id} label={`${m.m.code} — ${m.m.name}`} hint={m.m.controller ?? m.type} name="machineIds" value={m.m.id} />
              ))}
            </div>
          </fieldset>

          <h2 className="pt-2 text-[14.5px] font-semibold text-ink">First revision</h2>
          <FormGrid cols={3}>
            <TextField label="Revision" name="revision" required defaultValue="A" />
            <SelectField label="Drawing revision" name="drawingRevisionId" placeholder="None" options={drawings} />
            <SelectField label="Setup sheet revision" name="setupSheetRevisionId" placeholder="None" options={setupSheets} />
          </FormGrid>
          <TextArea label="Change description" name="changeDescription" required rows={2} defaultValue="Initial release" />
          <FileField label="Program file" name="file" required hint="The file's SHA-256 checksum is recorded so operators can verify the exact revision at the machine." />
        </ActionForm>
      </Panel>
    </>
  );
}
