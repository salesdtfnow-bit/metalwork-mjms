import { and, asc, desc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { z } from "zod";
import {
  batches,
  correctiveActions,
  files,
  holds,
  inspections,
  jobLines,
  jobs,
  materialLots,
  ncrFiles,
  ncrs,
  operations,
  suppliers,
  users,
} from "../db/schema";
import { audit } from "../audit";
import { can, mutate, requirePermission, type Ctx } from "../context";
import { forbidden, invalid, notFound } from "../errors";
import { nextRef, REF } from "../refs";
import { d } from "@/lib/decimal";
import { storeUpload } from "../storage";
import { signApproval } from "./approvals";
import { notify } from "./notifications";

export const NCR_CATEGORIES = ["dimension", "wrong_material", "wrong_revision", "surface", "tooling", "machine", "supplier", "documentation", "customer_complaint", "other"] as const;
export const DISPOSITIONS = ["rework", "repair", "use_as_is", "scrap", "return_to_supplier", "awaiting_investigation"] as const;

type RaiseInput = {
  source?: "internal" | "supplier" | "customer_complaint" | "audit";
  category: string;
  jobId?: string | null;
  jobLineId?: string | null;
  operationId?: string | null;
  batchId?: string | null;
  lotId?: string | null;
  inspectionId?: string | null;
  supplierId?: string | null;
  customerId?: string | null;
  qtyAffected: string;
  description: string;
  containmentAction?: string | null;
  holdOperation?: boolean;
  holdJob?: boolean;
  holdBatch?: boolean;
  holdLot?: boolean;
};

/** Internal raise (used by inspections too). Places containment holds as requested. */
export async function raiseNcrInternal(ctx: Ctx, input: RaiseInput) {
  const ref = await nextRef(ctx.db, REF.ncr);
  let heatNumber: string | null = null;
  let supplierId = input.supplierId ?? null;
  let partId: string | null = null;
  let customerId = input.customerId ?? null;
  let jobLineId = input.jobLineId ?? null;
  let jobId = input.jobId ?? null;
  if (input.lotId) {
    const [lot] = await ctx.db.select().from(materialLots).where(eq(materialLots.id, input.lotId)).limit(1);
    heatNumber = lot?.heatNumber ?? null;
    supplierId = supplierId ?? lot?.supplierId ?? null;
  }
  if (input.operationId) {
    const [op] = await ctx.db.select().from(operations).where(eq(operations.id, input.operationId)).limit(1);
    jobLineId = jobLineId ?? op?.jobLineId ?? null;
    jobId = jobId ?? op?.jobId ?? null;
  }
  if (jobLineId) {
    const [jl] = await ctx.db.select().from(jobLines).where(eq(jobLines.id, jobLineId)).limit(1);
    partId = jl?.partId ?? null;
    jobId = jobId ?? jl?.jobId ?? null;
  }
  if (jobId && !customerId) customerId = (await ctx.db.select({ c: jobs.customerId }).from(jobs).where(eq(jobs.id, jobId)))[0]?.c ?? null;
  const [n] = await ctx.db
    .insert(ncrs)
    .values({
      ref,
      source: input.source ?? "internal",
      category: input.category,
      jobId,
      jobLineId,
      operationId: input.operationId ?? null,
      batchId: input.batchId ?? null,
      lotId: input.lotId ?? null,
      inspectionId: input.inspectionId ?? null,
      supplierId,
      customerId,
      partId,
      heatNumber,
      qtyAffected: input.qtyAffected,
      description: input.description,
      containmentAction: input.containmentAction ?? null,
      status: input.containmentAction ? "contained" : "open",
      raisedBy: ctx.actor.userId,
    })
    .returning();
  const reason = `NCR ${ref}: ${input.description.slice(0, 140)}`;
  if (input.holdOperation && input.operationId) {
    const [op] = await ctx.db.select().from(operations).where(eq(operations.id, input.operationId)).limit(1);
    await ctx.db.insert(holds).values({ targetType: "operation", operationId: input.operationId, jobId, ncrId: n.id, reason, qtyHeld: input.qtyAffected, placedBy: ctx.actor.userId });
    if (op && !["complete", "cancelled", "on_hold"].includes(op.status)) await ctx.db.update(operations).set({ status: "on_hold", statusBeforeHold: op.status }).where(eq(operations.id, op.id));
  }
  if (input.holdBatch && input.batchId) {
    await ctx.db.insert(holds).values({ targetType: "batch", batchId: input.batchId, jobId, ncrId: n.id, reason, qtyHeld: input.qtyAffected, placedBy: ctx.actor.userId });
    await ctx.db.update(batches).set({ status: "on_hold" }).where(eq(batches.id, input.batchId));
  }
  if (input.holdLot && input.lotId) {
    await ctx.db.insert(holds).values({ targetType: "lot", lotId: input.lotId, ncrId: n.id, reason, placedBy: ctx.actor.userId });
    await ctx.db.update(materialLots).set({ status: "quarantined", quarantineReason: reason }).where(eq(materialLots.id, input.lotId));
  }
  if (input.holdJob && jobId) {
    const [j] = await ctx.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    await ctx.db.insert(holds).values({ targetType: "job", jobId, ncrId: n.id, reason, placedBy: ctx.actor.userId });
    if (j && j.status !== "on_hold") await ctx.db.update(jobs).set({ status: "on_hold", statusBeforeHold: j.status, holdReason: reason }).where(eq(jobs.id, jobId));
  }
  await audit(ctx, { action: "ncr.raise", entityType: "ncr", entityId: n.id, entityRef: ref, jobId, operationId: input.operationId, after: { ...input } });
  await notify(ctx, { type: "ncr.raised", title: `Non-conformance ${ref} raised`, body: input.description.slice(0, 200), link: `/ncr/${n.id}`, permission: "ncr.manage", dedupeKey: `ncr:${n.id}` });
  if (jobId) {
    const { refreshJobStatus } = await import("./jobs");
    await refreshJobStatus(ctx, jobId);
  }
  return n;
}

export const raiseInput = z.object({
  source: z.enum(["internal", "supplier", "customer_complaint", "audit"]).default("internal"),
  category: z.enum(NCR_CATEGORIES),
  jobId: z.string().uuid().nullish(),
  jobLineId: z.string().uuid().nullish(),
  operationId: z.string().uuid().nullish(),
  batchId: z.string().uuid().nullish(),
  lotId: z.string().uuid().nullish(),
  supplierId: z.string().uuid().nullish(),
  customerId: z.string().uuid().nullish(),
  qtyAffected: z.string().regex(/^\d+(\.\d+)?$/, "Enter the affected quantity."),
  description: z.string().trim().min(5, "Describe the non-conformance."),
  containmentAction: z.string().nullish(),
  holdOperation: z.boolean().default(true),
  holdJob: z.boolean().default(false),
  holdBatch: z.boolean().default(true),
  holdLot: z.boolean().default(true),
});

export async function raiseNcr(ctx: Ctx, raw: z.input<typeof raiseInput>, evidence: File[] = []) {
  requirePermission(ctx, "ncr.raise");
  const data = raiseInput.parse(raw);
  if (!data.jobId && !data.lotId && !data.supplierId && !data.customerId && !data.operationId) throw invalid("Link the NCR to a job, operation, material lot, supplier or customer.");
  return mutate(ctx, async (tx) => {
    const n = await raiseNcrInternal(tx, data);
    for (const f of evidence.filter((x) => x.size)) {
      const sf = await storeUpload(tx.db, f, ctx.actor.userId);
      await tx.db.insert(ncrFiles).values({ ncrId: n.id, fileId: sf.id });
    }
    return n;
  });
}

async function loadNcr(ctx: Ctx, id: string) {
  const [n] = await ctx.db.select().from(ncrs).where(eq(ncrs.id, id)).limit(1);
  if (!n) throw notFound("NCR");
  return n;
}

export async function updateNcrInvestigation(ctx: Ctx, id: string, input: { containmentAction?: string | null; rootCause?: string | null; ownerId?: string | null }) {
  requirePermission(ctx, "ncr.manage");
  return mutate(ctx, async (tx) => {
    const n = await loadNcr(tx, id);
    if (["closed", "cancelled"].includes(n.status)) throw invalid(`NCR is ${n.status}.`);
    const patch: Partial<typeof ncrs.$inferInsert> = { ...input };
    if (input.containmentAction && n.status === "open") patch.status = "contained";
    if (input.rootCause && ["open", "contained"].includes(n.status)) patch.status = "awaiting_disposition";
    await tx.db.update(ncrs).set(patch).where(eq(ncrs.id, id));
    await audit(tx, { action: "ncr.investigation_update", entityType: "ncr", entityId: id, entityRef: n.ref, jobId: n.jobId, before: n, after: input });
  });
}

/**
 * Approves a disposition (signed). rework/repair create linked rework operations;
 * use-as-is/repair require a customer concession reference.
 */
export async function approveDisposition(
  ctx: Ctx,
  id: string,
  input: { disposition: (typeof DISPOSITIONS)[number]; notes: string; customerConcessionRef?: string | null; password: string; reworkInstructions?: string | null },
) {
  requirePermission(ctx, "ncr.disposition");
  const disposition = z.enum(DISPOSITIONS).parse(input.disposition);
  if (!input.notes?.trim()) throw invalid("Record the disposition rationale.", { field: "notes" });
  if (["use_as_is", "repair"].includes(disposition) && !input.customerConcessionRef?.trim()) {
    throw invalid("Use-as-is and repair dispositions require a customer concession / deviation reference.", { field: "customerConcessionRef" });
  }
  return mutate(ctx, async (tx) => {
    const n = await loadNcr(tx, id);
    if (["closed", "cancelled", "in_rework", "awaiting_reinspection"].includes(n.status)) throw invalid(`NCR is ${n.status.replace(/_/g, " ")}.`);
    const approval = await signApproval(tx, {
      kind: "ncr.disposition",
      entityType: "ncr",
      entityId: id,
      decision: "approved",
      meaning: `I approve the disposition "${disposition.replace(/_/g, " ")}" for ${n.ref} (${n.qtyAffected} affected).`,
      comment: input.notes,
      password: input.password,
    });
    let status = "disposition_approved";
    const created: string[] = [];
    if ((disposition === "rework" || disposition === "repair") && n.jobLineId) {
      const lineOps = await tx.db.select().from(operations).where(eq(operations.jobLineId, n.jobLineId)).orderBy(desc(operations.sequence));
      const base = n.operationId ? lineOps.find((o) => o.id === n.operationId) : lineOps[0];
      const { operationTypes } = await import("../db/schema");
      const typeId = base?.operationTypeId ?? (await tx.db.select().from(operationTypes).limit(1))[0].id;
      const seq = (lineOps[0]?.sequence ?? 0) + 1;
      const [rw] = await tx.db
        .insert(operations)
        .values({
          jobId: n.jobId!,
          jobLineId: n.jobLineId,
          batchId: n.batchId,
          sequence: seq,
          opNumber: `${base?.opNumber ?? "RW"}R`,
          operationTypeId: typeId,
          title: `${disposition === "rework" ? "Rework" : "Repair"} per ${n.ref}`,
          instructions: input.reworkInstructions ?? input.notes,
          machineId: base?.machineId ?? null,
          machineGroupId: base?.machineGroupId ?? null,
          plannedQty: n.qtyAffected,
          setupMinutesEst: "0",
          cycleMinutesEst: base?.cycleMinutesEst ?? "0",
          programRevisionId: base?.programRevisionId ?? null,
          drawingRevisionId: base?.drawingRevisionId ?? null,
          requiredCompetencyId: base?.requiredCompetencyId ?? null,
          requiresProgram: base?.requiresProgram ?? false,
          isRework: true,
          ncrId: n.id,
          status: "pending",
        })
        .returning();
      created.push(rw.id);
      status = "in_rework";
      await notify(tx, { type: "rework.required", title: `Rework required: ${n.ref}`, link: `/jobs/${n.jobId}?tab=route`, permission: "production.assign", dedupeKey: `rw:${n.id}` });
    }
    if (disposition === "scrap" && n.jobLineId) {
      const [jl] = await tx.db.select().from(jobLines).where(eq(jobLines.id, n.jobLineId)).limit(1);
      await tx.db.update(jobLines).set({ qtyScrapped: d(jl.qtyScrapped).plus(d(n.qtyAffected)).toString() }).where(eq(jobLines.id, n.jobLineId));
    }
    if (disposition === "return_to_supplier" && n.lotId) {
      await tx.db.update(materialLots).set({ status: "returned" }).where(eq(materialLots.id, n.lotId));
    }
    await tx.db
      .update(ncrs)
      .set({ disposition, dispositionNotes: input.notes, customerConcessionRef: input.customerConcessionRef ?? null, dispositionBy: ctx.actor.userId, dispositionAt: new Date(), dispositionApprovalId: approval.id, status })
      .where(eq(ncrs.id, id));
    await audit(tx, { action: "ncr.disposition", entityType: "ncr", entityId: id, entityRef: n.ref, jobId: n.jobId, approvalId: approval.id, after: { disposition, concession: input.customerConcessionRef, reworkOperations: created }, reason: input.notes });
    if (n.jobId) {
      const { refreshJobStatus } = await import("./jobs");
      await refreshJobStatus(tx, n.jobId);
    }
    return { reworkOperationIds: created };
  });
}

/** Called when a rework operation is signed off: opens a reinspection linked to the NCR. */
export async function onReworkComplete(ctx: Ctx, ncrId: string, operationId: string) {
  const n = await loadNcr(ctx, ncrId);
  if (n.status !== "in_rework") return;
  const remaining = await ctx.db.select().from(operations).where(and(eq(operations.ncrId, ncrId), notInArray(operations.status, ["complete", "cancelled"])));
  if (remaining.length) return;
  const { openInspection } = await import("./inspections");
  const [op] = await ctx.db.select().from(operations).where(eq(operations.id, operationId)).limit(1);
  const insp = await openInspection(ctx, { stage: "in_process", jobId: n.jobId, jobLineId: n.jobLineId, operationId, batchId: n.batchId, drawingRevisionId: op?.drawingRevisionId ?? null, sampleQty: n.qtyAffected, notes: `Reinspection after rework for ${n.ref}` });
  await ctx.db.update(ncrs).set({ status: "awaiting_reinspection", reinspectionId: insp.id }).where(eq(ncrs.id, ncrId));
  await audit(ctx, { action: "ncr.awaiting_reinspection", entityType: "ncr", entityId: ncrId, entityRef: n.ref, jobId: n.jobId, after: { inspection: insp.ref } });
}

/** Releases a hold. Holds linked to an NCR need the quality hold-release permission. */
export async function releaseHold(ctx: Ctx, holdId: string, reason: string) {
  if (!reason?.trim()) throw invalid("Record why the hold can be released.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const [h] = await tx.db.select().from(holds).where(eq(holds.id, holdId)).limit(1);
    if (!h || h.releasedAt) throw invalid("Hold is not active.");
    if (h.ncrId || h.targetType === "lot") requirePermission(tx, "holds.release");
    else if (!can(ctx.actor, "jobs.hold") && !can(ctx.actor, "holds.release")) throw forbidden();
    await tx.db.update(holds).set({ releasedBy: ctx.actor.userId, releasedAt: new Date(), releaseReason: reason }).where(eq(holds.id, holdId));
    if (h.operationId) {
      const others = await tx.db.select().from(holds).where(and(eq(holds.operationId, h.operationId), isNull(holds.releasedAt)));
      if (!others.length) {
        const [op] = await tx.db.select().from(operations).where(eq(operations.id, h.operationId)).limit(1);
        if (op?.status === "on_hold") await tx.db.update(operations).set({ status: await resumeStatusFor(tx, op), statusBeforeHold: null }).where(eq(operations.id, op.id));
      }
    }
    if (h.batchId) {
      const others = await tx.db.select().from(holds).where(and(eq(holds.batchId, h.batchId), isNull(holds.releasedAt)));
      if (!others.length) await tx.db.update(batches).set({ status: "in_progress" }).where(eq(batches.id, h.batchId));
    }
    if (h.lotId) {
      const others = await tx.db.select().from(holds).where(and(eq(holds.lotId, h.lotId), isNull(holds.releasedAt)));
      const [lot] = await tx.db.select().from(materialLots).where(eq(materialLots.id, h.lotId)).limit(1);
      // A quarantined lot returns to "awaiting inspection" — it must be released again explicitly.
      if (!others.length && lot?.status === "quarantined") await tx.db.update(materialLots).set({ status: "awaiting_inspection" }).where(eq(materialLots.id, h.lotId));
    }
    if (h.targetType === "job" && h.jobId) {
      const others = await tx.db.select().from(holds).where(and(eq(holds.jobId, h.jobId), eq(holds.targetType, "job"), isNull(holds.releasedAt)));
      const [j] = await tx.db.select().from(jobs).where(eq(jobs.id, h.jobId)).limit(1);
      if (!others.length && j?.status === "on_hold") await tx.db.update(jobs).set({ status: j.statusBeforeHold ?? "order_confirmed", statusBeforeHold: null, holdReason: null }).where(eq(jobs.id, h.jobId));
    }
    await audit(tx, { action: "hold.release", entityType: h.targetType, entityId: h.operationId ?? h.batchId ?? h.lotId ?? h.jobId, jobId: h.jobId, operationId: h.operationId, reason, before: h });
    if (h.jobId) {
      const { refreshJobStatus } = await import("./jobs");
      await refreshJobStatus(tx, h.jobId);
    }
  });
}

