import { and, asc, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { z } from "zod";
import {
  customers,
  enquiries,
  enquiryAttachments,
  enquiryLines,
  files,
  inboundEmailAttachments,
  inboundEmails,
  users,
} from "../db/schema";
import { audit } from "../audit";
import { mutate, requirePermission, type Ctx } from "../context";
import { invalid, notFound } from "../errors";
import { nextRef, REF } from "../refs";
import { storeFile, storeUpload } from "../storage";
import { notify } from "./notifications";
import { createDocument } from "./documents";

export const ENQUIRY_STATUSES = ["new", "under_review", "quoting", "quoted", "won", "lost", "no_quote", "cancelled"] as const;
const CLOSED = ["won", "lost", "no_quote", "cancelled"];

/** Allowed manual status moves (quoting/quoted/won are also set automatically by quotations). */
const TRANSITIONS: Record<string, string[]> = {
  new: ["under_review", "quoting", "no_quote", "cancelled"],
  under_review: ["quoting", "no_quote", "cancelled", "new"],
  quoting: ["quoted", "no_quote", "cancelled", "under_review"],
  quoted: ["won", "lost", "quoting", "cancelled"],
  won: [],
  lost: ["quoting"],
  no_quote: ["under_review"],
  cancelled: [],
};

export const enquiryInput = z.object({
  customerId: z.string().uuid("Select a customer."),
  contactId: z.string().uuid().nullish(),
  subject: z.string().trim().min(3, "Subject is required."),
  description: z.string().nullish(),
  receivedAt: z.coerce.date().default(() => new Date()),
  receivedVia: z.enum(["email", "phone", "portal", "in_person", "other"]).default("email"),
  customerReference: z.string().trim().nullish(),
  requestedDeliveryDate: z.string().nullish(),
  ownerId: z.string().uuid().nullish(),
});

export const enquiryLineInput = z.object({
  partNumber: z.string().trim().min(1, "Part number is required."),
  description: z.string().trim().min(1, "Description is required."),
  quantity: z.string().regex(/^\d+(\.\d+)?$/, "Enter a quantity."),
  partId: z.string().uuid().nullish(),
  drawingNumber: z.string().trim().nullish(),
  drawingRevision: z.string().trim().nullish(),
  materialGrade: z.string().trim().nullish(),
  tolerances: z.string().nullish(),
  surfaceFinish: z.string().nullish(),
  specialRequirements: z.string().nullish(),
});

export async function createEnquiry(ctx: Ctx, raw: z.input<typeof enquiryInput>, lines: z.input<typeof enquiryLineInput>[] = []) {
  requirePermission(ctx, "enquiries.manage");
  const data = enquiryInput.parse(raw);
  const parsedLines = lines.map((l) => enquiryLineInput.parse(l));
  return mutate(ctx, async (tx) => {
    const [cust] = await tx.db.select().from(customers).where(eq(customers.id, data.customerId)).limit(1);
    if (!cust) throw invalid("Customer not found.", { field: "customerId" });
    if (!cust.isActive) throw invalid("This customer is inactive.", { field: "customerId" });
    const ref = await nextRef(tx.db, REF.enquiry);
    const [e] = await tx.db
      .insert(enquiries)
      .values({ ...data, ref, ownerId: data.ownerId ?? ctx.actor.userId, createdBy: ctx.actor.userId, requestedDeliveryDate: data.requestedDeliveryDate || null })
      .returning();
    if (parsedLines.length) await tx.db.insert(enquiryLines).values(parsedLines.map((l, i) => ({ ...l, enquiryId: e.id, lineNo: i + 1 })));
    await audit(tx, { action: "enquiry.create", entityType: "enquiry", entityId: e.id, entityRef: ref, after: { ...data, lines: parsedLines.length } });
    await notify(tx, { type: "enquiry.new", title: `New enquiry ${ref} from ${cust.name}`, body: data.subject, link: `/enquiries/${e.id}`, permission: "quotations.manage", excludeActor: true, dedupeKey: `enq:${e.id}` });
    return e;
  });
}

export async function updateEnquiry(ctx: Ctx, id: string, raw: Partial<z.input<typeof enquiryInput>>) {
  requirePermission(ctx, "enquiries.manage");
  const data = enquiryInput.partial().parse(raw);
  return mutate(ctx, async (tx) => {
    const [before] = await tx.db.select().from(enquiries).where(eq(enquiries.id, id)).limit(1);
    if (!before) throw notFound("Enquiry");
    if (CLOSED.includes(before.status)) throw invalid("Closed enquiries cannot be edited.");
    await tx.db.update(enquiries).set({ ...data, requestedDeliveryDate: data.requestedDeliveryDate === undefined ? undefined : data.requestedDeliveryDate || null }).where(eq(enquiries.id, id));
    await audit(tx, { action: "enquiry.update", entityType: "enquiry", entityId: id, entityRef: before.ref, before, after: data });
  });
}

export async function addEnquiryLine(ctx: Ctx, enquiryId: string, raw: z.input<typeof enquiryLineInput>) {
  requirePermission(ctx, "enquiries.manage");
  const l = enquiryLineInput.parse(raw);
  return mutate(ctx, async (tx) => {
    const [e] = await tx.db.select().from(enquiries).where(eq(enquiries.id, enquiryId)).limit(1);
    if (!e) throw notFound("Enquiry");
    if (CLOSED.includes(e.status)) throw invalid("Closed enquiries cannot be edited.");
    const existing = await tx.db.select({ n: enquiryLines.lineNo }).from(enquiryLines).where(eq(enquiryLines.enquiryId, enquiryId));
    const lineNo = Math.max(0, ...existing.map((x) => x.n)) + 1;
    const [row] = await tx.db.insert(enquiryLines).values({ ...l, enquiryId, lineNo }).returning();
    await audit(tx, { action: "enquiry.line_add", entityType: "enquiry", entityId: enquiryId, entityRef: e.ref, after: row });
    return row;
  });
}

export async function setEnquiryStatus(ctx: Ctx, id: string, status: string, reason?: string | null) {
  requirePermission(ctx, "enquiries.manage");
  return mutate(ctx, async (tx) => {
    const [e] = await tx.db.select().from(enquiries).where(eq(enquiries.id, id)).limit(1);
    if (!e) throw notFound("Enquiry");
    if (!TRANSITIONS[e.status]?.includes(status)) throw invalid(`An enquiry cannot move from ${e.status} to ${status}.`);
    if (["lost", "no_quote", "cancelled"].includes(status) && !reason?.trim()) throw invalid("Give a reason when closing an enquiry.", { field: "reason" });
    await tx.db.update(enquiries).set({ status, closedReason: reason ?? e.closedReason }).where(eq(enquiries.id, id));
    await audit(tx, { action: "enquiry.status", entityType: "enquiry", entityId: id, entityRef: e.ref, before: { status: e.status }, after: { status }, reason });
  });
}

/** Internal: used by quotations when a quote is created/sent/accepted. */
export async function advanceEnquiryStatus(ctx: Ctx, enquiryId: string, status: "quoting" | "quoted" | "won" | "lost") {
  const [e] = await ctx.db.select().from(enquiries).where(eq(enquiries.id, enquiryId)).limit(1);
  if (!e || CLOSED.includes(e.status) && status !== "won") return;
  if (e.status === status) return;
  await ctx.db.update(enquiries).set({ status }).where(eq(enquiries.id, enquiryId));
  await audit(ctx, { action: "enquiry.status", entityType: "enquiry", entityId: enquiryId, entityRef: e.ref, before: { status: e.status }, after: { status }, reason: "Updated by quotation workflow" });
}

export const ATTACHMENT_KINDS = ["email", "drawing", "cad", "step", "dxf", "spreadsheet", "photo", "specification", "other"] as const;

export function guessAttachmentKind(name: string): (typeof ATTACHMENT_KINDS)[number] {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["step", "stp"].includes(ext)) return "step";
  if (ext === "dxf") return "dxf";
  if (["igs", "iges", "x_t", "sldprt", "stl", "dwg", "prt"].includes(ext)) return "cad";
  if (["xls", "xlsx", "csv"].includes(ext)) return "spreadsheet";
  if (["jpg", "jpeg", "png", "heic", "webp"].includes(ext)) return "photo";
  if (["eml", "msg"].includes(ext)) return "email";
  if (ext === "pdf") return "drawing";
  return "other";
}

