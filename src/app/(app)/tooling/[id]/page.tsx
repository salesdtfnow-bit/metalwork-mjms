import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { can, canAny } from "@/server/context";
import { AppError } from "@/server/errors";
import { getTool } from "@/server/services/tooling";
import { boxheroItemOptions, linkedBoxheroItem, machineOptions } from "@/server/services/ui/workshop";
import { fmtDate, fmtDateTime, fmtQty, todayISO } from "@/lib/format";
import { MACHINE_STATUS } from "@/lib/status";
import { Badge, KeyValues, Notice, Section, StatusBadge, Table, TitleBlock, cx } from "@/components/ui";
import { ActionForm, Disclosure, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { ToolForm } from "../_components/ToolForm";
import { EVENT_KINDS, TOOL_STATUS, eventLabel, typeLabel } from "../_components/vocab";
import { recordToolEventAction, updateToolAction } from "../actions";

export const metadata = { title: "Tool" };

export default async function ToolPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageCtx("tooling.view");
  const { id } = await params;
  const data = await getTool(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const { tool: t, events, machines } = data;
  const manage = can(ctx.actor, "tooling.manage");
  const canRecord = canAny(ctx.actor, "tooling.manage", "production.execute");
  const bh = await linkedBoxheroItem(ctx, t.boxheroItemId);
  const [machineOpts, items] = manage ? await Promise.all([machineOptions(ctx), boxheroItemOptions(ctx)]) : [[], []];
  const lifePct = t.lifeLimit && Number(t.lifeLimit) > 0 ? Math.min(100, Math.round((Number(t.lifeUsed) / Number(t.lifeLimit)) * 100)) : null;
  const overdue = t.inspectionRequired && !!t.nextInspectionDue && t.nextInspectionDue < todayISO();

  return (
    <>
      <TitleBlock
        kind={typeLabel(t.toolType)}
        refNo={t.assetNo}
        title={t.description}
        status={
          <>
            <StatusBadge map={TOOL_STATUS} status={t.status} />
            {t.ownership === "boxhero" ? <Badge tone="info">BoxHero-owned</Badge> : <Badge tone="neutral">MJMS-owned</Badge>}
            {overdue && <Badge tone="danger">Inspection overdue</Badge>}
            {lifePct !== null && lifePct >= 100 && <Badge tone="danger">Life limit reached</Badge>}
          </>
        }
        cells={[
          { label: "Location", value: t.location },
          { label: "Life used", value: t.lifeUnit === "none" ? "Not tracked" : `${fmtQty(t.lifeUsed)} / ${fmtQty(t.lifeLimit, t.lifeUnit)}` },
          { label: "Life %", value: lifePct === null ? "—" : `${lifePct}%` },
          { label: "Inspection", value: t.inspectionRequired ? `Every ${t.inspectionIntervalDays ?? "?"} days` : "Not required" },
          { label: "Next inspection", value: <span className={cx(overdue && "font-semibold text-red")}>{fmtDate(t.nextInspectionDue)}</span> },
          { label: "Machines", value: machines.length },
        ]}
      />

      {t.ownership === "boxhero" && (
        <Notice tone="info" title="Stock is managed in BoxHero">
          {bh ? (
            <>
              Linked BoxHero item <span className="font-medium">{bh.name}</span>
              {bh.sku && ` (SKU ${bh.sku})`} — {fmtQty(bh.quantityTotal)} in stock as of the last sync ({fmtDateTime(bh.lastSyncedAt)}).{" "}
            </>
          ) : (
            "The linked BoxHero item is missing from the local cache. "
          )}
          Quantities are read-only here; adjust stock in BoxHero.
        </Notice>
      )}

      {lifePct !== null && (
        <div className="mb-5 max-w-xl">
          <div className="mb-1 flex justify-between text-[12px] text-steel">
            <span>Life used</span>
            <span>{lifePct}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-line-2" role="img" aria-label={`${lifePct}% of tool life used`}>
            <div className={cx("h-full", lifePct >= 100 ? "bg-red" : lifePct >= 80 ? "bg-amber" : "bg-green")} style={{ width: `${lifePct}%` }} />
          </div>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div>
          <Section title="Details">
            <KeyValues
              items={[
                { label: "Type", value: typeLabel(t.toolType) },
                { label: "Ownership", value: t.ownership === "boxhero" ? "BoxHero (consumable stock in BoxHero)" : "MJMS (asset)" },
                { label: "BoxHero item", value: bh ? `${bh.name}${bh.sku ? ` (${bh.sku})` : ""}` : null },
                { label: "Life unit", value: t.lifeUnit === "none" ? "Not life-tracked" : t.lifeUnit },
                { label: "Life limit", value: fmtQty(t.lifeLimit, t.lifeUnit === "none" ? null : t.lifeUnit) },
                { label: "Registered", value: fmtDate(t.createdAt) },
                { label: "Notes", value: t.notes, wide: true },
              ]}
            />
          </Section>
          <Section title="Machines">
            <Table head={["Machine", "Name", "Status"]} empty="Not linked to any machine.">
              {machines.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link href={`/machines/${m.id}`} className="plate text-dykem hover:underline">
                      {m.code}
                    </Link>
                  </td>
                  <td>{m.name}</td>
                  <td>
                    <StatusBadge map={MACHINE_STATUS} status={m.currentStatus} />
                  </td>
                </tr>
              ))}
            </Table>
          </Section>
          <Section title="Event history">
            <Table head={["When", "Event", "Quantity", "Operation", "Notes", "By"]} empty="No events recorded yet.">
              {events.map(({ e, user, op }) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-steel">{fmtDateTime(e.at)}</td>
                  <td>{eventLabel(e.kind)}</td>
                  <td>{e.quantity ? fmtQty(e.quantity, t.lifeUnit === "none" ? null : t.lifeUnit) : "—"}</td>
                  <td>{op ?? "—"}</td>
                  <td className="max-w-[360px] whitespace-pre-wrap text-steel">{e.notes ?? ""}</td>
                  <td className="whitespace-nowrap">{user ?? "System"}</td>
                </tr>
              ))}
            </Table>
          </Section>
          {manage && (
            <Disclosure label="Edit tool">
              <ToolForm
                action={updateToolAction}
                tool={t}
                machineIds={machines.map((m) => m.id)}
                machines={machineOpts}
                boxheroItems={items}
                submitLabel="Save changes"
              />
            </Disclosure>
          )}
        </div>

        {canRecord && (
          <Section title="Record event">
            <div className="rounded-md border border-line bg-sheet p-3">
              <ActionForm action={recordToolEventAction} submitLabel="Record event" resetOnSuccess>
                <input type="hidden" name="toolId" value={t.id} />
                <SelectField label="Event" name="kind" required options={EVENT_KINDS} defaultValue="usage" />
                <FormGrid>
                  <TextField label="Quantity" name="quantity" inputMode="decimal" hint={t.lifeUnit === "none" ? "Usage quantity." : `Usage in ${t.lifeUnit}.`} />
                  <SelectField
                    label="Status"
                    name="status"
                    options={Object.entries(TOOL_STATUS).map(([value, v]) => ({ value, label: v.label }))}
                    placeholder="No change"
                    hint="Required for a status change; optional inspection outcome."
                  />
                </FormGrid>
                <TextArea label="Notes / reason" name="notes" rows={2} hint="A reason is required for a status change." />
              </ActionForm>
            </div>
          </Section>
        )}
      </div>
    </>
  );
}
