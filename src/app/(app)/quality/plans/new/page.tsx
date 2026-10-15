import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { AppError } from "@/server/errors";
import { getPlan } from "@/server/services/inspections";
import { customerOptions, operationTypeOptions, partOptions } from "@/server/services/ui/quality";
import { trimQty } from "@/lib/decimal";
import { Notice, PageHeader, Panel, Section } from "@/components/ui";
import { ActionForm, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { CharacteristicRows, type CharPrefill } from "../../_components/CharacteristicRows";
import { STAGE_OPTIONS } from "../../_components/labels";
import { createPlanAction } from "../../actions";

export const metadata = { title: "New inspection plan" };

export default async function NewPlanPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const ctx = await requirePageCtx("quality.plans");
  const sp = await searchParams;
  const [source, partsList, custs, opTypes] = await Promise.all([
    sp.from
      ? getPlan(ctx, sp.from).catch((e) => {
          if (e instanceof AppError && e.code === "not_found") notFound();
          throw e;
        })
      : Promise.resolve(null),
    partOptions(ctx),
    customerOptions(ctx),
    operationTypeOptions(ctx),
  ]);
  const p = source?.plan;
  const num = (v: string | null) => (v === null ? null : trimQty(v));
  const prefill: CharPrefill[] = (source?.characteristics ?? []).map((c) => ({ ...c, nominal: num(c.nominal), tolMinus: num(c.tolMinus), tolPlus: num(c.tolPlus) }));

  return (
    <>
      <PageHeader
        title={p ? `New version of ${p.code}` : "New inspection plan"}
        description="A plan lists the characteristics to inspect at a stage. Plans start as drafts and must be approved (signed) before inspections can use them. Creating a plan with an existing code creates the next version."
      />
      {p && (
        <Notice tone="info" title={`Pre-filled from ${p.code} v${p.version}`}>
          Saving creates the next version of {p.code} as a draft. The current approved version stays in use until the new version is approved, at which point it becomes obsolete.
        </Notice>
      )}
      <Panel className="max-w-6xl p-4">
        <ActionForm action={createPlanAction} submitLabel={p ? "Create new version" : "Create plan"}>
          <FormGrid cols={3}>
            <TextField label="Plan code" name="code" required defaultValue={p?.code} hint="Same code as an existing plan → new version" />
            <TextField label="Plan name" name="name" required defaultValue={p?.name} className="sm:col-span-2" />
            <SelectField label="Stage" name="stage" required placeholder="Select…" options={STAGE_OPTIONS} defaultValue={p?.stage} />
            <SelectField label="Part" name="partId" placeholder="Any part" options={partsList.map((x) => ({ value: x.id, label: `${x.partNumber} — ${x.description}` }))} defaultValue={p?.partId} />
            <SelectField label="Customer" name="customerId" placeholder="Any customer" options={custs.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))} defaultValue={p?.customerId} />
            <SelectField label="Operation type" name="operationTypeId" placeholder="Any operation type" options={opTypes.map((o) => ({ value: o.id, label: `${o.code} — ${o.name}` }))} defaultValue={p?.operationTypeId} />
          </FormGrid>
          <TextArea label="Notes" name="notes" rows={2} defaultValue={p?.notes} />
          <Section title="Characteristics">
            <CharacteristicRows prefill={prefill} max={10} />
          </Section>
        </ActionForm>
      </Panel>
    </>
  );
}