/** Attach customer-supplied files (preserved as originals). */
export async function addEnquiryAttachments(ctx: Ctx, enquiryId: string, uploads: File[], opts: { kind?: string; note?: string | null } = {}) {
  requirePermission(ctx, "enquiries.manage");
  if (!uploads.length) throw invalid("Choose at least one file.", { field: "files" });
  return mutate(ctx, async (tx) => {
    const [e] = await tx.db.select().from(enquiries).where(eq(enquiries.id, enquiryId)).limit(1);
    if (!e) throw notFound("Enquiry");
    const out = [];
    for (const u of uploads) {
      const f = await storeUpload(tx.db, u, ctx.actor.userId, { isCustomerOriginal: true });
      const kind = opts.kind && (ATTACHMENT_KINDS as readonly string[]).includes(opts.kind) ? opts.kind : guessAttachmentKind(u.name);
      const [a] = await tx.db.insert(enquiryAttachments).values({ enquiryId, fileId: f.id, kind, note: opts.note ?? null, addedBy: ctx.actor.userId }).returning();
      out.push(a);
      await audit(tx, { action: "enquiry.attachment_add", entityType: "enquiry", entityId: enquiryId, entityRef: e.ref, after: { file: f.originalName, sha256: f.sha256, kind } });
    }
    return out;
  });
}

