import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { can, canAny, type Ctx } from "@/server/context";
import { listPurchaseOrders, listRequisitions } from "@/server/services/purchasing";
import { purchasingDashboard } from "@/server/services/reports";
import { supplierOptions } from "@/server/services/ui/materials";
import { JOB_STATUS, PO_STATUS } from "@/lib/status";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/format";
import { d, Decimal } from "@/lib/decimal";
import { Badge, LinkButton, PageHeader, Ref, Section, Stat, StatusBadge, Table, Tabs } from "@/components/ui";
import { ActionForm, CheckboxField, Disclosure, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { StageLegend } from "../materials/_components/Lifecycle";
import { CERT_STATUS } from "../materials/_components/labels";
import { cancelRequisitionAction, createPoFromRequisitionsAction } from "./actions";
import { supplierLabel } from "./_components/supplier";

export const metadata = { title: "Purchasing" };

type SP = { tab?: string; q?: string; status?: string; open?: string };

export default async function PurchasingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageCtx("purchasing.view");
  const sp = await searchParams;
  const tab = sp.tab === "orders" || sp.tab === "requisitions" ? sp.tab : "dashboard";
  const manage = can(ctx.actor, "purchasing.manage");
  return (
    <>
      <PageHeader
        title="Purchasing"
        description="Purchase requisitions and orders, expected and overdue deliveries, outstanding certificates and BoxHero sync problems."
        actions={
          manage && (
            <>
              <LinkButton href="/purchasing/requisitions/new">New requisition</LinkButton>
              <LinkButton href="/purchasing/new" variant="primary">
                New purchase order
              </LinkButton>
            </>
          )
        }
      />
      <Tabs
        base="/purchasing"
        current={tab}
        tabs={[
          { key: "dashboard", label: "Dashboard" },
          { key: "orders", label: "Purchase orders" },
          { key: "requisitions", label: "Requisitions" },
        ]}
      />
      {tab === "dashboard" && <Dashboard ctx={ctx} />}
      {tab === "orders" && <Orders ctx={ctx} sp={sp} />}
      {tab === "requisitions" && <Requisitions ctx={ctx} />}
    </>
  );
}

