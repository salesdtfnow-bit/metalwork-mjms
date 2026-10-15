import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { listSuppliers } from "@/server/services/parties";
import { can } from "@/server/context";
import { todayISO } from "@/lib/format";
import { Badge, LinkButton, PageHeader, Table } from "@/components/ui";
import { ApprovalBadge, APPROVAL_OPTIONS, CATEGORY_OPTIONS, categoryLabel } from "./_components/approval";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; approval?: string; all?: string }> }) {
  const ctx = await requirePageCtx("suppliers.view");
  const sp = await searchParams;
  const all = await listSuppliers(ctx, { q: sp.q, category: sp.category || undefined, includeInactive: sp.all === "1" });
  const rows = sp.approval ? all.filter((s) => s.approvalStatus === sp.approval) : all;
  const today = todayISO();
  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Material, subcontract, tooling and service suppliers, with approved-supplier status and scope."
        actions={
          can(ctx.actor, "suppliers.manage") && (
            <LinkButton href="/suppliers/new" variant="primary">
              New supplier
            </LinkButton>
          )
        }
      />
      <form className="mb-3 flex flex-wrap items-center gap-2" role="search">
        <input name="q" defaultValue={sp.q} placeholder="Filter by name or code" className="field-input max-w-xs" aria-label="Filter suppliers" />
        <select name="category" defaultValue={sp.category ?? ""} className="field-input max-w-[180px]" aria-label="Category">
          <option value="">Any category</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <select name="approval" defaultValue={sp.approval ?? ""} className="field-input max-w-[200px]" aria-label="Approval status">
          <option value="">Any approval status</option>
          {APPROVAL_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[13px] text-steel">
          <input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} className="accent-dykem" /> Include inactive
        </label>
        <button className="rounded-sm border border-line bg-sheet px-3 py-1.5 text-[13px]">Apply</button>
      </form>
      <Table head={["Code", "Name", "Categories", "Approval", "Scope", "Email", "Phone", ""]} empty="No suppliers match.">
        {rows.map((s) => (
          <tr key={s.id}>
            <td>
              <Link href={`/suppliers/${s.id}`} className="plate text-dykem hover:underline">
                {s.code}
              </Link>
            </td>
            <td className="font-medium">{s.name}</td>
            <td className="max-w-[220px] text-steel">{s.categories.length ? s.categories.map(categoryLabel).join(", ") : "—"}</td>
            <td>
              <ApprovalBadge status={s.approvalStatus} expiresOn={s.approvalExpiresOn} today={today} />
            </td>
            <td className="max-w-[240px] truncate text-steel">{s.approvalScope ?? "—"}</td>
            <td>{s.email ?? "—"}</td>
            <td className="whitespace-nowrap">{s.phone ?? "—"}</td>
            <td>{!s.isActive && <Badge tone="muted">Inactive</Badge>}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