/**
 * Closes an NCR. Requires an approved disposition; rework must be complete and reinspected
 * (passed); all holds raised by the NCR are released as part of closure.
 */
export async function closeNcr(ctx: Ctx, id: string, notes: string) {
  requirePermission(ctx, "ncr.close");
  if (!notes?.trim()) throw invalid("Closure notes are required.", { field: "notes" });
  return mutate(ctx, async (tx) => {
    const n = await loadNcr(tx, id);
    if (["closed", "cancelled"].includes(n.status)) throw invalid(`NCR is already ${n.status}.`);
    if (!n.disposition || n.disposition === "awaiting_investigation") throw invalid("An approved disposition is required before closure.");
    if (["rework", "repair"].includes(n.disposition)) {
      const openRw = await tx.db.select().from(operations).where(and(eq(operations.ncrId, id), notInArray(operations.status, ["complete", "cancelled"])));
      if (openRw.length) throw invalid("Rework operations are not complete.");
      if (!n.reinspectionId) throw invalid("Reinspection has not been performed.");
      const [ri] = await tx.db.select().from(inspections).where(eq(inspections.id, n.reinspectionId)).limit(1);
      if (ri?.status !== "passed") throw invalid(`Reinspection ${ri?.ref ?? ""} has not passed.`);
    }
    const active = await tx.db.select().from(holds).where(and(eq(holds.ncrId, id), isNull(holds.releasedAt)));
    if (active.length && !can(ctx.actor, "holds.release")) throw forbidden("Releasing the NCR holds requires the hold-release permission.");
    await tx.db.update(ncrs).set({ status: "closed", closedBy: ctx.actor.userId, closedAt: new Date(), closureNotes: notes }).where(eq(ncrs.id, id));
    await audit(tx, { action: "ncr.close", entityType: "ncr", entityId: id, entityRef: n.ref, jobId: n.jobId, reason: notes });
    for (const h of active) {
      // scrapped / returned material stays out of production; other holds are released.
      if (h.lotId && n.disposition === "return_to_supplier") continue;
      await tx.db.update(holds).set({ releasedBy: ctx.actor.userId, releasedAt: new Date(), releaseReason: `NCR ${n.ref} closed` }).where(eq(holds.id, h.id));
      if (h.operationId) {
        const [op] = await tx.db.select().from(operations).where(eq(operations.id, h.operationId)).limit(1);
        const stillHeld = await tx.db.select().from(holds).where(and(eq(holds.operationId, h.operationId), isNull(holds.releasedAt)));
        if (op?.status === "on_hold" && !stillHeld.length) await tx.db.update(operations).set({ status: await resumeStatusFor(tx, op), statusBeforeHold: null }).where(eq(operations.id, op.id));
      }
      if (h.batchId) await tx.db.update(batches).set({ status: "in_progress" }).where(eq(batches.id, h.batchId));
      if (h.lotId) await tx.db.update(materialLots).set({ status: "awaiting_inspection" }).where(and(eq(materialLots.id, h.lotId), eq(materialLots.status, "quarantined")));
      if (h.targetType === "job" && h.jobId) {
        const [j] = await tx.db.select().from(jobs).where(eq(jobs.id, h.jobId)).limit(1);
        if (j?.status === "on_hold") await tx.db.update(jobs).set({ status: j.statusBeforeHold ?? "order_confirmed", statusBeforeHold: null, holdReason: null }).where(eq(jobs.id, h.jobId));
      }
    }
    if (n.jobId) {
      const { refreshJobStatus } = await import("./jobs");
      await refreshJobStatus(tx, n.jobId);
    }
  });
}

