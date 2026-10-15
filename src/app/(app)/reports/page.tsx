import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { can, canAny } from "@/server/context";
import { jobsReport, ncrReport, operatorTimeReport, supplierPerformance } from "@/server/services/reports";
import { NCR_CATEGORIES } from "@/server/services/ncr";
import { reportFilterOptions } from "@/server/services/ui/records";
import { getSettings } from "@/server/services/settings";
import { addDaysISO, fmtDate, fmtDateTime, fmtMinutes, fmtMoney, fmtPct, fmtQty, todayISO } from "@/lib/format";
import { JOB_STATUS, NCR_STATUS } from "@/lib/status";
import { Badge, buttonClass, Notice, PageHeader, Ref, Section, StatusBadge, Table, Tabs } from "@/components/ui";

export const metadata = { title: "Reports" };

type SP = { tab?: string; from?: string; to?: string; customer?: string; status?: string; machine?: string; operator?: string; employee?: string; category?: string; supplier?: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const date = (v?: string) => (v && ISO.test(v) ? v : undefined);
const uuid = (v?: string) => (v && UUID.test(v) ? v : undefined);

function qs(params: Record<string, string | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : "";
}

/** Plain anchor (not next/link): the target is a file download from a route handler. */
function ExportLink({ href }: { href: string }) {
  return (
    <a href={href} className={buttonClass("secondary", "sm")} download>
      Export CSV
    </a>
  );
}

function FilterBar({ tab, children }: { tab: string; children: React.ReactNode }) {
  return (
    <form className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-line bg-sheet p-3" role="search">
      <input type="hidden" name="tab" value={tab} />
      {children}
      <button className="h-8.5 rounded-sm border border-dykem bg-dykem px-3 text-[13px] font-medium text-white hover:bg-dykem-2">Run report</button>
      <Link href={`/reports?tab=${tab}`} className="h-8.5 rounded-sm border border-line bg-sheet px-3 py-1.5 text-[13px]">
        Clear
      </Link>
    </form>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-[12.5px] font-medium text-ink-2">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function Select({ name, value, options, all = "All" }: { name: string; value?: string; options: { value: string; label: string }[]; all?: string }) {
  return (
    <select name={name} defaultValue={value ?? ""} className="field-input min-w-[160px]">
      <option value="">{all}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageCtx("reports.view", "reports.management");
  const sp = await searchParams;
  const canNcr = canAny(ctx.actor, "reports.view", "ncr.view");
  const canSuppliers = canAny(ctx.actor, "reports.view", "suppliers.view");
  const tabs = [
    { key: "jobs", label: "Jobs" },
    { key: "time", label: "Operator & machine time" },
    ...(canNcr ? [{ key: "ncr", label: "Non-conformances" }] : []),
    ...(canSuppliers ? [{ key: "suppliers", label: "Supplier performance" }] : []),
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : "jobs";
  const exportOk = can(ctx.actor, "reports.export");
  const opts = await reportFilterOptions(ctx);
  const settings = await getSettings(ctx.db);
  const commercial = canAny(ctx.actor, "reports.management", "jobs.view_commercial");

  const customerOpts = opts.customers.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }));
  const machineOpts = opts.machines.map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` }));
  const employeeOpts = opts.employees.map((e) => ({ value: e.id, label: `${e.firstName} ${e.lastName} (${e.no})` }));
  const supplierOpts = opts.suppliers.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }));

  return (
    <>
      <PageHeader
        title="Reports"
        description={
          <>
            Operational reports with filters and CSV export. Per-customer history (jobs, quotations, enquiries) is on each{" "}
            <Link href="/customers" className="link">
              customer page
            </Link>{" "}
            under “History”; per-job traceability is under{" "}
            <Link href="/traceability" className="link">
              Traceability
            </Link>
            .
          </>
        }
      />
      <Tabs base="/reports" current={tab} tabs={tabs} />

      {tab === "jobs" && (
        <JobsTab
          sp={sp}
          exportOk={exportOk}
          commercial={commercial}
          currency={settings.currency}
          customerOpts={customerOpts}
          machineOpts={machineOpts}
          employeeOpts={employeeOpts}
          ctx={ctx}
        />
      )}
      {tab === "time" && <TimeTab sp={sp} exportOk={exportOk} machineOpts={machineOpts} employeeOpts={employeeOpts} ctx={ctx} />}
      {tab === "ncr" && canNcr && <NcrTab sp={sp} exportOk={exportOk} supplierOpts={supplierOpts} ctx={ctx} />}
      {tab === "suppliers" && canSuppliers && <SupplierTab exportOk={exportOk} ctx={ctx} />}
    </>
  );
}

type Ctx = Awaited<ReturnType<typeof requirePageCtx>>;
type Opt = { value: string; label: string }[];

async function JobsTab({ sp, exportOk, commercial, currency, customerOpts, machineOpts, employeeOpts, ctx }: { sp: SP; exportOk: boolean; commercial: boolean; currency: string; customerOpts: Opt; machineOpts: Opt; employeeOpts: Opt; ctx: Ctx }) {
  const filters = { from: date(sp.from), to: date(sp.to), customer: uuid(sp.customer), status: sp.status && sp.status in JOB_STATUS ? sp.status : undefined, machine: uuid(sp.machine), operator: uuid(sp.operator) };
  const rows = await jobsReport(ctx, { from: filters.from, to: filters.to, customerId: filters.customer, status: filters.status, machineId: filters.machine, employeeId: filters.operator });
  const totals = rows.reduce((acc, r) => ({ qty: acc.qty + Number(r.quantity), good: acc.good + Number(r.good), rej: acc.rej + Number(r.rejected), scr: acc.scr + Number(r.scrapped) }), { qty: 0, good: 0, rej: 0, scr: 0 });
  return (
    <Section
      title={`Jobs (${rows.length})`}
      actions={exportOk && <ExportLink href={`/api/reports/jobs${qs(filters)}`} />}
    >
      <FilterBar tab="jobs">
        <F label="Created from">
          <input type="date" name="from" defaultValue={filters.from} className="field-input" />
        </F>
        <F label="Created to">
          <input type="date" name="to" defaultValue={filters.to} className="field-input" />
        </F>
        <F label="Customer">
          <Select name="customer" value={filters.customer} options={customerOpts} />
        </F>
        <F label="Status">
          <Select name="status" value={filters.status} options={Object.entries(JOB_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} />
        </F>
        <F label="Machine (time booked)">
          <Select name="machine" value={filters.machine} options={machineOpts} />
        </F>
        <F label="Operator (time booked)">
          <Select name="operator" value={filters.operator} options={employeeOpts} />
        </F>
      </FilterBar>
      <Table
        head={["Job", "Title", "Customer", "Status", "Required", "Qty", "Good", "Rejected", "Scrapped", "Dispatched", ...(commercial ? ["Value"] : [])]}
        empty="No jobs match these filters."
        footer={
          rows.length > 0 && (
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={5}>Totals</td>
                <td>{fmtQty(totals.qty)}</td>
                <td>{fmtQty(totals.good)}</td>
                <td>{fmtQty(totals.rej)}</td>
                <td>{fmtQty(totals.scr)}</td>
                <td />
                {commercial && <td />}
              </tr>
            </tfoot>
          )
        }
      >
        {rows.map((r) => (
          <tr key={r.jobNumber}>
            <td>
              <Link href={`/search?q=${encodeURIComponent(r.jobNumber)}`} className="plate text-dykem hover:underline">
                {r.jobNumber}
              </Link>
            </td>
            <td>{r.title}</td>
            <td>{r.customer}</td>
            <td>
              <StatusBadge map={JOB_STATUS} status={r.status} />
            </td>
            <td>{fmtDate(r.requiredDate)}</td>
            <td>{fmtQty(r.quantity)}</td>
            <td>{fmtQty(r.good)}</td>
            <td>{fmtQty(r.rejected)}</td>
            <td>{fmtQty(r.scrapped)}</td>
            <td>{fmtQty(r.dispatched)}</td>
            {commercial && <td>{r.value ? fmtMoney(r.value, currency) : "—"}</td>}
          </tr>
        ))}
      </Table>
      {rows.length >= 2000 && <Notice tone="warning">Only the 2,000 most recent jobs are included. Narrow the date range.</Notice>}
    </Section>
  );
}

async function TimeTab({ sp, exportOk, machineOpts, employeeOpts, ctx }: { sp: SP; exportOk: boolean; machineOpts: Opt; employeeOpts: Opt; ctx: Ctx }) {
  const to = date(sp.to) ?? todayISO();
  const from = date(sp.from) ?? addDaysISO(to, -30);
  const filters = { from, to, employee: uuid(sp.employee), machine: uuid(sp.machine) };
  const rows = await operatorTimeReport(ctx, { from, to, employeeId: filters.employee, machineId: filters.machine });
  const now = new Date().getTime();
  const mins = (r: (typeof rows)[number]) => ((r.t.endedAt?.getTime() ?? now) - r.t.startedAt.getTime()) / 60_000;
  const byEmployee = new Map<string, { name: string; minutes: number; good: number; entries: number }>();
  const byMachine = new Map<string, { minutes: number; entries: number }>();
  for (const r of rows) {
    const e = byEmployee.get(r.e.id) ?? { name: `${r.e.firstName} ${r.e.lastName}`, minutes: 0, good: 0, entries: 0 };
    e.minutes += mins(r);
    e.good += Number(r.t.qtyGood ?? 0);
    e.entries++;
    byEmployee.set(r.e.id, e);
    const key = r.machine ?? "No machine";
    const m = byMachine.get(key) ?? { minutes: 0, entries: 0 };
    m.minutes += mins(r);
    m.entries++;
    byMachine.set(key, m);
  }
  return (
    <Section title={`Time entries (${rows.length})`} actions={exportOk && <ExportLink href={`/api/reports/operator-time${qs(filters)}`} />}>
      <FilterBar tab="time">
        <F label="From">
          <input type="date" name="from" defaultValue={from} className="field-input" />
        </F>
        <F label="To">
          <input type="date" name="to" defaultValue={to} className="field-input" />
        </F>
        <F label="Operator">
          <Select name="employee" value={filters.employee} options={employeeOpts} />
        </F>
        <F label="Machine">
          <Select name="machine" value={filters.machine} options={machineOpts} />
        </F>
      </FilterBar>
      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <Table head={["Operator", "Entries", "Recorded time", "Good qty"]} empty="No time recorded.">
          {[...byEmployee.entries()].map(([id, e]) => (
            <tr key={id}>
              <td className="font-medium">{e.name}</td>
              <td>{e.entries}</td>
              <td>{fmtMinutes(e.minutes)}</td>
              <td>{fmtQty(e.good)}</td>
            </tr>
          ))}
        </Table>
        <Table head={["Machine", "Entries", "Recorded time"]} empty="No time recorded.">
          {[...byMachine.entries()].map(([code, m]) => (
            <tr key={code}>
              <td className="plate">{code}</td>
              <td>{m.entries}</td>
              <td>{fmtMinutes(m.minutes)}</td>
            </tr>
          ))}
        </Table>
      </div>
      <Table head={["Started", "Ended", "Duration", "Type", "Operator", "Job", "Op", "Machine", "Good", "Rejected", "Scrapped"]} empty="No time entries in this period.">
        {rows.map((r) => (
          <tr key={r.t.id}>
            <td className="whitespace-nowrap">{fmtDateTime(r.t.startedAt)}</td>
            <td className="whitespace-nowrap">{r.t.endedAt ? fmtDateTime(r.t.endedAt) : <Badge tone="progress">Running</Badge>}</td>
            <td>{fmtMinutes(mins(r))}</td>
            <td className="capitalize">{r.t.kind}</td>
            <td>
              {r.e.firstName} {r.e.lastName}
            </td>
            <td className="plate">{r.job}</td>
            <td>{r.op}</td>
            <td className="plate">{r.machine ?? "—"}</td>
            <td>{fmtQty(r.t.qtyGood)}</td>
            <td>{fmtQty(r.t.qtyRejected)}</td>
            <td>{fmtQty(r.t.qtyScrapped)}</td>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

async function NcrTab({ sp, exportOk, supplierOpts, ctx }: { sp: SP; exportOk: boolean; supplierOpts: Opt; ctx: Ctx }) {
  const filters = { from: date(sp.from), to: date(sp.to), category: sp.category && (NCR_CATEGORIES as readonly string[]).includes(sp.category) ? sp.category : undefined, supplier: uuid(sp.supplier) };
  const rows = await ncrReport(ctx, { from: filters.from, to: filters.to, category: filters.category, supplierId: filters.supplier });
  const byCategory = new Map<string, number>();
  for (const r of rows) byCategory.set(r.n.category, (byCategory.get(r.n.category) ?? 0) + 1);
  return (
    <Section title={`Non-conformances (${rows.length})`} actions={exportOk && <ExportLink href={`/api/reports/ncr${qs(filters)}`} />}>
      <FilterBar tab="ncr">
        <F label="Raised from">
          <input type="date" name="from" defaultValue={filters.from} className="field-input" />
        </F>
        <F label="Raised to">
          <input type="date" name="to" defaultValue={filters.to} className="field-input" />
        </F>
        <F label="Category">
          <Select name="category" value={filters.category} options={NCR_CATEGORIES.map((c) => ({ value: c, label: c.replace(/_/g, " ") }))} />
        </F>
        <F label="Supplier">
          <Select name="supplier" value={filters.supplier} options={supplierOpts} />
        </F>
      </FilterBar>
      {byCategory.size > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {[...byCategory.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([c, n]) => (
              <Badge key={c} tone="neutral">
                <span className="capitalize">{c.replace(/_/g, " ")}</span>: {n}
              </Badge>
            ))}
        </div>
      )}
      <Table head={["NCR", "Raised", "Source", "Category", "Job", "Supplier", "Heat no.", "Qty affected", "Description", "Status"]} empty="No non-conformances match these filters.">
        {rows.map((r) => (
          <tr key={r.n.id}>
            <td>
              <Ref href={`/ncr/${r.n.id}`} size="sm">
                {r.n.ref}
              </Ref>
            </td>
            <td className="whitespace-nowrap">{fmtDate(r.n.raisedAt)}</td>
            <td className="capitalize">{r.n.source.replace(/_/g, " ")}</td>
            <td className="capitalize">{r.n.category.replace(/_/g, " ")}</td>
            <td className="plate">{r.job ?? "—"}</td>
            <td>{r.supplier ?? "—"}</td>
            <td className="plate">{r.n.heatNumber ?? "—"}</td>
            <td>{fmtQty(r.n.qtyAffected)}</td>
            <td className="max-w-[360px] truncate">{r.n.description}</td>
            <td>
              <StatusBadge map={NCR_STATUS} status={r.n.status} />
            </td>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

async function SupplierTab({ exportOk, ctx }: { exportOk: boolean; ctx: Ctx }) {
  const rows = (await supplierPerformance(ctx)).sort((a, b) => b.ncrs - a.ncrs || a.supplier.name.localeCompare(b.supplier.name));
  return (
    <Section title={`Supplier performance (${rows.length} active suppliers)`} actions={exportOk && <ExportLink href="/api/reports/supplier-performance" />}>
      <p className="mb-2 text-[12.5px] text-steel">
        PO lines: all purchase-order lines placed with the supplier. Received: lines fully received. NCRs: non-conformances recorded against the supplier (all time).
      </p>
      <Table head={["Code", "Supplier", "Approval", "PO lines", "Received", "Received %", "NCRs"]} empty="No active suppliers.">
        {rows.map((r) => (
          <tr key={r.supplier.id}>
            <td>
              <Ref href={`/suppliers/${r.supplier.id}`} size="sm">
                {r.supplier.code}
              </Ref>
            </td>
            <td className="font-medium">{r.supplier.name}</td>
            <td className="capitalize">{r.supplier.approvalStatus.replace(/_/g, " ")}</td>
            <td>{r.poLines}</td>
            <td>{r.received}</td>
            <td>{r.poLines ? fmtPct((r.received / r.poLines) * 100) : "—"}</td>
            <td>{r.ncrs ? <Badge tone={r.ncrs > 2 ? "danger" : "warning"}>{r.ncrs}</Badge> : "0"}</td>
          </tr>
        ))}
      </Table>
    </Section>
  );
}
