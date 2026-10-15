import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { listCustomers } from "@/server/services/parties";
import { can } from "@/server/context";
import { Badge, LinkButton, PageHeader, Table } from "@/components/ui";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; all?: string }> }) {
  const ctx = await requirePageCtx("customers.view");
  const sp = await searchParams;
  const rows = await listCustomers(ctx, { q: sp.q, includeInactive: sp.all === "1" });
  return (
    <>
      <PageHeader
        title="Customers"
        description="Company records, contacts, delivery addresses and customer-specific quality requirements."
        actions={can(ctx.actor, "customers.manage") && <LinkButton href="/customers/new" variant="primary">New customer</LinkButton>}
      />
      <form className="mb-3 flex flex-wrap items-center gap-2" role="search">
        <input name="q" defaultValue={sp.q} placeholder="Filter by name, code or email" className="field-input max-w-xs" aria-label="Filter customers" />
        <label className="flex items-center gap-1.5 text-[13px] text-steel">
          <input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} className="accent-dykem" /> Include inactive
        </label>
        <button className="rounded-sm border border-line bg-sheet px-3 py-1.5 text-[13px]">Apply</button>
      </form>
      <Table head={["Code", "Name", "Email", "Phone", "Certificates required", "Status"]} empty="No customers match. Add your first customer to start recording enquiries.">
        {rows.map((c) => (
          <tr key={c.id}>
            <td>
              <Link href={`/customers/${c.id}`} className="plate text-dykem hover:underline">
                {c.code}
              </Link>
            </td>
            <td className="font-medium">{c.name}</td>
            <td>{c.email ?? "—"}</td>
            <td>{c.phone ?? "—"}</td>
            <td className="max-w-[280px] truncate text-steel">{c.requiredCertificates ?? "—"}</td>
            <td>{c.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="muted">Inactive</Badge>}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
