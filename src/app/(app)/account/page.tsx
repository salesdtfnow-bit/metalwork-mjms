import Link from "next/link";
import { requireCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { PERMISSIONS, type Permission } from "@/server/auth/permissions";
import { myAccount } from "@/server/services/ui/records";
import { fmtDateTime } from "@/lib/format";
import { Badge, KeyValues, LinkButton, PageHeader, Panel, Section } from "@/components/ui";
import { PERMISSION_GROUPS } from "../admin/_components/sections";

export const metadata = { title: "My account" };

export default async function AccountPage() {
  const ctx = await requireCtx();
  const acc = await myAccount(ctx);
  const perms = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => ctx.actor.permissions.has(p));
  const groups = new Map<string, Permission[]>();
  for (const p of perms) {
    const g = p.split(".")[0];
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }

  return (
    <>
      <PageHeader title="My account" description="Your profile, roles and what you are allowed to do in MJMS." actions={<LinkButton href="/change-password">Change password</LinkButton>} />

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Profile">
          <Panel className="p-4">
            <KeyValues
              cols={2}
              items={[
                { label: "Name", value: ctx.actor.name },
                { label: "Email", value: ctx.actor.email },
                {
                  label: "Linked employee",
                  value: acc.employee ? (
                    can(ctx.actor, "employees.view") ? (
                      <Link href={`/operators/${acc.employee.id}`} className="link">
                        {acc.employee.firstName} {acc.employee.lastName} ({acc.employee.employeeNo})
                      </Link>
                    ) : (
                      `${acc.employee.firstName} ${acc.employee.lastName} (${acc.employee.employeeNo})`
                    )
                  ) : (
                    "Not linked — shop-floor work cannot be recorded until an administrator links your account to an employee record."
                  ),
                },
                { label: "Last sign-in", value: fmtDateTime(acc.user?.lastLoginAt) },
                { label: "Account created", value: fmtDateTime(acc.user?.createdAt) },
              ]}
            />
          </Panel>
        </Section>

        <Section title="Current session">
          <Panel className="p-4">
            {acc.session ? (
              <KeyValues
                cols={2}
                items={[
                  { label: "Signed in", value: fmtDateTime(acc.session.createdAt) },
                  { label: "Last activity", value: fmtDateTime(acc.session.lastSeenAt) },
                  { label: "Expires", value: fmtDateTime(acc.session.expiresAt) },
                  { label: "Last re-authentication", value: fmtDateTime(acc.session.reauthAt) },
                  { label: "IP address", value: acc.session.ipAddress },
                  { label: "Browser", value: acc.session.userAgent, wide: true },
                  { label: "Active sessions on your account", value: acc.activeSessions },
                ]}
              />
            ) : (
              <p className="text-[13px] text-steel">Session details are not available.</p>
            )}
            <p className="mt-3 text-[12px] text-steel">Changing your password signs out your other sessions. If you see sessions you do not recognise, change your password and tell an administrator.</p>
          </Panel>
        </Section>
      </div>

      <Section title={`Roles (${acc.roles.length})`}>
        <div className="flex flex-wrap gap-2">
          {acc.roles.map((r) => (
            <div key={r.key} className="rounded-md border border-line bg-sheet px-3 py-2">
              <div className="text-[13.5px] font-semibold text-ink">{r.name}</div>
              {r.description && <div className="text-[12px] text-steel">{r.description}</div>}
            </div>
          ))}
          {acc.roles.length === 0 && <p className="text-[13px] text-steel">No roles assigned.</p>}
        </div>
      </Section>

      <Section title={`Permissions (${perms.length})`}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...groups.entries()].map(([g, list]) => (
            <Panel key={g} className="p-3">
              <h3 className="mb-1.5 text-[13px] font-semibold text-ink">{PERMISSION_GROUPS[g] ?? g}</h3>
              <ul className="space-y-1">
                {list.map((p) => (
                  <li key={p} className="text-[13px]">
                    <Badge tone="success" className="mr-1.5">
                      {p}
                    </Badge>
                    <span className="text-steel">{PERMISSIONS[p]}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-steel">Permissions come from your roles. Ask an administrator if you need access to something else.</p>
      </Section>
    </>
  );
}
