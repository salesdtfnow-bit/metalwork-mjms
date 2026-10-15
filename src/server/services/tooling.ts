import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { boxheroItems, machines, operationTools, operations, toolEvents, toolMachines, tools, users } from "../db/schema";
import { audit } from "../audit";
import { mutate, requirePermission, requireAnyPermission, type Ctx } from "../context";
import { conflict, invalid, notFound } from "../errors";
import { d } from "@/lib/decimal";
import { todayISO, addDaysISO } from "@/lib/format";

export const toolInput = z.object({
  assetNo: z.string().trim().min(1).transform((s) => s.toUpperCase()),
  description: z.string().trim().min(2),
  toolType: z.enum(["cutting_tool", "insert", "holder", "fixture", "jig", "gauge", "other"]),
  location: z.string().nullish(),
  ownership: z.enum(["mjms", "boxhero"]).default("mjms"),
  boxheroItemId: z.string().uuid().nullish(),
  lifeUnit: z.enum(["none", "minutes", "cycles", "parts"]).default("none"),
  lifeLimit: z.string().nullish(),
  inspectionRequired: z.boolean().default(false),
  inspectionIntervalDays: z.number().int().min(1).nullish(),
  nextInspectionDue: z.string().nullish(),
  notes: z.string().nullish(),
  machineIds: z.array(z.string().uuid()).default([]),
});

export async function saveTool(ctx: Ctx, raw: z.input<typeof toolInput>, id?: string) {
  requirePermission(ctx, "tooling.manage");
  const data = toolInput.parse(raw);
  if (data.ownership === "boxhero" && !data.boxheroItemId) throw invalid("Link the BoxHero item for tooling owned in BoxHero.", { field: "boxheroItemId" });
  if (data.lifeUnit !== "none" && !data.lifeLimit) throw invalid("Set the life limit for life-tracked tooling.", { field: "lifeLimit" });
  return mutate(ctx, async (tx) => {
    const { machineIds, ...values } = data;
    const [dup] = await tx.db.select({ id: tools.id }).from(tools).where(eq(tools.assetNo, data.assetNo)).limit(1);
    if (dup && dup.id !== id) throw conflict(`Asset ${data.assetNo} already exists.`, { field: "assetNo" });
    const v = { ...values, nextInspectionDue: values.nextInspectionDue || (values.inspectionRequired && values.inspectionIntervalDays ? addDaysISO(todayISO(), values.inspectionIntervalDays) : null) };
    const [t] = id ? await tx.db.update(tools).set(v).where(eq(tools.id, id)).returning() : await tx.db.insert(tools).values(v).returning();
    await tx.db.delete(toolMachines).where(eq(toolMachines.toolId, t.id));
    if (machineIds.length) await tx.db.insert(toolMachines).values(machineIds.map((machineId) => ({ toolId: t.id, machineId })));
    await audit(tx, { action: id ? "tool.update" : "tool.create", entityType: "tool", entityId: t.id, entityRef: t.assetNo, after: data });
    return t;
  });
}

/** Records usage/inspection/maintenance; usage accumulates life and flags tools at their limit. */
export async function recordToolEvent(ctx: Ctx, toolId: string, input: { kind: "usage" | "inspection" | "maintenance" | "regrind" | "replacement" | "status_change"; quantity?: string | null; operationId?: string | null; notes?: string | null; status?: string | null }) {
  requireAnyPermission(ctx, "tooling.manage", "production.execute");
  return mutate(ctx, async (tx) => {
    const [t] = await tx.db.select().from(tools).where(eq(tools.id, toolId)).limit(1);
    if (!t) throw notFound("Tool");
    const patch: Partial<typeof tools.$inferInsert> = {};
    if (input.kind === "usage" && input.quantity) {
      const used = d(t.lifeUsed).plus(d(input.quantity));
      patch.lifeUsed = used.toString();
      if (t.lifeLimit && used.greaterThanOrEqualTo(d(t.lifeLimit))) patch.status = "maintenance";
    }
    if (input.kind === "regrind" || input.kind === "replacement") {
      patch.lifeUsed = "0";
      patch.status = "available";
    }
    if (input.kind === "inspection") {
      patch.nextInspectionDue = t.inspectionIntervalDays ? addDaysISO(todayISO(), t.inspectionIntervalDays) : null;
      if (input.status) patch.status = input.status;
    }
    if (input.kind === "status_change") {
      const st = z.enum(["available", "in_use", "maintenance", "quarantined", "scrapped", "lost"]).parse(input.status);
      if (!input.notes?.trim()) throw invalid("A reason is required.", { field: "notes" });
      patch.status = st;
    }
    if (Object.keys(patch).length) await tx.db.update(tools).set(patch).where(eq(tools.id, toolId));
    await tx.db.insert(toolEvents).values({ toolId, kind: input.kind, operationId: input.operationId ?? null, quantity: input.quantity ?? null, notes: input.notes ?? null, userId: ctx.actor.userId });
    await audit(tx, { action: `tool.${input.kind}`, entityType: "tool", entityId: toolId, entityRef: t.assetNo, operationId: input.operationId, after: { ...input, ...patch } });
  });
}

