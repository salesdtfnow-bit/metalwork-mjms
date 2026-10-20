import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getDb } from "@/server/db/client";
import { getAcceptanceView } from "@/server/services/quote-acceptance";
import { fmtDate, fmtDateTime, fmtMoney, fmtQty } from "@/lib/format";
import { trimQty } from "@/lib/decimal";
import { buttonClass } from "@/components/ui";
import { ResponseForm } from "./ResponseForm";

export const metadata: Metadata = { title: { absolute: "Your quotation" }, robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * Public customer page reached from the quotation email. No sign-in: the unguessable token is the only
 * credential, so this page shows one quotation revision and nothing else.
 */
export default async function CustomerQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getAcceptanceView(await getDb(), token);
  if (!view) {
    return (
      <Shell>
        <div className="mx-auto max-w-lg py-16">
          <h1 className="plate text-[30px] leading-tight text-ink">This link is not valid</h1>
          <p className="mt-3 text-steel">It may have expired, been replaced by a newer quotation, or been copied incompletely. Please use the link in the most recent quotation email, or contact the person who sent it.</p>
        </div>
      </Shell>
    );
  }
  const { company, quote, lines, acceptance, state } = view;
  const cur = quote.currency;
  const label = `quotation ${quote.ref} revision ${quote.revisionNo}`;
  const taxLabel =
    quote.taxTreatment === "standard" ? `VAT @ ${trimQty(quote.taxRate)}%` : quote.taxTreatment === "reverse_charge" ? "VAT (reverse charge)" : quote.taxTreatment === "zero" ? "VAT (zero-rated)" : "VAT (exempt)";
  const docHref = (kind: "quote" | "confirmation") => `/q/${token}/document/${kind}`;

  return (
    <Shell company={company}>
      <header className="border-b-2 border-ink pb-5">
        <p className="text-[14px] text-steel">Quotation for {quote.customerName}</p>
        <h1 className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <span className="plate text-[40px] leading-none text-ink">{quote.ref}</span>
          <span className="plate text-[22px] text-steel">Revision {quote.revisionNo}</span>
        </h1>
        <p className="mt-2 text-[17px] text-ink-2">{quote.title}</p>
      </header>

      <StateBanner state={state} validUntil={quote.validUntil} acceptance={acceptance} confirmationHref={docHref("confirmation")} />

      <section aria-labelledby="lines-h" className="mt-6">
        <h2 id="lines-h" className="sr-only">
          Quoted items
        </h2>
        <div className="overflow-x-auto rounded-sm border border-line bg-sheet">
          <table className="w-full min-w-[560px] text-[14px]">
            <thead className="border-b border-line bg-paper text-left text-[12px] text-steel">
              <tr>
                <th className="px-3 py-2 font-medium">Part</th>
                <th className="px-3 py-2 font-medium">Drawing / material</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Unit price</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.lineNo} className="border-b border-line-2 align-top last:border-0">
                  <td className="px-3 py-2.5">
                    <span className="plate text-[16px] text-ink">{l.partNumber}</span>
                    <span className="block text-ink-2">{l.description}</span>
                  </td>
                  <td className="px-3 py-2.5 text-steel">
                    {l.drawing || "—"}
                    {l.material && <span className="block">{l.material}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtQty(l.quantity)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(l.unitPrice, cur)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(l.lineTotal, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ml-auto mt-3 w-full max-w-xs space-y-1 text-[14px]">
          <Row label="Subtotal" value={fmtMoney(quote.subtotal, cur)} />
          <Row label={taxLabel} value={fmtMoney(quote.taxAmount, cur)} />
          <div className="flex justify-between border-t-2 border-ink pt-1.5 text-[17px] font-semibold text-ink">
            <dt>Total</dt>
            <dd className="tabular-nums">{fmtMoney(quote.total, cur)}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-6 grid gap-4 text-[14px] sm:grid-cols-3">
        <Fact label="Lead time" value={quote.leadTime ?? "Confirmed on order"} />
        <Fact label="Delivery" value={quote.deliveryTerms ?? "Ex works"} />
        <Fact label="Valid until" value={fmtDate(quote.validUntil)} />
      </section>
      {quote.notes && <p className="mt-4 whitespace-pre-line text-[14px] text-ink-2">{quote.notes}</p>}

      <details className="mt-5 rounded-sm border border-line bg-sheet px-4 py-3 text-[13.5px]">
        <summary className="cursor-pointer font-medium text-ink">Terms and conditions</summary>
        <p className="mt-2 whitespace-pre-line text-steel">{quote.terms}</p>
      </details>

      {quote.hasPdf && (
        <p className="mt-4 flex flex-wrap items-center gap-3 text-[13px] text-steel">
          <a href={docHref("quote")} className={buttonClass("secondary")} target="_blank" rel="noopener">
            Open quotation PDF
          </a>
          {quote.pdfSha256 && <span className="break-all">PDF fingerprint (SHA-256): {quote.pdfSha256.slice(0, 16)}…</span>}
        </p>
      )}

      {state === "open" && (
        <section aria-labelledby="respond-h" className="mt-8 rounded-sm border border-ink/25 bg-sheet p-4 sm:p-5">
          <h2 id="respond-h" className="plate mb-3 text-[24px] text-ink">
            Respond to this quotation
          </h2>
          <ResponseForm token={token} customerName={quote.customerName} quoteLabel={label} total={fmtMoney(quote.total, cur)} />
        </section>
      )}
    </Shell>
  );
}

function Shell({ children, company }: { children: ReactNode; company?: { name: string; addressLines: string; phone: string | null; email: string | null; isDemo: boolean } }) {
  return (
    <div className="min-h-dvh bg-paper">
      {company?.isDemo && <p className="bg-amber px-4 py-1 text-center text-[12.5px] font-medium text-white">Demonstration data — not a real quotation.</p>}
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
        {company && (
          <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
            <p className="plate text-[26px] leading-none text-ink">{company.name}</p>
            <p className="text-right text-[12.5px] leading-snug text-steel">
              {company.addressLines.split("\n").filter(Boolean).join(", ")}
              {(company.phone || company.email) && <br />}
              {[company.phone, company.email].filter(Boolean).join(" · ")}
            </p>
          </div>
        )}
        <main>{children}</main>
        <footer className="mt-12 border-t border-line pt-4 text-[12px] text-steel">
          {company ? `This page was sent to you by ${company.name} and shows one quotation only. Please don't forward the link — anyone with it can respond.` : null}
        </footer>
      </div>
    </div>
  );
}

function StateBanner({
  state,
  validUntil,
  acceptance,
  confirmationHref,
}: {
  state: string;
  validUntil: string | null;
  acceptance: { byName: string | null; byPosition: string | null; at: Date | null; reference: string | null; countersignedBy: string | null; countersignedAt: Date | null; hasConfirmation: boolean } | null;
  confirmationHref: string;
}) {
  const box = (tone: string, title: string, body?: ReactNode) => (
    <div role="status" className={`mt-5 rounded-sm border-l-4 px-4 py-3 ${tone}`}>
      <p className="font-semibold">{title}</p>
      {body && <div className="mt-1 text-[14px]">{body}</div>}
    </div>
  );
  switch (state) {
    case "open":
      return box("border-dykem bg-dykem-50 text-ink", `Open for your response until ${fmtDate(validUntil)}`, "Review the details below, then accept, ask for changes or decline at the bottom of the page.");
    case "accepted_pending":
      return box(
        "border-green bg-green-50 text-ink",
        "Accepted — thank you",
        <>
          Accepted by {acceptance?.byName}
          {acceptance?.byPosition ? `, ${acceptance.byPosition}` : ""} on {fmtDateTime(acceptance?.at)}
          {acceptance?.reference ? ` (PO ${acceptance.reference})` : ""}. We will countersign it and email you the signed order acceptance.
        </>,
      );
    case "accepted":
      return box(
        "border-green bg-green-50 text-ink",
        "Order confirmed",
        <>
          {acceptance?.byName ? `Accepted by ${acceptance.byName} on ${fmtDateTime(acceptance.at)}. ` : ""}Countersigned by {acceptance?.countersignedBy ?? "us"} on {fmtDateTime(acceptance?.countersignedAt)}.
          {acceptance?.hasConfirmation && (
            <a href={confirmationHref} className="link ml-1" target="_blank" rel="noopener">
              Open the signed order acceptance
            </a>
          )}
        </>,
      );
    case "rejected":
      return box("border-steel bg-line-2 text-ink", "Declined", "This quotation has been declined. Contact us any time if you would like a new quotation.");
    case "withdrawn":
      return box("border-amber bg-amber-50 text-ink", "Replaced by a newer quotation", "Please use the link in the latest quotation email. This revision can no longer be accepted.");
    default:
      return box("border-amber bg-amber-50 text-ink", `Expired on ${fmtDate(validUntil)}`, "This quotation can no longer be accepted online. Contact us for an updated quotation.");
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-steel">
      <dt>{label}</dt>
      <dd className="tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-line pt-2">
      <p className="text-[12px] text-steel">{label}</p>
      <p className="mt-0.5 text-ink">{value}</p>
    </div>
  );
}
