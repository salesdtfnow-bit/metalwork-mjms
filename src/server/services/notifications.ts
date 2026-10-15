import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "../db/client";
import { emailOutbox, notificationPreferences, notifications, rolePermissions, userRoles, users } from "../db/schema";
import type { Ctx } from "../context";
import type { Permission } from "../auth/permissions";

/** Notification types users can tune in their preferences. */
export const NOTIFICATION_TYPES = {
  "enquiry.new": "New enquiry received",
  "quotation.review": "Quotation awaiting approval",
  "order.received": "Customer PO received",
  "material.ordered": "Material ordered",
  "material.overdue": "Material delivery overdue",
  "material.awaiting_inspection": "Material received and awaiting inspection",
  "job.ready": "Job ready for production",
  "program.awaiting_approval": "CNC program awaiting approval",
  "operation.ready": "Operation ready for the next operator",
  "first_off.required": "First-off inspection required",
  "operation.overdue": "Operation overdue",
  "job.at_risk": "Job at risk of missing delivery",
  "ncr.raised": "Non-conformance raised",
  "rework.required": "Rework required",
  "maintenance.due": "Calibration or maintenance due",
  "final_qc.awaiting": "Final QC awaiting approval",
  "job.ready_for_dispatch": "Job ready for dispatch",
  "integration.failure": "BoxHero integration failure",
  "assist.requested": "Operator requested assistance",
  "drawing.revised": "Drawing or program revised — review required",
} as const;
export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export type NotifyInput = {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  entityType?: string;
  entityId?: string;
  /** Explicit recipients and/or everyone holding a permission. */
  userIds?: (string | null | undefined)[];
  permission?: Permission;
  /** Same key + user → stored once (prevents notification storms from repeated events). */
  dedupeKey?: string;
  excludeActor?: boolean;
};

async function usersWithPermission(db: DB, permission: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .where(and(eq(rolePermissions.permission, permission), eq(users.isActive, true)));
  return rows.map((r) => r.id);
}

/** Creates in-app notifications (and queued emails where users opted in). Never throws into the caller's flow. */
export async function notify(ctx: Ctx, n: NotifyInput) {
  const ids = new Set<string>((n.userIds ?? []).filter((x): x is string => !!x));
  if (n.permission) for (const id of await usersWithPermission(ctx.db, n.permission)) ids.add(id);
  if (n.excludeActor) ids.delete(ctx.actor.userId);
  if (!ids.size) return;
  const list = [...ids];
  const prefs = await ctx.db
    .select()
    .from(notificationPreferences)
    .where(and(inArray(notificationPreferences.userId, list), eq(notificationPreferences.type, n.type)));
  const pref = new Map(prefs.map((p) => [p.userId, p]));
  const inApp = list.filter((id) => pref.get(id)?.inApp !== false);
  if (inApp.length) {
    await ctx.db
      .insert(notifications)
      .values(
        inApp.map((userId) => ({
          userId,
          type: n.type,
          title: n.title,
          body: n.body ?? null,
          link: n.link ?? null,
          entityType: n.entityType ?? null,
          entityId: n.entityId ?? null,
          dedupeKey: n.dedupeKey ?? null,
        })),
      )
      .onConflictDoNothing();
  }
  const emailIds = list.filter((id) => pref.get(id)?.email === true);
  if (emailIds.length) {
    const recips = await ctx.db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, emailIds));
    const base = process.env.APP_BASE_URL ?? "";
    for (const r of recips) {
      await ctx.db
        .insert(emailOutbox)
        .values({
          idempotencyKey: `notify:${n.type}:${r.id}:${n.dedupeKey ?? crypto.randomUUID()}`,
          to: [r.email],
          subject: `[MJMS] ${n.title}`,
          html: `<p>${escapeHtml(n.title)}</p>${n.body ? `<p>${escapeHtml(n.body)}</p>` : ""}${n.link ? `<p><a href="${base}${n.link}">Open in MJMS</a></p>` : ""}`,
          text: `${n.title}\n${n.body ?? ""}\n${n.link ? base + n.link : ""}`,
        })
        .onConflictDoNothing();
    }
  }
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function unreadCount(db: DB, userId: string) {
  const [r] = await db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(r?.n ?? 0);
}

export async function listNotifications(ctx: Ctx, opts: { unreadOnly?: boolean; limit?: number } = {}) {
  return ctx.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, ctx.actor.userId), opts.unreadOnly ? isNull(notifications.readAt) : undefined))
    .orderBy(desc(notifications.createdAt))
    .limit(opts.limit ?? 100);
}

export async function markRead(ctx: Ctx, ids: string[] | "all") {
  const where =
    ids === "all"
      ? and(eq(notifications.userId, ctx.actor.userId), isNull(notifications.readAt))
      : and(eq(notifications.userId, ctx.actor.userId), inArray(notifications.id, ids));
  await ctx.db.update(notifications).set({ readAt: new Date() }).where(where);
}

export async function setPreference(ctx: Ctx, type: NotificationType, inApp: boolean, email: boolean) {
  await ctx.db
    .insert(notificationPreferences)
    .values({ userId: ctx.actor.userId, type, inApp, email })
    .onConflictDoUpdate({ target: [notificationPreferences.userId, notificationPreferences.type], set: { inApp, email } });
}

export async function getPreferences(ctx: Ctx) {
  return ctx.db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, ctx.actor.userId));
}
