import { asc, eq } from "drizzle-orm";
import type { Ctx } from "../context";
import { customers, quotationLines, quotationRevisions, quotations, users } from "../db/schema";
import { getSettings } from "../services/settings";
import { formatAddress } from "../services/parties";
import { customerAddress } from "../services/quote-acceptance";
import { fmtDateTime, fmtMoney, fmtQty } from "@/lib/format";
import { companyFromSettings, Doc } from "./layout";

/**
 * Order acceptance confirmation: the customer's online acceptance and our countersignature on one page,
 * sent to both parties. Records exactly which issued PDF (by SHA-256) was accepted.
 */
export async function renderAcceptanceConfirmationPdf(ctx: Ctx, revisionId: string): Promise<Buffer> {
  const [row] = await ctx.db
    .select({ rev: quotationRevisions, q: quotations, c: customers })
    .from(quotationRevisions)
    .innerJoin(quotations, eq(quotations.id, quotationRevisions.quotationId))
    .innerJoin(customers, eq(customers.id, quotations.customerId))
    .where(eq(quotationRevisions.id, revisionId))
    .limit(1);
  const { rev, q, c } = row;
  const settings = await getSettings(ctx.db);
  const lines = await ctx.db.select().from(quotationLines).where(eq(quotationLines.revisionId, revisionId)).orderBy(asc(quotationLines.lineNo));
  const [verifier] = rev.acceptanceVerifiedBy ? await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, rev.acceptanceVerifiedBy)) : [];
  const addr = await customerAddress(ctx.db, c.id);
  const cur = rev.currency;

  const doc = await Doc.create({
    title: "Order acceptance",
    refNo: `${q.ref} / Rev ${rev.revisionNo}`,
    company: companyFromSettings(settings),
    demo: settings.isDemo,
    meta: [
      ["Accepted", fmtDateTime(rev.acceptanceRecordedAt)],
      ["Countersigned", fmtDateTime(rev.acceptanceVerifiedAt)],
      ["Customer PO", rev.acceptanceReference ?? "-"],
      ["Currency", cur],
    ],
  });
  doc.fields([
    ["Customer", `${c.name}\n${formatAddress(addr)}`],
    ["Quotation", `${q.ref} revision ${rev.revisionNo}\n${q.title}`],
  ]);
  doc.gap(8);
  doc.table(
    ["#", "Part number / description", "Qty", "Unit price", "Total"],
    lines.map((l) => [l.lineNo, `${l.partNumber}\n${l.description}`, fmtQty(l.quantity), fmtMoney(l.unitPrice, cur), fmtMoney(l.lineTotal, cur)]),
    [0.05, 0.53, 0.12, 0.15, 0.15],
    { align: ["l", "l", "r", "r", "r"] },
  );
  doc.totals([
    ["Subtotal", fmtMoney(rev.subtotal, cur)],
    ["VAT", fmtMoney(rev.taxAmount, cur)],
    ["Total", fmtMoney(rev.total, cur), true],
  ]);

  doc.heading("Accepted by the customer");
  doc.fields([
    ["Name and position", `${rev.acceptedByName ?? "-"}${rev.acceptedByPosition ? `, ${rev.acceptedByPosition}` : ""}`],
    ["Email", rev.acceptedByEmail],
    ["Accepted at", fmtDateTime(rev.acceptanceRecordedAt)],
    ["From IP address", rev.acceptanceIp],
  ]);
  doc.text(`Accepted online via a secure link issued for this revision only, declaring authority to accept on behalf of ${c.name}.`, { size: 8, color: "steel" });
  doc.text(`Quotation PDF accepted (SHA-256): ${rev.acceptedPdfSha256 ?? "not recorded"}`, { size: 7, color: "steel" });

  doc.heading(`Countersigned for ${settings.companyName}`);
  doc.signatureBox("Order accepted by", verifier?.name, `Signed electronically on ${fmtDateTime(rev.acceptanceVerifiedAt)}`);
  doc.gap(6);
  doc.text(
    "This document records an electronic acceptance (click-to-accept) and an electronic countersignature with re-authentication. It is not a qualified electronic signature. The quotation's terms apply.",
    { size: 7, color: "steel" },
  );
  return doc.save();
}
