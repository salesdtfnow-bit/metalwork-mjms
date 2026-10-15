import { requirePageCtx } from "@/server/auth/next";
import { listJobs } from "@/server/services/jobs";
import { jobCustomerOptions } from "@/server/services/ui/jobs";
import { can } from "@/server/context";
import { fmtDate, todayISO } from "@/lib/format";
import { JOB_STATUS, PRIORITY } from "@/lib/status";
import { cx, LinkButton, PageHeader, Ref, StatusBadge, Table } from "@/components/ui";

export const metadata = { title: "Jobs" };

const SCOPES = [
  { value: "open", label: "Open jobs" },
  { value: "late", label: "Late" },
  { value: "on_hold", label: "On hold" },
  { value: "all", label: "All, including closed" },
] as const;
type Scope = (typeof SCOPES)[number]["value"];

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ q?: string; scope?: string; status?: string; customer?: string }> }) {
  const ctx = await requirePageCtx("jobs.view", "production.view_all");
  const sp = await searchParams;
  const scope: Scope = SCOPES.some((s) => s.value === sp.scope) ? (sp.scope as Scope) : "open";
  const status = sp.status && sp.status in JOB_STATUS ? sp.status : undefined;
  const uuidRe = /^[0-9a-f-]{36}$/i;
  const customerId = sp.customer && uuidRe.test(sp.customer) ? sp.customer : undefined;
  const [rows, customers] = await Promise.all([listJobs(ctx, { q: sp.q, scope, status, customerId }), jobCustomerOptions(ctx)]);
  const today = todayISO();

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Manufacturing jobs in priority and required-date order. Jobs are created from verified customer purchase orders on the Customer orders page, so every job traces back to an accepted quotation and PO."
        actions={can(ctx.actor, "jobs.create") && <LinkButton href="/orders" variant="primary">New job</LinkButton>}
      />
      <form className="mb-3 flex flex-wrap items-center gap-2" role="search">
        <select name="scope" defaultValue={scope} className="field-input w-auto" aria-label="Scope">
          {SCOPES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={status ?? ""} className="field-input w-auto" aria-label="Status">
          <option value="">Any status</option>
          {Object.entries(JOB_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <select name="customer" defaultValue={customerId ?? ""} className="field-input w-auto max-w-[260px]" aria-label="Customer">
          <option value="">Any customer</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
        <input name="q" defaultValue={sp.q} placeholder="Job number, title or customer" className="field-input max-w-xs" aria-label="Search jobs" />
        <button className="rounded-sm border border-line bg-sheet px-3 py-1.5 text-[13px]">Apply</button>
        <span className="ml-auto text-[12.5px] text-steel">{rows.length === 500 ? "First 500 jobs shown — narrow the filter." : `${rows.length} job(s)`}</span>
      </form>
      <Table head={["Job", "Title", "Customer", "Status", "Priority", "Required", "Owner", "Next action"]} empty="No jobs match this filter.">
        {rows.map(({ job: j, customerCode, customer, owner }) => {
          const late = !!j.requiredDate && j.requiredDate < today && !["dispatched", "completed", "cancelled"].includes(j.status);
          return (
            <tr key={j.id}>
              <td className="whitespace-nowrap">
                <Ref href={`/jobs/${j.id}`}>{j.jobNumber}</Ref>
              </td>
              <td className="font-medium">{j.title}</td>
              <td className="whitespace-nowrap" title={customer}>
                <span className="plate text-[13px]">{customerCode}</span>
              </td>
              <td>
                <StatusBadge map={JOB_STATUS} status={j.status} />
                {!j.authorisedAt && !["cancelled", "completed"].includes(j.status) && <span className="ml-1.5 text-[12px] text-amber">Not authorised</span>}
              </td>
              <td>
                <StatusBadge map={PRIORITY} status={String(j.priority)} />
              </td>
              <td className={cx("whitespace-nowrap", late && "font-semibold text-red")}>
                {fmtDate(j.requiredDate)}
                {late && <span className="sr-only"> (late)</span>}
              </td>
              <td className="whitespace-nowrap">{owner ?? "—"}</td>
              <td className="max-w-[320px] text-steel">{j.status === "on_hold" ? `On hold: ${j.holdReason ?? ""}` : (j.nextAction ?? "—")}</td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
