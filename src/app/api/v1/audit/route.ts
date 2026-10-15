import { and, desc, eq, lt } from "drizzle-orm";
import { apiHandler } from "@/server/api";
import { requirePermission } from "@/server/context";
import { auditEvents } from "@/server/db/schema";

/** GET /api/v1/audit?entityType=&entityId=&before= — read-only audit trail (audit.view). */
export const GET = apiHandler(async (ctx, req) => {
  requirePermission(ctx, "audit.view");
  const u = new URL(req.url);
  const entityType = u.searchParams.get("entityType");
  const entityId = u.searchParams.get("entityId");
  const before = Number(u.searchParams.get("before") ?? 0);
  const rows = await ctx.db
    .select()
    .from(auditEvents)
    .where(and(entityType ? eq(auditEvents.entityType, entityType) : undefined, entityId ? eq(auditEvents.entityId, entityId) : undefined, before ? lt(auditEvents.id, before) : undefined))
    .orderBy(desc(auditEvents.id))
    .limit(200);
  return { events: rows };
});