async function Dashboard({ ctx }: { ctx: Ctx }) {
  const dash = await purchasingDashboard(ctx);
  const seeBoxhero = can(ctx.actor, "boxhero.view");
  const seeMaterials = can(ctx.actor, "materials.view");
  return (
    <>
      <StageLegend compact />
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Open purchase orders" value={dash.openPos.length} href="/purchasing?tab=orders&open=1" />
        <Stat label="Overdue delivery lines" value={dash.overdue.length} tone={dash.overdue.length ? "danger" : undefined} />
        <Stat label="Expected next 14 days" value={dash.expected.length} />
        <Stat label="Certificates outstanding" value={dash.certsOutstanding.length} tone={dash.certsOutstanding.length ? "warning" : undefined} href={seeMaterials ? "/materials?tab=release" : undefined} />
        <Stat label="BoxHero sync problems" value={dash.syncProblems.length} tone={dash.syncProblems.length ? "danger" : undefined} href={seeBoxhero ? "/materials?tab=boxhero" : undefined} />
        <Stat label="Jobs needing material" value={dash.jobsNeedingMaterial.length} tone={dash.jobsNeedingMaterial.length ? "warning" : undefined} />
      </div>

      <Section title={<span className={dash.overdue.length ? "text-red" : undefined}>Overdue deliveries</span>}>
        <Table head={["PO", "Line", "Supplier", "Description", "Job", "Ordered", "Received", "Required"]} empty="No overdue deliveries.">
          {dash.overdue.map(({ l, po, supplier, job }) => (
            <tr key={l.id} className="bg-red-50/60">
              <td>
                <Ref href={`/purchasing/${po.id}`} size="sm">
                  {po.ref}
                </Ref>
              </td>
              <td>{l.lineNo}</td>
              <td>{supplier}</td>
              <td>{l.description}</td>
              <td>{job && l.jobId ? <Link href={`/jobs/${l.jobId}`} className="link">{job}</Link> : "—"}</td>
              <td className="whitespace-nowrap">{fmtQty(l.quantity, l.uom)}</td>
              <td className="whitespace-nowrap">{fmtQty(l.qtyReceived, l.uom)}</td>
              <td className="whitespace-nowrap font-semibold text-red">{fmtDate(l.requiredDate)}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Expected deliveries — next 14 days">
          <Table head={["PO", "Supplier", "Description", "Outstanding", "Required"]} empty="Nothing expected in the next 14 days.">
            {dash.expected.map(({ l, po, supplier }) => (
              <tr key={l.id}>
                <td>
                  <Ref href={`/purchasing/${po.id}`} size="sm">
                    {po.ref}
                  </Ref>
                </td>
                <td>{supplier}</td>
                <td>{l.description}</td>
                <td className="whitespace-nowrap">{fmtQty(Decimal.max(d(l.quantity).minus(d(l.qtyReceived)), 0).toString(), l.uom)}</td>
                <td className="whitespace-nowrap">{fmtDate(l.requiredDate)}</td>
              </tr>
            ))}
          </Table>
        </Section>
        <Section title="Open purchase orders">
          <Table head={["PO", "Supplier", "Status", "Required"]} empty="No open purchase orders.">
            {dash.openPos.slice(0, 20).map(({ po, supplier }) => (
              <tr key={po.id}>
                <td>
                  <Ref href={`/purchasing/${po.id}`} size="sm">
                    {po.ref}
                  </Ref>
                </td>
                <td>{supplier}</td>
                <td>
                  <StatusBadge map={PO_STATUS} status={po.status} />
                </td>
                <td className="whitespace-nowrap">{fmtDate(po.requiredDate)}</td>
              </tr>
            ))}
          </Table>
          {dash.openPos.length > 20 && (
            <p className="mt-1 text-[12px]">
              <Link href="/purchasing?tab=orders&open=1" className="link">
                All {dash.openPos.length} open orders
              </Link>
            </p>
          )}
        </Section>
        <Section title="Certificates outstanding">
          <Table head={["Lot", "Heat", "Supplier", "Certificate"]} empty="No outstanding or rejected certificates.">
            {dash.certsOutstanding.map(({ l, supplier }) => (
              <tr key={l.id}>
                <td>
                  {seeMaterials ? (
                    <Ref href={`/materials/lots/${l.id}#certificates`} size="sm">
                      {l.lotNo}
                    </Ref>
                  ) : (
                    <Ref size="sm">{l.lotNo}</Ref>
                  )}
                </td>
                <td className="plate text-[13px]">{l.heatNumber}</td>
                <td>{supplier}</td>
                <td>
                  <StatusBadge map={CERT_STATUS} status={l.certificateStatus} />
                </td>
              </tr>
            ))}
          </Table>
        </Section>
        <Section title="Jobs needing material">
          <Table head={["Job", "Title", "Status", "Required"]} empty="No jobs are waiting on material.">
            {dash.jobsNeedingMaterial.map(({ job }) => (
              <tr key={job.id}>
                <td>
                  <Ref href={`/jobs/${job.id}?tab=materials`} size="sm">
                    {job.jobNumber}
                  </Ref>
                </td>
                <td>{job.title}</td>
                <td>
                  <StatusBadge map={JOB_STATUS} status={job.status} />
                </td>
                <td className="whitespace-nowrap">{fmtDate(job.requiredDate)}</td>
              </tr>
            ))}
          </Table>
        </Section>
      </div>
      {dash.syncProblems.length > 0 && (
        <p className="text-[13px] text-red">
          {dash.syncProblems.length} BoxHero stock movement(s) failed or need reconciliation.{" "}
          {seeBoxhero && (
            <Link href="/materials?tab=boxhero" className="link">
              Resolve on the BoxHero page
            </Link>
          )}
        </p>
      )}
    </>
  );
}

async function Orders({ ctx, sp }: { ctx: Ctx; sp: SP }) {
  const status = sp.status && sp.status in PO_STATUS ? sp.status : undefined;
  const rows = await listPurchaseOrders(ctx, { q: sp.q, status, open: sp.open === "1" });
  return (
    <>
      <form className="mb-3 flex flex-wrap items-center gap-2" role="search">
        <input type="hidden" name="tab" value="orders" />
        <input name="q" defaultValue={sp.q} placeholder="PO ref, supplier or supplier ref" className="field-input max-w-xs" aria-label="Filter purchase orders" />
        <select name="status" defaultValue={status ?? ""} className="field-input max-w-[220px]" aria-label="PO status">
          <option value="">All statuses</option>
          {Object.entries(PO_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[13px] text-steel">
          <input type="checkbox" name="open" value="1" defaultChecked={sp.open === "1"} className="accent-dykem" /> Open only
        </label>
        <button className="rounded-sm border border-line bg-sheet px-3 py-1.5 text-[13px]">Apply</button>
      </form>
      <Table head={["PO", "Supplier", "Kind", "Status", "Order date", "Required", "Supplier ref", "Total"]} empty="No purchase orders match.">
        {rows.map(({ po, supplier, supplierCode }) => (
          <tr key={po.id}>
            <td>
              <Ref href={`/purchasing/${po.id}`} size="sm">
                {po.ref}
              </Ref>
            </td>
            <td>
              {supplier} <span className="text-[12px] text-steel">{supplierCode}</span>
            </td>
            <td className="capitalize">{po.kind}</td>
            <td>
              <StatusBadge map={PO_STATUS} status={po.status} />
            </td>
            <td className="whitespace-nowrap">{fmtDate(po.orderDate)}</td>
            <td className="whitespace-nowrap">{fmtDate(po.requiredDate)}</td>
            <td>{po.supplierReference ?? "—"}</td>
            <td className="whitespace-nowrap text-right">{fmtMoney(po.total, po.currency)}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}

async function Requisitions({ ctx }: { ctx: Ctx }) {
  const manage = can(ctx.actor, "purchasing.manage");
  const [rows, suppliers] = await Promise.all([listRequisitions(ctx, "open"), manage ? supplierOptions(ctx) : Promise.resolve([])]);
  const seeJobs = canAny(ctx.actor, "jobs.view", "production.view_all");
  const table = (
    <Table head={["Ref", "Job", "Spec", "Description", "Dimensions", "Quantity", "Required", "Requested by", "Notes", ""]} empty="No open requisitions.">
      {rows.map(({ r, job, spec, requestedBy }) => (
        <tr key={r.id}>
          <td className="plate text-[13px]">{r.ref}</td>
          <td>{job && r.jobId ? seeJobs ? <Link href={`/jobs/${r.jobId}`} className="link">{job}</Link> : job : <span className="text-steel">Stock</span>}</td>
          <td>{spec ?? "—"}</td>
          <td>{r.description}</td>
          <td>{r.dimensions ?? "—"}</td>
          <td className="whitespace-nowrap">{fmtQty(r.quantity, r.uom)}</td>
          <td className="whitespace-nowrap">{fmtDate(r.requiredDate)}</td>
          <td>{requestedBy ?? "—"}</td>
          <td className="max-w-[240px] whitespace-pre-wrap text-steel">{r.notes ?? ""}</td>
          <td>
            {manage && (
              <Disclosure label="Cancel" variant="ghost">
                <ActionForm action={cancelRequisitionAction} submitLabel="Cancel requisition" submitVariant="danger" confirm={`Cancel requisition ${r.ref}? It will no longer be available for ordering.`}>
                  <input type="hidden" name="requisitionId" value={r.id} />
                  <TextArea label="Reason" name="reason" rows={2} required />
                </ActionForm>
              </Disclosure>
            )}
          </td>
        </tr>
      ))}
    </Table>
  );
  if (!manage || rows.length === 0) return table;
  const usable = suppliers.filter((s) => s.usable && s.categories.includes("material"));
  return (
    <>
      {table}
      <Section title="Create purchase order from requisitions" className="mt-6">
        <p className="mb-2 max-w-[90ch] text-[13px] text-steel">
          Select requisitions and an approved supplier. A draft PO is created with one line per requisition, linked back to the requisition. Lines start with a unit price of
          zero — set prices with “Edit price” on the PO before approval. The PO must then be approved by a different person before it is sent.
        </p>
        <ActionForm action={createPoFromRequisitionsAction} submitLabel="Create PO from selected requisitions">
          <fieldset className="rounded-sm border border-line bg-paper p-3">
            <legend className="px-1 text-[12.5px] font-semibold text-ink">Requisitions</legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {rows.map(({ r, job }) => (
                <CheckboxField key={r.id} name="requisitionIds" value={r.id} label={`${r.ref} — ${r.description} · ${fmtQty(r.quantity, r.uom)}`} hint={`${job ?? "Stock"}${r.requiredDate ? ` · required ${fmtDate(r.requiredDate)}` : ""}`} />
              ))}
            </div>
          </fieldset>
          <FormGrid cols={3}>
            <SelectField label="Supplier" name="supplierId" required placeholder="Select an approved supplier…" options={usable.map((s) => ({ value: s.id, label: supplierLabel(s) }))} />
            <TextField label="Required date" name="requiredDate" type="date" />
            <TextField label="Notes" name="notes" />
          </FormGrid>
          {usable.length === 0 && <Badge tone="warning">No approved material suppliers are available.</Badge>}
        </ActionForm>
      </Section>
    </>
  );
}