/**
 * Registers a customer drawing attachment as a controlled document (draft revision), keeping
 * the original file untouched, so it can be reviewed and released for production use.
 */
export async function registerAttachmentAsDocument(
  ctx: Ctx,
  attachmentId: string,
  input: { docNumber: string; title: string; revision: string; partId?: string | null },
) {
  requirePermission(ctx, "documents.upload");
  const [row] = await ctx.db
    .select({ a: enquiryAttachments, f: files, e: enquiries })
    .from(enquiryAttachments)
    .innerJoin(files, eq(files.id, enquiryAttachments.fileId))
    .innerJoin(enquiries, eq(enquiries.id, enquiryAttachments.enquiryId))
    .where(eq(enquiryAttachments.id, attachmentId))
    .limit(1);
  if (!row) throw notFound("Attachment");
  if (row.a.documentRevisionId) throw invalid("This attachment is already registered as a controlled document.");
  const { readFileBytes } = await import("../storage");
  const bytes = await readFileBytes(row.f);
  const file = new File([new Uint8Array(bytes)], row.f.originalName, { type: row.f.mimeType });
  const { rev } = await createDocument(
    ctx,
    { docNumber: input.docNumber, title: input.title, docType: "drawing", revision: input.revision, customerId: row.e.customerId, partId: input.partId ?? null, isCustomerSupplied: true, changeDescription: `Customer issue received with enquiry ${row.e.ref}` },
    file,
  );
  await ctx.db.update(enquiryAttachments).set({ documentRevisionId: rev.id }).where(eq(enquiryAttachments.id, attachmentId));
  return rev;
}

export async function listEnquiries(ctx: Ctx, opts: { q?: string; status?: string; customerId?: string; open?: boolean } = {}) {
  requirePermission(ctx, "enquiries.view");
  const q = opts.q?.trim();
  return ctx.db
    .select({ e: enquiries, customer: customers.name, customerCode: customers.code, owner: users.name })
    .from(enquiries)
    .innerJoin(customers, eq(customers.id, enquiries.customerId))
    .leftJoin(users, eq(users.id, enquiries.ownerId))
    .where(
      and(
        opts.status ? eq(enquiries.status, opts.status) : undefined,
        opts.open ? inArray(enquiries.status, ["new", "under_review", "quoting", "quoted"]) : undefined,
        opts.customerId ? eq(enquiries.customerId, opts.customerId) : undefined,
        q ? or(ilike(enquiries.ref, `%${q}%`), ilike(enquiries.subject, `%${q}%`), ilike(customers.name, `%${q}%`), ilike(enquiries.customerReference, `%${q}%`)) : undefined,
      ),
    )
    .orderBy(desc(enquiries.receivedAt))
    .limit(300);
}

