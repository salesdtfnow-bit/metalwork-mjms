import { and, asc, desc, eq, ilike, inArray, notInArray, or } from "drizzle-orm";
import { z } from "zod";
import {
  controlledDocuments,
  documentRevisions,
  fileAccessLog,
  files,
  jobLines,
  jobs,
  operationDocuments,
  operations,
  users,
} from "../db/schema";
import { audit } from "../audit";
import { can, mutate, requirePermission, type Ctx } from "../context";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { nextRef, REF } from "../refs";
import { storeUpload } from "../storage";
import { signApproval } from "./approvals";
import { getSettings } from "./settings";
import { notify } from "./notifications";

export const DOC_TYPES = ["drawing", "specification", "setup_sheet", "work_instruction", "procedure", "form", "safety", "certificate", "other"] as const;

export const documentInput = z.object({
  docNumber: z.string().trim().max(60).nullish(),
  title: z.string().trim().min(2, "Title is required."),
  docType: z.enum(DOC_TYPES),
  customerId: z.string().uuid().nullish(),
  supplierId: z.string().uuid().nullish(),
  machineId: z.string().uuid().nullish(),
  partId: z.string().uuid().nullish(),
  isCustomerSupplied: z.boolean().default(false),
  revision: z.string().trim().min(1, "Revision is required.").max(20),
  changeDescription: z.string().trim().nullish(),
});

/** Creates a controlled document with its first (draft) revision. */
export async function createDocument(ctx: Ctx, raw: z.input<typeof documentInput>, file: File) {
  requirePermission(ctx, "documents.upload");
  const data = documentInput.parse(raw);
  if (!file || file.size === 0) throw invalid("Attach the document file.", { field: "file" });
  return mutate(ctx, async (tx) => {
    const docNumber = data.docNumber?.trim() || (await nextRef(tx.db, REF.document, { yearly: false, pad: 5 }));
    const [dup] = await tx.db.select({ id: controlledDocuments.id }).from(controlledDocuments).where(eq(controlledDocuments.docNumber, docNumber)).limit(1);
    if (dup) throw conflict(`Document number ${docNumber} already exists — add a revision to it instead.`, { field: "docNumber" });
    const f = await storeUpload(tx.db, file, ctx.actor.userId, { isCustomerOriginal: data.isCustomerSupplied });
    const [doc] = await tx.db
      .insert(controlledDocuments)
      .values({
        docNumber,
        title: data.title,
        docType: data.docType,
        customerId: data.customerId ?? null,
        supplierId: data.supplierId ?? null,
        machineId: data.machineId ?? null,
        partId: data.partId ?? null,
        isCustomerSupplied: data.isCustomerSupplied,
        createdBy: ctx.actor.userId,
      })
      .returning();
    const [rev] = await tx.db
      .insert(documentRevisions)
      .values({ documentId: doc.id, revision: data.revision, fileId: f.id, changeDescription: data.changeDescription ?? "Initial issue", authorId: ctx.actor.userId })
      .returning();
    await audit(tx, { action: "document.create", entityType: "document", entityId: doc.id, entityRef: docNumber, after: { ...data, fileId: f.id, sha256: f.sha256, revisionId: rev.id } });
    return { doc, rev };
  });
}

