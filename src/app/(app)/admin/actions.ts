"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/server/action";
import { f } from "@/server/forms";
import { requirePermission } from "@/server/context";
import { invalid } from "@/server/errors";
import { fmtQty } from "@/lib/format";
import { verifyAuditChain } from "@/server/audit";
import { adminResetPassword, createEmployeeForUser, createRole, createUser, listRoles, setRolePermissions, setUserActive, updateUser } from "@/server/services/users";
import { updateSettings } from "@/server/services/settings";
import { saveOperationType } from "@/server/services/routing";
import { addCalendarException, saveCalendar, saveMachineType } from "@/server/services/machines";
import { saveCompetency } from "@/server/services/employees";
import { saveChecklistTemplate, saveDowntimeReason, saveRetentionPolicy, saveStatusTransition } from "@/server/services/config";
import { importCustomersCsv, importMaterialSpecsCsv, importSuppliersCsv } from "@/server/services/imports";

// ───────────── Users ─────────────

export const createUserAction = action(
  "admin.user_create",
  z.object({
    email: f.email().refine((v) => !!v, "Email is required."),
    name: f.str("Name is required."),
    password: f.str("Set a temporary password."),
    roleKeys: f.strs(),
    employeeId: f.optUuid(),
    mustChangePassword: f.bool(),
  }),
  async (ctx, { email, ...i }) => {
    if (!i.roleKeys.length) throw invalid("Choose at least one role.", { field: "roleKeys" });
    const u = await createUser(ctx, { ...i, email: email ?? "" });
    redirect(`/admin/users/${u.id}`);
  },
  { revalidate: "/admin/users" },
);

export const updateUserAction = action(
  "admin.user_update",
  z.object({ id: f.uuid(), name: f.str("Name is required."), roleKeys: f.strs(), employeeId: f.optUuid() }),
  async (ctx, { id, name, roleKeys, employeeId }) => {
    if (!roleKeys.length) throw invalid("Choose at least one role.", { field: "roleKeys" });
    await updateUser(ctx, id, { name, roleKeys, employeeId });
    return "User saved. Their sessions were signed out so the new roles take effect at next sign-in.";
  },
  { revalidate: (i) => ["/admin/users", `/admin/users/${i.id}`] },
);

export const createUserEmployeeAction = action(
  "admin.user_employee",
  z.object({
    id: f.uuid(),
    employeeNo: f.str("Employee ID is required."),
    firstName: f.str("First name is required."),
    lastName: f.str("Last name is required."),
    jobTitle: f.optStr(),
    shift: f.optStr(),
    badgeCode: f.optStr(),
  }),
  async (ctx, { id, ...employee }) => {
    const e = await createEmployeeForUser(ctx, id, employee);
    return `Employee record ${e.employeeNo} created and linked. This user can now be assigned operations and use My work; add their competencies under Operators.`;
  },
  { revalidate: (i) => ["/admin/users", `/admin/users/${i.id}`, "/operators", "/shopfloor"] },
);

export const setUserActiveAction = action(
  "admin.user_active",
  z.object({ id: f.uuid(), active: f.bool(), reason: f.str("A reason is required.") }),
  async (ctx, { id, active, reason }) => {
    await setUserActive(ctx, id, active, reason);
    return active ? "User reactivated." : "User deactivated and signed out of all sessions.";
  },
  { revalidate: (i) => ["/admin/users", `/admin/users/${i.id}`] },
);

export const resetPasswordAction = action(
  "admin.user_password",
  z.object({ id: f.uuid(), password: f.str("Enter a temporary password.") }),
  async (ctx, { id, password }) => {
    await adminResetPassword(ctx, id, password);
    return "Password reset. The user must change it at next sign-in; their sessions were signed out and any lockout cleared.";
  },
  { revalidate: (i) => `/admin/users/${i.id}` },
);

// ───────────── Roles ─────────────

/** Saves the whole matrix; only roles whose permission set actually changed are updated. */
export const saveRoleMatrixAction = action(
  "admin.role_matrix",
  z.object({ roleIds: f.uuids() }),
  async (ctx, { roleIds }, fd) => {
    const current = await listRoles(ctx);
    let changed = 0;
    for (const id of roleIds) {
      const role = current.find((r) => r.id === id);
      if (!role || role.key === "admin") continue;
      const next = [...new Set(fd.getAll(`perm_${id}`).map(String))].sort();
      const before = [...role.permissions].sort();
      if (next.length === before.length && next.every((p, i) => p === before[i])) continue;
      await setRolePermissions(ctx, id, next);
      changed++;
    }
    return changed ? `Permissions updated for ${changed} role(s). Users holding those roles were signed out so the change takes effect.` : "No changes to save.";
  },
  { revalidate: "/admin/roles" },
);

