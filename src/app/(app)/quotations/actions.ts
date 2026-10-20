"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/server/action";
import { f } from "@/server/forms";
import { invalid } from "@/server/errors";
import {
  approveAndSend,
  createQuotation,
  createRevision,
  markQuotationSent,
  recordCustomerResponse,
  recordFollowUp,
  removeQuoteLine,
  reviewQuotation,
  saveQuoteLine,
  submitForReview,
  updateRevisionTerms,
  verifyAcceptance,
} from "@/server/services/quotations";
import { getEnquiry } from "@/server/services/enquiries";
import { acceptanceUrl, regenerateAcceptanceLink } from "@/server/services/quote-acceptance";
import { requestBaseUrl } from "@/server/http";
import { trimQty } from "@/lib/decimal";

const TAX = ["standard", "zero", "exempt", "reverse_charge"] as const;
const path = (i: { quotationId: string }) => [`/quotations/${i.quotationId}`, "/quotations"];
/** Back to the quotation showing the new customer link once (the token itself is never stored). */
const showLink = (quotationId: string, url: string | null) => redirect(`/quotations/${quotationId}${url ? `?link=${encodeURIComponent(url.split("/q/")[1])}` : ""}`);

export const createQuotationAction = action(
  "quotation.create",
  z.object({
    enquiryId: f.optUuid(),
    customerId: f.uuid("Select a customer."),
    contactId: f.optUuid(),
    title: f.str("Title is required."),
    currency: f.optStr(),
    taxTreatment: f.enumOf(TAX),
    taxRate: f.optDec(),
    defaultMarginPct: f.dec({ allowNegative: true, msg: "Enter the default margin." }),
    validityDays: f.optInt(),
    leadTime: f.optStr(),
    commercialTerms: f.optStr(),
    deliveryTerms: f.optStr(),
    notes: f.optStr(),
    copyLines: f.bool(),
  }),
  async (ctx, { copyLines, ...i }) => {
    if (i.validityDays !== null && (i.validityDays < 1 || i.validityDays > 365)) throw invalid("Validity must be between 1 and 365 days.", { field: "validityDays" });
    const { quotation, revision } = await createQuotation(ctx, {
      ...i,
      currency: (i.currency ?? "GBP").toUpperCase(),
      taxRate: i.taxRate ?? undefined,
      validityDays: i.validityDays ?? undefined,
    });
    if (copyLines && i.enquiryId) {
      const enq = await getEnquiry(ctx, i.enquiryId);
      for (const l of enq.lines) {
        await saveQuoteLine(ctx, revision.id, {
          partNumber: l.partNumber,
          description: l.description,
          partId: l.partId,
          drawingNumber: l.drawingNumber,
          drawingRevision: l.drawingRevision,
          materialSpec: l.materialGrade,
          quantity: trimQty(l.quantity),
          notes: [l.surfaceFinish && `Finish: ${l.surfaceFinish}`, l.specialRequirements].filter(Boolean).join("\n") || null,
        });
      }
    }
    redirect(`/quotations/${quotation.id}`);
  },
  { revalidate: "/quotations" },
);

const COST_FIELDS = [
  "materialCostPerUnit",
  "materialWastagePct",
  "programmingCost",
  "setupCostPerBatch",
  "labourCost",
  "toolingCost",
  "consumablesCost",
  "subcontractCost",
  "finishingCost",
  "inspectionCost",
  "certificationCost",
  "packagingCost",
  "deliveryCost",
  "otherCost",
] as const;

const lineSchema = z.object({
  quotationId: f.uuid(),
  revisionId: f.uuid(),
  lineId: f.optUuid(),
  partNumber: f.str("Part number is required."),
  description: f.str("Description is required."),
  drawingNumber: f.optStr(),
  drawingRevision: f.optStr(),
  materialSpec: f.optStr(),
  quantity: f.dec({ msg: "Enter a quantity." }),
  batchSize: f.optDec(),
  ...Object.fromEntries(COST_FIELDS.map((k) => [k, f.optDec()])) as Record<(typeof COST_FIELDS)[number], ReturnType<typeof f.optDec>>,
  marginPct: f.optDec({ allowNegative: true }),
  priceOverridePerUnit: f.optDec(),
  priceOverrideReason: f.optStr(),
  notes: f.optStr(),
  ops_desc: f.strs(),
  ops_setup: f.strs(),
  ops_cycle: f.strs(),
  ops_rate: f.strs(),
});

