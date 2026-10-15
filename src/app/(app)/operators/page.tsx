import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { can, canAny } from "@/server/context";
import { listEmployees, operatorWorkloads } from "@/server/services/employees";
import { fmtDate, fmtMinutes } from "@/lib/format";
import { Badge, LinkButton, PageHeader, Table } from "@/components/ui";

export const metadata = { title: "Operators" };

export default async function OperatorsPage({ searchParams }: { searchParams: Promise<{ all?: string; q?: string }> }) {
  const ctx = await requirePageCtx("employees.view");
  const sp = await searchParams;
  const showLoad = canAny(ctx.actor, "planning.view", "production.view_all");
  const [rows, loads] = await Promise.all([listEmployees(ctx, { includeInactive: sp.all === "1" }), showLoad ? operatorWorkloads(ctx) : Promise.resolve([])]);
  const q = sp.q?.trim().toLowerCase();
  const shown = q ? rows.filter((e) => `${e.name} ${e.employeeNo} ${e.jobTitle ?? ""} ${e.department ?? ""}`.toLowerCase().includes(q)) : rows;

  return (
    <>
      <PageHeader
        title="Operators"
        description="Employees, their verified competencies and current workload. An operator can only start an operation that needs a competency they hold (valid and not expired)."
        actions={can(ctx.actor, "employees.manage") && <LinkButton href="/operators/new" variant="primary">Add employee</LinkButton>}
      />
      <form className="mb-3 flex flex-wrap items-center gap-2" role="search">
        <input name="q" defaultValue={sp.q} placeholder="Filter by name, ID or role" className="field-input max-w-xs" aria-label="Filter employees" />
        <label className="flex items-center gap-1.5 text-[13px] text-steel">
          <input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} className="accent-dykem" /> Include inactive
        </label>
        <button className="rounded-sm border border-line bg-sheet px-3 py-1.5 text-[13px]">Apply</button>
      </form>
      <Table head={["ID", "Name", "Job title", "Shift", "Competencies", ...(showLoad ? ["Open ops", "Est. workload"] : []), "Status"]} empty="No employees match.">
        {shown.map((e) => {
          const load = loads.find((l) => l.employee.id === e.id);
          return (
            <tr key={e.id}>
              <td>
                <Link href={`/operators/${e.id}`} className="plate text-dykem hover:underline">
                  {e.employeeNo}
                </Link>
              </td>
              <td className="font-medium">{e.name}</td>
              <td>
                {e.jobTitle ?? "—"}
                {e.department && <span className="block text-[12px] text-steel">{e.department}</span>}
              </td>
              <td>{e.shift ?? "—"}</td>
              <td className="max-w-[460px]">
                <div className="flex flex-wrap gap-1">
                  {e.competencies.length === 0 && <span className="text-steel">None recorded</span>}
                  {e.competencies.map(({ ec, c, expired }) => (
                    <Badge key={ec.id} tone={expired ? "danger" : ec.level === "trainee" ? "warning" : "success"}>
                      <span title={`${c.name}${ec.expiresOn ? ` — expires ${fmtDate(ec.expiresOn)}` : ""}`}>
                        {c.code}
                        {expired ? " · expired" : ec.level === "trainee" ? " · trainee" : ec.level === "trainer" ? " · trainer" : ""}
                      </span>
                    </Badge>
                  ))}
                </div>
              </td>
              {showLoad && (
                <>
                  <td>{load?.ops.length ?? 0}</td>
                  <td>{load ? fmtMinutes(load.minutes) : "—"}</td>
                </>
              )}
              <td>{e.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="muted">Inactive</Badge>}</td>
            </tr>
          );
        })}
      </Table>
      {showLoad && <p className="mt-2 text-[12px] text-steel">Estimated workload = remaining setup estimate + cycle estimate × remaining quantity, for open operations assigned to each person.</p>}
    </>
  );
}
