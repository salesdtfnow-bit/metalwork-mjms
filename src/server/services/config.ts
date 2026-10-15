import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { downtimeReasons, releaseChecklistTemplates, retentionPolicies, statusTransitions } from "../db/schema";
import { audit } from "../audit";
import { mutate, requirePermission, type Ctx } from "../context";
import { conflict, invalid, notFound } from "../errors";
import { isPermission } from "../auth/permissions";
import { JOB_STATUS } from "@/lib/status";

/**
 * Administrator configuration tables that have no dedicated module service:
 * job status transitions, final-release checklist templates, downtime reasons and
 * retention policies. Every change is audited in the same transaction.
 */

const jobStatusKey = z.string().refine((s) => s in JOB_STATUS, "Unknown job status.");

export const statusTransitionInput = z.object({
  id: z.string().uuid().nullish(),
  entityType: z.literal("job").default("job"),
  fromStatus: z.string().refine((s) => s === "*" || s in JOB_STATUS, "Unknown job status."),
  toStatus: jobStatusKey,
  permission: z.string().refine(isPermission, "Unknown permission."),
  requiresReason: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export async function saveStatusTransition(ctx: Ctx, raw: z.input<typeof statusTransitionInput>) {
  requirePermission(ctx, "admin.config");
  const data = statusTransitionInput.parse(raw);
  if (data.fromStatus === data.toStatus) throw invalid("A transition must change the status.", { field: "toStatus" });
  return mutate(ctx, async (tx) => {
    const [dup] = await tx.db
      .select({ id: statusTransitions.id })
      .from(statusTransitions)
      .where(
        and(
          eq(statusTransitions.entityType, data.entityType),
          eq(statusTransitions.fromStatus, data.fromStatus),
          eq(statusTransitions.toStatus, data.toStatus),
          data.id ? ne(statusTransitions.id, data.id) : undefined,
        ),
      )
      .limit(1);
    if (dup) throw conflict("This transition already exists — edit the existing row instead.", { field: "toStatus" });
    const values = { entityType: data.entityType, fromStatus: data.fromStatus, toStatus: data.toStatus, permission: data.permission, requiresReason: data.requiresReason, isActive: data.isActive };
    let before: unknown = null;
    let row;
    if (data.id) {
      [before] = await tx.db.select().from(statusTransitions).where(eq(statusTransitions.id, data.id)).limit(1);
      if (!before) throw notFound("Status transition");
      [row] = await tx.db.update(statusTransitions).set(values).where(eq(statusTransitions.id, data.id)).returning();
    } else {
      [row] = await tx.db.insert(statusTransitions).values(values).returning();
    }
    await audit(tx, { action: data.id ? "status_transition.update" : "status_transition.create", entityType: "status_transition", entityId: row.id, entityRef: `${row.entityType}: ${row.fromStatus} → ${row.toStatus}`, before, after: values });
    return row;
  });
}

export const checklistTemplateInput = z.object({
  id: z.string().uuid().nullish(),
  label: z.string().trim().min(3, "Describe the checklist item."),
  guidance: z.string().trim().nullish(),
  required: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(100),
  isActive: z.boolean().default(true),
});

export async function saveChecklistTemplate(ctx: Ctx, raw: z.input<typeof checklistTemplateInput>) {
  requirePermission(ctx, "admin.config");
  const data = checklistTemplateInput.parse(raw);
  return mutate(ctx, async (tx) => {
    const values = { label: data.label, guidance: data.guidance ?? null, required: data.required, sortOrder: data.sortOrder, isActive: data.isActive };
    let before: unknown = null;
    let row;
    if (data.id) {
      [before] = await tx.db.select().from(releaseChecklistTemplates).where(eq(releaseChecklistTemplates.id, data.id)).limit(1);
      if (!before) throw notFound("Checklist item");
      [row] = await tx.db.update(releaseChecklistTemplates).set(values).where(eq(releaseChecklistTemplates.id, data.id)).returning();
    } else {
      [row] = await tx.db.insert(releaseChecklistTemplates).values(values).returning();
    }
    await audit(tx, { action: data.id ? "release_checklist.update" : "release_checklist.create", entityType: "release_checklist_template", entityId: row.id, entityRef: row.label, before, after: values });
    return row;
  });
}

export const downtimeReasonInput = z.object({
  id: z.string().uuid().nullish(),
  code: z.string().trim().min(2, "Code is required.").max(20).transform((s) => s.toUpperCase()),
  name: z.string().trim().min(2, "Name is required."),
  category: z.enum(["planned", "unplanned"]),
  isActive: z.boolean().default(true),
});

export async function saveDowntimeReason(ctx: Ctx, raw: z.input<typeof downtimeReasonInput>) {
  requirePermission(ctx, "admin.config");
  const data = downtimeReasonInput.parse(raw);
  return mutate(ctx, async (tx) => {
    const [dup] = await tx.db
      .select({ id: downtimeReasons.id })
      .from(downtimeReasons)
      .where(and(eq(downtimeReasons.code, data.code), data.id ? ne(downtimeReasons.id, data.id) : undefined))
      .limit(1);
    if (dup) throw conflict(`Downtime reason code ${data.code} is already used.`, { field: "code" });
    const values = { code: data.code, name: data.name, category: data.category, isActive: data.isActive };
    let before: unknown = null;
    let row;
    if (data.id) {
      [before] = await tx.db.select().from(downtimeReasons).where(eq(downtimeReasons.id, data.id)).limit(1);
      if (!before) throw notFound("Downtime reason");
      [row] = await tx.db.update(downtimeReasons).set(values).where(eq(downtimeReasons.id, data.id)).returning();
    } else {
      [row] = await tx.db.insert(downtimeReasons).values(values).returning();
    }
    await audit(tx, { action: data.id ? "downtime_reason.update" : "downtime_reason.create", entityType: "downtime_reason", entityId: row.id, entityRef: row.code, before, after: values });
    return row;
  });
}

export const retentionPolicyInput = z.object({
  id: z.string().uuid().nullish(),
  recordType: z.string().trim().min(2, "Record type is required."),
  years: z.number().int().min(1, "At least 1 year.").max(100),
  basis: z.string().trim().min(2).default("from record closure"),
  notes: z.string().trim().nullish(),
});

/**
 * Retention policies are documentation of how long records are kept. MJMS never deletes
 * quality or manufacturing records automatically.
 */
export async function saveRetentionPolicy(ctx: Ctx, raw: z.input<typeof retentionPolicyInput>) {
  requirePermission(ctx, "admin.config");
  const data = retentionPolicyInput.parse(raw);
  return mutate(ctx, async (tx) => {
    const values = { recordType: data.recordType, years: data.years, basis: data.basis, notes: data.notes ?? null };
    let before: unknown = null;
    let row;
    if (data.id) {
      [before] = await tx.db.select().from(retentionPolicies).where(eq(retentionPolicies.id, data.id)).limit(1);
      if (!before) throw notFound("Retention policy");
      [row] = await tx.db.update(retentionPolicies).set(values).where(eq(retentionPolicies.id, data.id)).returning();
    } else {
      [row] = await tx.db.insert(retentionPolicies).values(values).returning();
    }
    await audit(tx, { action: data.id ? "retention_policy.update" : "retention_policy.create", entityType: "retention_policy", entityId: row.id, entityRef: row.recordType, before, after: values });
    return row;
  });
}
