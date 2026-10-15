import { eq, sql } from "drizzle-orm";
import { queryRows, type DB } from "./db/client";
import {
  companySettings,
  downtimeReasons,
  machineTypes,
  operationTypes,
  releaseChecklistTemplates,
  retentionPolicies,
  rolePermissions,
  roles,
  statusTransitions,
  users,
} from "./db/schema";
import { SYSTEM_ROLES } from "./auth/permissions";

export const SYSTEM_USER_EMAIL = "system@mjms.internal";

/** Operation types available out of the box (admins can add, edit, disable). */
export const DEFAULT_OPERATION_TYPES = [
  { code: "SAW", name: "Sawing", category: "cutting", requiresProgramDefault: false },
  { code: "MILL", name: "CNC milling", category: "machining", requiresProgramDefault: true, requiresFirstOffDefault: true },
  { code: "TURN", name: "CNC turning", category: "machining", requiresProgramDefault: true, requiresFirstOffDefault: true },
  { code: "MTURN", name: "Manual turning", category: "machining" },
  { code: "DRILL", name: "Drilling", category: "machining" },
  { code: "BORE", name: "Boring", category: "machining", requiresFirstOffDefault: true },
  { code: "GRIND", name: "Grinding", category: "machining", requiresFirstOffDefault: true },
  { code: "WJET", name: "Waterjet cutting", category: "cutting", requiresProgramDefault: true },
  { code: "LASER", name: "Laser cutting", category: "cutting", requiresProgramDefault: true },
  { code: "PLASMA", name: "Plasma cutting", category: "cutting", requiresProgramDefault: true },
  { code: "FAB", name: "Fabrication", category: "fabrication" },
  { code: "WELD", name: "Welding", category: "fabrication" },
  { code: "DEBURR", name: "Deburring", category: "finishing", requiresMachine: false },
  { code: "SURF", name: "Surface treatment (in-house)", category: "treatment" },
  { code: "HEAT", name: "Heat treatment (in-house)", category: "treatment" },
  { code: "ASSY", name: "Assembly", category: "assembly", requiresMachine: false },
  { code: "SUBCON", name: "External subcontract", category: "subcontract", requiresMachine: false, isSubcontract: true },
  { code: "INSP", name: "In-process inspection", category: "inspection", requiresMachine: false, isInspection: true },
  { code: "FINSP", name: "Final inspection", category: "inspection", requiresMachine: false, isInspection: true },
  { code: "PACK", name: "Packing & dispatch prep", category: "logistics", requiresMachine: false },
] as const;

/** Manual job transitions (automatic production-phase statuses are derived by the system). */
const PLANNING = [
  "order_confirmed",
  "awaiting_material",
  "material_received",
  "awaiting_material_release",
  "ready_for_planning",
  "planned",
  "awaiting_programming",
  "programming_in_progress",
  "awaiting_program_approval",
  "ready_for_production",
];
export function defaultJobTransitions() {
  const rows: { entityType: string; fromStatus: string; toStatus: string; permission: string; requiresReason: boolean }[] = [];
  for (const a of PLANNING) for (const b of PLANNING) if (a !== b) rows.push({ entityType: "job", fromStatus: a, toStatus: b, permission: "jobs.manage", requiresReason: false });
  for (const s of ["production_complete", "final_qc"]) rows.push({ entityType: "job", fromStatus: s, toStatus: "final_qc", permission: "quality.final_inspect", requiresReason: false });
  rows.push({ entityType: "job", fromStatus: "production_complete", toStatus: "ready_for_dispatch", permission: "quality.release", requiresReason: false });
  rows.push({ entityType: "job", fromStatus: "final_qc", toStatus: "ready_for_dispatch", permission: "quality.release", requiresReason: false });
  rows.push({ entityType: "job", fromStatus: "dispatched", toStatus: "completed", permission: "jobs.manage", requiresReason: false });
  rows.push({ entityType: "job", fromStatus: "ready_for_dispatch", toStatus: "completed", permission: "jobs.manage", requiresReason: true });
  rows.push({ entityType: "job", fromStatus: "*", toStatus: "on_hold", permission: "jobs.hold", requiresReason: true });
  rows.push({ entityType: "job", fromStatus: "*", toStatus: "cancelled", permission: "jobs.cancel", requiresReason: true });
  return rows.filter((r, i, arr) => arr.findIndex((x) => x.fromStatus === r.fromStatus && x.toStatus === r.toStatus) === i);
}

