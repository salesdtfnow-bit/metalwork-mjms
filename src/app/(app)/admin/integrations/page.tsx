import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { integrationStatus } from "@/server/integrations/boxhero/sync";
import { getEmailProvider } from "@/server/integrations/email/provider";
import { recentEmailOutbox, recentIntegrationEvents } from "@/server/services/ui/records";
import { fmtDateTime } from "@/lib/format";
import { SYNC_STATUS } from "@/lib/status";
import { Badge, KeyValues, Notice, Panel, Section, StatusBadge, Table } from "@/components/ui";

export const metadata = { title: "Integrations" };

const OUTBOX_TONE: Record<string, "warning" | "success" | "danger" | "muted"> = { pending: "warning", sent: "success", failed: "danger", cancelled: "muted" };

export default async function IntegrationsPage() {
  const ctx = await requirePageCtx("integrations.view");
  const canBoxhero = can(ctx.actor, "boxhero.view");
  const [boxhero, outbox, emailEvents] = await Promise.all([canBoxhero ? integrationStatus(ctx) : null, recentEmailOutbox(ctx), recentIntegrationEvents(ctx, "email", 20)]);
  const email = getEmailProvider();
  const base = process.env.APP_BASE_URL ?? "";
  const lastSuccess = boxhero?.events.find((e) => e.status === "success") ?? null;
  const lastError = boxhero?.events.find((e) => e.status === "error") ?? null;
  const problemCount = boxhero ? boxhero.problems.filter((p) => ["failed", "needs_reconciliation"].includes(p.status)).length : 0;
  const pendingCount = boxhero ? boxhero.problems.filter((p) => ["pending", "sending"].includes(p.status)).length : 0;

  return (
    <>
      <Section title="BoxHero inventory" actions={canBoxhero && <Link href="/materials?tab=boxhero" className="link text-[13px]">Open BoxHero sync &amp; reconciliation</Link>}>
        {!boxhero ? (
          <Notice tone="info">BoxHero details require the “View BoxHero stock information” permission (boxhero.view).</Notice>
        ) : (
          <Panel className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge tone={boxhero.mode === "api" ? "success" : boxhero.mode === "manual" ? "warning" : "info"}>{boxhero.label}</Badge>
              {problemCount > 0 ? <Badge tone="danger">{problemCount} transaction(s) need attention</Badge> : <Badge tone="success">No failed transactions</Badge>}
              {pendingCount > 0 && <Badge tone="warning">{pendingCount} queued</Badge>}
            </div>
            <KeyValues
              cols={4}
              items={[
                { label: "Mode", value: boxhero.mode },
                { label: "Last success", value: boxhero.state?.lastSuccessAt ? fmtDateTime(boxhero.state.lastSuccessAt) : lastSuccess ? `${fmtDateTime(lastSuccess.at)} — ${lastSuccess.message ?? lastSuccess.action}` : "None recorded" },
                { label: "Last error", value: boxhero.state?.lastErrorAt ? `${fmtDateTime(boxhero.state.lastErrorAt)} — ${boxhero.state.lastError ?? ""}` : lastError ? `${fmtDateTime(lastError.at)} — ${lastError.message ?? lastError.action}` : "None recorded" },
                {
                  label: "Transactions by status",
                  value: boxhero.counts.length ? (
                    <span className="flex flex-wrap gap-1">
                      {boxhero.counts.map((c) => (
                        <span key={c.status} className="inline-flex items-center gap-1">
                          <StatusBadge map={SYNC_STATUS} status={c.status} /> {c.n}
                        </span>
                      ))}
                    </span>
                  ) : (
                    "None"
                  ),
                },
              ]}
            />
            <p className="mt-3 text-[12px] text-steel">Mode is set in Company settings. The API token is read only from the BOXHERO_API_TOKEN environment variable and is never displayed.</p>
          </Panel>
        )}
      </Section>

      <Section title="Email">
        <Panel className="mb-3 p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-semibold">Provider: {email.name}</span>
            {email.configured ? <Badge tone="success">Configured</Badge> : <Badge tone="warning">Not configured — emails are logged to the server console only</Badge>}
            {outbox.counts.map((c) => (
              <Badge key={c.status} tone={OUTBOX_TONE[c.status] ?? "neutral"}>
                {c.status}: {c.n}
              </Badge>
            ))}
          </div>
          <p className="text-[13px] text-steel">Outbound email uses Resend when RESEND_API_KEY and EMAIL_FROM are set. Messages are queued in the outbox and retried by the outbox cron task; the idempotency key prevents duplicates.</p>
          <h3 className="mt-3 text-[13px] font-semibold text-ink">Inbound email (enquiries)</h3>
          <p className="mt-1 text-[13px] text-steel">
            Endpoint: <code className="plate rounded-sm bg-paper px-1">{base}/api/webhooks/resend</code>
          </p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[13px] text-steel">
            <li>In Resend, add a receiving domain/address and create a webhook for the event <code className="plate">email.received</code> pointing to the endpoint above.</li>
            <li>Copy the webhook signing secret into the environment variable <code className="plate">RESEND_WEBHOOK_SECRET</code> (RESEND_API_KEY must also be set — the full message is fetched from the Resend API).</li>
            <li>Received emails appear unassigned in the enquiries inbox. They are never treated as enquiries or quotation acceptances automatically.</li>
          </ol>
          {!base && <p className="mt-1 text-[12px] text-steel">Set APP_BASE_URL to show the full public URL.</p>}
        </Panel>
        <Table head={["Queued", "To", "Subject", "Status", "Attempts", "Last error", "Sent"]} empty="No emails have been queued.">
          {outbox.rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap text-steel">{fmtDateTime(r.createdAt)}</td>
              <td className="max-w-[220px] truncate">{r.to.join(", ")}</td>
              <td className="max-w-[320px] truncate">{r.subject}</td>
              <td>
                <Badge tone={OUTBOX_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
              </td>
              <td>{r.attempts}</td>
              <td className="max-w-[280px] truncate text-red">{r.lastError ?? ""}</td>
              <td className="whitespace-nowrap text-steel">{fmtDateTime(r.sentAt)}</td>
            </tr>
          ))}
        </Table>
        {emailEvents.length > 0 && (
          <div className="mt-3">
            <h3 className="mb-1 text-[13px] font-semibold text-ink">Recent email integration events</h3>
            <Table head={["When", "Direction", "Action", "Status", "Message"]}>
              {emailEvents.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-steel">{fmtDateTime(e.at)}</td>
                  <td>{e.direction}</td>
                  <td>{e.action}</td>
                  <td>
                    <Badge tone={e.status === "success" ? "success" : e.status === "error" ? "danger" : "warning"}>{e.status}</Badge>
                  </td>
                  <td className="max-w-[420px] truncate text-steel">{e.message ?? ""}</td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </Section>

      <Section title="Scheduled tasks (cron)">
        <p className="mb-2 text-[13px] text-steel">
          Called by Vercel Cron (or any scheduler) with the header <code className="plate">Authorization: Bearer $CRON_SECRET</code>. CRON_SECRET must be at least 16 characters. Every task is idempotent, so a missed or repeated run is safe.
        </p>
        <Table head={["Endpoint", "Purpose", "Suggested schedule"]}>
          <tr>
            <td className="plate">{base}/api/cron/daily</td>
            <td>Expires lapsed quotations, raises due preventive maintenance, sends overdue-delivery, late-operation, at-risk, calibration and BoxHero-failure alerts, then runs both outboxes.</td>
            <td>Daily, early morning</td>
          </tr>
          <tr>
            <td className="plate">{base}/api/cron/outbox</td>
            <td>Sends queued emails and BoxHero stock movements (safety net — actions also flush the outboxes immediately).</td>
            <td>Every 5–15 minutes</td>
          </tr>
          <tr>
            <td className="plate">{base}/api/cron/boxhero-sync</td>
            <td>Refreshes the BoxHero item and location catalogue.</td>
            <td>Hourly or daily</td>
          </tr>
        </Table>
        <p className="mt-2 text-[12px] text-steel">
          CRON_SECRET is {process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 16 ? <strong className="text-green">set</strong> : <strong className="text-red">not set or too short — scheduled tasks will be rejected</strong>}.
        </p>
      </Section>
    </>
  );
}
