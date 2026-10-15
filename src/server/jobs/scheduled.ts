import { and, eq, inArray, isNotNull, lt, notInArray } from "drizzle-orm";
import type { DB } from "../db/client";
import { getSystemUserId } from "../bootstrap";
import type { Ctx } from "../context";
import { jobs, operations, stockSyncTransactions } from "../db/schema";
import { processEmailOutbox } from "../integrations/email/outbox";
import { processStockOutbox } from "../integrations/boxhero/sync";
import { expireQuotations } from "../services/quotations";
import { raiseDuePreventiveWork, calibrationDue } from "../services/maintenance";
import { overdueDeliveries } from "../services/purchasing";
import { notify } from "../services/notifications";
import { todayISO, addDaysISO } from "@/lib/format";
import { ALL_PERMISSIONS } from "../auth/permissions";

export async function systemCtx(db: DB): Promise<Ctx> {
  const id = await getSystemUserId(db);
  return { db, actor: { userId: id, name: "System (automated)", email: "system", employeeId: null, roles: ["system"], permissions: new Set<string>(ALL_PERMISSIONS), isSystem: true } };
}

/** Frequent: drain outboxes. Safe to run concurrently / repeatedly (idempotent). */
export async function runOutboxes(db: DB) {
  const email = await processEmailOutbox(db).catch((e) => ({ error: String(e) }));
  const stock = await processStockOutbox(db).catch((e) => ({ error: String(e) }));
  return { email, stock };
}

/** Daily: expiries, preventive maintenance, overdue/at-risk/calibration alerts (deduplicated per day). */
export async function runDaily(db: DB) {
  const ctx = await systemCtx(db);
  const today = todayISO();
  const expired = await expireQuotations(ctx);
  const pm = await raiseDuePreventiveWork(ctx, 7);
  for (const l of await overdueDeliveries(ctx)) {
    await notify(ctx, { type: "material.overdue", title: `Overdue delivery: ${l.po.ref} line ${l.l.lineNo} from ${l.supplier} (due ${l.l.requiredDate})`, link: `/purchasing/${l.po.id}`, permission: "purchasing.manage", dedupeKey: `overdue:${l.l.id}:${today}` });
  }
  const lateOps = await db
    .select({ op: operations, job: jobs })
    .from(operations)
    .innerJoin(jobs, eq(jobs.id, operations.jobId))
    .where(and(isNotNull(operations.plannedEnd), lt(operations.plannedEnd, new Date()), notInArray(operations.status, ["complete", "cancelled"]), notInArray(jobs.status, ["cancelled", "completed"])));
  for (const o of lateOps) await notify(ctx, { type: "operation.overdue", title: `${o.job.jobNumber} op ${o.op.opNumber} is behind schedule`, link: `/jobs/${o.job.id}?tab=route`, permission: "planning.schedule", dedupeKey: `opLate:${o.op.id}:${today}` });
  const risk = await db.select().from(jobs).where(and(notInArray(jobs.status, ["completed", "cancelled", "dispatched", "ready_for_dispatch"]), lt(jobs.requiredDate, addDaysISO(today, 3))));
  for (const j of risk) await notify(ctx, { type: "job.at_risk", title: `${j.jobNumber} is at risk of missing ${j.requiredDate}`, link: `/jobs/${j.id}`, userIds: [j.ownerId], permission: "planning.schedule", dedupeKey: `risk:${j.id}:${today}` });
  for (const i of await calibrationDue(ctx, 14)) await notify(ctx, { type: "maintenance.due", title: `Calibration due: ${i.assetNo} (${i.calibrationDueOn})`, link: `/quality/instruments/${i.id}`, permission: "quality.instruments", dedupeKey: `cal:${i.id}:${today}` });
  const failedSync = await db.select().from(stockSyncTransactions).where(inArray(stockSyncTransactions.status, ["failed", "needs_reconciliation"]));
  if (failedSync.length) await notify(ctx, { type: "integration.failure", title: `${failedSync.length} BoxHero stock movement(s) need attention`, link: `/materials?tab=boxhero`, permission: "boxhero.reconcile", dedupeKey: `bhfail:${today}` });
  const outboxes = await runOutboxes(db);
  return { expiredQuotations: expired, preventiveRaised: pm, lateOps: lateOps.length, atRisk: risk.length, failedSync: failedSync.length, outboxes };
}
