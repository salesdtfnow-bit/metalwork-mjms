import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { listTools } from "@/server/services/tooling";
import { fmtDate, fmtQty } from "@/lib/format";
import { Badge, LinkButton, Notice, PageHeader, StatusBadge, Table, cx } from "@/components/ui";
import { TOOL_STATUS, typeLabel } from "./_components/vocab";

export const metadata = { title: "Tooling" };

export default async function ToolingPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; due?: string }> }) {
  const ctx = await requirePageCtx("tooling.view");
  const sp = await searchParams;
  const all = await listTools(ctx);
  const q = sp.q?.trim().toLowerCase();
  const rows = all.filter(
    (r) =>
      (!q || r.t.assetNo.toLowerCase().includes(q) || r.t.description.toLowerCase().includes(q) || (r.t.location ?? "").toLowerCase().includes(q)) &&
      (!sp.status || r.t.status === sp.status) &&
      (sp.due !== "1" || r.inspectionOverdue || (r.lifePct ?? 0) >= 100),
  );
  const overdue = all.filter((r) => r.inspectionOverdue).length;
  const atLimit = all.filter((r) => (r.lifePct ?? 0) >= 100).length;

  return (
    <>
      <PageHeader
        title="Tooling"
        description="Cutting tools, holders, fixtures, jigs and gauges: location, life used, inspection due dates and the machines they are used on."
        actions={can(ctx.actor, "tooling.manage") && <LinkButton href="/tooling/new" variant="primary">Add tool</LinkButton>}
      />
      <Notice tone="info" title="Who owns the record?">
        <span className="font-medium">MJMS</span> tools are assets managed entirely here. <span className="font-medium">BoxHero-owned</span> tools are consumables whose stock is managed in BoxHero — MJMS references
        the BoxHero item (it does not copy or change BoxHero quantities) and adds life, inspection and machine tracking on top.
      </Notice>
      {(overdue > 0 || atLimit > 0) && (
        <Notice tone="warning">
          {overdue > 0 && `${overdue} tool(s) have an overdue inspection. `}
          {atLimit > 0 && `${atLimit} tool(s) have reached their life limit. `}
          <Link href="/tooling?due=1" className="underline">
            Show only these
          </Link>
        </Notice>
      )}
      <form className="mb-3 flex flex-wrap items-center gap-2" role="search">
        <input name="q" defaultValue={sp.q} placeholder="Filter by asset, description or location" className="field-input max-w-xs" aria-label="Filter tools" />
        <select name="status" defaultValue={sp.status ?? ""} className="field-input w-auto" aria-label="Status">
          <option value="">Any status</option>
          {Object.entries(TOOL_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[13px] text-steel">
          <input type="checkbox" name="due" value="1" defaultChecked={sp.due === "1"} className="accent-dykem" /> Needs attention only
        </label>
        <button className="rounded-sm border border-line bg-sheet px-3 py-1.5 text-[13px]">Apply</button>
      </form>
      <Table head={["Asset", "Description", "Type", "Location", "Status", "Ownership", "Life used", "Inspection due", "Machines"]} empty="No tools match. Add tooling to track life, inspections and machine use.">
        {rows.map((r) => (
          <tr key={r.t.id}>
            <td>
              <Link href={`/tooling/${r.t.id}`} className="plate text-dykem hover:underline">
                {r.t.assetNo}
              </Link>
            </td>
            <td className="max-w-[260px] truncate font-medium">{r.t.description}</td>
            <td>{typeLabel(r.t.toolType)}</td>
            <td>{r.t.location ?? "—"}</td>
            <td>
              <StatusBadge map={TOOL_STATUS} status={r.t.status} />
            </td>
            <td>
              {r.t.ownership === "boxhero" ? (
                <span title={r.bh ? `BoxHero item: ${r.bh}` : "BoxHero item not found in cache"}>
                  <Badge tone="info">BoxHero-owned</Badge>
                  {r.bh && <span className="mt-0.5 block max-w-[160px] truncate text-[11.5px] text-steel">{r.bh}</span>}
                </span>
              ) : (
                <Badge tone="neutral">MJMS</Badge>
              )}
            </td>
            <td className="min-w-[130px]">
              {r.lifePct === null ? (
                <span className="text-steel">Not tracked</span>
              ) : (
                <div title={`${fmtQty(r.t.lifeUsed)} of ${fmtQty(r.t.lifeLimit)} ${r.t.lifeUnit}`}>
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line-2" role="img" aria-label={`${r.lifePct}% of life used`}>
                      <span className={cx("block h-full", r.lifePct >= 100 ? "bg-red" : r.lifePct >= 80 ? "bg-amber" : "bg-green")} style={{ width: `${r.lifePct}%` }} />
                    </span>
                    <span className={cx("text-[12px] tabular-nums", r.lifePct >= 100 && "font-semibold text-red")}>{r.lifePct}%</span>
                  </div>
                  <span className="text-[11.5px] text-steel">
                    {fmtQty(r.t.lifeUsed)} / {fmtQty(r.t.lifeLimit, r.t.lifeUnit)}
                  </span>
                </div>
              )}
            </td>
            <td className="whitespace-nowrap">
              {!r.t.inspectionRequired ? (
                <span className="text-steel">Not required</span>
              ) : r.inspectionOverdue ? (
                <span className="font-semibold text-red">{fmtDate(r.t.nextInspectionDue)} · overdue</span>
              ) : (
                fmtDate(r.t.nextInspectionDue)
              )}
            </td>
            <td className="plate text-[12.5px]">{r.machines.length ? r.machines.join(", ") : "—"}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