/** Adds a new draft revision (from an existing stored file, or a new upload). */
export async function addRevision(ctx: Ctx, documentId: string, raw: { revision: string; changeDescription: string; fileId?: string }, file?: File) {
  requirePermission(ctx, "documents.upload");
  const revision = raw.revision?.trim();
  if (!revision) throw invalid("Revision is required.", { field: "revision" });
  if (!raw.changeDescription?.trim()) throw invalid("Describe what changed in this revision.", { field: "changeDescription" });
  return mutate(ctx, async (tx) => {
    const [doc] = await tx.db.select().from(controlledDocuments).where(eq(controlledDocuments.id, documentId)).limit(1);
    if (!doc) throw notFound("Document");
    const [dup] = await tx.db
      .select({ id: documentRevisions.id })
      .from(documentRevisions)
      .where(and(eq(documentRevisions.documentId, documentId), eq(documentRevisions.revision, revision)))
      .limit(1);
    if (dup) throw conflict(`Revision ${revision} already exists for ${doc.docNumber}. Revisions are never overwritten.`, { field: "revision" });
    let fileId = raw.fileId;
    if (!fileId) {
      if (!file || file.size === 0) throw invalid("Attach the revision file.", { field: "file" });
      fileId = (await storeUpload(tx.db, file, ctx.actor.userId, { isCustomerOriginal: doc.isCustomerSupplied })).id;
    }
    const [rev] = await tx.db
      .insert(documentRevisions)
      .values({ documentId, revision, fileId, changeDescription: raw.changeDescription.trim(), authorId: ctx.actor.userId, supersedesId: doc.currentRevisionId })
      .returning();
    await audit(tx, { action: "document.revision_add", entityType: "document", entityId: documentId, entityRef: `${doc.docNumber} rev ${revision}`, after: rev });
    return rev;
  });
}

async function loadRev(ctx: Ctx, revisionId: string) {
  const [row] = await ctx.db
    .select({ rev: documentRevisions, doc: controlledDocuments })
    .from(documentRevisions)
    .innerJoin(controlledDocuments, eq(controlledDocuments.id, documentRevisions.documentId))
    .where(eq(documentRevisions.id, revisionId))
    .limit(1);
  if (!row) throw notFound("Document revision");
  return row;
}

export async function submitRevisionForReview(ctx: Ctx, revisionId: string) {
  requirePermission(ctx, "documents.upload");
  return mutate(ctx, async (tx) => {
    const { rev, doc } = await loadRev(tx, revisionId);
    if (rev.status !== "draft") throw invalid(`Only draft revisions can be submitted (this one is ${rev.status}).`);
    await tx.db.update(documentRevisions).set({ status: "in_review" }).where(eq(documentRevisions.id, revisionId));
    await audit(tx, { action: "document.revision_submit", entityType: "document", entityId: doc.id, entityRef: `${doc.docNumber} rev ${rev.revision}` });
  });
}

export async function reviewRevision(ctx: Ctx, revisionId: string, outcome: "reviewed" | "rejected", comment: string | null) {
  requirePermission(ctx, "documents.review");
  return mutate(ctx, async (tx) => {
    const { rev, doc } = await loadRev(tx, revisionId);
    if (rev.status !== "in_review") throw invalid("Only revisions in review can be reviewed.");
    if (outcome === "rejected" && !comment?.trim()) throw invalid("Give a reason for rejecting.", { field: "comment" });
    await tx.db
      .update(documentRevisions)
      .set(outcome === "rejected" ? { status: "rejected", reviewerId: ctx.actor.userId, reviewedAt: new Date() } : { reviewerId: ctx.actor.userId, reviewedAt: new Date() })
      .where(eq(documentRevisions.id, revisionId));
    await audit(tx, { action: outcome === "rejected" ? "document.revision_reject" : "document.revision_review", entityType: "document", entityId: doc.id, entityRef: `${doc.docNumber} rev ${rev.revision}`, reason: comment });
  });
}

/**
 * Approve and release a revision (electronic approval with re-authentication).
 * The previously released revision becomes superseded; open jobs and operations that
 * reference it are flagged for review — they are NOT switched automatically.
 */
