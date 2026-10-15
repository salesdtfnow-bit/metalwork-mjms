import { and, asc, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { z } from "zod";
import {
  addresses,
  customerOrders,
  customerRequirements,
  customers,
  jobLines,
  jobs,
  quotationLines,
  quotationRevisions,
  quotations,
  users,
} from "../db/schema";
import { audit } from "../audit";
import { mutate, requirePermission, type Ctx } from "../context";
import { conflict, invalid, notFound } from "../errors";
import { nextRef, REF } from "../refs";
import { storeUpload } from "../storage";
import { signApproval } from "./approvals";
import { currentDrawingRevision, ensurePartRevision, findOrCreatePart } from "./parts";
import { notify } from "./notifications";

export const orderInput = z.object({
  customerId: z.string().uuid("Select a customer."),
  customerPoNumber: z.string().trim().min(1, "Customer PO number is required."),
  poDate: z.string().nullish(),
  quotationRevisionId: z.string().uuid().nullish(),
  deliveryAddressId: z.string().uuid().nullish(),
  requiredDate: z.string().nullish(),
  orderValue: z.string().nullish(),
  commercialTerms: z.string().nullish(),
  notes: z.string().nullish(),
});

export async function registerCustomerOrder(ctx: Ctx, raw: z.input<typeof orderInput>, poFile?: File | null) {
  requirePermission(ctx, "orders.manage");
  const data = orderInput.parse(raw);
  return mutate(ctx, async (tx) => {
    const [dup] = await tx.db
      .select({ ref: customerOrders.ref })
      .from(customerOrders)
      .where(and(eq(customerOrders.customerId, data.customerId), eq(customerOrders.customerPoNumber, data.customerPoNumber)))
      .limit(1);
    if (dup) throw conflict(`PO ${data.customerPoNumber} is already registered as ${dup.ref}.`, { field: "customerPoNumber" });
    if (data.quotationRevisionId) {
      const [r] = await tx.db
        .select({ rev: quotationRevisions, q: quotations })
        .from(quotationRevisions)
        .innerJoin(quotations, eq(quotations.id, quotationRevisions.quotationId))
        .where(eq(quotationRevisions.id, data.quotationRevisionId))
        .limit(1);
      if (!r || r.q.customerId !== data.customerId) throw invalid("The quotation revision does not belong to this customer.", { field: "quotationRevisionId" });
    }
    const poFileId = poFile && poFile.size ? (await storeUpload(tx.db, poFile, ctx.actor.userId, { isCustomerOriginal: true })).id : null;
    const ref = await nextRef(tx.db, REF.customerOrder);
    const [o] = await tx.db
      .insert(customerOrders)
      .values({ ...data, ref, poFileId, receivedBy: ctx.actor.userId, poDate: data.poDate || null, requiredDate: data.requiredDate || null, orderValue: data.orderValue || null })
      .returning();
    await audit(tx, { action: "order.register", entityType: "customer_order", entityId: o.id, entityRef: ref, after: { ...data, poFileId } });
    await notify(tx, { type: "order.received", title: `Customer PO ${data.customerPoNumber} registered (${ref})`, link: `/orders/${o.id}`, permission: "orders.verify", excludeActor: true, dedupeKey: `order:${o.id}` });
    return o;
  });
}

/**
 * Contract review: confirms the PO matches the accepted quotation (price, quantity,
 * revision, delivery, terms). Requires the PO document and a verified acceptance.
 */
export async function verifyCustomerOrder(ctx: Ctx, orderId: string, input: { password: string; discrepancies?: string | null; comment?: string | null; poFile?: File | null }) {
  requirePermission(ctx, "orders.verify");
  return mutate(ctx, async (tx) => {
    const [o] = await tx.db.select().from(customerOrders).where(eq(customerOrders.id, orderId)).limit(1);
    if (!o) throw notFound("Customer order");
    if (o.status !== "received") throw invalid(`Order is ${o.status}.`);
    let poFileId = o.poFileId;
    if (!poFileId && input.poFile && input.poFile.size) {
      poFileId = (await storeUpload(tx.db, input.poFile, ctx.actor.userId, { isCustomerOriginal: true })).id;
      await tx.db.update(customerOrders).set({ poFileId }).where(eq(customerOrders.id, orderId));
    }
    if (!poFileId) throw invalid("Attach the customer's purchase order document before verifying.", { field: "poFile" });
    if (!o.quotationRevisionId) throw invalid("Link the accepted quotation revision before verifying.");
    const [rev] = await tx.db.select().from(quotationRevisions).where(eq(quotationRevisions.id, o.quotationRevisionId)).limit(1);
    if (rev?.status !== "accepted" || !rev.acceptanceVerifiedAt) throw invalid("The linked quotation revision has not been accepted and verified.");
    const approval = await signApproval(tx, {
      kind: "order.verify",
      entityType: "customer_order",
      entityId: o.id,
      decision: "approved",
      meaning: `Contract review: I have checked customer PO ${o.customerPoNumber} against the accepted quotation (parts, revisions, quantities, prices, delivery and terms)${input.discrepancies ? " and recorded the discrepancies noted" : " and found it consistent"}.`,
      comment: [input.discrepancies && `Discrepancies: ${input.discrepancies}`, input.comment].filter(Boolean).join("\n") || null,
      password: input.password,
    });
    await tx.db.update(customerOrders).set({ status: "verified", verifiedBy: ctx.actor.userId, verifiedAt: new Date(), discrepancies: input.discrepancies ?? null }).where(eq(customerOrders.id, orderId));
    await audit(tx, { action: "order.verify", entityType: "customer_order", entityId: o.id, entityRef: o.ref, approvalId: approval.id, reason: input.discrepancies });
  });
}

export const convertInput = z.object({
  title: z.string().trim().min(2, "Job title is required."),
  ownerId: z.string().uuid().nullish(),
  priority: z.number().int().min(1).max(4).default(3),
  requiredDate: z.string().nullish(),
  traceabilityLevel: z.enum(["job", "batch", "piece"]).default("job"),
  lines: z
    .array(z.object({ quotationLineId: z.string().uuid(), quantity: z.string().regex(/^\d+(\.\d+)?$/).optional(), include: z.boolean().default(true), traceabilityLevel: z.enum(["job", "batch", "piece"]).optional() }))
    .optional(),
  repeatOfJobId: z.string().uuid().nullish(),
});

/** Converts a verified PO + accepted quotation into a job with a permanent job number. */
export async function convertOrderToJob(ctx: Ctx, orderId: string, raw: z.input<typeof convertInput>) {
  requirePermission(ctx, "jobs.create");
  const input = convertInput.parse(raw);
  return mutate(ctx, async (tx) => {
    const [o] = await tx.db.select().from(customerOrders).where(eq(customerOrders.id, orderId)).limit(1);
    if (!o) throw notFound("Customer order");
    if (o.status === "converted") throw invalid("This order has already been converted to a job.");
    if (o.status !== "verified") throw invalid("Verify the customer PO against the accepted quotation before creating the job.");
    const [rev] = await tx.db
      .select({ rev: quotationRevisions, q: quotations })
      .from(quotationRevisions)
      .innerJoin(quotations, eq(quotations.id, quotationRevisions.quotationId))
      .where(eq(quotationRevisions.id, o.quotationRevisionId!))
      .limit(1);
    if (rev.rev.status !== "accepted" || !rev.rev.acceptanceVerifiedAt) throw invalid("The quotation acceptance must be verified.");
    const qLines = await tx.db.select().from(quotationLines).where(eq(quotationLines.revisionId, rev.rev.id)).orderBy(asc(quotationLines.lineNo));
    const chosen = qLines.filter((l) => input.lines?.find((x) => x.quotationLineId === l.id)?.include ?? true);
    if (!chosen.length) throw invalid("Select at least one quotation line.");
    const [cust] = await tx.db.select().from(customers).where(eq(customers.id, o.customerId)).limit(1);
    const reqs = await tx.db.select().from(customerRequirements).where(and(eq(customerRequirements.customerId, o.customerId), eq(customerRequirements.isActive, true)));
    const deliveryAddressId =
      o.deliveryAddressId ??
      (await tx.db.select({ id: addresses.id }).from(addresses).where(and(eq(addresses.customerId, o.customerId), eq(addresses.kind, "delivery"), eq(addresses.isDefault, true))).limit(1))[0]?.id ??
      null;

    const jobNumber = await nextRef(tx.db, REF.job);
    const [job] = await tx.db
      .insert(jobs)
      .values({
        jobNumber,
        title: input.title,
        customerId: o.customerId,
        customerOrderId: o.id,
        quotationRevisionId: rev.rev.id,
        repeatOfJobId: input.repeatOfJobId ?? null,
        status: "order_confirmed",
        priority: input.priority,
        ownerId: input.ownerId ?? ctx.actor.userId,
        requiredDate: input.requiredDate || o.requiredDate,
        deliveryAddressId,
        commercialTerms: o.commercialTerms ?? rev.rev.commercialTerms,
        certificationRequirements: [cust.requiredCertificates, ...reqs.filter((r) => r.kind === "material_cert" || r.kind === "documentation").map((r) => r.description)].filter(Boolean).join("\n") || null,
        inspectionRequirements: [cust.qualityRequirements, ...reqs.filter((r) => r.kind === "inspection").map((r) => r.description)].filter(Boolean).join("\n") || null,
        packagingRequirements: [cust.packagingRequirements, ...reqs.filter((r) => r.kind === "packaging").map((r) => r.description)].filter(Boolean).join("\n") || null,
        deliveryRequirements: cust.deliveryPreferences,
        materialRequirements: [...new Set(chosen.map((l) => l.materialSpec).filter(Boolean))].join("; ") || null,
        nextAction: "Authorise job, plan route and order material",
        createdBy: ctx.actor.userId,
      })
      .returning();

    let lineNo = 0;
    for (const ql of chosen) {
      const opt = input.lines?.find((x) => x.quotationLineId === ql.id);
      const part = await findOrCreatePart(tx, { customerId: o.customerId, partNumber: ql.partNumber, description: ql.description, traceabilityLevel: opt?.traceabilityLevel ?? input.traceabilityLevel });
      // Drawing revision pinned: the quote's referenced controlled revision, else the part's released drawing.
      const drawingRevisionId = ql.drawingRevisionId ?? (await currentDrawingRevision(tx, part.id))?.rev.id ?? null;
      const partRev = await ensurePartRevision(tx, part.id, ql.drawingRevision ?? "-", drawingRevisionId);
      await tx.db.insert(jobLines).values({
        jobId: job.id,
        lineNo: ++lineNo,
        partId: part.id,
        partRevisionId: partRev.id,
        partNumber: ql.partNumber,
        description: ql.description,
        drawingRevisionId,
        quotationLineId: ql.id,
        quantity: opt?.quantity ?? ql.quantity,
        unitPrice: ql.unitPrice,
        materialSpec: ql.materialSpec,
        traceabilityLevel: opt?.traceabilityLevel ?? part.traceabilityLevel ?? input.traceabilityLevel,
      });
    }
    await tx.db.update(customerOrders).set({ status: "converted" }).where(eq(customerOrders.id, o.id));
    await audit(tx, {
      action: "job.create",
      entityType: "job",
      entityId: job.id,
      entityRef: jobNumber,
      jobId: job.id,
      after: { fromOrder: o.ref, customerPo: o.customerPoNumber, quotation: `${rev.q.ref} rev ${rev.rev.revisionNo}`, lines: chosen.length },
    });
    return job;
  });
}

export async function listCustomerOrders(ctx: Ctx, opts: { q?: string; status?: string } = {}) {
  requirePermission(ctx, "orders.view");
  const q = opts.q?.trim();
  return ctx.db
    .select({ o: customerOrders, customer: customers.name, customerCode: customers.code, quoteRef: quotations.ref, revNo: quotationRevisions.revisionNo })
    .from(customerOrders)
    .innerJoin(customers, eq(customers.id, customerOrders.customerId))
    .leftJoin(quotationRevisions, eq(quotationRevisions.id, customerOrders.quotationRevisionId))
    .leftJoin(quotations, eq(quotations.id, quotationRevisions.quotationId))
    .where(and(opts.status ? eq(customerOrders.status, opts.status) : undefined, q ? or(ilike(customerOrders.customerPoNumber, `%${q}%`), ilike(customerOrders.ref, `%${q}%`), ilike(customers.name, `%${q}%`)) : undefined))
    .orderBy(desc(customerOrders.receivedAt))
    .limit(300);
}

export async function getCustomerOrder(ctx: Ctx, id: string) {
  requirePermission(ctx, "orders.view");
  const [row] = await ctx.db
    .select({ o: customerOrders, customer: customers, address: addresses, receivedByName: users.name })
    .from(customerOrders)
    .innerJoin(customers, eq(customers.id, customerOrders.customerId))
    .leftJoin(addresses, eq(addresses.id, customerOrders.deliveryAddressId))
    .leftJoin(users, eq(users.id, customerOrders.receivedBy))
    .where(eq(customerOrders.id, id))
    .limit(1);
  if (!row) throw notFound("Customer order");
  const quote = row.o.quotationRevisionId
    ? (await ctx.db.select({ rev: quotationRevisions, q: quotations }).from(quotationRevisions).innerJoin(quotations, eq(quotations.id, quotationRevisions.quotationId)).where(eq(quotationRevisions.id, row.o.quotationRevisionId)))[0]
    : null;
  const lines = quote ? await ctx.db.select().from(quotationLines).where(eq(quotationLines.revisionId, quote.rev.id)).orderBy(asc(quotationLines.lineNo)) : [];
  const createdJobs = await ctx.db.select().from(jobs).where(eq(jobs.customerOrderId, id));
  const verifier = row.o.verifiedBy ? (await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, row.o.verifiedBy)))[0]?.name : null;
  return { ...row, quote, lines, jobs: createdJobs, verifiedByName: verifier };
}

/** Accepted+verified revisions for a customer, for linking a PO. */
export async function acceptedRevisionsFor(ctx: Ctx, customerId: string) {
  requirePermission(ctx, "orders.view");
  return ctx.db
    .select({ rev: quotationRevisions, q: quotations })
    .from(quotationRevisions)
    .innerJoin(quotations, eq(quotations.id, quotationRevisions.quotationId))
    .where(and(eq(quotations.customerId, customerId), inArray(quotationRevisions.status, ["accepted", "awaiting_response", "sent"])))
    .orderBy(desc(quotationRevisions.createdAt));
}
