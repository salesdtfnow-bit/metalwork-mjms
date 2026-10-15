import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { DB } from "../../db/client";
import { emailOutbox, files, integrationEvents, integrationState } from "../../db/schema";
import { getEmailProvider, type EmailProvider } from "./provider";
import { readFileBytes } from "../../storage";

export async function queueEmail(
  db: DB,
  msg: { idempotencyKey: string; to: string[]; subject: string; html: string; text?: string; attachmentFileIds?: string[] },
) {
  await db
    .insert(emailOutbox)
    .values({ ...msg, attachmentFileIds: msg.attachmentFileIds ?? null })
    .onConflictDoNothing();
}

const MAX_ATTEMPTS = 6;

/**
 * Sends pending emails. Safe to run concurrently and repeatedly: each row is claimed with
 * a conditional update, and Resend dedupes on the idempotency key.
 */
export async function processEmailOutbox(db: DB, provider: EmailProvider = getEmailProvider(), limit = 20) {
  const due = await db
    .select()
    .from(emailOutbox)
    .where(and(eq(emailOutbox.status, "pending"), lte(emailOutbox.nextAttemptAt, new Date())))
    .limit(limit);
  let sent = 0;
  let failed = 0;
  for (const m of due) {
    const claimed = await db
      .update(emailOutbox)
      .set({ attempts: sql`${emailOutbox.attempts} + 1`, nextAttemptAt: new Date(Date.now() + 5 * 60_000) })
      .where(and(eq(emailOutbox.id, m.id), eq(emailOutbox.status, "pending"), eq(emailOutbox.attempts, m.attempts)))
      .returning();
    if (!claimed.length) continue;
    try {
      const attachments = [];
      if (m.attachmentFileIds?.length) {
        const fs = await db.select().from(files).where(inArray(files.id, m.attachmentFileIds));
        for (const f of fs) attachments.push({ filename: f.originalName, content: await readFileBytes(f), contentType: f.mimeType });
      }
      const res = await provider.send({ to: m.to, subject: m.subject, html: m.html, text: m.text, attachments, idempotencyKey: m.idempotencyKey });
      await db.update(emailOutbox).set({ status: "sent", sentAt: new Date(), providerMessageId: res.id, lastError: null }).where(eq(emailOutbox.id, m.id));
      sent++;
    } catch (e) {
      const attempts = m.attempts + 1;
      const final = attempts >= MAX_ATTEMPTS;
      await db
        .update(emailOutbox)
        .set({
          status: final ? "failed" : "pending",
          lastError: String((e as Error).message ?? e).slice(0, 1000),
          nextAttemptAt: new Date(Date.now() + Math.min(2 ** attempts, 120) * 60_000),
        })
        .where(eq(emailOutbox.id, m.id));
      await db.insert(integrationEvents).values({ integration: "email", direction: "outbound", action: "send", status: "error", message: String((e as Error).message ?? e).slice(0, 500), detail: { outboxId: m.id, attempts } });
      failed++;
    }
  }
  if (due.length) {
    await db
      .insert(integrationState)
      .values({ key: "email", lastSuccessAt: sent ? new Date() : null, lastErrorAt: failed ? new Date() : null })
      .onConflictDoUpdate({
        target: integrationState.key,
        set: { ...(sent ? { lastSuccessAt: new Date() } : {}), ...(failed ? { lastErrorAt: new Date() } : {}) },
      });
  }
  return { sent, failed, provider: provider.name };
}