/** Idempotent: safe to run on every deploy. Never overwrites admin edits to existing rows. */
export async function ensureBaseData(db: DB) {
  await db.insert(companySettings).values({ id: 1 }).onConflictDoNothing();

  for (const [key, r] of Object.entries(SYSTEM_ROLES)) {
    const [existing] = await db.select().from(roles).where(eq(roles.key, key)).limit(1);
    const roleId =
      existing?.id ??
      (await db.insert(roles).values({ key, name: r.name, description: r.description, isSystem: true }).returning({ id: roles.id }))[0].id;
    // The admin role always holds every permission (new permissions added by upgrades included).
    if (!existing || key === "admin") {
      await db
        .insert(rolePermissions)
        .values(r.permissions.map((permission) => ({ roleId, permission })))
        .onConflictDoNothing();
    }
  }

  await db
    .insert(users)
    .values({ email: SYSTEM_USER_EMAIL, name: "System (automated)", isActive: false })
    .onConflictDoNothing();

  for (const [i, t] of DEFAULT_OPERATION_TYPES.entries()) {
    await db
      .insert(operationTypes)
      .values({
        code: t.code,
        name: t.name,
        category: t.category,
        requiresMachine: "requiresMachine" in t ? t.requiresMachine : true,
        requiresProgramDefault: "requiresProgramDefault" in t ? t.requiresProgramDefault : false,
        requiresFirstOffDefault: "requiresFirstOffDefault" in t ? t.requiresFirstOffDefault : false,
        isSubcontract: "isSubcontract" in t ? t.isSubcontract : false,
        isInspection: "isInspection" in t ? t.isInspection : false,
        sortOrder: (i + 1) * 10,
      })
      .onConflictDoNothing();
  }

  await db.insert(statusTransitions).values(defaultJobTransitions()).onConflictDoNothing();

  const reasons = [
    ["SETUP", "Setup / changeover", "planned"],
    ["TOOL", "Tool change / breakage", "unplanned"],
    ["BREAK", "Machine breakdown", "unplanned"],
    ["MAT", "Waiting for material", "unplanned"],
    ["PROG", "Program issue", "unplanned"],
    ["QA", "Waiting for inspection", "unplanned"],
    ["OPR", "No operator available", "unplanned"],
    ["PM", "Planned maintenance", "planned"],
    ["OTHER", "Other", "unplanned"],
  ] as const;
  await db
    .insert(downtimeReasons)
    .values(reasons.map(([code, name, category]) => ({ code, name, category })))
    .onConflictDoNothing();

  const types = [
    ["CNC_MILL", "CNC machining centre"],
    ["CNC_LATHE", "CNC lathe"],
    ["MANUAL_LATHE", "Manual lathe"],
    ["SAW", "Saw"],
    ["GRINDER", "Grinder"],
    ["CUTTING", "Profile cutting (laser / waterjet / plasma)"],
    ["WELDING", "Welding station"],
    ["BENCH", "Bench / work cell"],
  ] as const;
  await db
    .insert(machineTypes)
    .values(types.map(([code, name]) => ({ code, name })))
    .onConflictDoNothing();

  const [{ n: templates }] = await queryRows<{ n: number }>(db, sql`select count(*)::int as n from release_checklist_templates`);
  if (templates === 0) {
    await db.insert(releaseChecklistTemplates).values([
      { label: "Parts visually inspected for damage, burrs and cleanliness", required: true, sortOrder: 10 },
      { label: "Part marking / identification correct", required: true, sortOrder: 20 },
      { label: "Packaging meets customer requirements", required: true, sortOrder: 30 },
      { label: "Required documentation pack assembled (CoC, certs, reports)", required: true, sortOrder: 40 },
    ]);
  }

  const [{ n: policies }] = await queryRows<{ n: number }>(db, sql`select count(*)::int as n from retention_policies`);
  if (policies === 0) {
    await db.insert(retentionPolicies).values([
      { recordType: "Jobs, travellers and production records", years: 10, notes: "Default; align with customer contracts (aerospace often requires longer)." },
      { recordType: "Inspection records, CoCs and material certificates", years: 10 },
      { recordType: "NCRs and corrective actions", years: 10 },
      { recordType: "Quotations not converted to orders", years: 6 },
      { recordType: "Audit trail", years: 10, notes: "Append-only; never deleted by the application." },
    ]);
  }
}

export async function getSystemUserId(db: DB): Promise<string> {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, SYSTEM_USER_EMAIL)).limit(1);
  if (!u) throw new Error("System user missing — run ensureBaseData");
  return u.id;
}
