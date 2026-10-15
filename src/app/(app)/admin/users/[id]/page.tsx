import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { listUsers } from "@/server/services/users";
import { userAdminOptions, userAuditEvents, userSessions } from "@/server/services/ui/records";
import { fmtDateTime } from "@/lib/format";
import { Badge, Notice, Panel, Section, Table, TitleBlock } from "@/components/ui";
import { ActionForm, CheckboxField, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { AuditList } from "@/components/AuditList";
import { createUserEmployeeAction, resetPasswordAction, setUserActiveAction, updateUserAction } from "../../actions";

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageCtx("admin.users");
  const { id } = await params;
  const users = await listUsers(ctx);
  const u = users.find((x) => x.id === id);
  if (!u) notFound();
  const [opts, sessions, events] = await Promise.all([userAdminOptions(ctx), userSessions(ctx, id), userAuditEvents(ctx, id)]);
  const now = new Date();
  const locked = !!u.lockedUntil && u.lockedUntil > now;
  const self = u.id === ctx.actor.userId;
  const roleKeys = new Set(u.roles.map((r) => r.key));
  const [firstName, ...rest] = u.name.trim().split(/\s+/);

  return (
    <>
      <p className="mb-2 text-[13px]">
        <Link href="/admin/users" className="link">
          ← All users
        </Link>
      </p>
      <TitleBlock
        kind="User"
        refNo={u.email}
        title={u.name}
        status={
          <>
            {u.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="muted">Deactivated</Badge>}
            {locked && <Badge tone="danger">Locked until {fmtDateTime(u.lockedUntil)}</Badge>}
            {u.mustChangePassword && <Badge tone="warning">Must change password</Badge>}
          </>
        }
        cells={[
          { label: "Roles", value: u.roles.map((r) => r.name).join(", ") || "None" },
          { label: "Employee", value: u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : "Not linked" },
          { label: "Last sign-in", value: fmtDateTime(u.lastLoginAt) },
          { label: "Failed sign-ins", value: u.failedLoginCount },
          { label: "Created", value: fmtDateTime(u.createdAt) },
          { label: "Deactivated", value: fmtDateTime(u.deactivatedAt) },
        ]}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Name, roles and employee">
          <Panel className="p-4">
            <ActionForm action={updateUserAction} submitLabel="Save user">
              <input type="hidden" name="id" value={u.id} />
              <Notice tone="warning">Saving signs this user out of every session so the new roles take effect at their next sign-in.</Notice>
              <FormGrid>
                <TextField label="Full name" name="name" required defaultValue={u.name} />
                <SelectField
                  label="Linked employee"
                  name="employeeId"
                  placeholder="— Not linked —"
                  defaultValue={u.employeeId}
                  options={opts.employees
                    .filter((e) => e.id === u.employeeId || (e.isActive && !opts.linkedEmployeeIds.has(e.id)))
                    .map((e) => ({ value: e.id, label: `${e.firstName} ${e.lastName} (${e.no})` }))}
                />
              </FormGrid>
              <fieldset>
                <legend className="mb-1 text-[12.5px] font-medium text-ink-2">Roles</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {opts.roles.map((r) => (
                    <CheckboxField key={r.id} label={r.name} name="roleKeys" value={r.key} defaultChecked={roleKeys.has(r.key)} hint={r.description ?? undefined} />
                  ))}
                </div>
                {self && <p className="mt-1 text-[12px] text-steel">You cannot remove your own administrator role.</p>}
              </fieldset>
            </ActionForm>
          </Panel>
          {!u.employeeId && (
            <Panel className="mt-4 p-4">
              <h3 className="mb-1 font-semibold text-ink">Also works on the shop floor?</h3>
              <p className="mb-3 text-[13px] text-steel">
                Create an employee record for this sign-in so they can be assigned operations, hold competencies and use My work. Any role can do this, administrators
                included. They still cannot approve inspections or releases of their own work.
              </p>
              <ActionForm action={createUserEmployeeAction} submitLabel="Create and link employee record">
                <input type="hidden" name="id" value={u.id} />
                <FormGrid>
                  <TextField label="First name" name="firstName" required defaultValue={firstName} />
                  <TextField label="Last name" name="lastName" required defaultValue={rest.join(" ")} />
                  <TextField label="Employee ID" name="employeeNo" required hint="Your payroll or clock number, e.g. E101." />
                  <TextField label="Job title" name="jobTitle" />
                  <TextField label="Shift" name="shift" />
                  <TextField label="Badge code" name="badgeCode" hint="Optional. For scanning a badge on shop-floor terminals." />
                </FormGrid>
              </ActionForm>
            </Panel>
          )}
        </Section>

        <div>
          <Section title="Reset password">
            <Panel className="p-4">
              <ActionForm action={resetPasswordAction} submitLabel="Reset password" confirm="The user's sessions will be signed out and they must change the temporary password at next sign-in." resetOnSuccess>
                <input type="hidden" name="id" value={u.id} />
                <TextField label="New temporary password" name="password" type="password" required autoComplete="new-password" hint="At least 10 characters. Also clears any sign-in lockout." />
              </ActionForm>
            </Panel>
          </Section>

          <Section title={u.isActive ? "Deactivate account" : "Reactivate account"}>
            <Panel className="p-4">
              {self && u.isActive ? (
                <p className="text-[13px] text-steel">You cannot deactivate your own account.</p>
              ) : (
                <ActionForm
                  action={setUserActiveAction}
                  submitLabel={u.isActive ? "Deactivate user" : "Reactivate user"}
                  submitVariant={u.isActive ? "danger" : "primary"}
                  confirm={u.isActive ? "The user is signed out immediately and can no longer sign in. Their records and history are kept." : "The user will be able to sign in again with their current password."}
                >
                  <input type="hidden" name="id" value={u.id} />
                  <input type="hidden" name="active" value={u.isActive ? "false" : "true"} />
                  <TextArea label="Reason" name="reason" required rows={2} />
                </ActionForm>
              )}
            </Panel>
          </Section>
        </div>
      </div>

      <Section title="Sessions">
        <Table head={["Signed in", "Last activity", "Expires", "Status", "IP address", "Browser"]} empty="No sessions recorded.">
          {sessions.map((s, i) => {
            const active = !s.revokedAt && s.expiresAt > now;
            return (
              <tr key={i}>
                <td className="whitespace-nowrap">{fmtDateTime(s.createdAt)}</td>
                <td className="whitespace-nowrap">{fmtDateTime(s.lastSeenAt)}</td>
                <td className="whitespace-nowrap">{fmtDateTime(s.expiresAt)}</td>
                <td>{active ? <Badge tone="success">Active</Badge> : s.revokedAt ? <Badge tone="muted">Signed out</Badge> : <Badge tone="muted">Expired</Badge>}</td>
                <td>{s.ipAddress ?? "—"}</td>
                <td className="max-w-[320px] truncate text-steel">{s.userAgent ?? "—"}</td>
              </tr>
            );
          })}
        </Table>
      </Section>

      <Section title="Account changes">
        <AuditList events={events} empty="No account changes recorded." />
      </Section>
      <CheckboxNote />
    </>
  );
}

function CheckboxNote() {
  return <p className="text-[12px] text-steel">Sign-in attempts and denied actions by this user are in the audit trail (filter by user).</p>;
}

