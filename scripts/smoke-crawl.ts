/**
 * Requests every page as every demo role against a running server (BASE_URL, default
 * http://localhost:3000) and reports 5xx responses and error markers. Uses .data/smoke.json.
 */
import { readFileSync } from "node:fs";

type Smoke = { tokens: Record<string, string>; ids: Record<string, string | string[] | null> };
const { tokens, ids } = JSON.parse(readFileSync(".data/smoke.json", "utf8")) as Smoke;
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const id = (k: string) => (Array.isArray(ids[k]) ? (ids[k] as string[])[0] : (ids[k] as string | null));

const pages = [
  "/", "/shopfloor", "/enquiries", "/enquiries/new", "/enquiries/inbox", "/quotations", "/quotations/new", "/customers", "/customers/new", "/orders", "/orders/new",
  "/jobs", "/planning", "/planning?tab=board", "/planning?tab=changes", "/machines", "/machines/new", "/operators", "/operators/new", "/programs", "/programs/new",
  "/materials", "/materials?tab=awaiting", "/materials?tab=specs", "/materials?tab=boxhero", "/purchasing", "/purchasing?tab=orders", "/purchasing?tab=requisitions", "/purchasing/new", "/purchasing/requisitions/new",
  "/suppliers", "/suppliers/new", "/quality", "/quality?tab=inspections", "/quality?tab=plans", "/quality?tab=instruments", "/quality/inspections/new", "/quality/plans/new", "/quality/instruments/new",
  "/ncr", "/ncr?tab=holds", "/ncr?tab=capa", "/ncr/new", "/tooling", "/tooling/new", "/maintenance", "/maintenance?tab=plans", "/maintenance/new", "/subcontract", "/subcontract/new", "/dispatch", "/dispatch?tab=dispatches", "/dispatch/new",
  "/traceability", "/reports", "/reports?tab=time", "/reports?tab=ncr", "/reports?tab=suppliers", "/documents", "/documents/new", "/notifications", "/account", "/search?q=JOB",
  "/admin", "/admin/users", "/admin/roles", "/admin/settings", "/admin/config", "/admin/audit", "/admin/integrations", "/admin/import", "/parts",
];
const detail: [string, string][] = [
  ["customer", "/customers/%"], ["supplier", "/suppliers/%"], ["enquiry", "/enquiries/%"], ["quotation", "/quotations/%"], ["order", "/orders/%"], ["part", "/parts/%"],
  ["machine", "/machines/%"], ["employee", "/operators/%"], ["program", "/programs/%"], ["lot", "/materials/lots/%"], ["po", "/purchasing/%"], ["inspection", "/quality/inspections/%"],
  ["plan", "/quality/plans/%"], ["instrument", "/quality/instruments/%"], ["release", "/quality/releases/%"], ["ncr", "/ncr/%"], ["tool", "/tooling/%"], ["workOrder", "/maintenance/%"],
  ["subcontract", "/subcontract/%"], ["dispatch", "/dispatch/%"], ["document", "/documents/%"], ["operation", "/shopfloor/op/%"], ["user", "/admin/users/%"],
];
for (const [k, p] of detail) if (id(k)) pages.push(p.replace("%", id(k)!));
for (const j of (ids.jobs as string[]) ?? []) for (const tab of ["overview", "lines", "route", "materials", "quality", "dispatch", "history"]) pages.push(`/jobs/${j}?tab=${tab}`);
if ((ids.jobs as string[])?.length) {
  const j = (ids.jobs as string[])[0];
  pages.push(`/traceability?q=${encodeURIComponent("H2219-47")}`, `/api/pdf/traveller/${j}`, `/api/pdf/traceability/${j}`, `/api/v1/jobs/${j}`, "/api/reports/jobs");
}

async function main() {
  let failures = 0;
  let checked = 0;
  const forbidden: Record<string, number> = {};
  for (const [email, token] of Object.entries(tokens)) {
    for (const p of pages) {
      const res = await fetch(BASE + p, { headers: { cookie: `mjms_session=${token}; __Host-mjms_session=${token}` }, redirect: "manual" });
      checked++;
      const body = res.headers.get("content-type")?.includes("text/html") ? await res.text() : "";
      const errorMarker = /Application error|Internal Server Error|An unexpected error occurred|Unhandled Runtime Error/.test(body);
      if (res.status >= 500 || errorMarker) {
        failures++;
        console.log(`FAIL ${res.status} ${email} ${p}${errorMarker ? " (error marker in page)" : ""}`);
      } else if ([307, 303].includes(res.status) && res.headers.get("location")?.includes("/login")) {
        failures++;
        console.log(`FAIL session not accepted (redirect to login) ${email} ${p}`);
      } else if (([307, 303].includes(res.status) && res.headers.get("location")?.includes("/forbidden")) || body.includes("/forbidden")) {
        forbidden[email] = (forbidden[email] ?? 0) + 1;
      }
    }
  }
  console.log(`\nChecked ${checked} page loads across ${Object.keys(tokens).length} roles — ${failures} failure(s).`);
  console.log("Pages redirected to 403 per role (expected for restricted pages):", forbidden);
  process.exit(failures ? 1 : 0);
}
main();
