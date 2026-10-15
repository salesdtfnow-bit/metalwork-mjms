import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { listDispatches, readyToDispatch } from "@/server/services/dispatch";
import { d } from "@/lib/decimal";
import { fmtDate, fmtDateTime, fmtQty, todayISO } from "@/lib/format";
import { DISPATCH_STATUS, JOB_STATUS } from "@/lib/status";
import { LinkButton, PageHeader, Ref, StatusBadge, Table, Tabs, cx } from "@/components/ui";

export const metadata = { title: "Dispatch" };

export default async function DispatchPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string }> }) {
  const ctx = await requirePageCtx("dispatch.view");
  const sp = await searchParams;
  const tab = sp.tab ?? "ready";
  const manage = can(ctx.actor, "dispatch.manage");
  const today = todayISO();
  return (
    <>
      <PageHeader
        title="Dispatch"
        description="Only quantity with an approved final quality release, not on hold and not already on a dispatch can be shipped. Confirming a dispatch issues the delivery note."
        actions={manage && <LinkButton href="/dispatch/new" variant="primary">Prepare dispatch</LinkButton>}
      />
      <Tabs
        base="/dispatch"
        current={tab}
        tabs={[
          { key: "ready", label: "Ready to dispatch" },
          { key: "dispatches", label: "Dispatches" },
        ]}
      />
      {tab === "ready" && <Ready ctx={ctx} manage={manage} today={today} />}
      {tab === "dispatches" && <Dispatches ctx={ctx} status={sp.status} />}
    </>
  );
}

type PageCtx = Awaited<ReturnType<typeof requirePageCtx>>;

async function Ready({ ctx, manage, today }: { ctx: PageCtx; manage: boolean; today: string }) {
  const rows = await readyToDispatch(ctx);
  return (
    <>
      <Table head={["Job", "Customer", "Line", "Part", "Released", "Dispatched", "To dispatch", "Required", "Job status", ""]} empty="Nothing is released and waiting to ship.">
        {rows.map(({ jl, job, customer }) => {
          const outstanding = d(jl.qtyReleased).minus(d(jl.qtyDispatched));
          const late = !!job.requiredDate && job.requiredDate < today;
          return (
            <tr key={jl.id}>
              <td>
                <Ref href={`/jobs/${job.id}`} size="sm">
                  {job.jobNumber}
                </Ref>
              </td>
              <td className="font-medium">{customer}</td>
              <td>{jl.lineNo}</td>
              <td>
                {jl.partNumber}
                <span className="block max-w-[240px] truncate text-[12px] text-steel">{jl.description}</span>
              </td>
              <td>{fmtQty(jl.qtyReleased)}</td>
              <td>{fmtQty(jl.qtyDispatched)}</td>
              <td className="font-semibold">{fmtQty(outstanding.toString())}</td>
              <td className={cx("whitespace-nowrap", late && "font-semibold text-red")}>{fmtDate(job.requiredDate)}</td>
              <td>
                <StatusBadge map={JOB_STATUS} status={job.status} />
              </td>
              <td>
                {manage && (
                  <LinkButton href={`/dispatch/new?jobId=${job.id}`} size="sm">
                    Prepare dispatch
                  </LinkButton>
                )}
              </td>
            </tr>
          );
        })}
      </Table>
      <p className="mt-1 text-[12px] text-steel">&quot;To dispatch&quot; is released minus dispatched. Quantity already on draft dispatches or under hold is deducted when you prepare a dispatch.</p>
    </>
  );
}

async function Dispatches({ ctx, status }: { ctx: PageCtx; status?: string }) {
  const valid = status && status in DISPATCH_STATUS ? status : undefined;
  const rows = await listDispatches(ctx, { status: valid });
  const filters = [{ key: "", label: "All" }, ...Object.entries(DISPATCH_STATUS).map(([key, v]) => ({ key, label: v.label }))];
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-1 text-[13px]" role="group" aria-label="Status filter">
        {filters.map((fl) => (
          <Link
            key={fl.key}
            href={`/dispatch?tab=dispatches${fl.key ? `&status=${fl.key}` : ""}`}
            aria-current={(valid ?? "") === fl.key ? "true" : undefined}
            className={cx("rounded-sm border px-2.5 py-1", (valid ?? "") === fl.key ? "border-dykem bg-dykem text-white" : "border-line bg-sheet")}
          >
            {fl.label}
          </Link>
        ))}
      </div>
      <Table head={["Delivery note", "Job", "Customer", "Customer PO", "Status", "Method / carrier", "Dispatched", "Delivered"]} empty="No dispatches match.">
        {rows.map((r) => (
          <tr key={r.d.id}>
            <td>
              <Ref href={`/dispatch/${r.d.id}`} size="sm">
                {r.d.ref}
              </Ref>
            </td>
            <td>
              <Ref href={`/jobs/${r.d.jobId}`} size="sm">
                {r.job}
              </Ref>
            </td>
            <td className="font-medium">{r.customer}</td>
            <td>{r.d.customerPoNumber ?? "—"}</td>
            <td>
              <StatusBadge map={DISPATCH_STATUS} status={r.d.status} />
            </td>
            <td className="capitalize">
              {(r.d.deliveryMethod ?? "—").replace(/_/g, " ")}
              {r.d.carrier && <span className="block text-[12px] normal-case text-steel">{r.d.carrier}</span>}
            </td>
            <td className="whitespace-nowrap text-[12.5px]">{fmtDateTime(r.d.dispatchedAt)}</td>
            <td className="whitespace-nowrap text-[12.5px]">{fmtDateTime(r.d.deliveredAt)}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
