import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { AppError } from "@/server/errors";
import { getPlan, listPlans } from "@/server/services/inspections";
import { customerOptions, operationTypeOptions, partOptions, qualityHistory, userOptions } from "@/server/services/ui/quality";
import { fmtDateTime } from "@/lib/format";
import { d, trimQty } from "@/lib/decimal";
import { Badge, KeyValues, LinkButton, Notice, Ref, Section, StatusBadge, Table, TitleBlock } from "@/components/ui";
import { ActionForm, Disclosure, SignatureBlock } from "@/components/forms";
import { AuditList } from "@/components/AuditList";
import { CharacteristicFields } from "../../_components/CharacteristicRows";
import { PLAN_STATUS, stageLabel } from "../../_components/labels";
import { addCharacteristicAction, approvePlanAction } from "../../actions";

const MEASURED = ["dimensional", "hardness", "surface"];

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageCtx("quality.view", "quality.plans");
  const { id } = await params;
  const data = await getPlan(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const { plan, characteristics } = data;
  const [all, partsList, custs, opTypes, people, history] = await Promise.all([listPlans(ctx), partOptions(ctx), customerOptions(ctx), operationTypeOptions(ctx), userOptions(ctx), qualityHistory(ctx, "inspection_plan", id)]);
  const versions = all.filter((p) => p.code === plan.code);
  const manage = can(ctx.actor, "quality.plans");
  const draft = plan.status === "draft";
  const n = (v: string | null) => (v === null ? "—" : trimQty(v));

  return (
    <>
      <TitleBlock
        kind="Inspection plan"
        refNo={`${plan.code} v${plan.version}`}
        title={plan.name}
        status={<StatusBadge map={PLAN_STATUS} status={plan.status} />}
        cells={[
          { label: "Stage", value: stageLabel(plan.stage) },
          { label: "Part", value: partsList.find((x) => x.id === plan.partId)?.partNumber ?? "Any" },
          { label: "Customer", value: custs.find((x) => x.id === plan.customerId)?.name ?? "Any" },
          { label: "Operation type", value: opTypes.find((x) => x.id === plan.operationTypeId)?.name ?? "Any" },
          { label: "Characteristics", value: characteristics.length },
          { label: "Approved", value: plan.approvedAt ? `${fmtDateTime(plan.approvedAt)} · ${people.find((u) => u.id === plan.approvedBy)?.name ?? ""}` : "Not approved" },
        ]}
        actions={manage && <LinkButton href={`/quality/plans/new?from=${plan.id}`} size="sm">Create new version from this plan</LinkButton>}
      />

      {plan.status === "obsolete" && <Notice tone="warning" title="Obsolete">A later version of {plan.code} has been approved. This version can no longer be selected for new inspections.</Notice>}
      {plan.status === "approved" && <Notice tone="info">Approved plans cannot be edited. To change characteristics, create a new version from this plan; approving the new version makes this one obsolete.</Notice>}

      <Section title="Characteristics">
        <Table head={["Seq", "Balloon", "Characteristic", "Type", "Specification", "Nominal", "Tol −", "Tol +", "LSL", "USL", "Unit", "Samples", "Method / instrument", "Flags"]} empty="No characteristics yet. Add at least one before approval.">
          {characteristics.map((c) => {
            const measured = MEASURED.includes(c.charType) && c.nominal !== null;
            return (
              <tr key={c.id}>
                <td className="plate text-steel">{c.seq}</td>
                <td className="plate">{c.balloonNo ?? "—"}</td>
                <td className="font-medium">{c.name}</td>
                <td className="capitalize">{c.charType}</td>
                <td className="max-w-[200px] whitespace-pre-wrap text-steel">{c.specification ?? "—"}{c.acceptanceCriteria ? <div className="text-[12px]">Accept: {c.acceptanceCriteria}</div> : null}</td>
                <td className="plate text-right">{n(c.nominal)}</td>
                <td className="plate text-right">{measured ? n(c.tolMinus ?? "0") : "—"}</td>
                <td className="plate text-right">{measured ? n(c.tolPlus ?? "0") : "—"}</td>
                <td className="plate text-right">{measured ? limit(c.nominal, c.tolMinus) : "—"}</td>
                <td className="plate text-right">{measured ? limit(c.nominal, c.tolPlus) : "—"}</td>
                <td>{c.unit ?? ""}</td>
                <td className="plate">{c.sampleSize}{c.frequency ? <span className="ml-1 text-[12px] text-steel">({c.frequency})</span> : null}</td>
                <td className="text-steel">{[c.method, c.instrumentType].filter(Boolean).join(" · ") || "—"}</td>
                <td className="space-x-1 whitespace-nowrap">
                  {c.isCritical && <Badge tone="danger">Critical</Badge>}
                  {c.evidenceRequired && <Badge tone="info">Evidence</Badge>}
                </td>
              </tr>
            );
          })}
        </Table>
        {manage && draft && (
          <div className="mt-3">
            <Disclosure label="Add characteristic">
              <ActionForm action={addCharacteristicAction} submitLabel="Add characteristic" resetOnSuccess>
                <input type="hidden" name="planId" value={plan.id} />
                <CharacteristicFields prefix="ch0_" required />
              </ActionForm>
            </Disclosure>
          </div>
        )}
      </Section>

      <Section title="Details">
        <KeyValues
          items={[
            { label: "Created", value: fmtDateTime(plan.createdAt) },
            { label: "Inspector role", value: plan.inspectorRole },
            { label: "Notes", value: plan.notes, wide: true },
          ]}
        />
      </Section>

      {manage && draft && (
        <Section title="Approve plan">
          <div className="max-w-2xl">
            {characteristics.length === 0 ? (
              <Notice tone="warning">Add at least one characteristic before approving.</Notice>
            ) : (
              <ActionForm action={approvePlanAction} submitLabel="Approve plan">
                <input type="hidden" name="planId" value={plan.id} />
                <SignatureBlock meaning={`I approve inspection plan ${plan.code} version ${plan.version} for use. Any previously approved version of ${plan.code} becomes obsolete.`} />
              </ActionForm>
            )}
          </div>
        </Section>
      )}

      <Section title="Versions">
        <Table head={["Version", "Status", "Characteristics", "Created", "Approved"]}>
          {versions.map((v) => (
            <tr key={v.id} className={v.id === plan.id ? "bg-dykem-50/40" : undefined}>
              <td><Ref href={`/quality/plans/${v.id}`}>v{v.version}</Ref></td>
              <td><StatusBadge map={PLAN_STATUS} status={v.status} /></td>
              <td className="plate">{v.characteristics}</td>
              <td className="text-steel">{fmtDateTime(v.createdAt)}</td>
              <td className="text-steel">{v.approvedAt ? fmtDateTime(v.approvedAt) : "—"}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="History">
        <AuditList events={history} />
      </Section>
    </>
  );
}

/** Specification limit = nominal + deviation (exact decimal arithmetic). */
function limit(nominal: string | null, dev: string | null) {
  return trimQty(d(nominal).plus(d(dev)));
}
