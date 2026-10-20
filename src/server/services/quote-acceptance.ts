/**
 * Customer self-service acceptance of an issued quotation ("mutual acceptance"):
 *   1. Sending a revision issues a secure link (only the token's SHA-256 is stored).
 *   2. The customer reviews that exact revision and accepts (named signatory, position, email, PO),
 *      rejects, or requests changes — no account needed.
 *   3. An online acceptance is recorded as the customer's acceptance; our existing second-person
 *      verification becomes the countersignature, which produces a confirmation PDF for both parties.
 * Click-to-accept is an electronic acceptance, not a qualified electronic signature, and is labelled so.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { addresses, customers, files, quotationLines, quotationRevisions, quotations, quoteAcceptanceLinks, users } from "../db/schema";
import { audit } from "../audit";
import { mutate, requirePermission, type Ctx } from "../context";
import { invalid, notFound } from "../errors";
import { newToken, sha256 } from "../auth/password";
import { getSystemUserId } from "../bootstrap";
import { ALL_PERMISSIONS } from "../auth/permissions";
import { storeUpload } from "../storage";
import { getSettings } from "./settings";
import { advanceEnquiryStatus } from "./enquiries";
import { notify } from "./notifications";
import { addDaysISO, todayISO, zonedToUtc } from "@/lib/format";

/** Customer actions run as the system user (a local copy avoids an import cycle with jobs/scheduled). */
async function systemCtx(db: DB): Promise<Ctx> {
  const id = await getSystemUserId(db);
  return { db, actor: { userId: id, name: "System (customer link)", email: "system", employeeId: null, roles: ["system"], permissions: new Set<string>(ALL_PERMISSIONS), isSystem: true } };
}

/** Read-only access (status, PDFs) continues this long after the response deadline. */
const VIEW_GRACE_DAYS = 90;

export function acceptanceUrl(baseUrl: string, token: string) {
  return `${baseUrl.replace(/\/$/, "")}/q/${token}`;
}

/**
 * Issues a link for a sent revision and revokes every earlier link for the same quotation, so only the
 * current revision can be accepted. Call inside the sending transaction. Returns the plaintext token,
 * which is never stored.
 */
export async function issueAcceptanceLinkTx(tx: Ctx, rev: { id: string; quotationId: string; validUntil: string | null }) {
  if (!rev.validUntil) throw invalid("The revision has no validity date.");
  const siblings = await tx.db.select({ id: quotationRevisions.id }).from(quotationRevisions).where(eq(quotationRevisions.quotationId, rev.quotationId));
  for (const s of siblings) {
    await tx.db
      .update(quoteAcceptanceLinks)
      .set({ revokedAt: new Date() })
      .where(and(eq(quoteAcceptanceLinks.revisionId, s.id), isNull(quoteAcceptanceLinks.revokedAt)));
  }
  const { token, hash } = newToken(32);
  // Responses accepted until the end of the last valid day in the company's timezone.
  const expiresAt = zonedToUtc(addDaysISO(rev.validUntil, 1), "00:00");
  const viewUntil = new Date(expiresAt.getTime() + VIEW_GRACE_DAYS * 86_400_000);
  await tx.db.insert(quoteAcceptanceLinks).values({ revisionId: rev.id, tokenHash: hash, createdBy: tx.actor.userId, expiresAt, viewUntil });
  return token;
}

/** Staff: replace the customer link (e.g. it was lost, or sent to the wrong person). */
export async function regenerateAcceptanceLink(ctx: Ctx, revisionId: string) {
  requirePermission(ctx, "quotations.send");
  return mutate(ctx, async (tx) => {
    const [row] = await tx.db
      .select({ rev: quotationRevisions, q: quotations })
      .from(quotationRevisions)
      .innerJoin(quotations, eq(quotations.id, quotationRevisions.quotationId))
      .where(eq(quotationRevisions.id, revisionId))
      .limit(1);
    if (!row) throw notFound("Quotation revision");
    const { rev, q } = row;
    if (!["sent", "awaiting_response"].includes(rev.status) || rev.acceptanceRecordedAt) throw invalid("A customer link can only be issued for a sent revision that has no recorded response.");
    if (rev.validUntil && rev.validUntil < todayISO()) throw invalid(`This revision expired on ${rev.validUntil}. Create a new revision instead.`);
    const token = await issueAcceptanceLinkTx(tx, rev);
    await audit(tx, { action: "quotation.acceptance_link_issued", entityType: "quotation", entityId: q.id, entityRef: `${q.ref} rev ${rev.revisionNo}`, reason: "Customer link replaced; earlier links revoked" });
    return token;
  });
}