export async function approveAndReleaseRevision(ctx: Ctx, revisionId: string, input: { password: string; effectiveDate?: string | null; comment?: string | null }) {
  requirePermission(ctx, "documents.approve");
  const settings = await getSettings(ctx.db);
  return mutate(ctx, async (tx) => {
    const { rev, doc } = await loadRev(tx, revisionId);
    if (rev.status !== "in_review") throw invalid("Only revisions that have been submitted for review can be approved.");
    if (settings.requireIndependentApproval && rev.authorId === ctx.actor.userId) {
      throw forbidden("Independent approval is required: you cannot approve a revision you authored.");
    }
    const approval = await signApproval(tx, {
      kind: "document.release",
      entityType: "document_revision",
      entityId: rev.id,
      decision: "approved",
      meaning: `I approve ${doc.docNumber} revision ${rev.revision} for use and release it as the current controlled revision.`,
      comment: input.comment,
      password: input.password,
    });
    const now = new Date();
    const previousId = doc.currentRevisionId;
    await tx.db
      .update(documentRevisions)
      .set({
        status: "released",
        approverId: ctx.actor.userId,
        approvedAt: now,
        releasedBy: ctx.actor.userId,
        releasedAt: now,
        effectiveDate: input.effectiveDate ?? now.toISOString().slice(0, 10),
        reviewerId: rev.reviewerId ?? ctx.actor.userId,
        reviewedAt: rev.reviewedAt ?? now,
        supersedesId: previousId,
      })
      .where(eq(documentRevisions.id, rev.id));
    if (previousId && previousId !== rev.id) {
      await tx.db.update(documentRevisions).set({ status: "superseded", supersededById: rev.id, supersededAt: now }).where(eq(documentRevisions.id, previousId));
    }
    await tx.db.update(controlledDocuments).set({ currentRevisionId: rev.id }).where(eq(controlledDocuments.id, doc.id));
    const impact = previousId ? await flagDrawingImpact(tx, previousId, `${doc.docNumber} superseded by revision ${rev.revision}`) : { jobLines: 0, operations: 0, jobIds: [] };
    await audit(tx, {
      action: "document.revision_release",
      entityType: "document",
      entityId: doc.id,
      entityRef: `${doc.docNumber} rev ${rev.revision}`,
      before: { currentRevisionId: previousId },
      after: { currentRevisionId: rev.id, impact },
      approvalId: approval.id,
    });
    if (impact.operations || impact.jobLines) {
      await notify(tx, {
        type: "drawing.revised",
        title: `${doc.docNumber} revised to ${rev.revision} — ${impact.operations} operation(s) need review`,
        link: `/documents/${doc.id}`,
        permission: "production.supervise",
        dedupeKey: `docrev:${rev.id}`,
      });
    }
    return { approval, impact };
  });
}

/** Flags open job lines / operations that reference a superseded revision. */
export async function flagDrawingImpact(ctx: Ctx, oldRevisionId: string, reason: string) {
  const closedJobs = ["completed", "cancelled", "dispatched"];
  const affectedLines = await ctx.db
    .select({ id: jobLines.id, jobId: jobLines.jobId })
    .from(jobLines)
    .innerJoin(jobs, eq(jobs.id, jobLines.jobId))
    .where(and(eq(jobLines.drawingRevisionId, oldRevisionId), notInArray(jobs.status, closedJobs)));
  if (affectedLines.length) {
    await tx_updateLines(ctx, affectedLines.map((l) => l.id));
  }
  const pinned = await ctx.db.select({ operationId: operationDocuments.operationId }).from(operationDocuments).where(eq(operationDocuments.documentRevisionId, oldRevisionId));
  const opsDirect = await ctx.db
    .select({ id: operations.id, jobId: operations.jobId })
    .from(operations)
    .where(
      and(
        or(eq(operations.drawingRevisionId, oldRevisionId), pinned.length ? inArray(operations.id, pinned.map((p) => p.operationId)) : undefined),
        notInArray(operations.status, ["complete", "cancelled"]),
      ),
    );
  if (opsDirect.length) {
    await ctx.db.update(operations).set({ reviewRequired: true, reviewReason: reason }).where(inArray(operations.id, opsDirect.map((o) => o.id)));
  }
  const jobIds = [...new Set([...affectedLines.map((l) => l.jobId), ...opsDirect.map((o) => o.jobId)])];
  return { jobLines: affectedLines.length, operations: opsDirect.length, jobIds };
}

async function tx_updateLines(ctx: Ctx, ids: string[]) {
  await ctx.db.update(jobLines).set({ drawingReviewRequired: true }).where(inArray(jobLines.id, ids));
}

