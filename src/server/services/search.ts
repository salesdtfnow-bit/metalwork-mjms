import { eq, ilike, or } from "drizzle-orm";
import {
  cncPrograms,
  controlledDocuments,
  customerOrders,
  customers,
  dispatches,
  employees,
  enquiries,
  inspections,
  jobs,
  machines,
  materialLots,
  ncrs,
  operations,
  parts,
  purchaseOrders,
  quotations,
  serials,
  suppliers,
} from "../db/schema";
import { can, type Ctx } from "../context";
import type { Permission } from "../auth/permissions";

export type SearchHit = { kind: string; label: string; sub?: string; href: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Exact-code lookup for scanned barcodes/QR codes and typed references. Returns a direct
 * destination when the code identifies exactly one record the user may open.
 */
export async function resolveCode(ctx: Ctx, raw: string): Promise<string | null> {
  const q = raw.trim();
  if (!q) return null;
  if (q.startsWith("/") && !q.startsWith("//")) return q;
  if (UUID.test(q)) {
    const [op] = await ctx.db.select({ id: operations.id, jobId: operations.jobId }).from(operations).where(eq(operations.id, q)).limit(1);
    if (op) return can(ctx.actor, "production.view_all") || can(ctx.actor, "jobs.view") ? `/jobs/${op.jobId}?tab=route` : `/shopfloor/op/${op.id}`;
  }
  const checks: [Permission, () => Promise<string | null>][] = [
    ["jobs.view", async () => (await ctx.db.select({ id: jobs.id }).from(jobs).where(ilike(jobs.jobNumber, q)).limit(1))[0]?.id.replace(/^/, "/jobs/") ?? null],
    ["materials.view", async () => (await ctx.db.select({ id: materialLots.id }).from(materialLots).where(ilike(materialLots.lotNo, q)).limit(1))[0]?.id.replace(/^/, "/materials/lots/") ?? null],
    ["quotations.view", async () => (await ctx.db.select({ id: quotations.id }).from(quotations).where(ilike(quotations.ref, q)).limit(1))[0]?.id.replace(/^/, "/quotations/") ?? null],
    ["enquiries.view", async () => (await ctx.db.select({ id: enquiries.id }).from(enquiries).where(ilike(enquiries.ref, q)).limit(1))[0]?.id.replace(/^/, "/enquiries/") ?? null],
    ["purchasing.view", async () => (await ctx.db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(ilike(purchaseOrders.ref, q)).limit(1))[0]?.id.replace(/^/, "/purchasing/") ?? null],
    ["ncr.view", async () => (await ctx.db.select({ id: ncrs.id }).from(ncrs).where(ilike(ncrs.ref, q)).limit(1))[0]?.id.replace(/^/, "/ncr/") ?? null],
    ["quality.view", async () => (await ctx.db.select({ id: inspections.id }).from(inspections).where(ilike(inspections.ref, q)).limit(1))[0]?.id.replace(/^/, "/quality/inspections/") ?? null],
    ["dispatch.view", async () => (await ctx.db.select({ id: dispatches.id }).from(dispatches).where(ilike(dispatches.ref, q)).limit(1))[0]?.id.replace(/^/, "/dispatch/") ?? null],
    ["programs.view", async () => (await ctx.db.select({ id: cncPrograms.id }).from(cncPrograms).where(ilike(cncPrograms.programNumber, q)).limit(1))[0]?.id.replace(/^/, "/programs/") ?? null],
    ["documents.view", async () => (await ctx.db.select({ id: controlledDocuments.id }).from(controlledDocuments).where(ilike(controlledDocuments.docNumber, q)).limit(1))[0]?.id.replace(/^/, "/documents/") ?? null],
    ["machines.view", async () => (await ctx.db.select({ id: machines.id }).from(machines).where(ilike(machines.code, q)).limit(1))[0]?.id.replace(/^/, "/machines/") ?? null],
    ["traceability.view", async () => ((await ctx.db.select({ id: serials.id }).from(serials).where(eq(serials.serialNo, q)).limit(1))[0] ? `/traceability?q=${encodeURIComponent(q)}` : null)],
  ];
  for (const [perm, fn] of checks) {
    if (!can(ctx.actor, perm)) continue;
    const hit = await fn();
    if (hit) return hit;
  }
  return null;
}

/** Permission-filtered global search across the main record types. */
export async function globalSearch(ctx: Ctx, raw: string): Promise<SearchHit[]> {
  const q = raw.trim();
  if (q.length < 2) return [];
  const like = `%${q}%`;
  const hits: SearchHit[] = [];
  const add = async (perm: Permission | Permission[], fn: () => Promise<SearchHit[]>) => {
    const perms = Array.isArray(perm) ? perm : [perm];
    if (perms.some((p) => can(ctx.actor, p))) hits.push(...(await fn()));
  };
  await add(["jobs.view", "production.view_all"], async () =>
    (await ctx.db.select({ j: jobs, c: customers.name }).from(jobs).innerJoin(customers, eq(customers.id, jobs.customerId)).where(or(ilike(jobs.jobNumber, like), ilike(jobs.title, like))).limit(8)).map((r) => ({ kind: "Job", label: `${r.j.jobNumber} — ${r.j.title}`, sub: r.c, href: `/jobs/${r.j.id}` })),
  );
  await add("customers.view", async () => (await ctx.db.select().from(customers).where(or(ilike(customers.name, like), ilike(customers.code, like))).limit(6)).map((c) => ({ kind: "Customer", label: `${c.code} — ${c.name}`, href: `/customers/${c.id}` })));
  await add("suppliers.view", async () => (await ctx.db.select().from(suppliers).where(or(ilike(suppliers.name, like), ilike(suppliers.code, like))).limit(6)).map((s) => ({ kind: "Supplier", label: `${s.code} — ${s.name}`, href: `/suppliers/${s.id}` })));
  await add("enquiries.view", async () => (await ctx.db.select().from(enquiries).where(or(ilike(enquiries.ref, like), ilike(enquiries.subject, like), ilike(enquiries.customerReference, like))).limit(6)).map((e) => ({ kind: "Enquiry", label: `${e.ref} — ${e.subject}`, href: `/enquiries/${e.id}` })));
  await add("quotations.view", async () => (await ctx.db.select().from(quotations).where(or(ilike(quotations.ref, like), ilike(quotations.title, like))).limit(6)).map((x) => ({ kind: "Quotation", label: `${x.ref} — ${x.title}`, href: `/quotations/${x.id}` })));
  await add("orders.view", async () => (await ctx.db.select().from(customerOrders).where(or(ilike(customerOrders.customerPoNumber, like), ilike(customerOrders.ref, like))).limit(6)).map((o) => ({ kind: "Customer PO", label: `${o.customerPoNumber} (${o.ref})`, href: `/orders/${o.id}` })));
  await add("purchasing.view", async () => (await ctx.db.select().from(purchaseOrders).where(or(ilike(purchaseOrders.ref, like), ilike(purchaseOrders.supplierReference, like))).limit(6)).map((p) => ({ kind: "Purchase order", label: p.ref, sub: p.status, href: `/purchasing/${p.id}` })));
  await add(["jobs.view", "documents.view"], async () => (await ctx.db.select().from(parts).where(or(ilike(parts.partNumber, like), ilike(parts.description, like))).limit(6)).map((p) => ({ kind: "Part", label: `${p.partNumber} — ${p.description}`, href: `/parts/${p.id}` })));
  await add("materials.view", async () => (await ctx.db.select().from(materialLots).where(or(ilike(materialLots.lotNo, like), ilike(materialLots.heatNumber, like))).limit(8)).map((l) => ({ kind: "Material lot", label: `${l.lotNo} — heat ${l.heatNumber}`, sub: l.status.replace("_", " "), href: `/materials/lots/${l.id}` })));
  await add("documents.view", async () => (await ctx.db.select().from(controlledDocuments).where(or(ilike(controlledDocuments.docNumber, like), ilike(controlledDocuments.title, like))).limit(6)).map((d) => ({ kind: "Document", label: `${d.docNumber} — ${d.title}`, sub: d.docType, href: `/documents/${d.id}` })));
  await add("programs.view", async () => (await ctx.db.select().from(cncPrograms).where(or(ilike(cncPrograms.programNumber, like), ilike(cncPrograms.name, like))).limit(6)).map((p) => ({ kind: "CNC program", label: `${p.programNumber} — ${p.name}`, href: `/programs/${p.id}` })));
  await add("machines.view", async () => (await ctx.db.select().from(machines).where(or(ilike(machines.code, like), ilike(machines.name, like))).limit(6)).map((m) => ({ kind: "Machine", label: `${m.code} — ${m.name}`, href: `/machines/${m.id}` })));
  await add("employees.view", async () => (await ctx.db.select().from(employees).where(or(ilike(employees.firstName, like), ilike(employees.lastName, like), ilike(employees.employeeNo, like))).limit(6)).map((e) => ({ kind: "Operator", label: `${e.firstName} ${e.lastName}`, sub: e.employeeNo, href: `/operators/${e.id}` })));
  await add("quality.view", async () => (await ctx.db.select().from(inspections).where(ilike(inspections.ref, like)).limit(6)).map((i) => ({ kind: "Inspection", label: i.ref, sub: `${i.stage} — ${i.status}`, href: `/quality/inspections/${i.id}` })));
  await add("ncr.view", async () => (await ctx.db.select().from(ncrs).where(or(ilike(ncrs.ref, like), ilike(ncrs.description, like))).limit(6)).map((n) => ({ kind: "NCR", label: `${n.ref} — ${n.description.slice(0, 60)}`, sub: n.status, href: `/ncr/${n.id}` })));
  await add("dispatch.view", async () => (await ctx.db.select().from(dispatches).where(or(ilike(dispatches.ref, like), ilike(dispatches.trackingRef, like))).limit(6)).map((d) => ({ kind: "Delivery", label: d.ref, sub: d.status, href: `/dispatch/${d.id}` })));
  return hits;
}
