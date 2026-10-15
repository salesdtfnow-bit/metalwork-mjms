import type { Ctx } from "@/server/context";
import { can } from "@/server/context";
import { integrationStatus } from "@/server/integrations/boxhero/sync";
import { searchBoxheroItems } from "@/server/services/materials";
import { boxheroLocations } from "@/server/services/ui/materials";
import { SYNC_STATUS } from "@/lib/status";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { Badge, KeyValues, Notice, Section, Stat, StatusBadge, Table } from "@/components/ui";
import { ActionForm, Disclosure, TextArea, TextField } from "@/components/forms";
import { cancelMovementAction, confirmMovementAction, processOutboxAction, retryMovementAction, syncCatalogueAction } from "../actions";
import { SYNC_KIND } from "./labels";

export async function BoxheroTab({ ctx, iq }: { ctx: Ctx; iq?: string }) {
  const [st, locations, items] = await Promise.all([integrationStatus(ctx), boxheroLocations(ctx), searchBoxheroItems(ctx, iq ?? "")]);
  const canSync = can(ctx.actor, "boxhero.sync");
  const canReconcile = can(ctx.actor, "boxhero.reconcile");
  const locName = new Map(locations.map((l) => [l.boxheroLocationId, l.name]));
  const count = (s: string) => st.counts.find((c) => c.status === s)?.n ?? 0;

  return (
    <>
      <div className="mb-4 rounded-md border border-ink/80 bg-sheet px-4 py-3">
        <div className="text-[11px] font-medium text-steel">Inventory integration mode</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-3">
          <span className="plate text-[22px] uppercase leading-none text-ink">{st.mode}</span>
          <span className="text-[14px] font-medium text-ink-2">{st.label}</span>
        </div>
      </div>
      {st.mode === "simulated" && (
        <Notice tone="warning" title="SIMULATED — no real stock changes">
          Stock movements are recorded in an in-database stand-in, not your BoxHero team. Configure BOXHERO_API_TOKEN and set mode to api to connect to the real BoxHero.
        </Notice>
      )}
      {st.mode === "manual" && (
        <Notice tone="info" title="Manual confirmation mode">
          Every stock movement must be made in BoxHero by a person, and its BoxHero transaction reference recorded here with “Confirm manually”.
        </Notice>
      )}

      <Section title="Status">
        <KeyValues
          cols={4}
          items={[
            { label: "Last successful sync / movement", value: fmtDateTime(st.state?.lastSuccessAt) },
            { label: "Last error", value: st.state?.lastErrorAt ? fmtDateTime(st.state.lastErrorAt) : "None recorded" },
            { label: "Last error message", value: st.state?.lastError, wide: true },
          ]}
        />
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
          {Object.entries(SYNC_STATUS).map(([k, v]) => (
            <Stat key={k} label={v.label} value={count(k)} tone={["failed", "needs_reconciliation"].includes(k) && count(k) > 0 ? "danger" : k === "pending" && count(k) > 0 ? "warning" : undefined} />
          ))}
        </div>
        {canSync && (
          <div className="mt-3 flex flex-wrap items-start gap-3">
            <ActionForm action={syncCatalogueAction} submitLabel="Sync item catalogue now" submitVariant="secondary" />
            <ActionForm action={processOutboxAction} submitLabel="Process queued movements now" submitVariant="secondary" />
          </div>
        )}
      </Section>

      <Section title="Movements needing attention">
        <p className="mb-2 max-w-[90ch] text-[13px] text-steel">
          Pending, sending, failed and uncertain stock movements. Retrying never sends blindly: BoxHero is first searched for the movement&apos;s idempotency marker, and only if it
          is not found is the movement sent again — so a movement is never recorded twice.
        </p>
        <Table head={["Idempotency key", "Kind", "BoxHero item", "Qty", "Status", "Attempts", "Last error", "Created", ""]} empty="No outstanding or failed movements.">
          {st.problems.map((p) => (
            <tr key={p.id}>
              <td className="max-w-[260px] break-all font-mono text-[12px]">{p.idempotencyKey}</td>
              <td>{SYNC_KIND[p.kind] ?? p.kind}</td>
              <td className="font-mono text-[12px]">{p.boxheroItemId}</td>
              <td className="whitespace-nowrap">{fmtQty(p.quantity)}</td>
              <td>
                <StatusBadge map={SYNC_STATUS} status={p.status} />
              </td>
              <td>{p.attempts}</td>
              <td className="max-w-[280px] whitespace-pre-wrap text-[12.5px] text-red">{p.lastError ?? ""}</td>
              <td className="whitespace-nowrap text-steel">{fmtDateTime(p.createdAt)}</td>
              <td className="min-w-[180px] space-y-1.5">
                {canReconcile && (
                  <>
                    {["failed", "needs_reconciliation"].includes(p.status) && (
                      <ActionForm action={retryMovementAction} submitLabel="Retry (reconcile first)" submitVariant="secondary" submitSize="sm">
                        <input type="hidden" name="id" value={p.id} />
                      </ActionForm>
                    )}
                    <Disclosure label="Confirm manually" variant="ghost">
                      <ActionForm action={confirmMovementAction} submitLabel="Confirm in BoxHero">
                        <input type="hidden" name="id" value={p.id} />
                        <TextField label="BoxHero transaction reference" name="reference" required />
                        <TextArea label="Note" name="note" rows={2} required placeholder="How was this confirmed in BoxHero?" />
                      </ActionForm>
                    </Disclosure>
                    <Disclosure label="Cancel movement" variant="ghost">
                      <ActionForm action={cancelMovementAction} submitLabel="Cancel movement" submitVariant="danger" confirm="This movement will never be sent to BoxHero. Use only if the source record was reversed or the movement was made another way.">
                        <input type="hidden" name="id" value={p.id} />
                        <TextArea label="Reason" name="reason" rows={2} required />
                      </ActionForm>
                    </Disclosure>
                  </>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Recent integration events">
        <Table head={["When", "Action", "Result", "Message"]} empty="No integration events recorded yet.">
          {st.events.map((e) => (
            <tr key={e.id}>
              <td className="whitespace-nowrap text-steel">{fmtDateTime(e.at)}</td>
              <td>{e.action.replace(/_/g, " ")}</td>
              <td>
                <Badge tone={e.status === "success" ? "success" : e.status === "warning" ? "warning" : "danger"}>{e.status === "success" ? "Success" : e.status === "warning" ? "Warning" : "Error"}</Badge>
              </td>
              <td className="max-w-[640px] whitespace-pre-wrap text-[12.5px]">{e.message ?? ""}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="BoxHero cached quantities — BoxHero is the system of record">
        <p className="mb-2 text-[13px] text-steel">
          Quantities below are a local cache from the last catalogue sync. Always check BoxHero for live stock. Item search runs on this cache.
        </p>
        <form className="mb-3 flex flex-wrap items-center gap-2" role="search">
          <input type="hidden" name="tab" value="boxhero" />
          <input name="iq" defaultValue={iq} placeholder="Item name, SKU or barcode" className="field-input max-w-xs" aria-label="Search BoxHero items" />
          <button className="rounded-sm border border-line bg-sheet px-3 py-1.5 text-[13px]">Search</button>
        </form>
        <Table head={["Item", "SKU", "Barcode", "Total qty (cached)", "By location (cached)", "Last synced"]} empty="No cached BoxHero items. Run “Sync item catalogue now”.">
          {items.map((i) => {
            const qs = (Array.isArray(i.quantities) ? i.quantities : []) as { location_id: string; quantity: string }[];
            return (
              <tr key={i.id}>
                <td className="font-medium">{i.name}</td>
                <td>{i.sku ?? "—"}</td>
                <td className="font-mono text-[12px]">{i.barcode ?? "—"}</td>
                <td className="whitespace-nowrap">{fmtQty(i.quantityTotal)}</td>
                <td className="text-[12.5px]">
                  {qs.length === 0
                    ? "—"
                    : qs.map((q) => (
                        <span key={q.location_id} className="mr-2 inline-block whitespace-nowrap">
                          {locName.get(q.location_id) ?? q.location_id}: {fmtQty(q.quantity)}
                        </span>
                      ))}
                </td>
                <td className="whitespace-nowrap text-steel">{fmtDateTime(i.lastSyncedAt)}</td>
              </tr>
            );
          })}
        </Table>
        {items.length >= 50 && <p className="mt-2 text-[12px] text-steel">Showing the first 50 matching items. Search to narrow.</p>}
      </Section>
    </>
  );
}