export async function cancelNcr(ctx: Ctx, id: string, reason: string) {
  requirePermission(ctx, "ncr.close");
  if (!reason?.trim()) throw invalid("A reason is required.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const n = await loadNcr(tx, id);
    if (n.disposition) throw invalid("An NCR with an approved disposition cannot be cancelled — close it instead.");
    await tx.db.update(ncrs).set({ status: "cancelled", closureNotes: reason, closedBy: ctx.actor.userId, closedAt: new Date() }).where(eq(ncrs.id, id));
    await audit(tx, { action: "ncr.cancel", entityType: "ncr", entityId: id, entityRef: n.ref, jobId: n.jobId, reason });
  });
}

// ───────────── Corrective action ─────────────

export async function createCorrectiveAction(ctx: Ctx, input: { ncrId?: string | null; title: string; problem: string; ownerId?: string | null; dueDate?: string | null }) {
  requirePermission(ctx, "capa.manage");
  if (!input.title?.trim() || !input.problem?.trim()) throw invalid("Title and problem statement are required.");
  return mutate(ctx, async (tx) => {
    const ref = await nextRef(tx.db, REF.capa);
    const [ca] = await tx.db.insert(correctiveActions).values({ ref, ncrId: input.ncrId ?? null, title: input.title.trim(), problem: input.problem.trim(), ownerId: input.ownerId ?? null, dueDate: input.dueDate || null, createdBy: ctx.actor.userId }).returning();
    await audit(tx, { action: "capa.create", entityType: "corrective_action", entityId: ca.id, entityRef: ref, after: input });
    return ca;
  });
}

