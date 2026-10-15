import { asc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { roles, rolePermissions, userRoles, users, employees } from "../db/schema";
import { audit } from "../audit";
import { mutate, requirePermission, type Ctx } from "../context";
import { conflict, invalid, notFound } from "../errors";
import { hashPassword, passwordPolicyError } from "../auth/password";
import { revokeAllSessions } from "../auth/session";
import { ALL_PERMISSIONS, isPermission } from "../auth/permissions";

const email = z.string().trim().toLowerCase().email("Enter a valid email address.");

export const createUserInput = z.object({
  email,
  name: z.string().trim().min(2, "Name is required."),
  password: z.string().min(1),
  roleKeys: z.array(z.string()).min(1, "Choose at least one role."),
  employeeId: z.string().uuid().nullish(),
  mustChangePassword: z.boolean().default(true),
});

export async function createUser(ctx: Ctx, raw: z.input<typeof createUserInput>) {
  requirePermission(ctx, "admin.users");
  const input = createUserInput.parse(raw);
  const pwErr = passwordPolicyError(input.password, input.email);
  if (pwErr) throw invalid(pwErr, { field: "password" });
  const passwordHash = await hashPassword(input.password);
  return mutate(ctx, async (tx) => {
    const [dup] = await tx.db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
    if (dup) throw conflict("A user with this email already exists.", { field: "email" });
    const roleRows = await tx.db.select().from(roles).where(inArray(roles.key, input.roleKeys));
    if (roleRows.length !== input.roleKeys.length) throw invalid("Unknown role selected.");
    const [u] = await tx.db
      .insert(users)
      .values({ email: input.email, name: input.name, passwordHash, employeeId: input.employeeId ?? null, mustChangePassword: input.mustChangePassword })
      .returning();
    await tx.db.insert(userRoles).values(roleRows.map((r) => ({ userId: u.id, roleId: r.id })));
    await audit(tx, { action: "user.create", entityType: "user", entityId: u.id, entityRef: u.email, after: { email: u.email, name: u.name, roles: input.roleKeys } });
    return u;
  });
}

export async function updateUser(
  ctx: Ctx,
  userId: string,
  raw: { name?: string; roleKeys?: string[]; employeeId?: string | null },
) {
  requirePermission(ctx, "admin.users");
  return mutate(ctx, async (tx) => {
    const [u] = await tx.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw notFound("User");
    const before = { name: u.name, employeeId: u.employeeId, roles: await roleKeysOf(tx, userId) };
    if (raw.name !== undefined || raw.employeeId !== undefined) {
      await tx.db
        .update(users)
        .set({ ...(raw.name !== undefined ? { name: raw.name.trim() } : {}), ...(raw.employeeId !== undefined ? { employeeId: raw.employeeId } : {}) })
        .where(eq(users.id, userId));
    }
    const rolesChanged = !!raw.roleKeys && (raw.roleKeys.length !== before.roles.length || raw.roleKeys.some((k) => !before.roles.includes(k)));
    if (raw.roleKeys && rolesChanged) {
      if (userId === ctx.actor.userId && !raw.roleKeys.includes("admin") && before.roles.includes("admin"))
        throw invalid("You cannot remove your own administrator role.");
      const roleRows = await tx.db.select().from(roles).where(inArray(roles.key, raw.roleKeys));
      await tx.db.delete(userRoles).where(eq(userRoles.userId, userId));
      if (roleRows.length) await tx.db.insert(userRoles).values(roleRows.map((r) => ({ userId, roleId: r.id })));
      await revokeAllSessions(tx.db, userId); // permissions changed → force fresh login
    }
    await audit(tx, { action: "user.update", entityType: "user", entityId: userId, entityRef: u.email, before, after: raw });
  });
}

export async function setUserActive(ctx: Ctx, userId: string, active: boolean, reason: string) {
  requirePermission(ctx, "admin.users");
  if (!reason?.trim()) throw invalid("A reason is required.", { field: "reason" });
  if (userId === ctx.actor.userId && !active) throw invalid("You cannot deactivate your own account.");
  return mutate(ctx, async (tx) => {
    const [u] = await tx.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw notFound("User");
    await tx.db.update(users).set({ isActive: active, deactivatedAt: active ? null : new Date() }).where(eq(users.id, userId));
    if (!active) await revokeAllSessions(tx.db, userId);
    await audit(tx, { action: active ? "user.reactivate" : "user.deactivate", entityType: "user", entityId: userId, entityRef: u.email, reason });
  });
}

export async function adminResetPassword(ctx: Ctx, userId: string, newPassword: string) {
  requirePermission(ctx, "admin.users");
  const [u] = await ctx.db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw notFound("User");
  const err = passwordPolicyError(newPassword, u.email);
  if (err) throw invalid(err, { field: "password" });
  const hash = await hashPassword(newPassword);
  return mutate(ctx, async (tx) => {
    await tx.db.update(users).set({ passwordHash: hash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, userId));
    await revokeAllSessions(tx.db, userId);
    await audit(tx, { action: "user.password_reset_by_admin", entityType: "user", entityId: userId, entityRef: u.email });
  });
}

async function roleKeysOf(ctx: Ctx, userId: string) {
  const rows = await ctx.db.select({ key: roles.key }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, userId));
  return rows.map((r) => r.key);
}