export async function getEnquiry(ctx: Ctx, id: string) {
  requirePermission(ctx, "enquiries.view");
  const [row] = await ctx.db
    .select({ e: enquiries, customer: customers, owner: users.name })
    .from(enquiries)
    .innerJoin(customers, eq(customers.id, enquiries.customerId))
    .leftJoin(users, eq(users.id, enquiries.ownerId))
    .where(eq(enquiries.id, id))
    .limit(1);
  if (!row) throw notFound("Enquiry");
  const [lines, attachments, emails] = await Promise.all([
    ctx.db.select().from(enquiryLines).where(eq(enquiryLines.enquiryId, id)).orderBy(asc(enquiryLines.lineNo)),
    ctx.db
      .select({ a: enquiryAttachments, f: files })
      .from(enquiryAttachments)
      .innerJoin(files, eq(files.id, enquiryAttachments.fileId))
      .where(eq(enquiryAttachments.enquiryId, id))
      .orderBy(asc(enquiryAttachments.createdAt)),
    ctx.db.select().from(inboundEmails).where(eq(inboundEmails.enquiryId, id)).orderBy(asc(inboundEmails.receivedAt)),
  ]);
  return { ...row, lines, attachments, emails };
}

// ───────────────────────────── Inbound email ─────────────────────────────

export type ParsedEmail = {
  provider: "eml_upload" | "resend" | "graph";
  providerMessageId: string;
  messageId?: string | null;
  from: string;
  fromName?: string | null;
  to: string[];
  cc: string[];
  subject: string;
  date: Date;
  text?: string | null;
  html?: string | null;
  raw?: { bytes: Buffer; name: string } | null;
  attachments: { filename: string; contentType?: string | null; bytes: Buffer }[];
};

/**
 * Stores an inbound email and its attachments (idempotent per provider message id).
 * Emails are NOT automatically treated as enquiries or acceptances — an authorised user
 * links each one to an enquiry (or creates an enquiry from it).
 */
export async function ingestEmail(ctx: Ctx, email: ParsedEmail) {
  return mutate(ctx, async (tx) => {
    const [existing] = await tx.db
      .select()
      .from(inboundEmails)
      .where(and(eq(inboundEmails.provider, email.provider), eq(inboundEmails.providerMessageId, email.providerMessageId)))
      .limit(1);
    if (existing) return { email: existing, duplicate: true };
    const rawFile = email.raw ? await storeFile(tx.db, { bytes: email.raw.bytes, name: email.raw.name, mimeType: "message/rfc822", uploadedBy: ctx.actor.isSystem ? null : ctx.actor.userId, isCustomerOriginal: true }) : null;
    const [row] = await tx.db
      .insert(inboundEmails)
      .values({
        provider: email.provider,
        providerMessageId: email.providerMessageId,
        messageIdHeader: email.messageId ?? null,
        fromAddress: email.from,
        fromName: email.fromName ?? null,
        toAddresses: email.to,
        ccAddresses: email.cc,
        subject: email.subject,
        receivedAt: email.date,
        textBody: email.text ?? null,
        htmlBody: email.html ?? null,
        rawFileId: rawFile?.id ?? null,
      })
      .returning();
    for (const a of email.attachments) {
      if (!a.bytes.length) continue;
      try {
        const f = await storeFile(tx.db, { bytes: a.bytes, name: a.filename, mimeType: a.contentType, uploadedBy: null, isCustomerOriginal: true });
        await tx.db.insert(inboundEmailAttachments).values({ inboundEmailId: row.id, fileId: f.id, filename: f.originalName, contentType: f.mimeType });
      } catch (e) {
        // Blocked file types are skipped (recorded in audit) rather than failing the whole email.
        await audit(tx, { action: "email.attachment_skipped", entityType: "inbound_email", entityId: row.id, reason: String((e as Error).message), after: { filename: a.filename } });
      }
    }
    await audit(tx, { action: "email.ingest", entityType: "inbound_email", entityId: row.id, after: { provider: email.provider, from: email.from, subject: email.subject, attachments: email.attachments.length } });
    // Suggest the customer by sender domain (never auto-link).
    return { email: row, duplicate: false };
  });
}