export async function updateCorrectiveAction(ctx: Ctx, id: string, input: { rootCause?: string | null; action?: string | null; status?: "in_progress" | "implemented"; verificationMethod?: string | null; verificationDueDate?: string | null }) {
  requirePermission(ctx, "capa.manage");
  return mutate(ctx, async (tx) => {
    const [ca] = await tx.db.select().from(correctiveActions).where(eq(correctiveActions.id, id)).limit(1);
    if (!ca) throw notFound("Corrective action");
    if (input.status === "implemented" && !(input.action ?? ca.action)) throw invalid("Describe the action taken before marking it implemented.", { field: "action" });
    await tx.db.update(correctiveActions).set({ ...input, implementedAt: input.status === "implemented" ? new Date() : ca.implementedAt }).where(eq(correctiveActions.id, id));
    await audit(tx, { action: "capa.update", entityType: "corrective_action", entityId: id, entityRef: ca.ref, before: ca, after: input });
  });
}

/** Effectiveness verification by someone other than the action owner. */
export async function verifyCorrectiveAction(ctx: Ctx, id: string, input: { effective: boolean; notes: string }) {
  requirePermission(ctx, "capa.verify");
  if (!input.notes?.trim()) throw invalid("Record the verification evidence.", { field: "notes" });
  return mutate(ctx, async (tx) => {
    const [ca] = await tx.db.select().from(correctiveActions).where(eq(correctiveActions.id, id)).limit(1);
    if (!ca) throw notFound("Corrective action");
    if (ca.status !== "implemented") throw invalid("The action must be implemented before effectiveness can be verified.");
    if (ca.ownerId === ctx.actor.userId) throw forbidden("Effectiveness must be verified by someone other than the action owner.");
    await tx.db.update(correctiveActions).set({ status: input.effective ? "verified_effective" : "verified_ineffective", effective: input.effective, verifiedBy: ctx.actor.userId, verifiedAt: new Date(), verificationNotes: input.notes }).where(eq(correctiveActions.id, id));
    await audit(tx, { action: "capa.verify", entityType: "corrective_action", entityId: id, entityRef: ca.ref, after: input });
  });
}

