import Link from "next/link";
import { requireCtx } from "@/server/auth/next";
import { getPreferences, listNotifications, NOTIFICATION_TYPES } from "@/server/services/notifications";
import { getEmailProvider } from "@/server/integrations/email/provider";
import { fmtDateTime } from "@/lib/format";
import { Badge, cx, Empty, Notice, PageHeader, Section, Table } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { markAllReadAction, markReadAction, savePreferencesAction } from "./actions";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const ctx = await requireCtx();
  const [list, prefs] = await Promise.all([listNotifications(ctx, { limit: 200 }), getPreferences(ctx)]);
  const sorted = [...list.filter((n) => !n.readAt), ...list.filter((n) => n.readAt)];
  const unread = list.filter((n) => !n.readAt).length;
  const pref = new Map(prefs.map((p) => [p.type, p]));
  const email = getEmailProvider();

  return (
    <>
      <PageHeader
        title="Notifications"
        description={`${unread} unread. Notifications are created by the system when something needs your attention.`}
        actions={
          unread > 0 && (
            <ActionForm action={markAllReadAction} submitLabel="Mark all as read" submitVariant="secondary" submitSize="sm" inline>
              <span />
            </ActionForm>
          )
        }
      />

      <Section title="Inbox">
        {sorted.length === 0 ? (
          <Empty title="No notifications">You will be notified here about approvals, inspections, overdue work and other events relevant to your role.</Empty>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line bg-sheet">
            {sorted.map((n) => (
              <li key={n.id} className={cx("flex flex-wrap items-start gap-3 px-3 py-2.5", !n.readAt && "border-l-[3px] border-l-dykem bg-dykem-50/40")}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {!n.readAt && <Badge tone="info">New</Badge>}
                    <span className={cx("text-[13.5px]", !n.readAt ? "font-semibold text-ink" : "text-ink-2")}>{n.title}</span>
                  </div>
                  {n.body && <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-steel">{n.body}</p>}
                  <p className="mt-0.5 text-[12px] text-steel">
                    {NOTIFICATION_TYPES[n.type as keyof typeof NOTIFICATION_TYPES] ?? n.type} · {fmtDateTime(n.createdAt)}
                    {n.readAt && <> · read {fmtDateTime(n.readAt)}</>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {n.link && n.link.startsWith("/") && !n.link.startsWith("//") && (
                    <Link href={n.link} className="link text-[13px]">
                      Open
                    </Link>
                  )}
                  {!n.readAt && (
                    <ActionForm action={markReadAction} submitLabel="Mark read" submitVariant="ghost" submitSize="sm" inline>
                      <input type="hidden" name="id" value={n.id} />
                    </ActionForm>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {list.length >= 200 && <p className="mt-1 text-[12px] text-steel">Showing the 200 most recent notifications.</p>}
      </Section>

      <Section title="Preferences">
        {!email.configured && (
          <Notice tone="warning">
            Email notifications are queued but not delivered: no email provider is configured (current provider: {email.name}). An administrator must set RESEND_API_KEY and EMAIL_FROM.
          </Notice>
        )}
        <ActionForm action={savePreferencesAction} submitLabel="Save preferences">
          <Table head={["Notification", "In-app", "Email"]}>
            {Object.entries(NOTIFICATION_TYPES).map(([type, label]) => {
              const p = pref.get(type);
              return (
                <tr key={type}>
                  <td>{label}</td>
                  <td>
                    <input type="checkbox" name="inApp" value={type} defaultChecked={p ? p.inApp : true} aria-label={`${label}: in-app`} className="h-4 w-4 accent-dykem" />
                  </td>
                  <td>
                    <input type="checkbox" name="email" value={type} defaultChecked={p ? p.email : false} aria-label={`${label}: email`} className="h-4 w-4 accent-dykem" />
                  </td>
                </tr>
              );
            })}
          </Table>
          <p className="text-[12px] text-steel">You only receive notifications for events your role is involved in. Turning off in-app notifications also hides them from the bell counter.</p>
        </ActionForm>
      </Section>
    </>
  );
}