async function findLink(db: DB, token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [row] = await db
    .select({ link: quoteAcceptanceLinks, rev: quotationRevisions, q: quotations, c: customers })
    .from(quoteAcceptanceLinks)
    .innerJoin(quotationRevisions, eq(quotationRevisions.id, quoteAcceptanceLinks.revisionId))
    .innerJoin(quotations, eq(quotations.id, quotationRevisions.quotationId))
    .innerJoin(customers, eq(customers.id, quotations.customerId))
    .where(eq(quoteAcceptanceLinks.tokenHash, sha256(token)))
    .limit(1);
  return row ?? null;
}

export type AcceptanceState = "open" | "expired" | "accepted_pending" | "accepted" | "rejected" | "withdrawn";

function stateOf(row: NonNullable<Awaited<ReturnType<typeof findLink>>>, now = new Date()): AcceptanceState {
  const { link, rev } = row;
  if (rev.status === "accepted") return "accepted";
  if (rev.status === "rejected") return "rejected";
  if (rev.acceptanceRecordedAt) return "accepted_pending";
  if (link.revokedAt || rev.status === "superseded") return "withdrawn";
  if (now >= link.expiresAt || rev.status === "expired" || !["sent", "awaiting_response"].includes(rev.status)) return "expired";
  return "open";
}

/**
 * What the customer sees. Returns null for unknown tokens and for links past their viewing window —
 * the page then shows one generic message, so it reveals nothing about which quotations exist.
 */
export async function getAcceptanceView(db: DB, token: string) {
  const row = await findLink(db, token);
  if (!row || new Date() >= row.link.viewUntil) return null;
  // A revoked link stays viewable only to explain it was replaced.
  await db
    .update(quoteAcceptanceLinks)
    .set({ lastViewedAt: new Date(), viewCount: row.link.viewCount + 1 })
    .where(eq(quoteAcceptanceLinks.id, row.link.id));
  const { rev, q, c } = row;
  const settings = await getSettings(db);
  const lines = await db.select().from(quotationLines).where(eq(quotationLines.revisionId, rev.id)).orderBy(asc(quotationLines.lineNo));
  const [pdf] = rev.pdfFileId ? await db.select({ sha256: files.sha256 }).from(files).where(eq(files.id, rev.pdfFileId)) : [];
  const [verifier] = rev.acceptanceVerifiedBy ? await db.select({ name: users.name }).from(users).where(eq(users.id, rev.acceptanceVerifiedBy)) : [];
  return {
    state: stateOf(row),
    company: { name: settings.companyName, addressLines: settings.addressLines, phone: settings.phone, email: settings.email, isDemo: settings.isDemo },
    quote: {
      ref: q.ref,
      title: q.title,
      revisionNo: rev.revisionNo,
      customerName: c.name,
      currency: rev.currency,
      taxTreatment: rev.taxTreatment,
      taxRate: rev.taxRate,
      subtotal: rev.subtotal,
      taxAmount: rev.taxAmount,
      total: rev.total,
      validUntil: rev.validUntil,
      leadTime: rev.leadTime,
      deliveryTerms: rev.deliveryTerms,
      notes: rev.notes,
      terms: rev.commercialTerms || settings.defaultQuoteTerms || "Our standard terms and conditions of sale apply.",
      sentAt: rev.sentAt,
      hasPdf: !!rev.pdfFileId,
      pdfSha256: pdf?.sha256 ?? null,
    },
    lines: lines.map((l) => ({
      lineNo: l.lineNo,
      partNumber: l.partNumber,
      description: l.description,
      drawing: [l.drawingNumber, l.drawingRevision ? `Rev ${l.drawingRevision}` : null].filter(Boolean).join(" "),
      material: l.materialSpec,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
    })),
    acceptance: rev.acceptanceRecordedAt
      ? {
          byName: rev.acceptedByName,
          byPosition: rev.acceptedByPosition,
          at: rev.acceptanceRecordedAt,
          reference: rev.acceptanceReference,
          countersignedBy: verifier?.name ?? null,
          countersignedAt: rev.acceptanceVerifiedAt,
          hasConfirmation: !!rev.acceptanceConfirmationFileId,
        }
      : null,
    feedback: rev.customerFeedback,
  };
}