export async function listUsers(ctx: Ctx) {
  requirePermission(ctx, "admin.users");
  const rows = await ctx.db
    .select({ u: users, emp: employees })
    .from(users)
    .leftJoin(employees, eq(employees.id, users.employeeId))
    .where(ne(users.email, "system@mjms.internal"))
    .orderBy(asc(users.name));
  const ur = await ctx.db.select({ userId: userRoles.userId, key: roles.key, name: roles.name }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId));
  return rows.map((r) => ({ ...r.u, passwordHash: undefined, employee: r.emp, roles: ur.filter((x) => x.userId === r.u.id) }));
}

// ───────────── Roles ─────────────

export async function createRole(ctx: Ctx, raw: { key: string; name: string; description?: string; permissions: string[] }) {
  requirePermission(ctx, "admin.roles");
  const key = raw.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!key || !raw.name.trim()) throw invalid("Key and name are required.");
  const bad = raw.permissions.filter((p) => !isPermission(p));
  if (bad.length) throw invalid(`Unknown permission(s): ${bad.join(", ")}`);
  return mutate(ctx, async (tx) => {
    const [dup] = await tx.db.select().from(roles).where(eq(roles.key, key)).limit(1);
    if (dup) throw conflict("A role with this key already exists.");
    const [r] = await tx.db.insert(roles).values({ key, name: raw.name.trim(), description: raw.description ?? null }).returning();
    if (raw.permissions.length) await tx.db.insert(rolePermissions).values(raw.permissions.map((permission) => ({ roleId: r.id, permission })));
    await audit(tx, { action: "role.create", entityType: "role", entityId: r.id, entityRef: key, after: { permissions: raw.permissions } });
    return r;
  });
}

export async function setRolePermissions(ctx: Ctx, roleId: string, permissions: string[]) {
  requirePermission(ctx, "admin.roles");
  const bad = permissions.filter((p) => !isPermission(p));
  if (bad.length) throw invalid(`Unknown permission(s): ${bad.join(", ")}`);
  return mutate(ctx, async (tx) => {
    const [r] = await tx.db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
    if (!r) throw notFound("Role");
    if (r.key === "admin") throw invalid("The system administrator role always has every permission.");
    const before = (await tx.db.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId))).map((x) => x.permission);
    await tx.db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (permissions.length) await tx.db.insert(rolePermissions).values([...new Set(permissions)].map((permission) => ({ roleId, permission })));
    // Users holding this role must log in again to pick up the change.
    const holders = await tx.db.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, roleId));
    for (const h of holders) await revokeAllSessions(tx.db, h.userId);
    await audit(tx, { action: "role.permissions_changed", entityType: "role", entityId: roleId, entityRef: r.key, before: { permissions: before }, after: { permissions } });
  });
}

export async function listRoles(ctx: Ctx) {
  requirePermission(ctx, "admin.roles");
  const rs = await ctx.db.select().from(roles).orderBy(asc(roles.name));
  const ps = await ctx.db.select().from(rolePermissions);
  return rs.map((r) => ({ ...r, permissions: ps.filter((p) => p.roleId === r.id).map((p) => p.permission) }));
}

export { ALL_PERMISSIONS };