const num = (v: string | undefined) => {
  const s = (v ?? "").trim().replace(/,/g, "");
  return s === "" ? "0" : s;
};

export const saveQuoteLineAction = action(
  "quotation.line_save",
  lineSchema,
  async (ctx, i) => {
    const operations = i.ops_desc
      .map((desc, n) => ({ description: desc.trim(), setupMinutes: num(i.ops_setup[n]), cycleMinutes: num(i.ops_cycle[n]), ratePerHour: num(i.ops_rate[n]) }))
      .filter((o) => o.description);
    operations.forEach((o, n) => {
      for (const [k, v] of [["setup minutes", o.setupMinutes], ["cycle minutes", o.cycleMinutes], ["rate per hour", o.ratePerHour]] as const) {
        if (!/^\d+(\.\d+)?$/.test(v)) throw invalid(`Operation ${n + 1} (${o.description}): enter a valid ${k}.`);
      }
    });
    const costs = Object.fromEntries(COST_FIELDS.map((k) => [k, i[k] ?? "0"])) as Record<(typeof COST_FIELDS)[number], string>;
    const { breakdown } = await saveQuoteLine(
      ctx,
      i.revisionId,
      {
        partNumber: i.partNumber,
        description: i.description,
        drawingNumber: i.drawingNumber,
        drawingRevision: i.drawingRevision,
        materialSpec: i.materialSpec,
        quantity: i.quantity,
        batchSize: i.batchSize,
        ...costs,
        marginPct: i.marginPct,
        priceOverridePerUnit: i.priceOverridePerUnit,
        priceOverrideReason: i.priceOverrideReason,
        notes: i.notes,
        operations,
      },
      i.lineId ?? undefined,
    );
    return `${i.lineId ? "Line updated" : "Line added"} — unit price ${breakdown.unitPrice}, line total ${breakdown.lineTotal}.`;
  },
  { revalidate: path },
);

export const removeQuoteLineAction = action(
  "quotation.line_remove",
  z.object({ quotationId: f.uuid(), lineId: f.uuid() }),
  async (ctx, i) => {
    await removeQuoteLine(ctx, i.lineId);
    return "Line removed.";
  },
  { revalidate: path },
);

export const updateTermsAction = action(
  "quotation.terms",
  z.object({
    quotationId: f.uuid(),
    revisionId: f.uuid(),
    leadTime: f.optStr(),
    commercialTerms: f.optStr(),
    deliveryTerms: f.optStr(),
    notes: f.optStr(),
    internalNotes: f.optStr(),
    validityDays: f.int({ min: 1, max: 365 }),
    taxTreatment: f.enumOf(TAX),
    taxRate: f.dec({ msg: "Enter the tax rate." }),
    defaultMarginPct: f.dec({ allowNegative: true, msg: "Enter the default margin." }),
  }),
  async (ctx, { quotationId: _q, revisionId, ...terms }) => {
    await updateRevisionTerms(ctx, revisionId, terms);
    return "Terms saved. Lines using the default margin were re-priced.";
  },
  { revalidate: path },
);

export const submitForReviewAction = action(
  "quotation.submit_review",
  z.object({ quotationId: f.uuid(), revisionId: f.uuid() }),
  async (ctx, i) => {
    await submitForReview(ctx, i.revisionId);
    return "Submitted for internal review. Reviewers have been notified.";
  },
  { revalidate: path },
);

export const reviewQuotationAction = action(
  "quotation.review",
  z.object({ quotationId: f.uuid(), revisionId: f.uuid(), decision: f.enumOf(["approved", "rejected"] as const), comment: f.optStr(), password: f.str("Enter your password to sign.") }),
  async (ctx, i) => {
    await reviewQuotation(ctx, i.revisionId, { decision: i.decision, comment: i.comment, password: i.password });
    return i.decision === "approved" ? "Approved for issue." : "Returned to draft for correction.";
  },
  { revalidate: path },
);

