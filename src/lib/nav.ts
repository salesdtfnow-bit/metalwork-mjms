/** Navigation structure. Items are hidden when the user lacks every listed permission. */
export type NavItem = { href: string; label: string; icon: string; any: string[] };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: "gauge", any: [] },
      { href: "/shopfloor", label: "My work", icon: "hard-hat", any: ["production.execute"] },
    ],
  },
  {
    label: "Commercial",
    items: [
      { href: "/enquiries", label: "Enquiries", icon: "inbox", any: ["enquiries.view"] },
      { href: "/quotations", label: "Quotations", icon: "file-text", any: ["quotations.view"] },
      { href: "/customers", label: "Customers", icon: "building", any: ["customers.view"] },
      { href: "/orders", label: "Customer orders", icon: "clipboard-check", any: ["orders.view"] },
    ],
  },
  {
    label: "Production",
    items: [
      { href: "/jobs", label: "Jobs", icon: "layers", any: ["jobs.view", "production.view_all"] },
      { href: "/planning", label: "Production planning", icon: "calendar-range", any: ["planning.view"] },
      { href: "/machines", label: "Machines", icon: "cog", any: ["machines.view"] },
      { href: "/operators", label: "Operators", icon: "users", any: ["employees.view"] },
      { href: "/programs", label: "CNC programs", icon: "file-code", any: ["programs.view"] },
    ],
  },
  {
    label: "Materials",
    items: [
      { href: "/materials", label: "Materials & BoxHero", icon: "boxes", any: ["materials.view"] },
      { href: "/purchasing", label: "Purchasing", icon: "shopping-cart", any: ["purchasing.view"] },
      { href: "/suppliers", label: "Suppliers", icon: "truck", any: ["suppliers.view"] },
    ],
  },
  {
    label: "Quality",
    items: [
      { href: "/quality", label: "Quality control", icon: "ruler", any: ["quality.view"] },
      { href: "/ncr", label: "Non-conformances", icon: "triangle-alert", any: ["ncr.view", "ncr.raise"] },
    ],
  },
  {
    label: "Workshop",
    items: [
      { href: "/tooling", label: "Tooling", icon: "wrench", any: ["tooling.view"] },
      { href: "/maintenance", label: "Maintenance", icon: "hammer", any: ["maintenance.view"] },
      { href: "/subcontract", label: "Subcontractors", icon: "factory", any: ["subcontract.view"] },
      { href: "/dispatch", label: "Dispatch", icon: "package-check", any: ["dispatch.view"] },
    ],
  },
  {
    label: "Records",
    items: [
      { href: "/traceability", label: "Traceability", icon: "git-branch", any: ["traceability.view"] },
      { href: "/reports", label: "Reports", icon: "bar-chart", any: ["reports.view", "reports.management"] },
      { href: "/documents", label: "Documents", icon: "folder", any: ["documents.view"] },
      { href: "/admin", label: "Administration", icon: "shield", any: ["admin.users", "admin.roles", "admin.settings", "admin.config", "audit.view", "integrations.view"] },
    ],
  },
];

export function visibleNav(permissions: ReadonlySet<string>): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.any.length === 0 || i.any.some((p) => permissions.has(p))) })).filter((g) => g.items.length > 0);
}
