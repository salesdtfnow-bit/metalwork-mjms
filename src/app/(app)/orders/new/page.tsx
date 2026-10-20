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
import { getPoDraft } from "@/server/services/po-import";

export const metadata = { title: "Register customer PO" };

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ customerId?: string; revisionId?: string; draft?: string }> }) {
  const ctx = await requirePageCtx("orders.manage");
  const sp = await searchParams;
  const customers = await customerOptions(ctx);
  const customer = customers.find((c) => c.id === sp.customerId);
  const draft = sp.draft && /^[0-9a-f-]{36}$/.test(sp.draft) ? await getPoDraft(ctx, sp.draft).catch(() => null) : null;

  if (!customer) {
    return (
      <>
        <PageHeader title="Register customer PO" description="Choose the customer who sent the purchase order." />
        {sp.customerId && <Notice tone="warning">That customer was not found or is inactive.</Notice>}
        {draft && (
          <Notice tone="info" title="PO read — now choose the customer">
            {draft.customerName ? <>The PO appears to be from <strong>{draft.customerName}</strong>, which doesn&apos;t match an existing customer. </> : "The customer couldn't be identified from the PO. "}
            Choose them below, or{" "}
            <Link href="/customers/new" className="link">
              add the customer
            </Link>{" "}
            first and come back to this page.
          </Notice>
        )}
        <Panel className="max-w-xl p-4">
          <form className="space-y-3" method="get">
            {draft && <input type="hidden" name="draft" value={draft.extractionId} />}
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
      {draft && (
        <Notice tone={draft.warnings.length ? "warning" : "info"} title={draft.used ? "This PO reading has already been used for an order" : "Filled in from the PO by the assistant — check everything before saving"}>
          <p>Compare each part number, quantity, price and date with the PO{draft.file ? <> (<a className="link" href={`/api/files/${draft.file.id}`} target="_blank" rel="noopener">open the PO</a>)</> : null}. The assistant can misread scans and unusual layouts.</p>
          {draft.drawings.length > 0 && (
            <p className="mt-1">
              Drawings read:{" "}
              {draft.drawings.map((d, i) => (
                <span key={d.id}>
                  {i > 0 && ", "}
                  <a className="link" href={`/api/files/${d.id}`} target="_blank" rel="noopener">
                    {d.name}
                  </a>
                </span>
              ))}
              . Register them under Documents so the approved revision is pinned to the job.
            </p>
          )}
          {draft.warnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {draft.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {draft.currency && draft.currency.toUpperCase() !== customer.currency && <p className="mt-2">The PO is in {draft.currency}; this customer is set up in {customer.currency}.</p>}
        </Notice>
      )}
      <Panel className="max-w-5xl p-4">
        <OrderForm
          draft={draft?.draft}
          poFileId={draft?.file?.id}
          poFileName={draft?.file?.name}
          aiExtractionId={draft?.extractionId}
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
