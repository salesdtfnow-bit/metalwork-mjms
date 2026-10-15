import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { listCustomerOrders } from "@/server/services/orders";
import { can, canAny } from "@/server/context";
import { fmtDate, fmtMoney } from "@/lib/format";
import { ORDER_STATUS } from "@/lib/status";
import { LinkButton, PageHeader, Ref, StatusBadge, Table } from "@/components/ui";

export const metadata = { title: "Customer orders" };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const ctx = await requirePageCtx("orders.view");
  const sp = await searchParams;
  const rows = await listCustomerOrders(ctx, { q: sp.q, status: sp.status || undefined });
  const commercial = canAny(ctx.actor, "jobs.view_commercial", "customers.view_commercial");
  const seeQuotes = can(ctx.actor, "quotations.view");
  return (
    <>
      <PageHeader
        title="Customer orders"
        description="Customer purchase orders: registered on receipt, checked against the accepted quotation (contract review), then converted to jobs."
        actions={
          can(ctx.actor, "orders.manage") && (
            <LinkButton href="/orders/new" variant="primary">
              Register PO
            </LinkButton>
          )
        }
      />
      <form className="mb-3 flex flex-wrap items-center gap-2" role="search">
        <input name="q" defaultValue={sp.q} placeholder="PO number, ref or customer" className="field-input max-w-xs" aria-label="Filter orders" />
        <select name="status" defaultValue={sp.status ?? ""} className="field-input max-w-[220px]" aria-label="Status">
          <option value="">Any status</option>
          {Object.entries(ORDER_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <button className="rounded-sm border border-line bg-sheet px-3 py-1.5 text-[13px]">Apply</button>
      </form>
      <Table
        head={["Ref", "Customer", "Customer PO", "PO date", "Quotation", "Required", ...(commercial ? ["Value"] : []), "Received", "Status"]}
        empty="No customer orders match. Register a PO when the customer’s order arrives."
      >
        {rows.map(({ o, customer, quoteRef, revNo }) => (
          <tr key={o.id}>
            <td>
              <Ref href={`/orders/${o.id}`} size="sm">
                {o.ref}
              </Ref>
            </td>
            <td className="font-medium">{customer}</td>
            <td className="plate text-[13px]">{o.customerPoNumber}</td>
            <td className="whitespace-nowrap">{fmtDate(o.poDate)}</td>
            <td className="whitespace-nowrap">
              {quoteRef ? (
                seeQuotes ? (
                  <Link href={`/quotations?q=${encodeURIComponent(quoteRef)}`} className="link">
                    {quoteRef} rev {revNo}
                  </Link>
                ) : (
                  `${quoteRef} rev ${revNo}`
                )
              ) : (
                <span className="text-amber">Not linked</span>
              )}
            </td>
            <td className="whitespace-nowrap">{fmtDate(o.requiredDate)}</td>
            {commercial && <td className="whitespace-nowrap text-right tabular-nums">{o.orderValue ? fmtMoney(o.orderValue, o.currency) : "—"}</td>}
            <td className="whitespace-nowrap text-steel">{fmtDate(o.receivedAt)}</td>
            <td>
              <StatusBadge map={ORDER_STATUS} status={o.status} />
            </td>
          </tr>
        ))}
      </Table>
    </>
  );
}