// ───────────── Queries ─────────────

export async function listNcrs(ctx: Ctx, opts: { status?: string; open?: boolean; jobId?: string } = {}) {
  requirePermission(ctx, "ncr.view");
  return ctx.db
    .select({ n: ncrs, job: jobs.jobNumber, supplier: suppliers.name, raisedBy: users.name })
    .from(ncrs)
    .leftJoin(jobs, eq(jobs.id, ncrs.jobId))
    .leftJoin(suppliers, eq(suppliers.id, ncrs.supplierId))
    .leftJoin(users, eq(users.id, ncrs.raisedBy))
    .where(and(opts.status ? eq(ncrs.status, opts.status) : undefined, opts.open ? notInArray(ncrs.status, ["closed", "cancelled"]) : undefined, opts.jobId ? eq(ncrs.jobId, opts.jobId) : undefined))
    .orderBy(desc(ncrs.raisedAt))
    .limit(300);
}

export async function getNcr(ctx: Ctx, id: string) {
  requirePermission(ctx, "ncr.view");
  const n = await loadNcr(ctx, id);
  const [job, op, lot, supplier, insp, reinsp, evidence, nHolds, capas, rework] = await Promise.all([
    n.jobId ? ctx.db.select().from(jobs).where(eq(jobs.id, n.jobId)) : Promise.resolve([]),
    n.operationId ? ctx.db.select().from(operations).where(eq(operations.id, n.operationId)) : Promise.resolve([]),
    n.lotId ? ctx.db.select().from(materialLots).where(eq(materialLots.id, n.lotId)) : Promise.resolve([]),
    n.supplierId ? ctx.db.select().from(suppliers).where(eq(suppliers.id, n.supplierId)) : Promise.resolve([]),
    n.inspectionId ? ctx.db.select().from(inspections).where(eq(inspections.id, n.inspectionId)) : Promise.resolve([]),
    n.reinspectionId ? ctx.db.select().from(inspections).where(eq(inspections.id, n.reinspectionId)) : Promise.resolve([]),
    ctx.db.select({ nf: ncrFiles, f: files }).from(ncrFiles).innerJoin(files, eq(files.id, ncrFiles.fileId)).where(eq(ncrFiles.ncrId, id)),
    ctx.db.select().from(holds).where(eq(holds.ncrId, id)).orderBy(asc(holds.placedAt)),
    ctx.db.select().from(correctiveActions).where(eq(correctiveActions.ncrId, id)),
    ctx.db.select().from(operations).where(eq(operations.ncrId, id)),
  ]);
  const people = await ctx.db.select({ id: users.id, name: users.name }).from(users);
  const nm = (u: string | null) => people.find((p) => p.id === u)?.name ?? null;
  return { ncr: n, job: job[0] ?? null, operation: op[0] ?? null, lot: lot[0] ?? null, supplier: supplier[0] ?? null, inspection: insp[0] ?? null, reinspection: reinsp[0] ?? null, evidence, holds: nHolds, capas, rework, names: { raisedBy: nm(n.raisedBy), dispositionBy: nm(n.dispositionBy), closedBy: nm(n.closedBy), owner: nm(n.ownerId) } };
}

