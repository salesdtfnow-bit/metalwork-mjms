import { requirePageCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { listPlans } from "@/server/services/inspections";
import { jobLineOptions, lotOptions } from "@/server/services/ui/quality";
import { PageHeader, Panel, Notice } from "@/components/ui";
import { ActionForm, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { createInspectionAction } from "../../actions";
import { STAGE_OPTIONS, stageLabel } from "../../_components/labels";

export const metadata = { title: "New inspection" };

export default async function NewInspectionPage({ searchParams }: { searchParams: Promise<{ jobLineId?: string; stage?: string; lotId?: string; operationId?: string; jobId?: string }> }) {
  const ctx = await requirePageCtx("quality.inspect", "quality.final_inspect");
  const sp = await searchParams;
  const canFinal = can(ctx.actor, "quality.final_inspect");
  const stages = STAGE_OPTIONS.filter((s) => s.value !== "final" || canFinal);
  const stage = stages.some((s) => s.value === sp.stage) ? sp.stage! : null;
  const [plans, lines, lots] = await Promise.all([listPlans(ctx), jobLineOptions(ctx), lotOptions(ctx)]);
  const approved = plans.filter((p) => p.status === "approved" && (!stage || p.stage === stage));
  const line = lines.find((l) => l.id === sp.jobLineId);

  return (
    <>
      <PageHeader
        title="New inspection"
        description="Opens an inspection record. Results are entered on the inspection page against the plan's characteristics. First-off, in-process and incoming inspections are normally opened automatically by production and goods-in."
      />
      <Panel className="mb-4 max-w-4xl p-4">
        <form className="flex flex-wrap items-end gap-3">
          {sp.jobLineId && <input type="hidden" name="jobLineId" value={sp.jobLineId} />}
          {sp.lotId && <input type="hidden" name="lotId" value={sp.lotId} />}
          {sp.operationId && <input type="hidden" name="operationId" value={sp.operationId} />}
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-medium text-ink-2">1. Inspection stage</span>
            <select name="stage" defaultValue={stage ?? ""} className="field-input w-auto" required>
              <option value="">Select stage…</option>
              {stages.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button className="rounded-sm border border-line bg-sheet px-3 py-1.5 text-[13px]">{stage ? "Change stage" : "Continue"}</button>
        </form>
        {!canFinal && <p className="mt-2 text-[12px] text-steel">Final inspection is not listed: it requires the final-inspection permission.</p>}
      </Panel>

      {stage && (
        <Panel className="max-w-4xl p-4">
          <h2 className="mb-3 text-[14.5px] font-semibold text-ink">2. {stageLabel(stage)} inspection details</h2>
          {approved.length === 0 && (
            <Notice tone="warning" title="No approved plan for this stage">
              You can still open the inspection without a plan and record ad-hoc pass/fail results with comments, but a plan-based inspection is preferred.
            </Notice>
          )}
          <ActionForm action={createInspectionAction} submitLabel="Open inspection">
            <input type="hidden" name="stage" value={stage} />
            {sp.operationId && <input type="hidden" name="operationId" value={sp.operationId} />}
            {sp.jobId && <input type="hidden" name="jobId" value={sp.jobId} />}
            <FormGrid>
              <SelectField
                label="Inspection plan"
                name="planId"
                placeholder="No plan (ad-hoc results only)"
                options={approved.map((p) => ({ value: p.id, label: `${p.code} v${p.version} — ${p.name} (${p.characteristics} characteristics)` }))}
                defaultValue={approved.length === 1 ? approved[0].id : undefined}
                hint="Only approved plans for this stage are listed."
              />
              {stage === "incoming" ? (
                <SelectField
                  label="Material lot"
                  name="lotId"
                  placeholder="Select lot…"
                  options={lots.map((l) => ({ value: l.id, label: `${l.lotNo} · heat ${l.heatNumber} (${l.status.replace(/_/g, " ")})` }))}
                  defaultValue={sp.lotId}
                />
              ) : line ? (
                <div>
                  <input type="hidden" name="jobLineId" value={line.id} />
                  <p className="mb-1 text-[12.5px] font-medium text-ink-2">Job line</p>
                  <p className="text-[13.5px]">
                    <span className="plate">{line.jobNumber}</span> line {line.lineNo} — {line.partNumber} {line.description}
                  </p>
                </div>
              ) : (
                <SelectField
                  label="Job line"
                  name="jobLineId"
                  placeholder="Select job line…"
                  required={stage === "final"}
                  options={lines.map((l) => ({ value: l.id, label: `${l.jobNumber} / ${l.lineNo} — ${l.partNumber}` }))}
                  hint="The drawing revision is captured from the job line."
                />
              )}
              <TextField label="Sample quantity" name="sampleQty" inputMode="decimal" />
            </FormGrid>
            <TextArea label="Notes" name="notes" rows={2} />
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
