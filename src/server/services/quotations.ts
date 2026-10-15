import { and, asc, desc, eq, ilike, inArray, lt, or } from "drizzle-orm";
import { z } from "zod";
import {
  contacts,
  customers,
  enquiries,
  operationTypes,
  quotationLineOperations,
  quotationLines,
  quotationRevisions,
  quotations,
  users,
} from "../db/schema";
import { audit } from "../audit";
import { mutate, requirePermission, type Ctx } from "../context";
import { forbidden, invalid, notFound } from "../errors";
import { nextRef, REF } from "../refs";
import { costLine, quoteTotals, type TaxTreatment } from "@/lib/costing";
import { addDaysISO, todayISO } from "@/lib/format";
import { storeFile, storeUpload } from "../storage";
import { advanceEnquiryStatus } from "./enquiries";
import { getSettings } from "./settings";
import { notify } from "./notifications";
import { signApproval } from "./approvals";
import { queueEmail } from "../integrations/email/outbox";

const OPEN_REV = ["draft", "internal_review", "sent", "awaiting_response"];

export const quotationInput = z.object({
  enquiryId: z.string().uuid().nullish(),
  customerId: z.string().uuid("Select a customer."),
  contactId: z.string().uuid().nullish(),
  title: z.string().trim().min(3, "Title is required."),
  currency: z.string().length(3).default("GBP"),
  taxTreatment: z.enum(["standard", "zero", "exempt", "reverse_charge"]).default("standard"),
  taxRate: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  defaultMarginPct: z.string().regex(/^-?\d+(\.\d+)?$/).default("25"),
  validityDays: z.number().int().min(1).max(365).optional(),
  leadTime: z.string().nullish(),
  commercialTerms: z.string().nullish(),
  deliveryTerms: z.string().nullish(),
  notes: z.string().nullish(),
});

export async function createQuotation(ctx: Ctx, raw: z.input<typeof quotationInput>) {
  requirePermission(ctx, "quotations.manage");
  const data = quotationInput.parse(raw);
  const settings = await getSettings(ctx.db);
  return mutate(ctx, async (tx) => {
    const [cust] = await tx.db.select().from(customers).where(eq(customers.id, data.customerId)).limit(1);
    if (!cust?.isActive) throw invalid("Select an active customer.", { field: "customerId" });
    if (data.enquiryId) {
      const [enq] = await tx.db.select().from(enquiries).where(eq(enquiries.id, data.enquiryId)).limit(1);
      if (!enq) throw invalid("Enquiry not found.");
      if (enq.customerId !== data.customerId) throw invalid("The enquiry belongs to a different customer.");
    }
    const ref = await nextRef(tx.db, REF.quotation);
    const [q] = await tx.db
      .insert(quotations)
      .values({ ref, enquiryId: data.enquiryId ?? null, customerId: data.customerId, contactId: data.contactId ?? null, title: data.title, ownerId: ctx.actor.userId })
      .returning();
    const [rev] = await tx.db
      .insert(quotationRevisions)
      .values({
        quotationId: q.id,
        revisionNo: 1,
        currency: data.currency,
        taxTreatment: data.taxTreatment,
        taxRate: data.taxRate ?? settings.defaultTaxRate,
        defaultMarginPct: data.defaultMarginPct,
        validityDays: data.validityDays ?? settings.quoteValidityDays,
        leadTime: data.leadTime ?? null,
        commercialTerms: data.commercialTerms ?? settings.defaultQuoteTerms,
        deliveryTerms: data.deliveryTerms ?? null,
        notes: data.notes ?? null,
        preparedBy: ctx.actor.userId,
      })
      .returning();
    if (data.enquiryId) await advanceEnquiryStatus(tx, data.enquiryId, "quoting");
    await audit(tx, { action: "quotation.create", entityType: "quotation", entityId: q.id, entityRef: ref, after: { ...data, revisionId: rev.id } });
    return { quotation: q, revision: rev };
  });
}