/** Parses an .eml file (RFC 822) with postal-mime. */
export async function parseEml(bytes: Buffer, fileName = "message.eml"): Promise<ParsedEmail> {
  const PostalMime = (await import("postal-mime")).default;
  const parsed = await PostalMime.parse(bytes);
  const { createHash } = await import("node:crypto");
  const id = parsed.messageId || createHash("sha256").update(bytes).digest("hex");
  return {
    provider: "eml_upload",
    providerMessageId: id,
    messageId: parsed.messageId ?? null,
    from: parsed.from?.address ?? "unknown@unknown",
    fromName: parsed.from?.name ?? null,
    to: (parsed.to ?? []).map((a) => a.address ?? "").filter(Boolean),
    cc: (parsed.cc ?? []).map((a) => a.address ?? "").filter(Boolean),
    subject: parsed.subject ?? "(no subject)",
    date: parsed.date ? new Date(parsed.date) : new Date(),
    text: parsed.text ?? null,
    html: parsed.html ?? null,
    raw: { bytes, name: fileName.endsWith(".eml") ? fileName : `${fileName}.eml` },
    attachments: (parsed.attachments ?? []).map((a) => ({
      filename: a.filename ?? "attachment",
      contentType: a.mimeType ?? null,
      bytes: typeof a.content === "string" ? Buffer.from(a.content) : Buffer.from(a.content as ArrayBuffer),
    })),
  };
}

export async function importEmlUpload(ctx: Ctx, file: File) {
  requirePermission(ctx, "email.import");
  if (!file.name.toLowerCase().endsWith(".eml")) throw invalid("Upload an .eml file (save the email from Outlook or your mail client as .eml).", { field: "file" });
  const parsed = await parseEml(Buffer.from(await file.arrayBuffer()), file.name);
  return ingestEmail(ctx, parsed);
}

/** Links an inbound email to an enquiry; its attachments become enquiry attachments. */
export async function linkEmailToEnquiry(ctx: Ctx, inboundEmailId: string, enquiryId: string) {
  requirePermission(ctx, "email.import");
  requirePermission(ctx, "enquiries.manage");
  return mutate(ctx, async (tx) => {
    const [m] = await tx.db.select().from(inboundEmails).where(eq(inboundEmails.id, inboundEmailId)).limit(1);
    if (!m) throw notFound("Email");
    if (m.enquiryId && m.enquiryId !== enquiryId) throw invalid("This email is already linked to another enquiry.");
    const [e] = await tx.db.select().from(enquiries).where(eq(enquiries.id, enquiryId)).limit(1);
    if (!e) throw notFound("Enquiry");
    await tx.db.update(inboundEmails).set({ status: "linked", enquiryId, linkedBy: ctx.actor.userId, linkedAt: new Date() }).where(eq(inboundEmails.id, inboundEmailId));
    if (m.rawFileId) {
      await tx.db.insert(enquiryAttachments).values({ enquiryId, fileId: m.rawFileId, kind: "email", inboundEmailId, note: `Original email: ${m.subject}`, addedBy: ctx.actor.userId });
    }
    const atts = await tx.db.select().from(inboundEmailAttachments).where(eq(inboundEmailAttachments.inboundEmailId, inboundEmailId));
    for (const a of atts) {
      await tx.db.insert(enquiryAttachments).values({ enquiryId, fileId: a.fileId, kind: guessAttachmentKind(a.filename), inboundEmailId, addedBy: ctx.actor.userId });
    }
    await audit(tx, { action: "email.link", entityType: "enquiry", entityId: enquiryId, entityRef: e.ref, after: { inboundEmailId, subject: m.subject, attachments: atts.length } });
  });
}

/** Creates a new enquiry from an inbound email and links it. */
export async function createEnquiryFromEmail(ctx: Ctx, inboundEmailId: string, input: { customerId: string; subject?: string }) {
  requirePermission(ctx, "email.import");
  const [m] = await ctx.db.select().from(inboundEmails).where(eq(inboundEmails.id, inboundEmailId)).limit(1);
  if (!m) throw notFound("Email");
  const e = await createEnquiry(ctx, {
    customerId: input.customerId,
    subject: input.subject?.trim() || m.subject || "Enquiry by email",
    description: (m.textBody ?? "").slice(0, 8000),
    receivedAt: m.receivedAt,
    receivedVia: "email",
  });
  await linkEmailToEnquiry(ctx, inboundEmailId, e.id);
  return e;
}

export async function ignoreEmail(ctx: Ctx, inboundEmailId: string, reason: string) {
  requirePermission(ctx, "email.import");
  return mutate(ctx, async (tx) => {
    const [m] = await tx.db.update(inboundEmails).set({ status: "ignored" }).where(eq(inboundEmails.id, inboundEmailId)).returning();
    if (!m) throw notFound("Email");
    await audit(tx, { action: "email.ignore", entityType: "inbound_email", entityId: inboundEmailId, reason });
  });
}

