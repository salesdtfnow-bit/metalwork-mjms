import { asc, eq, isNotNull, isNull } from "drizzle-orm";
import type { DB } from "../db/client";
import { dispatches, operations, timeEntries } from "../db/schema";

/**
 * DEMO ONLY. The seed records production through the real services, so every run happens
 * within seconds. This spreads completed time entries across the previous working days
 * (07:00–15:30, Mon–Fri) using the operations' estimated setup and cycle times, so that
 * utilisation, planned-vs-actual and delivery dates look like a real workshop.
 * Audit timestamps are left untouched (they record when the seed actually ran).
 */
export async function applyRealisticDemoTimings(db: DB) {
  const entries = await db.select({ t: timeEntries, op: operations }).from(timeEntries).innerJoin(operations, eq(operations.id, timeEntries.operationId)).where(isNotNull(timeEntries.endedAt)).orderBy(asc(timeEntries.startedAt));
  const DAY_START = 7 * 60;
  const DAY_END = 15 * 60 + 30;
  // Start 12 working days ago.
  const cursor = new Date();
  cursor.setUTCHours(7, 0, 0, 0);
  let back = 12;
  while (back > 0) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) back--;
  }
  const minutesOfDay = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();
  const nextWorkingMorning = (d: Date) => {
    const n = new Date(d);
    do n.setUTCDate(n.getUTCDate() + 1);
    while (n.getUTCDay() === 0 || n.getUTCDay() === 6);
    n.setUTCHours(7, 0, 0, 0);
    return n;
  };
  const opWindows = new Map<string, { start: Date; end: Date }>();
  for (const { t, op } of entries) {
    const qty = Number(t.qtyGood) + Number(t.qtyRejected) + Number(t.qtyScrapped);
    let minutes = t.kind === "setup" ? Number(op.setupMinutesEst) || 30 : Math.max(10, qty * (Number(op.cycleMinutesEst) || 1));
    minutes = Math.min(minutes, 7 * 60); // keep a single entry within a shift
    if (minutesOfDay(cursor) + minutes > DAY_END) {
      const n = nextWorkingMorning(cursor);
      cursor.setTime(n.getTime());
    }
    const start = new Date(cursor);
    const end = new Date(cursor.getTime() + minutes * 60_000);
    await db.update(timeEntries).set({ startedAt: start, endedAt: end }).where(eq(timeEntries.id, t.id));
    const w = opWindows.get(op.id);
    opWindows.set(op.id, { start: w && w.start < start ? w.start : start, end: w && w.end > end ? w.end : end });
    cursor.setTime(end.getTime() + 15 * 60_000);
    if (minutesOfDay(cursor) < DAY_START) cursor.setUTCHours(7, 0, 0, 0);
  }
  for (const [opId, w] of opWindows) {
    const [op] = await db.select().from(operations).where(eq(operations.id, opId));
    await db
      .update(operations)
      .set({ actualStart: w.start, actualEnd: op.status === "complete" ? w.end : null, signedOffAt: op.signedOffAt ? w.end : null })
      .where(eq(operations.id, opId));
  }
  // Running entries: started 50 minutes ago.
  await db.update(timeEntries).set({ startedAt: new Date(Date.now() - 50 * 60_000) }).where(isNull(timeEntries.endedAt));
  // Dispatches follow the end of production.
  const ds = await db.select().from(dispatches).where(isNotNull(dispatches.dispatchedAt));
  for (const d of ds) {
    const jobOps = await db.select({ id: operations.id }).from(operations).where(eq(operations.jobId, d.jobId));
    const lastEnd = Math.max(...jobOps.map((o) => opWindows.get(o.id)?.end.getTime() ?? 0));
    const shipped = new Date((lastEnd || Date.now() - 2 * 86_400_000) + 20 * 3_600_000);
    await db.update(dispatches).set({ dispatchedAt: shipped, deliveredAt: d.deliveredAt ? new Date(shipped.getTime() + 86_400_000) : null }).where(eq(dispatches.id, d.id));
  }
}