async function loadRevision(ctx: Ctx, revisionId: string) {
  const [row] = await ctx.db
    .select({ rev: quotationRevisions, q: quotations })
    .from(quotationRevisions)
    .innerJoin(quotations, eq(quotations.id, quotationRevisions.quotationId))
    .where(eq(quotationRevisions.id, revisionId))
    .limit(1);
  if (!row) throw notFound("Quotation revision");
  return row;
}

function assertEditable(rev: typeof quotationRevisions.$inferSelect) {
  if (rev.isLocked || rev.status !== "draft") throw invalid(`Revision ${rev.revisionNo} is ${rev.status.replace("_", " ")} and locked. Create a new revision to make changes.`);
}

export const quoteLineInput = z.object({
  partNumber: z.string().trim().min(1, "Part number is required."),
  description: z.string().trim().min(1, "Description is required."),
  partId: z.string().uuid().nullish(),
  drawingNumber: z.string().trim().nullish(),
  drawingRevision: z.string().trim().nullish(),
  drawingRevisionId: z.string().uuid().nullish(),
  materialSpec: z.string().trim().nullish(),
  quantity: z.string().regex(/^\d+(\.\d+)?$/, "Enter a quantity."),
  batchSize: z.string().regex(/^\d+(\.\d+)?$/).nullish(),
  materialCostPerUnit: z.string().default("0"),
  materialWastagePct: z.string().default("0"),
  programmingCost: z.string().default("0"),
  setupCostPerBatch: z.string().default("0"),
  labourCost: z.string().default("0"),
  toolingCost: z.string().default("0"),
  consumablesCost: z.string().default("0"),
  subcontractCost: z.string().default("0"),
  finishingCost: z.string().default("0"),
  inspectionCost: z.string().default("0"),
  certificationCost: z.string().default("0"),
  packagingCost: z.string().default("0"),
  deliveryCost: z.string().default("0"),
  otherCost: z.string().default("0"),
  marginPct: z.string().nullish(),
  priceOverridePerUnit: z.string().nullish(),
  priceOverrideReason: z.string().nullish(),
  notes: z.string().nullish(),
  operations: z
    .array(z.object({ operationTypeId: z.string().uuid().nullish(), description: z.string().min(1), setupMinutes: z.string().default("0"), cycleMinutes: z.string().default("0"), ratePerHour: z.string().default("0") }))
    .default([]),
});
export type QuoteLineInput = z.input<typeof quoteLineInput>;

/** Adds or replaces a line (with its operation estimates) and recalculates the revision totals. */
export async function saveQuoteLine(ctx: Ctx, revisionId: string, raw: QuoteLineInput, lineId?: string) {
  requirePermission(ctx, "quotations.manage");
  const l = quoteLineInput.parse(raw);
  if (l.priceOverridePerUnit && !l.priceOverrideReason?.trim()) throw invalid("Give a reason for overriding the calculated price.", { field: "priceOverrideReason" });
  return mutate(ctx, async (tx) => {
    const { rev, q } = await loadRevision(tx, revisionId);
    assertEditable(rev);
    let breakdown;
    try {
      breakdown = costLine({ ...l, operations: l.operations }, rev.defaultMarginPct);
    } catch (e) {
      throw invalid((e as Error).message);
    }
    const values = {
      ...l,
      operations: undefined,
      revisionId,
      batchSize: l.batchSize ?? null,
      marginPct: l.marginPct || null,
      priceOverridePerUnit: l.priceOverridePerUnit || null,
      machiningCost: breakdown.machiningCost,
      totalCost: breakdown.totalCost,
      unitCost: breakdown.unitCost,
      unitPrice: breakdown.unitPrice,
      lineTotal: breakdown.lineTotal,
    };
    delete (values as Record<string, unknown>).operations;
    let id = lineId;
    if (id) {
      const [existing] = await tx.db.select().from(quotationLines).where(and(eq(quotationLines.id, id), eq(quotationLines.revisionId, revisionId))).limit(1);
      if (!existing) throw notFound("Quotation line");
      await tx.db.update(quotationLines).set(values).where(eq(quotationLines.id, id));
      await tx.db.delete(quotationLineOperations).where(eq(quotationLineOperations.lineId, id));
    } else {
      const existing = await tx.db.select({ n: quotationLines.lineNo }).from(quotationLines).where(eq(quotationLines.revisionId, revisionId));
      const [row] = await tx.db
        .insert(quotationLines)
        .values({ ...values, lineNo: Math.max(0, ...existing.map((x) => x.n)) + 1 })
        .returning();
      id = row.id;
    }
    if (l.operations.length) {
      await tx.db.insert(quotationLineOperations).values(l.operations.map((o, i) => ({ ...o, operationTypeId: o.operationTypeId ?? null, lineId: id!, seq: (i + 1) * 10 })));
    }
    await recalcRevision(tx, revisionId);
    await audit(tx, { action: lineId ? "quotation.line_update" : "quotation.line_add", entityType: "quotation", entityId: q.id, entityRef: `${q.ref} rev ${rev.revisionNo}`, after: { ...l, breakdown } });
    return { lineId: id!, breakdown };
  });
}

