import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { companySettings, employees, roles, userRoles, users } from "../db/schema";
import { hashPassword } from "../auth/password";
import { loadActor } from "../auth/session";
import type { Ctx } from "../context";
import { addAddress, addContact, addCustomerRequirement, createCustomer, createSupplier, setSupplierApproval } from "../services/parties";
import { seedDemoOperations } from "./seed-operations";
import { applyRealisticDemoTimings } from "./timings";

/** Fictitious people. Emails use the reserved .test TLD. */
export const DEMO_USERS = [
  { email: "admin@demo.test", name: "Sam Okafor", roles: ["admin"], employee: false },
  { email: "manager@demo.test", name: "Helen Marsh", roles: ["management"], employee: false },
  { email: "sales@demo.test", name: "Priya Nair", roles: ["sales"], employee: false },
  { email: "purchasing@demo.test", name: "Tom Wright", roles: ["purchasing"], employee: false },
  { email: "planner@demo.test", name: "Gareth Lewis", roles: ["production_manager"], employee: true },
  { email: "programmer@demo.test", name: "Marek Nowak", roles: ["cnc_programmer"], employee: true },
  { email: "operator1@demo.test", name: "Dan Hughes", roles: ["operator"], employee: true },
  { email: "operator2@demo.test", name: "Aisha Rahman", roles: ["operator"], employee: true },
  { email: "operator3@demo.test", name: "Lee Turner", roles: ["operator"], employee: true },
  { email: "inspector@demo.test", name: "Claire Dobson", roles: ["quality_inspector"], employee: true },
  { email: "quality@demo.test", name: "Ravi Shah", roles: ["quality_manager"], employee: true },
  { email: "dispatch@demo.test", name: "Kevin Moore", roles: ["dispatch"], employee: true },
  { email: "auditor@demo.test", name: "Jo Pearce (external auditor)", roles: ["auditor"], employee: false },
] as const;

export type DemoCtx = { db: DB; admin: Ctx; byEmail: Map<string, { userId: string; employeeId: string | null; ctx: Ctx }> };

