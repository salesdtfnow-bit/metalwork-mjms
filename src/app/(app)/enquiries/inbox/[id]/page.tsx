import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { getInboundEmail, listEnquiries, listInbox } from "@/server/services/enquiries";
import { customerOptions } from "@/server/services/ui/sales";
import { can } from "@/server/context";
import { AppError } from "@/server/errors";
import { fmtDateTime } from "@/lib/format";
import { Badge, KeyValues, LinkButton, Notice, Section, Table, TitleBlock } from "@/components/ui";
import { InboxActions } from "../../_components/InboxActions";
import { ActionForm } from "@/components/forms";
import { restoreEmailAction } from "../../actions";

export const metadata = { title: "Inbound email" };

const STATUS_BADGE = {
  unassigned: <Badge tone="warning">Unassigned</Badge>,
  linked: <Badge tone="success">Linked to enquiry</Badge>,
  ignored: <Badge tone="muted">Ignored</Badge>,
} as Record<string, ReactNode>;

export default async function InboundEmailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageCtx("email.import");
  const { id } = await params;
  const { email: m, attachments } = await getInboundEmail(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const manageEnq = can(ctx.actor, "enquiries.manage");
  const unassigned = m.status === "unassigned";
  const [customers, open, inbox] = await Promise.all([
    unassigned && manageEnq ? customerOptions(ctx) : Promise.resolve([]),
    unassigned && manageEnq && can(ctx.actor, "enquiries.view") ? listEnquiries(ctx, { open: true }) : Promise.resolve([]),
    // listInbox carries the sender-domain customer suggestion.
    unassigned ? listInbox(ctx, "unassigned") : Promise.resolve([]),
  ]);
  const suggested = inbox.find((x) => x.id === m.id)?.suggestedCustomer ?? null;

  return (
    <>
      <TitleBlock
        kind="Inbound email"
        refNo={m.provider === "eml_upload" ? ".eml" : m.provider === "resend" ? "Resend" : m.provider}
        title={m.subject || "(no subject)"}
        status={STATUS_BADGE[m.status] ?? <Badge>{m.status}</Badge>}
        cells={[
          { label: "From", value: m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress },
          { label: "Received", value: fmtDateTime(m.receivedAt) },
          { label: "To", value: m.toAddresses.join(", ") || "—" },
          { label: "Cc", value: m.ccAddresses.join(", ") || "—" },
          { label: "Attachments", value: attachments.length },
          { label: "Imported", value: fmtDateTime(m.createdAt) },
        ]}
        actions={
          <>
            {m.rawFileId && (
              <a href={`/api/files/${m.rawFileId}`} className="link text-[13px]">
                Download original .eml
              </a>
            )}
            {m.status === "ignored" && (
              <ActionForm action={restoreEmailAction} submitLabel="Restore to unassigned" submitVariant="secondary" submitSize="sm">
                <input type="hidden" name="emailId" value={m.id} />
              </ActionForm>
            )}
            {m.enquiryId && (
              <LinkButton href={`/enquiries/${m.enquiryId}?tab=emails`} size="sm">
                Open enquiry
              </LinkButton>
            )}
          </>
        }
      />

      {unassigned && (
        <Section title="Assign this email">
          <p className="mb-2 text-[12.5px] text-steel">
            Suggested customer: {suggested ? <span className="font-medium text-ink">{suggested.name}</span> : "none (no customer email shares the sender’s domain)"}
          </p>
          <InboxActions
            emailId={m.id}
            subject={m.subject}
            suggestedCustomerId={suggested?.id}
            customers={customers.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))}
            openEnquiries={open.map(({ e, customer }) => ({ value: e.id, label: `${e.ref} — ${customer} — ${e.subject}` }))}
            canManageEnquiries={manageEnq}
          />
        </Section>
      )}

      <Section title="Message">
        {m.textBody ? (
          <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-sheet p-3 font-sans text-[13.5px] leading-relaxed text-ink">{m.textBody}</pre>
        ) : m.htmlBody ? (
          <Notice tone="info" title="This email only has a formatted (HTML) body.">
            For security the formatted version is not displayed here.{" "}
            {m.rawFileId ? (
              <>
                <a href={`/api/files/${m.rawFileId}`} className="link">
                  Download the original .eml
                </a>{" "}
                and open it in your mail client to read it.
              </>
            ) : (
              "The original message file was not stored by the provider."
            )}
          </Notice>
        ) : (
          <p className="text-[13px] text-steel">This email has no message text.</p>
        )}
      </Section>

      <Section title="Attachments">
        <Table head={["File", "Type", "Size"]} empty="No attachments (blocked file types are skipped and recorded in the audit trail).">
          {attachments.map(({ a, f }) => (
            <tr key={a.id}>
              <td>
                <a className="link break-all" href={`/api/files/${f.id}`}>
                  {a.filename}
                </a>
              </td>
              <td className="text-steel">{a.contentType ?? f.mimeType}</td>
              <td className="whitespace-nowrap text-steel">{Math.max(1, Math.round(f.sizeBytes / 1024))} KB</td>
            </tr>
          ))}
        </Table>
      </Section>

      <KeyValues
        cols={3}
        items={[
          { label: "Message-ID", value: m.messageIdHeader },
          { label: "Linked at", value: m.linkedAt ? fmtDateTime(m.linkedAt) : null },
        ]}
      />
      <p className="mt-4 text-[12px] text-steel">
        <Link href="/enquiries/inbox" className="link">
          Back to inbox
        </Link>
      </p>
    </>
  );
}
