import type { Actor } from "@/server/context";
import type { Permission } from "@/server/auth/permissions";

/** Administration sections and the permission that unlocks each. */
export const ADMIN_SECTIONS: { href: string; label: string; perm: Permission }[] = [
  { href: "/admin/users", label: "Users", perm: "admin.users" },
  { href: "/admin/roles", label: "Roles & permissions", perm: "admin.roles" },
  { href: "/admin/settings", label: "Company settings", perm: "admin.settings" },
  { href: "/admin/config", label: "Configuration", perm: "admin.config" },
  { href: "/admin/audit", label: "Audit trail", perm: "audit.view" },
  { href: "/admin/integrations", label: "Integrations", perm: "integrations.view" },
  { href: "/admin/import", label: "Data import", perm: "admin.settings" },
];

export function visibleAdminSections(actor: Actor) {
  return ADMIN_SECTIONS.filter((s) => actor.permissions.has(s.perm));
}

export const ADMIN_PERMS: Permission[] = ["admin.users", "admin.roles", "admin.settings", "admin.config", "audit.view", "integrations.view"];

/** Labels for permission groups (prefix before the dot). */
export const PERMISSION_GROUPS: Record<string, string> = {
  admin: "Administration",
  audit: "Audit",
  integrations: "Integrations",
  customers: "Customers",
  suppliers: "Suppliers",
  documents: "Documents",
  enquiries: "Enquiries",
  email: "Email",
  quotations: "Quotations",
  orders: "Customer orders",
  jobs: "Jobs",
  routing: "Routing",
  production: "Production",
  planning: "Planning",
  machines: "Machines",
  employees: "Employees",
  competencies: "Competencies",
  tooling: "Tooling",
  maintenance: "Maintenance",
  programs: "CNC programs",
  materials: "Materials",
  purchasing: "Purchasing",
  boxhero: "BoxHero",
  quality: "Quality",
  ncr: "Non-conformances",
  capa: "Corrective actions",
  holds: "Holds",
  subcontract: "Subcontract",
  dispatch: "Dispatch",
  reports: "Reports",
  traceability: "Traceability",
};
