import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { getJob } from "@/server/services/jobs";
import { can } from "@/server/context";
import { AppError } from "@/server/errors";
import { fmtDate, fmtMoney, todayISO } from "@/lib/format";
import { JOB_STATUS, PRIORITY } from "@/lib/status";
import { Badge, buttonClass, cx, LinkButton, StatusBadge, Tabs, TitleBlock } from "@/components/ui";
import { UUID_RE } from "../_components/maps";
import { OverviewTab } from "../_components/OverviewTab";
import { LinesTab } from "../_components/LinesTab";
import { RouteTab } from "../_components/RouteTab";
import { MaterialsTab } from "../_components/MaterialsTab";
import { QualityTab } from "../_components/QualityTab";
import { DispatchTab } from "../_components/DispatchTab";
import { HistoryTab } from "../_components/HistoryTab";

const TABS = ["overview", "lines", "route", "materials", "quality", "dispatch", "history"] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: UUID_RE.test(id) ? "Job" : "Job not found" };
}

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; op?: string }> }) {
  const ctx = await requirePageCtx("jobs.view", "production.view_all");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "overview";
  const data = await getJob(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const { job: j, customer, order, quote, owner, lines, showCommercial } = data;
  const late = !!j.requiredDate && j.requiredDate < todayISO() && !["dispatched", "completed", "cancelled"].includes(j.status);
  const trace = can(ctx.actor, "traceability.view");

  return (
    <>
      <TitleBlock
        kind="Job"
        refNo={j.jobNumber}
        title={j.title}
        status={
          <>
            <StatusBadge map={JOB_STATUS} status={j.status} />
            <StatusBadge map={PRIORITY} status={String(j.priority)} />
            {!j.authorisedAt && !["cancelled", "completed"].includes(j.status) && <Badge tone="warning">Not authorised</Badge>}
            {j.status === "on_hold" && j.holdReason && <span className="text-[13px] text-[#8a4b00]">On hold: {j.holdReason}</span>}
            {late && <Badge tone="danger">Late</Badge>}
          </>
        }
        cells={[
          {
            label: "Customer",
            value: can(ctx.actor, "customers.view") ? (
              <Link href={`/customers/${customer.id}`} className="link">
                {customer.code} — {customer.name}
              </Link>
            ) : (
              `${customer.code} — ${customer.name}`
            ),
          },
          {
            label: "Customer PO",
            value: order ? (
              can(ctx.actor, "orders.view") ? (
                <Link href={`/orders/${order.id}`} className="link">
                  {order.customerPoNumber}
                </Link>
              ) : (
                order.customerPoNumber
              )
            ) : null,
          },
          {
            label: "Quotation",
            value: quote ? (
              can(ctx.actor, "quotations.view") ? (
                <Link href={`/quotations/${quote.q.id}`} className="link">
                  {quote.q.ref} rev {quote.rev.revisionNo}
                </Link>
              ) : (
                `${quote.q.ref} rev ${quote.rev.revisionNo}`
              )
            ) : null,
          },
          { label: "Required date", value: <span className={cx(late && "text-red")}>{fmtDate(j.requiredDate)}</span> },
          { label: "Owner", value: owner },
          showCommercial ? { label: "Order value", value: order?.orderValue ? fmtMoney(order.orderValue, order.currency) : null } : { label: "Promised date", value: fmtDate(j.promisedDate) },
        ]}
        actions={
          <>
            <a href={`/api/pdf/traveller/${j.id}`} className={buttonClass("secondary", "sm")}>
              Print traveller
            </a>
            {trace && (
              <>
                <LinkButton href={`/traceability?q=${encodeURIComponent(j.jobNumber)}`} size="sm">
                  Traceability
                </LinkButton>
                <a href={`/api/pdf/traceability/${j.id}`} className={buttonClass("secondary", "sm")}>
                  Traceability PDF
                </a>
              </>
            )}
          </>
        }
      />
      <Tabs
        base={`/jobs/${id}`}
        current={tab}
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "lines", label: "Lines", count: lines.length },
          { key: "route", label: "Route" },
          { key: "materials", label: "Materials" },
          { key: "quality", label: "Quality" },
          { key: "dispatch", label: "Dispatch" },
          { key: "history", label: "History" },
        ]}
      />
      {tab === "overview" && <OverviewTab ctx={ctx} data={data} />}
      {tab === "lines" && <LinesTab ctx={ctx} data={data} />}
      {tab === "route" && <RouteTab ctx={ctx} data={data} selectedOpId={sp.op && UUID_RE.test(sp.op) ? sp.op : null} />}
      {tab === "materials" && <MaterialsTab ctx={ctx} data={data} />}
      {tab === "quality" && <QualityTab ctx={ctx} data={data} />}
      {tab === "dispatch" && <DispatchTab ctx={ctx} data={data} />}
      {tab === "history" && <HistoryTab ctx={ctx} data={data} />}
    </>
  );
}
