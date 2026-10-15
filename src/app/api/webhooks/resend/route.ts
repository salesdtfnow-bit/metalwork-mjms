import { getDb } from "@/server/db/client";
import { ingestEmail } from "@/server/services/enquiries";
import { systemCtx } from "@/server/jobs/scheduled";
import { integrationEvents } from "@/server/db/schema";

export const maxDuration = 60;

/**
 * Resend inbound email webhook (event `email.received`). Signature verified with Svix using
 * RESEND_WEBHOOK_SECRET. The webhook carries metadata only, so the full message and
 * attachments are fetched from the Resend API. Emails are stored unassigned — never
 * automatically treated as enquiries or acceptances.
 */
export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const apiKey = process.env.RESEND_API_KEY;
  if (!secret || !apiKey) return new Response("Inbound email is not configured", { status: 503 });
  const payload = await req.text();
  const { Webhook } = await import("svix");
  let event: { type: string; data: { email_id: string; from?: string; subject?: string } };
  try {
    new Webhook(secret).verify(payload, {
      "svix-id": req.headers.get("svix-id") ?? "",
      "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
      "svix-signature": req.headers.get("svix-signature") ?? "",
    }); // throws if the signature is invalid
    event = JSON.parse(payload) as typeof event;
  } catch {
    return new Response("Invalid signature", { status: 401 });
  }
  if (event.type !== "email.received") return Response.json({ ignored: event.type });
  const db = await getDb();
  try {
    const base = "https://api.resend.com";
    const headers = { Authorization: `Bearer ${apiKey}` };
    const full = (await (await fetch(`${base}/emails/receiving/${encodeURIComponent(event.data.email_id)}`, { headers })).json()) as {
      from: string;
      to: string[];
      cc?: string[];
      subject: string;
      html?: string;
      text?: string;
      message_id?: string;
      created_at?: string;
      raw?: { download_url?: string };
    };
    const atts = (await (await fetch(`${base}/emails/receiving/${encodeURIComponent(event.data.email_id)}/attachments`, { headers })).json()) as { data?: { filename: string; content_type: string; download_url: string }[] };
    const attachments = [];
    for (const a of atts.data ?? []) {
      const res = await fetch(a.download_url);
      if (res.ok) attachments.push({ filename: a.filename, contentType: a.content_type, bytes: Buffer.from(await res.arrayBuffer()) });
    }
    const raw = full.raw?.download_url ? await fetch(full.raw.download_url).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null) : null;
    const fromMatch = /^(.*)<(.+)>$/.exec(full.from ?? "");
    const ctx = await systemCtx(db);
    const r = await ingestEmail(ctx, {
      provider: "resend",
      providerMessageId: event.data.email_id,
      messageId: full.message_id ?? null,
      from: (fromMatch?.[2] ?? full.from ?? "").trim(),
      fromName: fromMatch?.[1]?.trim().replace(/^"|"$/g, "") ?? null,
      to: full.to ?? [],
      cc: full.cc ?? [],
      subject: full.subject ?? "(no subject)",
      date: full.created_at ? new Date(full.created_at) : new Date(),
      text: full.text ?? null,
      html: full.html ?? null,
      raw: raw ? { bytes: Buffer.from(raw), name: `${event.data.email_id}.eml` } : null,
      attachments,
    });
    await db.insert(integrationEvents).values({ integration: "email", direction: "inbound", action: "email.received", status: "success", message: `Stored inbound email "${full.subject}" (${attachments.length} attachments)${r.duplicate ? " — duplicate ignored" : ""}` });
    return Response.json({ ok: true, duplicate: r.duplicate });
  } catch (e) {
    await db.insert(integrationEvents).values({ integration: "email", direction: "inbound", action: "email.received", status: "error", message: String((e as Error).message).slice(0, 500) });
    // 5xx → Resend retries delivery; ingestion is idempotent on the email id.
    return new Response("Ingestion failed", { status: 500 });
  }
}