export async function obsoleteRevision(ctx: Ctx, revisionId: string, reason: string) {
  requirePermission(ctx, "documents.approve");
  if (!reason?.trim()) throw invalid("A reason is required.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const { rev, doc } = await loadRev(tx, revisionId);
    if (!["draft", "in_review", "approved", "released"].includes(rev.status)) throw invalid(`Revision is already ${rev.status}.`);
    await tx.db.update(documentRevisions).set({ status: "obsolete" }).where(eq(documentRevisions.id, revisionId));
    if (doc.currentRevisionId === revisionId) {
      await tx.db.update(controlledDocuments).set({ currentRevisionId: null }).where(eq(controlledDocuments.id, doc.id));
      await flagDrawingImpact(tx, revisionId, `${doc.docNumber} revision ${rev.revision} made obsolete`);
    }
    await audit(tx, { action: "document.revision_obsolete", entityType: "document", entityId: doc.id, entityRef: `${doc.docNumber} rev ${rev.revision}`, reason });
  });
}

/** Is this revision currently valid for production use? */
export function isProductionRevision(rev: { status: string } | null | undefined) {
  return rev?.status === "released";
}

export async function listDocuments(ctx: Ctx, opts: { q?: string; docType?: string; partId?: string; customerId?: string; machineId?: string } = {}) {
  requirePermission(ctx, "documents.view");
  const q = opts.q?.trim();
  const rows = await ctx.db
    .select({ doc: controlledDocuments, current: documentRevisions })
    .from(controlledDocuments)
    .leftJoin(documentRevisions, eq(documentRevisions.id, controlledDocuments.currentRevisionId))
    .where(
      and(
        q ? or(ilike(controlledDocuments.docNumber, `%${q}%`), ilike(controlledDocuments.title, `%${q}%`)) : undefined,
        opts.docType ? eq(controlledDocuments.docType, opts.docType) : undefined,
        opts.partId ? eq(controlledDocuments.partId, opts.partId) : undefined,
        opts.customerId ? eq(controlledDocuments.customerId, opts.customerId) : undefined,
        opts.machineId ? eq(controlledDocuments.machineId, opts.machineId) : undefined,
      ),
    )
    .orderBy(desc(controlledDocuments.createdAt))
    .limit(500);
  return rows;
}

export async function getDocument(ctx: Ctx, id: string) {
  requirePermission(ctx, "documents.view");
  const [doc] = await ctx.db.select().from(controlledDocuments).where(eq(controlledDocuments.id, id)).limit(1);
  if (!doc) throw notFound("Document");
  const revs = await ctx.db
    .select({ rev: documentRevisions, file: files, author: users.name })
    .from(documentRevisions)
    .innerJoin(files, eq(files.id, documentRevisions.fileId))
    .leftJoin(users, eq(users.id, documentRevisions.authorId))
    .where(eq(documentRevisions.documentId, id))
    .orderBy(desc(documentRevisions.createdAt));
  const access = await ctx.db
    .select({ log: fileAccessLog, user: users.name })
    .from(fileAccessLog)
    .leftJoin(users, eq(users.id, fileAccessLog.userId))
    .where(inArray(fileAccessLog.fileId, revs.length ? revs.map((r) => r.file.id) : ["00000000-0000-0000-0000-000000000000"]))
    .orderBy(desc(fileAccessLog.at))
    .limit(100);
  return { doc, revisions: revs, access };
}

/** Users with only production.execute should normally see released revisions only. */
export function canSeeUnreleased(ctx: Ctx) {
  return can(ctx.actor, "documents.upload") || can(ctx.actor, "documents.review") || can(ctx.actor, "documents.approve");
}

export async function documentsForPart(ctx: Ctx, partId: string) {
  return ctx.db
    .select({ doc: controlledDocuments, current: documentRevisions })
    .from(controlledDocuments)
    .leftJoin(documentRevisions, eq(documentRevisions.id, controlledDocuments.currentRevisionId))
    .where(eq(controlledDocuments.partId, partId))
    .orderBy(asc(controlledDocuments.docNumber));
}
