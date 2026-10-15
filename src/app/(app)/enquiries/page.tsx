import { requirePageCtx } from "@/server/auth/next";
import { listEnquiries } from "@/server/services/enquiries";
import { can } from "@/server/context";
import { fmtDate, todayISO } from "@/lib/format";
import { ENQUIRY_STATUS } from "@/lib/status";
import { LinkButton, PageHeader, Ref, StatusBadge, Table } from "@/components/ui";
import { receivedViaLabel } from "./_components/labels";

export const metadata = { title: "Enquiries" };

export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; open?: string | string[] }> }) {
  const ctx = await requirePageCtx("enquiries.view");
  const sp = await searchParams;
  // Open enquiries are the default view; "open=0" shows everything.
  const openOnly = sp.open !== "0" && !sp.status;
  const rows = await listEnquiries(ctx, { q: sp.q, status: sp.status || undefined, open: openOnly });
  const today = todayISO();
  return (
    <>
      <PageHeader
        title="Enquiries"
        description="Customer requests for quotation: what was asked for, by when, and who owns it."
        actions={
          <>
            {can(ctx.actor, "email.import") && <LinkButton href="/enquiries/inbox">Email inbox</LinkButton>}
            {can(ctx.actor, "enquiries.manage") && (
              <LinkButton href="/enquiries/new" variant="primary">
                New enquiry
              </LinkButton>
            )}
          </>
        }
      />
      <form className="mb-3 flex flex-wrap items-center gap-2" role="search">
        <input name="q" defaultValue={sp.q} placeholder="Ref, subject, customer or customer ref" className="field-input max-w-xs" aria-label="Filter enquiries" />
        <select name="status" defaultValue={sp.status ?? ""} className="field-input max-w-[200px]" aria-label="Status">
          <option value="">Any status</option>
          {Object.entries(ENQUIRY_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[13px] text-steel">
          <input type="hidden" name="open" value="0" />
          <input type="checkbox" name="open" value="1" defaultChecked={openOnly} className="accent-dykem" /> Open only
        </label>
        <button className="rounded-sm border border-line bg-sheet px-3 py-1.5 text-[13px]">Apply</button>
      </form>
      <Table
        head={["Ref", "Customer", "Subject", "Received", "Requested delivery", "Owner", "Status"]}
        empty={openOnly ? "No open enquiries. Untick “Open only” to see closed ones." : "No enquiries match."}
      >
        {rows.map(({ e, customer, owner }) => (
          <tr key={e.id}>
            <td>
              <Ref href={`/enquiries/${e.id}`} size="sm">
                {e.ref}
              </Ref>
            </td>
            <td className="font-medium">{customer}</td>
            <td className="max-w-[360px]">
              <span className="line-clamp-1">{e.subject}</span>
              {e.customerReference && <span className="block text-[12px] text-steel">Customer ref {e.customerReference}</span>}
            </td>
            <td className="whitespace-nowrap">
              {fmtDate(e.receivedAt)}
              <span className="block text-[12px] text-steel">{receivedViaLabel(e.receivedVia)}</span>
            </td>
            <td className={e.requestedDeliveryDate && e.requestedDeliveryDate < today && ["new", "under_review", "quoting", "quoted"].includes(e.status) ? "whitespace-nowrap font-medium text-red" : "whitespace-nowrap"}>
              {fmtDate(e.requestedDeliveryDate)}
            </td>
            <td className="whitespace-nowrap">{owner ?? "—"}</td>
            <td>
              <StatusBadge map={ENQUIRY_STATUS} status={e.status} />
            </td>
          </tr>
        ))}
      </Table>
    </>
  );
}
