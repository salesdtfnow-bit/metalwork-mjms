import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { listEnquiries, listInbox } from "@/server/services/enquiries";
import { customerOptions } from "@/server/services/ui/sales";
import { can } from "@/server/context";
import { fmtDateTime } from "@/lib/format";
import { Badge, Empty, NotYet, PageHeader, Panel, Section, Table, Tabs } from "@/components/ui";
import { ActionForm, Disclosure, FileField } from "@/components/forms";
import { InboxActions } from "../_components/InboxActions";
import { importEmlAction, restoreEmailAction } from "../actions";

export const metadata = { title: "Email inbox" };

const TABS = ["unassigned", "linked", "ignored"] as const;
type Tab = (typeof TABS)[number];

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageCtx("email.import");
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "unassigned";
  const manageEnq = can(ctx.actor, "enquiries.manage");
  const [rows, customers, open] = await Promise.all([
    listInbox(ctx, tab),
    tab === "unassigned" && manageEnq ? customerOptions(ctx) : Promise.resolve([]),
    tab === "unassigned" && manageEnq && can(ctx.actor, "enquiries.view") ? listEnquiries(ctx, { open: true }) : Promise.resolve([]),
  ]);
  const customerOpts = customers.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }));
  const enquiryOpts = open.map(({ e, customer }) => ({ value: e.id, label: `${e.ref} — ${customer} — ${e.subject}` }));
  const resendConfigured = !!process.env.RESEND_WEBHOOK_SECRET;

  return (
    <>
      <PageHeader
        title="Email inbox"
        description={
          <>
            Inbound customer emails waiting to be turned into enquiries. Nothing is linked automatically — each email is checked and assigned by a person.{" "}
            <Link href="/enquiries" className="link">
              Back to enquiries
            </Link>
          </>
        }
        actions={
          <Disclosure label="Import .eml file" variant="primary">
            <ActionForm action={importEmlAction} submitLabel="Import" resetOnSuccess className="w-[min(420px,80vw)]">
              <FileField label="Email file (.eml)" name="file" accept=".eml,message/rfc822" required hint="In Outlook, drag the message to a folder or use File › Save as to get an .eml file." />
            </ActionForm>
          </Disclosure>
        }
      />

      <Section title="Email sources">
        <div className="grid gap-3 lg:grid-cols-3">
          <Panel className="p-3 text-[13px]">
            <p className="font-semibold text-ink">.eml upload</p>
            <p className="mt-1 text-steel">Always available — no configuration needed. Use it for emails saved from any mail client.</p>
          </Panel>
          <Panel className="p-3 text-[13px]">
            <p className="flex items-center gap-2 font-semibold text-ink">
              Resend inbound {resendConfigured ? <Badge tone="success">Configured</Badge> : <Badge tone="muted">Not configured</Badge>}
            </p>
            <p className="mt-1 text-steel">
              When <code className="plate text-[12px]">RESEND_WEBHOOK_SECRET</code> and <code className="plate text-[12px]">RESEND_API_KEY</code> are set and the webhook points at <code className="plate text-[12px]">/api/webhooks/resend</code>, emails sent to the inbound address arrive here automatically.
            </p>
          </Panel>
          <div>
            <p className="mb-1 text-[13px] font-semibold text-ink">Microsoft 365</p>
            <NotYet>Direct Microsoft 365 (Graph) mailbox import is planned but not built. Forward the mailbox to the Resend inbound address, or upload .eml files.</NotYet>
          </div>
        </div>
      </Section>

      <Tabs base="/enquiries/inbox" current={tab} tabs={TABS.map((t) => ({ key: t, label: t === "unassigned" ? "Unassigned" : t === "linked" ? "Linked" : "Ignored", count: t === tab ? rows.length : undefined }))} />

      {tab === "unassigned" ? (
        rows.length === 0 ? (
          <Empty title="No unassigned emails">New inbound emails appear here. Import an .eml file to add one by hand.</Empty>
        ) : (
          <div className="space-y-3">
            {rows.map((m) => (
              <article key={m.id} className="rounded-md border border-line bg-sheet p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/enquiries/inbox/${m.id}`} className="font-semibold text-dykem hover:underline">
                      {m.subject || "(no subject)"}
                    </Link>
                    <p className="text-[12.5px] text-steel">
                      From {m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-steel">
                    <span>{fmtDateTime(m.receivedAt)}</span>
                    <Badge tone={m.attachmentCount ? "info" : "muted"}>{m.attachmentCount === 1 ? "1 attachment" : `${m.attachmentCount} attachments`}</Badge>
                    <Badge tone="muted">{m.provider === "eml_upload" ? ".eml upload" : m.provider === "resend" ? "Resend" : m.provider}</Badge>
                  </div>
                </div>
                {m.textBody && <p className="mt-2 line-clamp-2 max-w-[110ch] text-[13px] text-ink-2">{m.textBody.slice(0, 400)}</p>}
                <p className="mt-2 text-[12.5px] text-steel">
                  Suggested customer: {m.suggestedCustomer ? <span className="font-medium text-ink">{m.suggestedCustomer.name}</span> : "none (no customer email shares the sender’s domain)"}
                </p>
                <div className="mt-2">
                  <InboxActions
                    emailId={m.id}
                    subject={m.subject}
                    suggestedCustomerId={m.suggestedCustomer?.id}
                    customers={customerOpts}
                    openEnquiries={enquiryOpts}
                    canManageEnquiries={manageEnq}
                  />
                </div>
              </article>
            ))}
          </div>
        )
      ) : (
        <Table head={["Received", "From", "Subject", "Attachments", tab === "linked" ? "Enquiry" : ""]} empty={tab === "linked" ? "No linked emails yet." : "No ignored emails."}>
          {rows.map((m) => (
            <tr key={m.id}>
              <td className="whitespace-nowrap text-steel">{fmtDateTime(m.receivedAt)}</td>
              <td className="max-w-[260px] truncate">{m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress}</td>
              <td>
                <Link href={`/enquiries/inbox/${m.id}`} className="link">
                  {m.subject || "(no subject)"}
                </Link>
              </td>
              <td className="text-center">{m.attachmentCount}</td>
              <td>
                {m.enquiryId && (
                  <Link href={`/enquiries/${m.enquiryId}?tab=emails`} className="link">
                    Open enquiry
                  </Link>
                )}
                {m.status === "ignored" && (
                  <ActionForm action={restoreEmailAction} submitLabel="Restore" submitVariant="secondary" submitSize="sm">
                    <input type="hidden" name="emailId" value={m.id} />
                  </ActionForm>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
