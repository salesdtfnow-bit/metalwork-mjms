import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { acceptedRevisionsFor } from "@/server/services/orders";
import { formatAddress } from "@/server/services/parties";
import { customerAddressOptions, customerOptions } from "@/server/services/ui/sales";
import { can, canAny } from "@/server/context";
import { fmtMoney } from "@/lib/format";
import { QUOTE_STATUS, statusDef } from "@/lib/status";
import { Notice, PageHeader, Panel } from "@/components/ui";
import { OrderForm } from "./OrderForm";

export const metadata = { title: "Register customer PO" };

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ customerId?: string; revisionId?: string }> }) {
  const ctx = await requirePageCtx("orders.manage");
  const sp = await searchParams;
  const customers = await customerOptions(ctx);
  const customer = customers.find((c) => c.id === sp.customerId);

  if (!customer) {
    return (
      <>
        <PageHeader title="Register customer PO" description="Choose the customer who sent the purchase order." />
        {sp.customerId && <Notice tone="warning">That customer was not found or is inactive.</Notice>}
        <Panel className="max-w-xl p-4">
          <form className="space-y-3" method="get">
            <label className="block text-[12.5px] font-medium text-ink-2" htmlFor="customerId">
              Customer
            </label>
            <select id="customerId" name="customerId" required className="field-input" defaultValue="">
              <option value="" disabled>
                Select a customer
              </option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
            <button className="inline-flex h-8.5 items-center rounded-sm border border-dykem bg-dykem px-3 text-[13.5px] font-medium text-white hover:bg-dykem-2">Continue</button>
          </form>
        </Panel>
      </>
    );
  }

  const commercial = canAny(ctx.actor, "jobs.view_commercial", "customers.view_commercial", "quotations.view");
  const [revs, addresses] = await Promise.all([acceptedRevisionsFor(ctx, customer.id), customerAddressOptions(ctx, customer.id)]);
  const delivery = addresses.filter((a) => a.kind !== "billing");
  const preselect = revs.find((x) => x.rev.id === sp.revisionId) ?? revs.find((x) => x.rev.status === "accepted") ?? null;

  const canFastTrack = can(ctx.actor, "orders.verify") && can(ctx.actor, "jobs.create");
  return (
    <>
      <PageHeader
        title="Register customer PO"
        description={
          <>
            {customer.name}.{" "}
            <Link href="/orders/new" className="link">
              Change customer
            </Link>
          </>
        }
      />
      <Panel className="max-w-5xl p-4">
        <OrderForm
          customer={{ id: customer.id, currency: customer.currency }}
          quotations={revs.map(({ rev, q }) => ({
            value: rev.id,
            label: `${q.ref} rev ${rev.revisionNo} — ${q.title} — ${statusDef(QUOTE_STATUS, rev.status).label}${rev.acceptanceVerifiedAt ? "" : rev.acceptanceRecordedAt ? " (acceptance not yet verified)" : ""}${commercial ? ` — ${fmtMoney(rev.total, rev.currency)}` : ""}`,
          }))}
          preselectRevisionId={preselect?.rev.id}
          addresses={delivery.map((a) => ({ value: a.id, label: `${a.label ? `${a.label} — ` : ""}${formatAddress(a).replace(/\n/g, ", ")}${a.isDefault ? " (default)" : ""}` }))}
          commercial={commercial}
          canFastTrack={canFastTrack}
        />
      </Panel>
    </>
  );
}
