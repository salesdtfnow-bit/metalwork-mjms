import { and, asc, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { controlledDocuments, customers, documentRevisions, partRevisions, parts } from "../db/schema";
import { audit } from "../audit";
import { mutate, requireAnyPermission, type Ctx } from "../context";
import { invalid, notFound } from "../errors";

/** Finds a part by customer + part number, creating it if needed (inside the caller's transaction). */
export async function findOrCreatePart(ctx: Ctx, input: { customerId: string | null; partNumber: string; description: string; materialSpecId?: string | null; traceabilityLevel?: string }) {
  const pn = input.partNumber.trim();
  if (!pn) throw invalid("Part number is required.");
  const [existing] = await ctx.db
    .select()
    .from(parts)
    .where(and(eq(parts.partNumber, pn), input.customerId ? eq(parts.customerId, input.customerId) : isNull(parts.customerId)))
    .limit(1);
  if (existing) return existing;
  const [p] = await ctx.db
    .insert(parts)
    .values({ partNumber: pn, customerId: input.customerId, description: input.description, materialSpecId: input.materialSpecId ?? null, traceabilityLevel: input.traceabilityLevel ?? "job" })
    .returning();
  await audit(ctx, { action: "part.create", entityType: "part", entityId: p.id, entityRef: pn, after: p });
  return p;
}

/** Links a controlled drawing document to a part (its released revision becomes the default for new jobs). */
export async function setPartDrawing(ctx: Ctx, partId: string, documentId: string) {
  requireAnyPermission(ctx, "documents.upload", "jobs.manage");
  return mutate(ctx, async (tx) => {
    const [doc] = await tx.db.select().from(controlledDocuments).where(eq(controlledDocuments.id, documentId)).limit(1);
    if (!doc) throw notFound("Document");
    if (doc.docType !== "drawing") throw invalid("Only drawing documents can be linked as the part drawing.");
    const [p] = await tx.db.update(parts).set({ drawingDocumentId: documentId }).where(eq(parts.id, partId)).returning();
    if (!p) throw notFound("Part");
    await tx.db.update(controlledDocuments).set({ partId }).where(eq(controlledDocuments.id, documentId));
    await audit(tx, { action: "part.drawing_link", entityType: "part", entityId: partId, entityRef: p.partNumber, after: { documentId, docNumber: doc.docNumber } });
  });
}

/** The released drawing revision currently in force for a part, if any. */
export async function currentDrawingRevision(ctx: Ctx, partId: string) {
  const [p] = await ctx.db.select().from(parts).where(eq(parts.id, partId)).limit(1);
  if (!p?.drawingDocumentId) return null;
  const [row] = await ctx.db
    .select({ rev: documentRevisions, doc: controlledDocuments })
    .from(controlledDocuments)
    .innerJoin(documentRevisions, eq(documentRevisions.id, controlledDocuments.currentRevisionId))
    .where(eq(controlledDocuments.id, p.drawingDocumentId))
    .limit(1);
  return row ?? null;
}

export async function ensurePartRevision(ctx: Ctx, partId: string, revision: string, drawingRevisionId: string | null) {
  const [existing] = await ctx.db.select().from(partRevisions).where(and(eq(partRevisions.partId, partId), eq(partRevisions.revision, revision))).limit(1);
  if (existing) return existing;
  await ctx.db.update(partRevisions).set({ isCurrent: false }).where(eq(partRevisions.partId, partId));
  const [r] = await ctx.db.insert(partRevisions).values({ partId, revision, drawingRevisionId, isCurrent: true }).returning();
  return r;
}

export async function listParts(ctx: Ctx, opts: { q?: string; customerId?: string } = {}) {
  requireAnyPermission(ctx, "jobs.view", "quotations.view", "documents.view", "production.view_all");
  const q = opts.q?.trim();
  return ctx.db
    .select({ part: parts, customer: customers.name, drawing: controlledDocuments.docNumber })
    .from(parts)
    .leftJoin(customers, eq(customers.id, parts.customerId))
    .leftJoin(controlledDocuments, eq(controlledDocuments.id, parts.drawingDocumentId))
    .where(and(opts.customerId ? eq(parts.customerId, opts.customerId) : undefined, q ? or(ilike(parts.partNumber, `%${q}%`), ilike(parts.description, `%${q}%`)) : undefined))
    .orderBy(asc(parts.partNumber))
    .limit(300);
}

export async function getPart(ctx: Ctx, id: string) {
  requireAnyPermission(ctx, "jobs.view", "quotations.view", "documents.view", "production.view_all");
  const [p] = await ctx.db.select().from(parts).where(eq(parts.id, id)).limit(1);
  if (!p) throw notFound("Part");
  const revs = await ctx.db.select().from(partRevisions).where(eq(partRevisions.partId, id)).orderBy(desc(partRevisions.createdAt));
  return { part: p, revisions: revs };
}