export const createRoleAction = action(
  "admin.role_create",
  z.object({ key: f.str("Key is required."), name: f.str("Name is required."), description: f.optStr(), permissions: f.strs() }),
  async (ctx, { key, name, description, permissions }) => {
    const r = await createRole(ctx, { key, name, description: description ?? undefined, permissions });
    return `Role “${r.name}” created.`;
  },
  { revalidate: "/admin/roles" },
);

// ───────────── Company settings ─────────────

export const updateSettingsAction = action(
  "admin.settings",
  z.object({
    companyName: f.str("Company name is required."),
    addressLines: f.optStr(),
    phone: f.optStr(),
    email: f.optStr(),
    website: f.optStr(),
    vatNumber: f.optStr(),
    companyNumber: f.optStr(),
    timezone: f.str("Timezone is required."),
    currency: f.str("Currency is required.").transform((s) => s.toUpperCase()),
    defaultTaxRate: f.str("Default tax rate is required."),
    quoteValidityDays: f.int({ min: 1, max: 365 }),
    defaultQuoteTerms: f.optStr(),
    retentionYears: f.int({ min: 1, max: 100 }),
    allowSelfInspection: f.bool(),
    requireIndependentApproval: f.bool(),
    quoteApprovalMode: f.enumOf(["single_step", "independent"] as const),
    quoteAcceptanceMode: f.enumOf(["single_step", "verified"] as const),
    boxheroMode: f.enumOf(["simulated", "api", "manual"] as const),
  }),
  async (ctx, i) => {
    await updateSettings(ctx, { ...i, addressLines: i.addressLines ?? "", defaultQuoteTerms: i.defaultQuoteTerms ?? "" });
    return "Company settings saved.";
  },
  { revalidate: ["/admin/settings", "/"] },
);

// ───────────── Configuration ─────────────

export const saveOperationTypeAction = action(
  "admin.operation_type",
  z.object({
    id: f.optUuid(),
    code: f.str("Code is required."),
    name: f.str("Name is required."),
    category: f.str(),
    requiresMachine: f.bool(),
    requiresProgramDefault: f.bool(),
    requiresFirstOffDefault: f.bool(),
    isSubcontract: f.bool(),
    isInspection: f.bool(),
    defaultCompetencyId: f.optUuid(),
    defaultRatePerHour: f.optDec({ min: 0 }),
    isActive: f.bool(),
    sortOrder: f.optInt(),
  }),
  async (ctx, { id, sortOrder, ...i }) => {
    const t = await saveOperationType(ctx, { ...i, id: id ?? undefined, sortOrder: sortOrder ?? 100 });
    return `Operation type ${t.code} saved.`;
  },
  { revalidate: "/admin/config" },
);

export const saveTransitionAction = action(
  "admin.status_transition",
  z.object({ id: f.optUuid(), fromStatus: f.str(), toStatus: f.str(), permission: f.str(), requiresReason: f.bool(), isActive: f.bool() }),
  async (ctx, i) => {
    await saveStatusTransition(ctx, { ...i, entityType: "job" });
    return "Transition saved.";
  },
  { revalidate: "/admin/config" },
);

export const saveChecklistAction = action(
  "admin.release_checklist",
  z.object({ id: f.optUuid(), label: f.str("Describe the checklist item."), guidance: f.optStr(), required: f.bool(), sortOrder: f.optInt(), isActive: f.bool() }),
  async (ctx, { sortOrder, ...i }) => {
    await saveChecklistTemplate(ctx, { ...i, sortOrder: sortOrder ?? 100 });
    return "Checklist item saved.";
  },
  { revalidate: "/admin/config" },
);

export const saveDowntimeReasonAction = action(
  "admin.downtime_reason",
  z.object({ id: f.optUuid(), code: f.str("Code is required."), name: f.str("Name is required."), category: f.enumOf(["planned", "unplanned"] as const), isActive: f.bool() }),
  async (ctx, i) => {
    const r = await saveDowntimeReason(ctx, i);
    return `Downtime reason ${r.code} saved.`;
  },
  { revalidate: "/admin/config" },
);

export const saveRetentionAction = action(
  "admin.retention_policy",
  z.object({ id: f.optUuid(), recordType: f.str("Record type is required."), years: f.int({ min: 1, max: 100 }), basis: f.str(), notes: f.optStr() }),
  async (ctx, i) => {
    await saveRetentionPolicy(ctx, i);
    return "Retention policy saved.";
  },
  { revalidate: "/admin/config" },
);