export async function listInbox(ctx: Ctx, status: "unassigned" | "linked" | "ignored" = "unassigned") {
  requirePermission(ctx, "email.import");
  const rows = await ctx.db.select().from(inboundEmails).where(eq(inboundEmails.status, status)).orderBy(desc(inboundEmails.receivedAt)).limit(200);
  const counts = rows.length
    ? await ctx.db.select({ id: inboundEmailAttachments.inboundEmailId }).from(inboundEmailAttachments).where(inArray(inboundEmailAttachments.inboundEmailId, rows.map((r) => r.id)))
    : [];
  // Suggest customers by sender email domain.
  const domains = [...new Set(rows.map((r) => r.fromAddress.split("@")[1]).filter(Boolean))];
  const custs = domains.length ? await ctx.db.select({ id: customers.id, name: customers.name, email: customers.email }).from(customers) : [];
  return rows.map((r) => ({
    ...r,
    attachmentCount: counts.filter((c) => c.id === r.id).length,
    suggestedCustomer: custs.find((c) => c.email && c.email.split("@")[1] === r.fromAddress.split("@")[1]) ?? null,
  }));
}

export async function getInboundEmail(ctx: Ctx, id: string) {
  requirePermission(ctx, "email.import");
  const [m] = await ctx.db.select().from(inboundEmails).where(eq(inboundEmails.id, id)).limit(1);
  if (!m) throw notFound("Email");
  const atts = await ctx.db.select({ a: inboundEmailAttachments, f: files }).from(inboundEmailAttachments).innerJoin(files, eq(files.id, inboundEmailAttachments.fileId)).where(eq(inboundEmailAttachments.inboundEmailId, id));
  return { email: m, attachments: atts };
}

export async function updateEnquiryLine(ctx: Ctx, lineId: string, raw: z.input<typeof enquiryLineInput>) {
  requirePermission(ctx, "enquiries.manage");
  const l = enquiryLineInput.parse(raw);
  return mutate(ctx, async (tx) => {
    const [line] = await tx.db.select().from(enquiryLines).where(eq(enquiryLines.id, lineId)).limit(1);
    if (!line) throw notFound("Enquiry line");
    const [e] = await tx.db.select().from(enquiries).where(eq(enquiries.id, line.enquiryId)).limit(1);
    if (CLOSED.includes(e.status)) throw invalid("Closed enquiries cannot be edited.");
    await tx.db.update(enquiryLines).set(l).where(eq(enquiryLines.id, lineId));
    await audit(tx, { action: "enquiry.line_update", entityType: "enquiry", entityId: e.id, entityRef: e.ref, before: line, after: l });
  });
}

export async function removeEnquiryLine(ctx: Ctx, lineId: string) {
  requirePermission(ctx, "enquiries.manage");
  return mutate(ctx, async (tx) => {
    const [line] = await tx.db.select().from(enquiryLines).where(eq(enquiryLines.id, lineId)).limit(1);
    if (!line) throw notFound("Enquiry line");
    const [e] = await tx.db.select().from(enquiries).where(eq(enquiries.id, line.enquiryId)).limit(1);
    if (CLOSED.includes(e.status)) throw invalid("Closed enquiries cannot be edited.");
    await tx.db.delete(enquiryLines).where(eq(enquiryLines.id, lineId));
    await audit(tx, { action: "enquiry.line_remove", entityType: "enquiry", entityId: e.id, entityRef: e.ref, before: line });
  });
}

export async function restoreEmail(ctx: Ctx, inboundEmailId: string) {
  requirePermission(ctx, "email.import");
  return mutate(ctx, async (tx) => {
    const [m] = await tx.db.select().from(inboundEmails).where(eq(inboundEmails.id, inboundEmailId)).limit(1);
    if (!m) throw notFound("Email");
    if (m.status !== "ignored") throw invalid("Only ignored emails can be restored.");
    await tx.db.update(inboundEmails).set({ status: "unassigned" }).where(eq(inboundEmails.id, inboundEmailId));
    await audit(tx, { action: "email.restore", entityType: "inbound_email", entityId: inboundEmailId });
  });
}
