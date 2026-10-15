import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { listSubcontractOrders } from "@/server/services/subcontract";
import { daysBetween, fmtDate, fmtQty, todayISO } from "@/lib/format";
import { SUBCON_STATUS } from "@/lib/status";
import { LinkButton, PageHeader, Ref, StatusBadge, Table, cx } from "@/components/ui";
import { processLabel } from "./_components/vocab";

export const metadata = { title: "Subcontract orders" };

export default async function SubcontractPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const ctx = await requirePageCtx("subcontract.view");
  const scope = (await searchParams).scope === "all" ? "all" : "open";
  const rows = await listSubcontractOrders(ctx, scope === "open");
  const today = todayISO();
  return (
    <>
      <PageHeader
        title="Subcontractors"
        description="External processes (heat treatment, plating, grinding…). Parts returning from a subcontractor go through an incoming inspection before the operation is complete."
        actions={can(ctx.actor, "subcontract.manage") && <LinkButton href="/subcontract/new" variant="primary">New subcontract order</LinkButton>}
      />
      <div className="mb-3 flex gap-1 text-[13px]" role="group" aria-label="Scope">
        <Link href="/subcontract?scope=open" aria-current={scope === "open" ? "true" : undefined} className={cx("rounded-sm border px-2.5 py-1", scope === "open" ? "border-dykem bg-dykem text-white" : "border-line bg-sheet")}>
          Open
        </Link>
        <Link href="/subcontract?scope=all" aria-current={scope === "all" ? "true" : undefined} className={cx("rounded-sm border px-2.5 py-1", scope === "all" ? "border-dykem bg-dykem text-white" : "border-line bg-sheet")}>
          All
        </Link>
      </div>
      <Table head={["Order", "Supplier", "Job", "Op", "Part", "Process", "Status", "Sent", "Returned", "Return due"]} empty={scope === "open" ? "No open subcontract orders." : "No subcontract orders yet."}>
        {rows.map((r) => {
          const outstanding = ["draft", "sent", "at_supplier"].includes(r.sco.status);
          const overdue = outstanding && !!r.sco.requiredReturnDate && r.sco.requiredReturnDate < today;
          return (
            <tr key={r.sco.id}>
              <td>
                <Ref href={`/subcontract/${r.sco.id}`} size="sm">
                  {r.sco.ref}
                </Ref>
              </td>
              <td className="font-medium">{r.supplier}</td>
              <td>
                <Ref href={`/jobs/${r.sco.jobId}`} size="sm">
                  {r.job}
                </Ref>
              </td>
              <td>{r.opNumber}</td>
              <td>{r.part}</td>
              <td>{processLabel(r.sco.process)}</td>
              <td>
                <StatusBadge map={SUBCON_STATUS} status={r.sco.status} />
              </td>
              <td>{fmtQty(r.sco.qtySent)}</td>
              <td>{fmtQty(r.sco.qtyReturned)}</td>
              <td className={cx("whitespace-nowrap", overdue && "font-semibold text-red")}>
                {fmtDate(r.sco.requiredReturnDate)}
                {overdue && <span className="block text-[11.5px]">Overdue {daysBetween(r.sco.requiredReturnDate!, today)} d</span>}
              </td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