export async function removeQuoteLine(ctx: Ctx, lineId: string) {
  requirePermission(ctx, "quotations.manage");
  return mutate(ctx, async (tx) => {
    const [line] = await tx.db.select().from(quotationLines).where(eq(quotationLines.id, lineId)).limit(1);
    if (!line) throw notFound("Quotation line");
    const { rev, q } = await loadRevision(tx, line.revisionId);
    assertEditable(rev);
    await tx.db.delete(quotationLineOperations).where(eq(quotationLineOperations.lineId, lineId));
    await tx.db.delete(quotationLines).where(eq(quotationLines.id, lineId));
    await recalcRevision(tx, rev.id);
    await audit(tx, { action: "quotation.line_remove", entityType: "quotation", entityId: q.id, entityRef: `${q.ref} rev ${rev.revisionNo}`, before: line });
  });
}

async function recalcRevision(ctx: Ctx, revisionId: string) {
  const [rev] = await ctx.db.select().from(quotationRevisions).where(eq(quotationRevisions.id, revisionId)).limit(1);
  const lines = await ctx.db.select().from(quotationLines).where(eq(quotationLines.revisionId, revisionId));
  const t = quoteTotals(lines.map((l) => l.lineTotal), lines.map((l) => l.totalCost), rev.taxTreatment as TaxTreatment, rev.taxRate);
  await ctx.db.update(quotationRevisions).set(t).where(eq(quotationRevisions.id, revisionId));
}

export async function updateRevisionTerms(
  ctx: Ctx,
  revisionId: string,
  raw: { leadTime?: string | null; commercialTerms?: string | null; deliveryTerms?: string | null; notes?: string | null; internalNotes?: string | null; validityDays?: number; taxTreatment?: string; taxRate?: string; defaultMarginPct?: string },
) {
  requirePermission(ctx, "quotations.manage");
  return mutate(ctx, async (tx) => {
    const { rev, q } = await loadRevision(tx, revisionId);
    assertEditable(rev);
    const patch = {
      ...raw,
      taxTreatment: raw.taxTreatment ? z.enum(["standard", "zero", "exempt", "reverse_charge"]).parse(raw.taxTreatment) : undefined,
    };
    await tx.db.update(quotationRevisions).set(patch).where(eq(quotationRevisions.id, revisionId));
    if (raw.defaultMarginPct !== undefined && raw.defaultMarginPct !== rev.defaultMarginPct) {
      // Re-cost lines that use the default margin.
      const lines = await tx.db.select().from(quotationLines).where(eq(quotationLines.revisionId, revisionId));
      for (const line of lines.filter((x) => !x.marginPct)) {
        const ops = await tx.db.select().from(quotationLineOperations).where(eq(quotationLineOperations.lineId, line.id));
        const b = costLine({ ...line, operations: ops }, raw.defaultMarginPct);
        await tx.db.update(quotationLines).set({ machiningCost: b.machiningCost, totalCost: b.totalCost, unitCost: b.unitCost, unitPrice: b.unitPrice, lineTotal: b.lineTotal }).where(eq(quotationLines.id, line.id));
      }
    }
    await recalcRevision(tx, revisionId);
    await audit(tx, { action: "quotation.terms_update", entityType: "quotation", entityId: q.id, entityRef: `${q.ref} rev ${rev.revisionNo}`, before: rev, after: patch });
  });
}

