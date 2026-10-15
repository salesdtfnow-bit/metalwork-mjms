import { requirePageCtx } from "@/server/auth/next";
import { listQuotations } from "@/server/services/quotations";
import { can } from "@/server/context";
import { fmtDate, fmtMoney, todayISO } from "@/lib/format";
import { QUOTE_STATUS } from "@/lib/status";
import { LinkButton, PageHeader, Ref, StatusBadge, Table } from "@/components/ui";

export const metadata = { title: "Quotations" };

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const ctx = await requirePageCtx("quotations.view");
  const sp = await searchParams;
  const rows = await listQuotations(ctx, { q: sp.q, status: sp.status || undefined });
  const today = todayISO();
  return (
    <>
      <PageHeader
        title="Quotations"
        description="Costed quotations, their revisions, internal review and customer response."
        actions={
          can(ctx.actor, "quotations.manage") && (
            <LinkButton href="/quotations/new" variant="primary">
              New quotation
            </LinkButton>
          )
        }
      />
      <form className="mb-3 flex flex-wrap items-center gap-2" role="search">
        <input name="q" defaultValue={sp.q} placeholder="Ref, title or customer" className="field-input max-w-xs" aria-label="Filter quotations" />
        <select name="status" defaultValue={sp.status ?? ""} className="field-input max-w-[200px]" aria-label="Status">
          <option value="">Any status</option>
          {Object.entries(QUOTE_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <button className="rounded-sm border border-line bg-sheet px-3 py-1.5 text-[13px]">Apply</button>
      </form>
      <Table head={["Ref", "Customer", "Title", "Rev", "Status", "Total", "Valid until", "Owner"]} empty="No quotations match.">
        {rows.map(({ quote, customer, owner, latest }) => {
          const expiring = latest?.validUntil && ["sent", "awaiting_response"].includes(latest.status) && latest.validUntil <= today;
          return (
            <tr key={quote.id}>
              <td>
                <Ref href={`/quotations/${quote.id}`} size="sm">
                  {quote.ref}
                </Ref>
              </td>
              <td className="font-medium">{customer}</td>
              <td className="max-w-[360px]">
                <span className="line-clamp-1">{quote.title}</span>
              </td>
              <td className="text-center tabular-nums">{latest?.revisionNo ?? quote.latestRevisionNo}</td>
              <td>
                <StatusBadge map={QUOTE_STATUS} status={quote.status} />
                {latest?.acceptanceRecordedAt && !latest.acceptanceVerifiedAt && <span className="ml-1 text-[12px] text-amber">acceptance to verify</span>}
              </td>
              <td className="whitespace-nowrap text-right tabular-nums">{latest ? fmtMoney(latest.total, latest.currency) : "—"}</td>
              <td className={expiring ? "whitespace-nowrap font-medium text-red" : "whitespace-nowrap"}>{fmtDate(latest?.validUntil)}</td>
              <td className="whitespace-nowrap">{owner ?? "—"}</td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