export async function listCorrectiveActions(ctx: Ctx, open = true) {
  requirePermission(ctx, "ncr.view");
  return ctx.db
    .select({ ca: correctiveActions, owner: users.name, ncrRef: ncrs.ref })
    .from(correctiveActions)
    .leftJoin(users, eq(users.id, correctiveActions.ownerId))
    .leftJoin(ncrs, eq(ncrs.id, correctiveActions.ncrId))
    .where(open ? notInArray(correctiveActions.status, ["closed", "cancelled", "verified_effective"]) : undefined)
    .orderBy(asc(correctiveActions.dueDate));
}

export async function activeHolds(ctx: Ctx) {
  return ctx.db
    .select({ h: holds, job: jobs.jobNumber, op: operations.opNumber, lot: materialLots.lotNo, ncr: ncrs.ref })
    .from(holds)
    .leftJoin(jobs, eq(jobs.id, holds.jobId))
    .leftJoin(operations, eq(operations.id, holds.operationId))
    .leftJoin(materialLots, eq(materialLots.id, holds.lotId))
    .leftJoin(ncrs, eq(ncrs.id, holds.ncrId))
    .where(isNull(holds.releasedAt))
    .orderBy(desc(holds.placedAt));
}


/** Status an operation returns to when its last hold is released. */
export async function resumeStatusFor(ctx: Ctx, op: typeof operations.$inferSelect): Promise<string> {
  const before = op.statusBeforeHold;
  if (before === "in_production" || before === "in_setup") return "paused";
  if (before === "awaiting_inspection") {
    const open = await ctx.db.select({ id: inspections.id }).from(inspections).where(and(eq(inspections.operationId, op.id), inArray(inspections.status, ["open", "in_progress"]))).limit(1);
    return open.length ? "awaiting_inspection" : "paused";
  }
  return before ?? "pending";
}