/** Availability of tooling required by an operation (planning check). */
export async function toolingCheck(ctx: Ctx, operationId: string) {
  const rows = await ctx.db.select({ ot: operationTools, t: tools }).from(operationTools).innerJoin(tools, eq(tools.id, operationTools.toolId)).where(eq(operationTools.operationId, operationId));
  const today = todayISO();
  return rows.map(({ t }) => {
    const issues: string[] = [];
    if (t.status !== "available" && t.status !== "in_use") issues.push(`status ${t.status}`);
    if (t.lifeLimit && d(t.lifeUsed).greaterThanOrEqualTo(d(t.lifeLimit))) issues.push("life limit reached");
    if (t.inspectionRequired && t.nextInspectionDue && t.nextInspectionDue < today) issues.push(`inspection overdue (${t.nextInspectionDue})`);
    return { tool: t, ok: issues.length === 0, issues };
  });
}

export async function listTools(ctx: Ctx) {
  requirePermission(ctx, "tooling.view");
  const rows = await ctx.db.select({ t: tools, bh: boxheroItems.name }).from(tools).leftJoin(boxheroItems, eq(boxheroItems.id, tools.boxheroItemId)).orderBy(asc(tools.assetNo));
  const tm = rows.length ? await ctx.db.select({ toolId: toolMachines.toolId, code: machines.code }).from(toolMachines).innerJoin(machines, eq(machines.id, toolMachines.machineId)).where(inArray(toolMachines.toolId, rows.map((r) => r.t.id))) : [];
  const today = todayISO();
  return rows.map((r) => ({
    ...r,
    machines: tm.filter((x) => x.toolId === r.t.id).map((x) => x.code),
    lifePct: r.t.lifeLimit ? Math.min(100, Math.round((Number(r.t.lifeUsed) / Number(r.t.lifeLimit)) * 100)) : null,
    inspectionOverdue: !!r.t.inspectionRequired && !!r.t.nextInspectionDue && r.t.nextInspectionDue < today,
  }));
}

export async function getTool(ctx: Ctx, id: string) {
  requirePermission(ctx, "tooling.view");
  const [t] = await ctx.db.select().from(tools).where(eq(tools.id, id)).limit(1);
  if (!t) throw notFound("Tool");
  const events = await ctx.db.select({ e: toolEvents, user: users.name, op: operations.opNumber }).from(toolEvents).leftJoin(users, eq(users.id, toolEvents.userId)).leftJoin(operations, eq(operations.id, toolEvents.operationId)).where(eq(toolEvents.toolId, id)).orderBy(desc(toolEvents.at));
  const mach = await ctx.db.select({ m: machines }).from(toolMachines).innerJoin(machines, eq(machines.id, toolMachines.machineId)).where(eq(toolMachines.toolId, id));
  return { tool: t, events, machines: mach.map((m) => m.m) };
}

export async function toolsDueAttention(ctx: Ctx) {
  const all = await ctx.db.select().from(tools).where(and(lte(tools.nextInspectionDue, addDaysISO(todayISO(), 14))));
  return all;
}