export async function submitForReview(ctx: Ctx, revisionId: string) {
  requirePermission(ctx, "quotations.manage");
  return mutate(ctx, async (tx) => {
    const { rev, q } = await loadRevision(tx, revisionId);
    if (rev.status !== "draft") throw invalid("Only draft revisions can be submitted for review.");
    const lines = await tx.db.select({ id: quotationLines.id }).from(quotationLines).where(eq(quotationLines.revisionId, revisionId));
    if (!lines.length) throw invalid("Add at least one line before submitting.");
    await tx.db.update(quotationRevisions).set({ status: "internal_review", submittedForReviewAt: new Date() }).where(eq(quotationRevisions.id, revisionId));
    await tx.db.update(quotations).set({ status: "internal_review" }).where(eq(quotations.id, q.id));
    await audit(tx, { action: "quotation.submit_review", entityType: "quotation", entityId: q.id, entityRef: `${q.ref} rev ${rev.revisionNo}` });
    await notify(tx, { type: "quotation.review", title: `Quotation ${q.ref} rev ${rev.revisionNo} awaiting approval`, body: q.title, link: `/quotations/${q.id}`, permission: "quotations.review", excludeActor: true, dedupeKey: `qrev:${rev.id}` });
  });
}

/** Internal approval (signed). Approver must differ from the preparer when independence is required. */
export async function reviewQuotation(ctx: Ctx, revisionId: string, input: { decision: "approved" | "rejected"; comment?: string | null; password: string }) {
  requirePermission(ctx, "quotations.review");
  const settings = await getSettings(ctx.db);
  return mutate(ctx, async (tx) => {
    const { rev, q } = await loadRevision(tx, revisionId);
    if (rev.status !== "internal_review") throw invalid("This revision is not awaiting internal review.");
    if (settings.requireIndependentApproval && rev.preparedBy === ctx.actor.userId) throw forbidden("Independent approval is required: you prepared this quotation.");
    if (input.decision === "rejected" && !input.comment?.trim()) throw invalid("Explain why the quotation is being returned.", { field: "comment" });
    const approval = await signApproval(tx, {
      kind: "quotation.review",
      entityType: "quotation_revision",
      entityId: rev.id,
      decision: input.decision,
      meaning:
        input.decision === "approved"
          ? `I have reviewed ${q.ref} revision ${rev.revisionNo} (pricing, capability, lead time and terms) and approve it for issue to the customer.`
          : `I return ${q.ref} revision ${rev.revisionNo} for correction.`,
      comment: input.comment,
      password: input.password,
    });
    if (input.decision === "approved") {
      await tx.db.update(quotationRevisions).set({ reviewedBy: ctx.actor.userId, reviewedAt: new Date(), reviewApprovalId: approval.id }).where(eq(quotationRevisions.id, rev.id));
    } else {
      await tx.db.update(quotationRevisions).set({ status: "draft", reviewedBy: null, reviewedAt: null }).where(eq(quotationRevisions.id, rev.id));
      await tx.db.update(quotations).set({ status: "draft" }).where(eq(quotations.id, q.id));
    }
    await audit(tx, { action: `quotation.review_${input.decision}`, entityType: "quotation", entityId: q.id, entityRef: `${q.ref} rev ${rev.revisionNo}`, approvalId: approval.id, reason: input.comment });
  });
}

/**
 * Marks a reviewed revision as sent: locks it, stamps validity, stores the issued PDF.
 * Optionally queues an email to the customer contact with the PDF attached.
 */