export async function seedDemo(db: DB, opts: { password: string }) {
  await db
    .update(companySettings)
    .set({
      isDemo: true,
      companyName: "Brackley Precision Engineering Ltd (DEMO)",
      addressLines: "Unit 7, Shelley Road Industrial Estate\nBrackley\nNorthamptonshire\nNN13 7AB",
      phone: "01280 000000",
      email: "office@brackley-precision.test",
      vatNumber: "GB 000 0000 00",
      companyNumber: "00000000",
      defaultQuoteTerms:
        "Prices are ex-works and exclude VAT. Quotation valid for the period stated. Lead time confirmed on receipt of order and approved drawings. Material subject to availability at time of order. Our standard terms and conditions of sale apply.",
    })
    .where(eq(companySettings.id, 1));

  const hash = await hashPassword(opts.password);
  const byEmail: DemoCtx["byEmail"] = new Map();
  let empNo = 100;
  for (const u of DEMO_USERS) {
    let employeeId: string | null = null;
    if (u.employee) {
      const [first, ...rest] = u.name.split(" ");
      const [e] = await db
        .insert(employees)
        .values({ employeeNo: `E${++empNo}`, firstName: first, lastName: rest.join(" "), email: u.email, jobTitle: u.roles[0].replace(/_/g, " "), badgeCode: `BADGE-${empNo}`, shift: "Days (07:00–15:30)" })
        .returning();
      employeeId = e.id;
    }
    const [row] = await db.insert(users).values({ email: u.email, name: u.name, passwordHash: hash, employeeId, mustChangePassword: false }).returning();
    for (const key of u.roles) {
      const [r] = await db.select().from(roles).where(eq(roles.key, key));
      await db.insert(userRoles).values({ userId: row.id, roleId: r.id });
    }
    const actor = (await loadActor(db, row.id))!;
    byEmail.set(u.email, { userId: row.id, employeeId, ctx: { db, actor } });
  }
  const admin = byEmail.get("admin@demo.test")!.ctx;
  const sales = byEmail.get("sales@demo.test")!.ctx;
  const quality = byEmail.get("quality@demo.test")!.ctx;
  const purchasing = byEmail.get("purchasing@demo.test")!.ctx;

  // ── Customers ──
  const kestrel = await createCustomer(sales, {
    code: "KESTREL",
    name: "Kestrel Aerospace Components Ltd",
    email: "purchasing@kestrel-aero.test",
    phone: "01234 100200",
    currency: "GBP",
    paymentTerms: "30 days EOM",
    qualityRequirements: "AS9100 flow-down clauses apply. First-article inspection report (FAIR) on new part numbers. No unapproved concessions.",
    requiredCertificates: "EN 10204 3.1 material certificates; Certificate of Conformity with every delivery.",
    packagingRequirements: "Individually bagged, VCI paper for steel parts.",
  });
  const northfield = await createCustomer(sales, {
    code: "NORHYD",
    name: "Northfield Hydraulics Ltd",
    email: "orders@northfield-hydraulics.test",
    phone: "0161 200 3000",
    paymentTerms: "60 days",
    requiredCertificates: "EN 10204 3.1 material certificates for pressure-retaining parts.",
  });
  const severn = await createCustomer(sales, {
    code: "SEVMED",
    name: "Severn Medical Devices plc",
    email: "supplychain@severn-medical.test",
    paymentTerms: "45 days",
    qualityRequirements: "ISO 13485 supplier. Serial-number traceability required for implant-grade components.",
    requiredCertificates: "3.1 certificates, CoC, inspection report per serial number.",
  });
  const ardent = await createCustomer(sales, { code: "ARDENT", name: "Ardent Motorsport Engineering", email: "parts@ardent-motorsport.test", paymentTerms: "30 days" });

  for (const [c, contact, addr] of [
    [kestrel, { name: "Fiona Grant", jobTitle: "Senior Buyer", email: "f.grant@kestrel-aero.test", phone: "01234 100211" }, { line1: "Kestrel House, Aviation Park", city: "Bedford", postcode: "MK44 1XX", label: "Goods-in, Door 3" }],
    [northfield, { name: "Andy Patel", jobTitle: "Purchasing Manager", email: "a.patel@northfield-hydraulics.test" }, { line1: "Mill Lane Works", city: "Stockport", postcode: "SK4 2XX" }],
    [severn, { name: "Dr Megan Lloyd", jobTitle: "Supplier Quality Engineer", email: "m.lloyd@severn-medical.test" }, { line1: "Severn Science Park, Building 2", city: "Gloucester", postcode: "GL2 9XX" }],
    [ardent, { name: "Chris Bell", jobTitle: "Chief Designer", email: "c.bell@ardent-motorsport.test" }, { line1: "Unit 12, Silverstone Technology Park", city: "Towcester", postcode: "NN12 8XX" }],
  ] as const) {
    await addContact(sales, { customerId: c.id }, { ...contact, isPrimary: true });
    await addAddress(sales, { customerId: c.id }, { kind: "delivery", ...addr, isDefault: true, country: "United Kingdom" });
  }
  await addCustomerRequirement(sales, kestrel.id, { kind: "documentation", description: "Certificate of Conformity signed by the Quality Manager with each delivery", mandatory: true });
  await addCustomerRequirement(sales, kestrel.id, { kind: "material_cert", description: "EN 10204 3.1 certificate traceable to heat number for every material lot used", mandatory: true });
  await addCustomerRequirement(sales, severn.id, { kind: "marking", description: "Laser-mark serial number on each part per drawing note 4", mandatory: true });

  // ── Suppliers ──
  const sup = async (code: string, name: string, categories: ("material" | "subcontract" | "tooling" | "calibration" | "maintenance" | "carrier" | "other")[], status: string, scope: string) => {
    const s = await createSupplier(purchasing, { code, name, categories, email: `sales@${code.toLowerCase()}.test`, currency: "GBP" });
    await setSupplierApproval(quality, s.id, { status, scope, expiresOn: "2027-09-30", reason: "Initial approved supplier list (demo data)" });
    return s;
  };
  const midmet = await sup("MIDMET", "Midland Metals Stockholders Ltd", ["material"], "approved", "Aluminium, carbon and alloy steel bar/plate with 3.1 certs");
  const westal = await sup("WESTAL", "Westbury Alloys Ltd", ["material"], "approved", "Stainless steel and titanium bar");
  const covht = await sup("COVHT", "Coventry Heat Treatment Services", ["subcontract"], "approved", "Through-hardening, nitriding (Nadcap)");
  const bright = await sup("BRIGHT", "Brightside Anodising & Plating", ["subcontract"], "conditional", "Type II/III anodising — conditional pending audit");
  const pcal = await sup("PCAL", "Precision Calibration Labs", ["calibration"], "approved", "UKAS-accredited dimensional calibration");
  const tooltec = await sup("TOOLTEC", "Tooltec Cutting Tools", ["tooling"], "approved", "Cutting tools and inserts");
  const freight = await sup("EXPFR", "Express Freight UK", ["carrier"], "approved", "Next-day pallet and parcel");

  const demo: DemoCtx = { db, admin, byEmail };
  const ops = await seedDemoOperations(demo, { customers: { kestrel, northfield, severn, ardent }, suppliers: { midmet, westal, covht, bright, pcal, tooltec, freight } });
  await applyRealisticDemoTimings(db);

  return { users: DEMO_USERS.length, customers: 4, suppliers: 7, ...ops };
}
