import { asc, eq } from "drizzle-orm";
import type { Ctx } from "../context";
import { addresses, contacts, customers, enquiries, quotationLines, quotationRevisions, quotations, users } from "../db/schema";
import { getSettings } from "../services/settings";
import { formatAddress } from "../services/parties";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/format";
import { trimQty } from "@/lib/decimal";
import { companyFromSettings, Doc } from "./layout";

export async function renderQuotationPdf(ctx: Ctx, revisionId: string): Promise<Buffer> {
  const [row] = await ctx.db
    .select({ rev: quotationRevisions, q: quotations, c: customers, contact: contacts, enq: enquiries })
    .from(quotationRevisions)
    .innerJoin(quotations, eq(quotations.id, quotationRevisions.quotationId))
    .innerJoin(customers, eq(customers.id, quotations.customerId))
    .leftJoin(contacts, eq(contacts.id, quotations.contactId))
    .leftJoin(enquiries, eq(enquiries.id, quotations.enquiryId))
    .where(eq(quotationRevisions.id, revisionId))
    .limit(1);
  const settings = await getSettings(ctx.db);
  const lines = await ctx.db.select().from(quotationLines).where(eq(quotationLines.revisionId, revisionId)).orderBy(asc(quotationLines.lineNo));
  const [addr] = await ctx.db.select().from(addresses).where(eq(addresses.customerId, row.c.id)).orderBy(asc(addresses.kind)).limit(1);
  const [preparer] = row.rev.preparedBy ? await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, row.rev.preparedBy)) : [];
  const [reviewer] = row.rev.reviewedBy ? await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, row.rev.reviewedBy)) : [];
  const cur = row.rev.currency;

  const doc = await Doc.create({
    title: "Quotation",
    refNo: `${row.q.ref} / Rev ${row.rev.revisionNo}`,
    company: companyFromSettings(settings),
    demo: settings.isDemo,
    meta: [
      ["Date", fmtDate(row.rev.sentAt ?? new Date())],
      ["Valid until", fmtDate(row.rev.validUntil)],
      ["Your reference", row.enq?.customerReference ?? row.enq?.ref ?? "-"],
      ["Currency", cur],
    ],
  });
  doc.fields(
    [
      ["Customer", `${row.c.name}\n${formatAddress(addr)}`],
      ["For the attention of", row.contact ? `${row.contact.name}${row.contact.email ? `\n${row.contact.email}` : ""}` : "-"],
    ],
    2,
  );
  doc.heading(row.q.title);
  doc.table(
    ["#", "Part number / description", "Drawing", "Material", "Qty", "Unit price", "Total"],
    lines.map((l) => [
      l.lineNo,
      `${l.partNumber}\n${l.description}`,
      [l.drawingNumber, l.drawingRevision ? `Rev ${l.drawingRevision}` : null].filter(Boolean).join(" "),
      l.materialSpec ?? "",
      fmtQty(l.quantity),
      fmtMoney(l.unitPrice, cur),
      fmtMoney(l.lineTotal, cur),
    ]),
    [0.04, 0.34, 0.14, 0.14, 0.08, 0.13, 0.13],
    { align: ["l", "l", "l", "l", "r", "r", "r"] },
  );
  const taxLabel = row.rev.taxTreatment === "standard" ? `VAT @ ${trimQty(row.rev.taxRate)}%` : row.rev.taxTreatment === "reverse_charge" ? "VAT (reverse charge)" : row.rev.taxTreatment === "zero" ? "VAT (zero-rated)" : "VAT (exempt)";
  doc.totals([
    ["Subtotal", fmtMoney(row.rev.subtotal, cur)],
    [taxLabel, fmtMoney(row.rev.taxAmount, cur)],
    ["Total", fmtMoney(row.rev.total, cur), true],
  ]);
  doc.gap(6);
  doc.fields([
    ["Lead time", row.rev.leadTime ?? "To be confirmed on order"],
    ["Delivery terms", row.rev.deliveryTerms ?? "Ex works"],
  ]);
  if (row.rev.notes) {
    doc.heading("Notes");
    doc.text(row.rev.notes);
  }
  doc.heading("Terms");
  doc.text(row.rev.commercialTerms || settings.defaultQuoteTerms || "Our standard terms and conditions of sale apply.", { size: 8, color: "steel" });
  doc.gap(10);
  doc.signatureBox("Prepared by", preparer?.name, reviewer ? `Approved by ${reviewer.name} on ${fmtDate(row.rev.reviewedAt)}` : null);
  return doc.save();
}