export async function markQuotationSent(ctx: Ctx, revisionId: string, input: { sentTo: string; emailToCustomer?: boolean; message?: string | null }) {
  requirePermission(ctx, "quotations.send");
  if (!input.sentTo?.trim()) throw invalid("Record who the quotation was sent to.", { field: "sentTo" });
  const { renderQuotationPdf } = await import("../pdf/quotation");
  return mutate(ctx, async (tx) => {
    const { rev, q } = await loadRevision(tx, revisionId);
    if (rev.status !== "internal_review" || !rev.reviewedAt) throw invalid("The quotation must be approved in internal review before it is sent.");
    const today = todayISO();
    const validUntil = addDaysISO(today, rev.validityDays);
    await tx.db.update(quotationRevisions).set({ status: "sent", isLocked: true, sentAt: new Date(), sentBy: ctx.actor.userId, sentTo: input.sentTo.trim(), validUntil }).where(eq(quotationRevisions.id, rev.id));
    await tx.db.update(quotations).set({ status: "sent" }).where(eq(quotations.id, q.id));
    const pdf = await renderQuotationPdf(tx, rev.id);
    const file = await storeFile(tx.db, { bytes: pdf, name: `${q.ref}-rev${rev.revisionNo}.pdf`, mimeType: "application/pdf", uploadedBy: ctx.actor.userId });
    await tx.db.update(quotationRevisions).set({ pdfFileId: file.id }).where(eq(quotationRevisions.id, rev.id));
    // Earlier open revisions are superseded by the issued one.
    await tx.db
      .update(quotationRevisions)
      .set({ status: "superseded" })
      .where(and(eq(quotationRevisions.quotationId, q.id), lt(quotationRevisions.revisionNo, rev.revisionNo), inArray(quotationRevisions.status, OPEN_REV)));
    if (q.enquiryId) await advanceEnquiryStatus(tx, q.enquiryId, "quoted");
    if (input.emailToCustomer) {
      const to = input.sentTo.includes("@") ? [input.sentTo.trim()] : [];
      if (!to.length) throw invalid("Enter the customer email address to email the quotation.", { field: "sentTo" });
      await queueEmail(tx.db, {
        idempotencyKey: `quote-sent:${rev.id}`,
        to,
        subject: `Quotation ${q.ref} rev ${rev.revisionNo} — ${q.title}`,
        html: `<p>Please find attached our quotation ${q.ref} revision ${rev.revisionNo}.</p>${input.message ? `<p>${input.message.replace(/</g, "&lt;")}</p>` : ""}<p>The quotation is valid until ${validUntil}.</p>`,
        text: `Please find attached our quotation ${q.ref} revision ${rev.revisionNo}. Valid until ${validUntil}.`,
        attachmentFileIds: [file.id],
      });
    }
    await audit(tx, { action: "quotation.sent", entityType: "quotation", entityId: q.id, entityRef: `${q.ref} rev ${rev.revisionNo}`, after: { sentTo: input.sentTo, validUntil, pdfFileId: file.id, sha256: file.sha256, emailed: !!input.emailToCustomer } });
    return { fileId: file.id, validUntil };
  });
}

export async function recordFollowUp(ctx: Ctx, revisionId: string, note: string) {
  requirePermission(ctx, "quotations.send");
  return mutate(ctx, async (tx) => {
    const { rev, q } = await loadRevision(tx, revisionId);
    if (!["sent", "awaiting_response"].includes(rev.status)) throw invalid("Only sent quotations can be followed up.");
    await tx.db.update(quotationRevisions).set({ status: "awaiting_response", customerFeedback: [rev.customerFeedback, `${todayISO()}: ${note}`].filter(Boolean).join("\n") }).where(eq(quotationRevisions.id, rev.id));
    await tx.db.update(quotations).set({ status: "awaiting_response" }).where(eq(quotations.id, q.id));
    await audit(tx, { action: "quotation.follow_up", entityType: "quotation", entityId: q.id, entityRef: `${q.ref} rev ${rev.revisionNo}`, reason: note });
  });
}

