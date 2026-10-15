import { Fragment } from "react";
import { requirePageCtx } from "@/server/auth/next";
import { listRoles } from "@/server/services/users";
import { PERMISSIONS, type Permission } from "@/server/auth/permissions";
import { Badge, Notice, Section } from "@/components/ui";
import { ActionForm, Disclosure, FormGrid, TextField } from "@/components/forms";
import { createRoleAction, saveRoleMatrixAction } from "../actions";
import { PERMISSION_GROUPS } from "../_components/sections";

export const metadata = { title: "Roles & permissions" };

function grouped() {
  const groups = new Map<string, Permission[]>();
  for (const p of Object.keys(PERMISSIONS) as Permission[]) {
    const g = p.split(".")[0];
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }
  return [...groups.entries()];
}

export default async function RolesPage() {
  const ctx = await requirePageCtx("admin.roles");
  const roles = await listRoles(ctx);
  const groups = grouped();
  const editable = roles.filter((r) => r.key !== "admin");

  return (
    <>
      <Section title={`Permission matrix (${roles.length} roles)`}>
        <Notice tone="info">
          Tick the permissions each role grants and save. Users holding a changed role are signed out so the new permissions apply at their next sign-in. The System administrator role always has every permission and cannot be edited. The server checks every permission regardless of what the screens show.
        </Notice>
        <ActionForm action={saveRoleMatrixAction} submitLabel="Save permission changes">
          {editable.map((r) => (
            <input key={r.id} type="hidden" name="roleIds" value={r.id} />
          ))}
          <div className="max-h-[70vh] overflow-auto rounded-md border border-line bg-sheet">
            <table className="data-table">
              <thead className="sticky top-0 z-10 bg-sheet">
                <tr>
                  <th scope="col" className="min-w-[280px]">
                    Permission
                  </th>
                  {roles.map((r) => (
                    <th key={r.id} scope="col" className="min-w-[88px] text-center align-bottom">
                      <span className="block text-[12px] leading-tight">{r.name}</span>
                      {r.key === "admin" && <span className="block text-[10.5px] font-normal text-steel">read-only</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map(([g, perms]) => (
                  <Fragment key={g}>
                    <tr>
                      <th scope="rowgroup" colSpan={roles.length + 1} className="bg-line-2/60 text-left text-[12px] font-semibold uppercase tracking-wide text-ink-2">
                        {PERMISSION_GROUPS[g] ?? g}
                      </th>
                    </tr>
                    {perms.map((p) => (
                      <tr key={p}>
                        <td>
                          <span className="plate text-[12.5px]">{p}</span>
                          <span className="block text-[12px] text-steel">{PERMISSIONS[p]}</span>
                        </td>
                        {roles.map((r) => (
                          <td key={r.id} className="text-center">
                            {r.key === "admin" ? (
                              <input type="checkbox" checked readOnly disabled aria-label={`${r.name}: ${p}`} className="h-4 w-4 accent-dykem" />
                            ) : (
                              <input type="checkbox" name={`perm_${r.id}`} value={p} defaultChecked={r.permissions.includes(p)} aria-label={`${r.name}: ${p}`} className="h-4 w-4 accent-dykem" />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </ActionForm>
      </Section>

      <Section title="Roles">
        <div className="mb-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {roles.map((r) => (
            <div key={r.id} className="rounded-md border border-line bg-sheet px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-[13.5px] font-semibold text-ink">{r.name}</span>
                <span className="plate text-[12px] text-steel">{r.key}</span>
                {r.isSystem && <Badge tone="info">System</Badge>}
              </div>
              {r.description && <p className="text-[12px] text-steel">{r.description}</p>}
              <p className="mt-1 text-[12px] text-steel">{r.key === "admin" ? "All permissions" : `${r.permissions.length} permission(s)`}</p>
            </div>
          ))}
        </div>
        <Disclosure label="Create role" variant="primary">
          <ActionForm action={createRoleAction} submitLabel="Create role">
            <FormGrid cols={3}>
              <TextField label="Key" name="key" required hint="Lower-case letters, digits and underscores, e.g. shift_lead" />
              <TextField label="Name" name="name" required />
              <TextField label="Description" name="description" />
            </FormGrid>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {groups.map(([g, perms]) => (
                <fieldset key={g} className="rounded-sm border border-line p-2">
                  <legend className="px-1 text-[12.5px] font-semibold text-ink">{PERMISSION_GROUPS[g] ?? g}</legend>
                  {perms.map((p) => (
                    <label key={p} className="flex items-start gap-2 py-0.5 text-[12.5px]">
                      <input type="checkbox" name="permissions" value={p} className="mt-0.5 h-4 w-4 accent-dykem" />
                      <span>
                        <span className="plate">{p}</span> <span className="text-steel">— {PERMISSIONS[p]}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          </ActionForm>
        </Disclosure>
      </Section>
    </>
  );
}