export const markSentAction = action(
  "quotation.sent",
  z.object({ quotationId: f.uuid(), revisionId: f.uuid(), sentTo: f.str("Record who the quotation was sent to."), emailToCustomer: f.bool(), message: f.optStr() }),
  async (ctx, i) => {
    const res = await markQuotationSent(ctx, i.revisionId, { sentTo: i.sentTo, emailToCustomer: i.emailToCustomer, message: i.message, linkBaseUrl: await requestBaseUrl() });
    showLink(i.quotationId, res.acceptanceUrl);
  },
  { revalidate: path },
);

export const approveAndSendAction = action(
  "quotation.approve_send",
  z.object({
    quotationId: f.uuid(),
    revisionId: f.uuid(),
    sentTo: f.str("Enter who it is going to (email address, or e.g. 'handed to buyer')."),
    emailToCustomer: f.bool(),
    message: f.optStr(),
    comment: f.optStr(),
    password: f.str("Enter your password to sign."),
  }),
  async (ctx, i) => {
    const res = await approveAndSend(ctx, i.revisionId, { sentTo: i.sentTo, emailToCustomer: i.emailToCustomer, message: i.message, comment: i.comment, password: i.password, linkBaseUrl: await requestBaseUrl() });
    showLink(i.quotationId, res.acceptanceUrl);
  },
  { revalidate: path },
);

export const regenerateLinkAction = action(
  "quotation.link",
  z.object({ quotationId: f.uuid(), revisionId: f.uuid() }),
  async (ctx, i) => {
    const token = await regenerateAcceptanceLink(ctx, i.revisionId);
    showLink(i.quotationId, acceptanceUrl(await requestBaseUrl(), token));
  },
  { revalidate: path },
);

export const followUpAction = action(
  "quotation.follow_up",
  z.object({ quotationId: f.uuid(), revisionId: f.uuid(), note: f.str("Describe the follow-up.") }),
  async (ctx, i) => {
    await recordFollowUp(ctx, i.revisionId, i.note);
    return "Follow-up recorded.";
  },
  { revalidate: path },
);

export const recordAcceptanceAction = action(
  "quotation.acceptance",
  z.object({ quotationId: f.uuid(), revisionId: f.uuid(), reference: f.optStr(), feedback: f.optStr(), evidence: f.file() }),
  async (ctx, i) => {
    const res = await recordCustomerResponse(ctx, i.revisionId, { decision: "accepted", reference: i.reference, feedback: i.feedback, evidence: i.evidence ?? null });
    return res?.accepted ? "Accepted. You can now register the customer PO." : "Acceptance recorded. A second person must now verify it.";
  },
  { revalidate: path },
);

export const recordRejectionAction = action(
  "quotation.rejection",
  z.object({ quotationId: f.uuid(), revisionId: f.uuid(), feedback: f.str("Record the customer’s reason, if given, or “No reason given”.") }),
  async (ctx, i) => {
    await recordCustomerResponse(ctx, i.revisionId, { decision: "rejected", feedback: i.feedback });
    return "Rejection recorded.";
  },
  { revalidate: path },
);

export const verifyAcceptanceAction = action(
  "quotation.verify_acceptance",
  z.object({ quotationId: f.uuid(), revisionId: f.uuid(), comment: f.optStr(), password: f.str("Enter your password to sign.") }),
  async (ctx, i) => {
    await verifyAcceptance(ctx, i.revisionId, { password: i.password, comment: i.comment });
    return "Acceptance verified. The customer PO can now be registered against this revision. For an online acceptance, the signed confirmation has been emailed to the customer.";
  },
  { revalidate: path },
);

export const createRevisionAction = action(
  "quotation.revision",
  z.object({ quotationId: f.uuid(), reason: f.str("Explain why a new revision is needed.") }),
  async (ctx, i) => {
    const rev = await createRevision(ctx, i.quotationId, i.reason);
    redirect(`/quotations/${i.quotationId}?rev=${rev.revisionNo}`);
  },
  { revalidate: path },
);