/**
 * Records the customer's response. An ACCEPTANCE is only recorded here (with evidence or
 * a reference); it becomes confirmed when a second person verifies it (verifyAcceptance).
 */
export async function recordCustomerResponse(
  ctx: Ctx,
  revisionId: string,
  input: { decision: "accepted" | "rejected"; feedback?: string | null; reference?: string | null; evidence?: File | null; evidenceFileId?: string | null },
) {
  requirePermission(ctx, "quotations.record_response");
  return mutate(ctx, async (tx) => {
    const { rev, q } = await loadRevision(tx, revisionId);
    if (!["sent", "awaiting_response"].includes(rev.status)) throw invalid("Responses can only be recorded for sent quotations.");
    if (rev.validUntil && rev.validUntil < todayISO() && input.decision === "accepted") {
      throw invalid(`This quotation expired on ${rev.validUntil}. Issue a new revision before accepting.`);
    }
    if (input.decision === "rejected") {
      await tx.db.update(quotationRevisions).set({ status: "rejected", customerFeedback: input.feedback ?? null, respondedAt: new Date() }).where(eq(quotationRevisions.id, rev.id));
      await tx.db.update(quotations).set({ status: "rejected" }).where(eq(quotations.id, q.id));
      if (q.enquiryId) await advanceEnquiryStatus(tx, q.enquiryId, "lost");
      await audit(tx, { action: "quotation.rejected_by_customer", entityType: "quotation", entityId: q.id, entityRef: `${q.ref} rev ${rev.revisionNo}`, reason: input.feedback });
      return;
    }
    let evidenceId = input.evidenceFileId ?? null;
    if (input.evidence && input.evidence.size > 0) evidenceId = (await storeUpload(tx.db, input.evidence, ctx.actor.userId, { isCustomerOriginal: true })).id;
    if (!evidenceId && !input.reference?.trim()) {
      throw invalid("Attach the acceptance evidence (e.g. the customer's email or PO) or record its reference.", { field: "evidence" });
    }
    await tx.db
      .update(quotationRevisions)
      .set({ acceptanceEvidenceFileId: evidenceId, acceptanceReference: input.reference ?? null, acceptanceRecordedBy: ctx.actor.userId, acceptanceRecordedAt: new Date(), customerFeedback: input.feedback ?? rev.customerFeedback, respondedAt: new Date(), status: "awaiting_response" })
      .where(eq(quotationRevisions.id, rev.id));
    await audit(tx, { action: "quotation.acceptance_recorded", entityType: "quotation", entityId: q.id, entityRef: `${q.ref} rev ${rev.revisionNo}`, after: { evidenceFileId: evidenceId, reference: input.reference } });
  });
}

/** Second-person verification that the recorded acceptance is genuine and matches the issued revision. */
export async function verifyAcceptance(ctx: Ctx, revisionId: string, input: { password: string; comment?: string | null }) {
  requirePermission(ctx, "quotations.verify_acceptance");
  return mutate(ctx, async (tx) => {
    const { rev, q } = await loadRevision(tx, revisionId);
    if (!rev.acceptanceRecordedAt) throw invalid("No customer acceptance has been recorded for this revision.");
    if (rev.acceptanceVerifiedAt) throw invalid("Acceptance is already verified.");
    if (rev.acceptanceRecordedBy === ctx.actor.userId) throw forbidden("A different person must verify the acceptance you recorded.");
    const approval = await signApproval(tx, {
      kind: "quotation.acceptance_verify",
      entityType: "quotation_revision",
      entityId: rev.id,
      decision: "approved",
      meaning: `I have checked the customer's acceptance evidence against ${q.ref} revision ${rev.revisionNo} (price, quantity, revision, terms) and confirm the acceptance.`,
      comment: input.comment,
      password: input.password,
    });
    await tx.db.update(quotationRevisions).set({ status: "accepted", acceptanceVerifiedBy: ctx.actor.userId, acceptanceVerifiedAt: new Date() }).where(eq(quotationRevisions.id, rev.id));
    await tx.db.update(quotations).set({ status: "accepted" }).where(eq(quotations.id, q.id));
    if (q.enquiryId) await advanceEnquiryStatus(tx, q.enquiryId, "won");
    await audit(tx, { action: "quotation.accepted", entityType: "quotation", entityId: q.id, entityRef: `${q.ref} rev ${rev.revisionNo}`, approvalId: approval.id });
  });
}

