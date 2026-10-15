import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { listParts } from "@/server/services/parts";
import { Badge, PageHeader, Table } from "@/components/ui";

export const metadata = { title: "Parts" };

const TRACE: Record<string, string> = { job: "Job", batch: "Batch", piece: "Piece (serialised)" };

export default async function PartsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requirePageCtx("jobs.view", "quotations.view", "documents.view", "production.view_all");
  const sp = await searchParams;
  const rows = await listParts(ctx, { q: sp.q });
  return (
    <>
      <PageHeader
        title="Parts"
        description="Customer part numbers with their controlled drawing, revisions, CNC programs and job history. Parts are created automatically from quotation and order lines."
      />
      <form className="mb-3 flex flex-wrap items-center gap-2" role="search">
        <input name="q" defaultValue={sp.q} placeholder="Part number or description" className="field-input max-w-xs" aria-label="Filter parts" />
        <button className="rounded-sm border border-line bg-sheet px-3 py-1.5 text-[13px]">Apply</button>
        <span className="ml-auto text-[12.5px] text-steel">{rows.length === 300 ? "First 300 parts shown — narrow the filter." : `${rows.length} part(s)`}</span>
      </form>
      <Table head={["Part number", "Description", "Customer", "Drawing", "Traceability", "Status"]} empty="No parts match. Parts are added when quotation or order lines are recorded.">
        {rows.map(({ part: p, customer, drawing }) => (
          <tr key={p.id}>
            <td className="whitespace-nowrap">
              <Link href={`/parts/${p.id}`} className="plate text-dykem hover:underline">
                {p.partNumber}
              </Link>
            </td>
            <td className="font-medium">{p.description}</td>
            <td>{customer ?? <span className="text-steel">Internal / any</span>}</td>
            <td className="whitespace-nowrap">{drawing ? <span className="plate text-[13px]">{drawing}</span> : <span className="text-amber">No drawing linked</span>}</td>
            <td>{TRACE[p.traceabilityLevel] ?? p.traceabilityLevel}</td>
            <td>{p.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="muted">Inactive</Badge>}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
