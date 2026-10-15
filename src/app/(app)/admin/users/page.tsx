import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { listUsers } from "@/server/services/users";
import { userAdminOptions } from "@/server/services/ui/records";
import { fmtDateTime } from "@/lib/format";
import { Badge, Section, Table } from "@/components/ui";
import { ActionForm, CheckboxField, Disclosure, FormGrid, SelectField, TextField } from "@/components/forms";
import { createUserAction } from "../actions";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const ctx = await requirePageCtx("admin.users");
  const [users, opts] = await Promise.all([listUsers(ctx), userAdminOptions(ctx)]);
  const now = new Date();
  return (
    <>
      <Section
        title={`Users (${users.length})`}
        actions={<span className="text-[12px] text-steel">Deactivated users keep their history; accounts are never deleted.</span>}
      >
        <Table head={["Name", "Email", "Roles", "Employee", "Status", "Last sign-in", ""]} empty="No users.">
          {users.map((u) => {
            const locked = !!u.lockedUntil && u.lockedUntil > now;
            return (
              <tr key={u.id} className={u.isActive ? undefined : "text-steel"}>
                <td className="font-medium">
                  <Link href={`/admin/users/${u.id}`} className="text-dykem hover:underline">
                    {u.name}
                  </Link>
                </td>
                <td>{u.email}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {u.roles.map((r) => (
                      <Badge key={r.key} tone={r.key === "admin" ? "danger" : "neutral"}>
                        {r.name}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td>{u.employee ? `${u.employee.firstName} ${u.employee.lastName} (${u.employee.employeeNo})` : "—"}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {u.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="muted">Deactivated</Badge>}
                    {locked && <Badge tone="danger">Locked</Badge>}
                    {u.mustChangePassword && <Badge tone="warning">Must change password</Badge>}
                  </div>
                </td>
                <td className="whitespace-nowrap text-steel">{fmtDateTime(u.lastLoginAt)}</td>
                <td>
                  <Link href={`/admin/users/${u.id}`} className="link text-[13px]">
                    Manage
                  </Link>
                </td>
              </tr>
            );
          })}
        </Table>
      </Section>

      <Section title="Create user">
        <Disclosure label="New user" variant="primary">
          <ActionForm action={createUserAction} submitLabel="Create user">
            <FormGrid cols={3}>
              <TextField label="Email" name="email" type="email" required autoComplete="off" />
              <TextField label="Full name" name="name" required />
              <TextField label="Temporary password" name="password" type="password" required autoComplete="new-password" hint="At least 10 characters, not containing the email address. Give it to the user securely." />
            </FormGrid>
            <SelectField
              label="Linked employee (needed for shop-floor work)"
              name="employeeId"
              placeholder="— Not linked —"
              options={opts.employees
                .filter((e) => e.isActive && !opts.linkedEmployeeIds.has(e.id))
                .map((e) => ({ value: e.id, label: `${e.firstName} ${e.lastName} (${e.no})` }))}
            />
            <fieldset>
              <legend className="mb-1 text-[12.5px] font-medium text-ink-2">
                Roles <span className="text-red">*</span>
              </legend>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {opts.roles.map((r) => (
                  <CheckboxField key={r.id} label={r.name} name="roleKeys" value={r.key} hint={r.description ?? undefined} />
                ))}
              </div>
            </fieldset>
            <CheckboxField label="Must change password at first sign-in" name="mustChangePassword" defaultChecked />
          </ActionForm>
        </Disclosure>
      </Section>
    </>
  );
}
