import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { can, type Ctx } from "@/server/context";
import { listLots } from "@/server/services/materials";
import { LOT_STATUS } from "@/lib/status";
import { fmtDate, fmtQty } from "@/lib/format";
import { Badge, PageHeader, Ref, StatusBadge, Table, Tabs } from "@/components/ui";
import { StageLegend, SyncCell } from "./_components/Lifecycle";
import { CERT_STATUS, nextStep } from "./_components/labels";
import { ReleaseTab } from "./_components/ReleaseTab";
import { SpecsTab } from "./_components/SpecsTab";
import { BoxheroTab } from "./_components/BoxheroTab";

export const metadata = { title: "Materials & BoxHero" };

type SP = { tab?: string; q?: string; status?: string; bhq?: string; iq?: string };

export default async function MaterialsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageCtx("materials.view");
  const sp = await searchParams;
  const showBoxhero = can(ctx.actor, "boxhero.view");
  const tab = sp.tab === "release" || sp.tab === "specs" || (sp.tab === "boxhero" && showBoxhero) ? sp.tab : "lots";

  return (
    <>
      <PageHeader
        title="Materials & BoxHero"
        description="Material lots by heat number, incoming inspection, certificates, release for production, specifications and BoxHero stock synchronisation."
      />
      <StageLegend />
      <Tabs
        base="/materials"
        current={tab}
        tabs={[
          { key: "lots", label: "Lots" },
          { key: "release", label: "Awaiting release" },
          { key: "specs", label: "Specifications" },
          ...(showBoxhero ? [{ key: "boxhero", label: "BoxHero" }] : []),
        ]}
      />
      {tab === "lots" && <LotsTab ctx={ctx} q={sp.q} status={sp.status} />}
      {tab === "release" && <ReleaseTab ctx={ctx} />}
      {tab === "specs" && <SpecsTab ctx={ctx} bhq={sp.bhq} />}
      {tab === "boxhero" && <BoxheroTab ctx={ctx} iq={sp.iq} />}
    </>
  );
}

async function LotsTab({ ctx, q, status }: { ctx: Ctx; q?: string; status?: string }) {
  const rows = await listLots(ctx, { q, status: status && status in LOT_STATUS ? status : undefined });
  return (
    <>
      <form className="mb-3 flex flex-wrap items-center gap-2" role="search">
        <input type="hidden" name="tab" value="lots" />
        <input name="q" defaultValue={q} placeholder="Lot no, heat no or supplier" className="field-input max-w-xs" aria-label="Filter lots" />
        <select name="status" defaultValue={status ?? ""} className="field-input max-w-[220px]" aria-label="Lot status">
          <option value="">All statuses</option>
          {Object.entries(LOT_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <button className="rounded-sm border border-line bg-sheet px-3 py-1.5 text-[13px]">Apply</button>
      </form>
      <Table
        head={["Lot", "Heat / cast", "Spec / grade", "Supplier", "PO", "GRN", "Quantity", "Certificate", "BoxHero stock-in", "Status", "Next step", "Received"]}
        empty="No material lots match. Lots are created when goods are received against a purchase order."
      >
        {rows.map(({ lot, supplier, spec, grade, receiptRef, poRef, sync }) => {
          const ns = nextStep(lot, sync);
          return (
            <tr key={lot.id}>
              <td>
                <Ref href={`/materials/lots/${lot.id}`} size="sm">
                  {lot.lotNo}
                </Ref>
              </td>
              <td className="plate text-[13px]">{lot.heatNumber}</td>
              <td>
                {spec ? (
                  <>
                    <span className="font-medium">{spec}</span>
                    <span className="block text-[12px] text-steel">{grade}</span>
                  </>
                ) : (
                  <span className="text-steel">No spec</span>
                )}
              </td>
              <td>{supplier}</td>
              <td>
                <Link href={`/purchasing?tab=orders&q=${encodeURIComponent(poRef)}`} className="link">
                  {poRef}
                </Link>
              </td>
              <td className="plate text-[13px]">{receiptRef}</td>
              <td className="whitespace-nowrap">{fmtQty(lot.qtyReceived, lot.uom)}</td>
              <td>
                <StatusBadge map={CERT_STATUS} status={lot.certificateStatus} />
              </td>
              <td>
                <SyncCell sync={sync} />
              </td>
              <td>
                <StatusBadge map={LOT_STATUS} status={lot.status} />
              </td>
              <td>
                <Badge tone={ns.tone}>{ns.text}</Badge>
              </td>
              <td className="whitespace-nowrap text-steel">{fmtDate(lot.createdAt)}</td>
            </tr>
          );
        })}
      </Table>
      {rows.length >= 300 && <p className="mt-2 text-[12px] text-steel">Showing the 300 most recent lots. Filter to narrow the list.</p>}
    </>
  );
}