export const saveMachineTypeAction = action(
  "admin.machine_type",
  z.object({ id: f.optUuid(), code: f.str("Code is required."), name: f.str("Name is required."), fieldKey: f.strs(), fieldLabel: f.strs(), fieldType: f.strs(), fieldUnit: f.strs() }),
  async (ctx, { id, code, name, fieldKey, fieldLabel, fieldType, fieldUnit }) => {
    const defs = fieldKey
      .map((key, i) => ({ key: key.trim(), label: (fieldLabel[i] ?? "").trim(), type: (fieldType[i] ?? "text").trim(), unit: (fieldUnit[i] ?? "").trim() || undefined }))
      .filter((d) => d.key);
    for (const d of defs) if (!d.label) throw invalid(`Give custom field “${d.key}” a label.`);
    const t = await saveMachineType(ctx, { id: id ?? undefined, code, name, customFieldDefs: defs });
    return `Machine type ${t.code} saved.`;
  },
  { revalidate: "/admin/config" },
);

export const saveCalendarAction = action(
  "admin.calendar",
  z.object({ id: f.optUuid(), name: f.str("Calendar name is required."), shiftDay: f.strs(), shiftStart: f.strs(), shiftEnd: f.strs() }),
  async (ctx, { id, name, shiftDay, shiftStart, shiftEnd }) => {
    const shifts = shiftDay
      .map((d, i) => ({ dayOfWeek: Number(d), startTime: (shiftStart[i] ?? "").trim().slice(0, 5), endTime: (shiftEnd[i] ?? "").trim().slice(0, 5) }))
      .filter((s) => s.startTime || s.endTime);
    for (const s of shifts) if (!Number.isInteger(s.dayOfWeek) || s.dayOfWeek < 0 || s.dayOfWeek > 6) throw invalid("Invalid weekday.");
    const cal = await saveCalendar(ctx, { id: id ?? undefined, name, shifts });
    return `Calendar “${cal.name}” saved with ${shifts.length} shift(s).`;
  },
  { revalidate: "/admin/config" },
);

export const addCalendarExceptionAction = action(
  "admin.calendar_exception",
  z.object({ calendarId: f.uuid(), date: f.date(), isWorking: f.bool(), note: f.optStr() }),
  async (ctx, { calendarId, ...i }) => {
    await addCalendarException(ctx, calendarId, i);
    return i.isWorking ? "Extra working day added." : "Non-working day added.";
  },
  { revalidate: "/admin/config" },
);

export const saveCompetencyAction = action(
  "admin.competency",
  z.object({
    id: f.optUuid(),
    code: f.str("Code is required."),
    name: f.str("Name is required."),
    description: f.optStr(),
    operationTypeId: f.optUuid(),
    machineTypeId: f.optUuid(),
    machineId: f.optUuid(),
    requiresExpiry: f.bool(),
    validityMonths: f.optInt(),
  }),
  async (ctx, { id, ...i }) => {
    const c = await saveCompetency(ctx, i, id ?? undefined);
    return `Competency ${c.code} saved.`;
  },
  { revalidate: "/admin/config" },
);

// ───────────── Audit ─────────────

export const verifyAuditChainAction = action("admin.audit_verify", z.object({}), async (ctx) => {
  requirePermission(ctx, "audit.view");
  const r = await verifyAuditChain(ctx.db);
  if (r.ok) return `Hash chain verified: all ${fmtQty(r.checked)} audit events are intact.`;
  return { ok: false, error: `Hash chain BROKEN at audit event #${r.brokenAtId} (${r.checked} events checked). The event or one before it has been altered outside the application — investigate immediately.` };
});

// ───────────── Data import ─────────────

export const importCsvAction = action(
  "admin.import_csv",
  z.object({ kind: f.enumOf(["customers", "suppliers", "material_specs"] as const), file: z.instanceof(File, { message: "Choose a CSV file." }) }),
  async (ctx, { kind, file }) => {
    if (file.size > 5 * 1024 * 1024) throw invalid("The file is larger than 5 MB. Split it into smaller files.", { field: "file" });
    const text = await file.text();
    const report = kind === "customers" ? await importCustomersCsv(ctx, text) : kind === "suppliers" ? await importSuppliersCsv(ctx, text) : await importMaterialSpecsCsv(ctx, text);
    return { ok: true, data: report, message: `Import finished: ${report.created} created, ${report.skipped} skipped (already exist), ${report.errors} with errors, of ${report.total} row(s).` };
  },
  { revalidate: ["/customers", "/suppliers", "/materials"] },
);