/** New revision copied from the latest; earlier open revisions become superseded when it is sent. */
export async function createRevision(ctx: Ctx, quotationId: string, reason: string) {
  requirePermission(ctx, "quotations.manage");
  if (!reason?.trim()) throw invalid("Explain why a new revision is needed.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const [q] = await tx.db.select().from(quotations).where(eq(quotations.id, quotationId)).limit(1);
    if (!q) throw notFound("Quotation");
    const revs = await tx.db.select().from(quotationRevisions).where(eq(quotationRevisions.quotationId, quotationId)).orderBy(desc(quotationRevisions.revisionNo));
    const latest = revs[0];
    if (revs.some((r) => r.status === "accepted")) throw invalid("This quotation has an accepted revision. Raise a new quotation for further changes.");
    if (latest.status === "draft") throw invalid(`Revision ${latest.revisionNo} is still a draft — edit it instead.`);
    const no = latest.revisionNo + 1;
    const { id: _id, createdAt: _c, ...copy } = latest;
    const [rev] = await tx.db
      .insert(quotationRevisions)
      .values({
        ...copy,
        revisionNo: no,
        status: "draft",
        isLocked: false,
        preparedBy: ctx.actor.userId,
        submittedForReviewAt: null,
        reviewedBy: null,
        reviewedAt: null,
        reviewApprovalId: null,
        sentAt: null,
        sentBy: null,
        sentTo: null,
        pdfFileId: null,
        validUntil: null,
        customerFeedback: null,
        respondedAt: null,
        acceptanceEvidenceFileId: null,
        acceptanceRecordedBy: null,
        acceptanceRecordedAt: null,
        acceptanceVerifiedBy: null,
        acceptanceVerifiedAt: null,
        acceptanceReference: null,
        internalNotes: `Revision ${no}: ${reason}`,
      })
      .returning();
    const lines = await tx.db.select().from(quotationLines).where(eq(quotationLines.revisionId, latest.id));
    for (const l of lines) {
      const { id: oldId, ...lc } = l;
      const [nl] = await tx.db.insert(quotationLines).values({ ...lc, revisionId: rev.id }).returning();
      const ops = await tx.db.select().from(quotationLineOperations).where(eq(quotationLineOperations.lineId, oldId));
      if (ops.length) await tx.db.insert(quotationLineOperations).values(ops.map(({ id: _o, ...o }) => ({ ...o, lineId: nl.id })));
    }
    if (["internal_review"].includes(latest.status)) await tx.db.update(quotationRevisions).set({ status: "superseded" }).where(eq(quotationRevisions.id, latest.id));
    await tx.db.update(quotations).set({ latestRevisionNo: no, status: "draft" }).where(eq(quotations.id, quotationId));
    await audit(tx, { action: "quotation.revision_create", entityType: "quotation", entityId: q.id, entityRef: `${q.ref} rev ${no}`, reason });
    return rev;
  });
}

/** Scheduled: marks sent quotations past their validity date as expired. */
export async function expireQuotations(ctx: Ctx) {
  const today = todayISO();
  const due = await ctx.db
    .select({ rev: quotationRevisions, q: quotations })
    .from(quotationRevisions)
    .innerJoin(quotations, eq(quotations.id, quotationRevisions.quotationId))
    .where(and(inArray(quotationRevisions.status, ["sent", "awaiting_response"]), lt(quotationRevisions.validUntil, today)));
  for (const { rev, q } of due) {
    if (rev.acceptanceRecordedAt) continue; // acceptance recorded within validity — awaiting verification
    await mutate(ctx, async (tx) => {
      await tx.db.update(quotationRevisions).set({ status: "expired" }).where(eq(quotationRevisions.id, rev.id));
      await tx.db.update(quotations).set({ status: "expired" }).where(eq(quotations.id, q.id));
      await audit(tx, { action: "quotation.expired", entityType: "quotation", entityId: q.id, entityRef: `${q.ref} rev ${rev.revisionNo}`, reason: `Validity ended ${rev.validUntil}` });
    });
  }
  return due.length;
}