/** The file a customer may download through their link: the issued quotation, or the confirmation once countersigned. */
export async function linkDocument(db: DB, token: string, kind: "quote" | "confirmation") {
  const row = await findLink(db, token);
  if (!row || new Date() >= row.link.viewUntil) return null;
  if (kind === "quote" && row.link.revokedAt && !row.rev.acceptanceRecordedAt) return null;
  const fileId = kind === "quote" ? row.rev.pdfFileId : row.rev.acceptanceConfirmationFileId;
  if (!fileId) return null;
  const [file] = await db.select().from(files).where(eq(files.id, fileId));
  return file ? { file, linkId: row.link.id } : null;
}

const text = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters.`);

export const customerResponseInput = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("accept"),
    name: text(120).min(2, "Enter your full name."),
    position: text(120).min(2, "Enter your position or job title."),
    email: text(200).email("Enter a valid email address — the confirmation is sent there."),
    poReference: text(120).optional(),
    comment: text(4000).optional(),
    confirm: z.literal(true, { error: "Tick the box to confirm you are authorised to accept." }),
  }),
  z.object({ decision: z.literal("reject"), name: text(120).min(2, "Enter your full name."), comment: text(4000).optional() }),
  z.object({
    decision: z.literal("changes"),
    name: text(120).min(2, "Enter your full name."),
    comment: text(4000).min(5, "Describe the changes you need."),
  }),
]);
export type CustomerResponseInput = z.input<typeof customerResponseInput>;

/** Records the customer's response through their link. Runs as the system user; the customer is identified in the record. */
export async function respondViaLink(db: DB, token: string, raw: CustomerResponseInput, meta: { ip?: string | null; userAgent?: string | null; poFile?: File | null }) {
  const input = customerResponseInput.parse(raw);
  const ctx = await systemCtx(db);
  return mutate(ctx, async (tx) => {
    const row = await findLink(tx.db, token);
    if (!row) throw notFound("Quotation link");
    const state = stateOf(row);
    if (state === "withdrawn") throw invalid("This quotation has been replaced by a newer revision. Please use the link in the latest quotation email.");
    if (state === "expired") throw invalid("This quotation has expired. Please contact us for an updated quotation.");
    if (state !== "open") throw invalid("A response has already been recorded for this quotation.");
    const { link, rev, q, c } = row;
    const ref = `${q.ref} rev ${rev.revisionNo}`;
    const stamp = `${todayISO()} — ${input.name}`;
    const who = { channel: "customer_link", name: input.name, ip: meta.ip ?? null, linkId: link.id };
    // Claim the link atomically so two simultaneous submissions cannot both record a final response.
    if (input.decision !== "changes") {
      const claimed = await tx.db
        .update(quoteAcceptanceLinks)
        .set({ respondedAt: new Date() })
        .where(and(eq(quoteAcceptanceLinks.id, link.id), isNull(quoteAcceptanceLinks.respondedAt)))
        .returning({ id: quoteAcceptanceLinks.id });
      if (!claimed.length) throw invalid("A response has already been recorded for this quotation.");
    }
    const tell = (title: string, body?: string) =>
      notify(tx, { type: "quotation.customer_response", title, body, link: `/quotations/${q.id}`, entityType: "quotation", entityId: q.id, userIds: [rev.sentBy, rev.preparedBy], permission: "quotations.verify_acceptance", dedupeKey: `customer-response:${link.id}:${input.decision}:${Date.now()}` });

    if (input.decision === "accept") {
      const [pdf] = rev.pdfFileId ? await tx.db.select({ sha256: files.sha256 }).from(files).where(eq(files.id, rev.pdfFileId)) : [];
      const evidence = meta.poFile && meta.poFile.size > 0 ? await storeUpload(tx.db, meta.poFile, null, { isCustomerOriginal: true }) : null;
      await tx.db
        .update(quotationRevisions)
        .set({
          acceptanceChannel: "customer_link",
          acceptedByName: input.name,
          acceptedByPosition: input.position,
          acceptedByEmail: input.email.toLowerCase(),
          acceptanceIp: meta.ip?.slice(0, 100) ?? null,
          acceptanceUserAgent: meta.userAgent?.slice(0, 300) ?? null,
          acceptedPdfSha256: pdf?.sha256 ?? null,
          acceptanceReference: input.poReference || null,
          acceptanceEvidenceFileId: evidence?.id ?? null,
          acceptanceRecordedBy: tx.actor.userId,
          acceptanceRecordedAt: new Date(),
          respondedAt: new Date(),
          status: "awaiting_response",
          customerFeedback: input.comment ? [rev.customerFeedback, `${stamp} (accepted online): ${input.comment}`].filter(Boolean).join("\n") : rev.customerFeedback,
        })
        .where(eq(quotationRevisions.id, rev.id));
      await tx.db.update(quotations).set({ status: "awaiting_response" }).where(eq(quotations.id, q.id));
      await audit(tx, {
        action: "quotation.acceptance_recorded",
        entityType: "quotation",
        entityId: q.id,
        entityRef: ref,
        after: { ...who, position: input.position, email: input.email, poReference: input.poReference ?? null, evidenceFileId: evidence?.id ?? null, acceptedPdfSha256: pdf?.sha256 ?? null },
      });
      await tell(`${ref} accepted online by ${input.name} (${c.name})`, "Check it and countersign to confirm the order.");
      return { decision: "accept" as const };
    }

    if (input.decision === "reject") {
      await tx.db
        .update(quotationRevisions)
        .set({ status: "rejected", respondedAt: new Date(), customerFeedback: [rev.customerFeedback, `${stamp} (declined online)${input.comment ? `: ${input.comment}` : ""}`].filter(Boolean).join("\n") })
        .where(eq(quotationRevisions.id, rev.id));
      await tx.db.update(quotations).set({ status: "rejected" }).where(eq(quotations.id, q.id));
      if (q.enquiryId) await advanceEnquiryStatus(tx, q.enquiryId, "lost");
      await audit(tx, { action: "quotation.rejected_by_customer", entityType: "quotation", entityId: q.id, entityRef: ref, reason: input.comment ?? null, after: who });
      await tell(`${ref} declined online by ${input.name} (${c.name})`, input.comment);
      return { decision: "reject" as const };
    }

    await tx.db
      .update(quotationRevisions)
      .set({ status: "awaiting_response", customerFeedback: [rev.customerFeedback, `${stamp} (change requested online): ${input.comment}`].filter(Boolean).join("\n") })
      .where(eq(quotationRevisions.id, rev.id));
    await tx.db.update(quotations).set({ status: "awaiting_response" }).where(eq(quotations.id, q.id));
    await audit(tx, { action: "quotation.change_requested", entityType: "quotation", entityId: q.id, entityRef: ref, reason: input.comment, after: who });
    await tell(`${c.name} requested changes to ${ref}`, input.comment);
    return { decision: "changes" as const };
  });
}

/** The customer's delivery address line for the confirmation PDF. */
export async function customerAddress(db: DB, customerId: string) {
  const [a] = await db.select().from(addresses).where(eq(addresses.customerId, customerId)).orderBy(asc(addresses.kind)).limit(1);
  return a ?? null;
}