export async function listQuotations(ctx: Ctx, opts: { q?: string; status?: string; customerId?: string } = {}) {
  requirePermission(ctx, "quotations.view");
  const q = opts.q?.trim();
  const rows = await ctx.db
    .select({ quote: quotations, customer: customers.name, customerCode: customers.code, owner: users.name })
    .from(quotations)
    .innerJoin(customers, eq(customers.id, quotations.customerId))
    .leftJoin(users, eq(users.id, quotations.ownerId))
    .where(
      and(
        opts.status ? eq(quotations.status, opts.status) : undefined,
        opts.customerId ? eq(quotations.customerId, opts.customerId) : undefined,
        q ? or(ilike(quotations.ref, `%${q}%`), ilike(quotations.title, `%${q}%`), ilike(customers.name, `%${q}%`)) : undefined,
      ),
    )
    .orderBy(desc(quotations.createdAt))
    .limit(300);
  const revs = rows.length
    ? await ctx.db.select().from(quotationRevisions).where(inArray(quotationRevisions.quotationId, rows.map((r) => r.quote.id)))
    : [];
  return rows.map((r) => {
    const latest = revs.filter((x) => x.quotationId === r.quote.id).sort((a, b) => b.revisionNo - a.revisionNo)[0];
    return { ...r, latest };
  });
}

export async function getQuotation(ctx: Ctx, id: string) {
  requirePermission(ctx, "quotations.view");
  const [row] = await ctx.db
    .select({ q: quotations, customer: customers, contact: contacts, enquiry: enquiries })
    .from(quotations)
    .innerJoin(customers, eq(customers.id, quotations.customerId))
    .leftJoin(contacts, eq(contacts.id, quotations.contactId))
    .leftJoin(enquiries, eq(enquiries.id, quotations.enquiryId))
    .where(eq(quotations.id, id))
    .limit(1);
  if (!row) throw notFound("Quotation");
  const revisions = await ctx.db.select().from(quotationRevisions).where(eq(quotationRevisions.quotationId, id)).orderBy(desc(quotationRevisions.revisionNo));
  const revIds = revisions.map((r) => r.id);
  const lines = revIds.length ? await ctx.db.select().from(quotationLines).where(inArray(quotationLines.revisionId, revIds)).orderBy(asc(quotationLines.lineNo)) : [];
  const ops = lines.length
    ? await ctx.db
        .select({ op: quotationLineOperations, type: operationTypes.name })
        .from(quotationLineOperations)
        .leftJoin(operationTypes, eq(operationTypes.id, quotationLineOperations.operationTypeId))
        .where(inArray(quotationLineOperations.lineId, lines.map((l) => l.id)))
        .orderBy(asc(quotationLineOperations.seq))
    : [];
  const people = await ctx.db.select({ id: users.id, name: users.name }).from(users);
  const name = (uid: string | null) => people.find((p) => p.id === uid)?.name ?? null;
  return {
    ...row,
    revisions: revisions.map((r) => ({
      ...r,
      preparedByName: name(r.preparedBy),
      reviewedByName: name(r.reviewedBy),
      sentByName: name(r.sentBy),
      acceptanceRecordedByName: name(r.acceptanceRecordedBy),
      acceptanceVerifiedByName: name(r.acceptanceVerifiedBy),
      lines: lines.filter((l) => l.revisionId === r.id).map((l) => ({ ...l, operations: ops.filter((o) => o.op.lineId === l.id) })),
    })),
  };
}
