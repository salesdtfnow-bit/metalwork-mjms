import type { DB } from "@/server/db/client";
import type { Ctx } from "@/server/context";
import { addAddress, createCustomer } from "@/server/services/parties";
import { createEnquiry } from "@/server/services/enquiries";
import {
  createQuotation,
  markQuotationSent,
  recordCustomerResponse,
  reviewQuotation,
  saveQuoteLine,
  submitForReview,
  verifyAcceptance,
} from "@/server/services/quotations";
import { convertOrderToJob, registerCustomerOrder, verifyCustomerOrder } from "@/server/services/orders";
import { makeUser, TEST_PASSWORD } from "./db";

let n = 0;

export async function team(db: DB) {
  return {
    admin: await makeUser(db, ["admin"]),
    sales: await makeUser(db, ["sales"]),
    sales2: await makeUser(db, ["sales"]),
    manager: await makeUser(db, ["management"]),
    planner: await makeUser(db, ["production_manager"]),
    programmer: await makeUser(db, ["cnc_programmer"]),
    purchasing: await makeUser(db, ["purchasing"]),
    opA: await makeUser(db, ["operator"], { name: "Operator A" }),
    opB: await makeUser(db, ["operator"], { name: "Operator B" }),
    inspector: await makeUser(db, ["quality_inspector"]),
    qm: await makeUser(db, ["quality_manager"]),
    dispatch: await makeUser(db, ["dispatch"]),
    auditor: await makeUser(db, ["auditor"]),
  };
}
export type Team = Awaited<ReturnType<typeof team>>;

export async function customer(ctx: Ctx) {
  n++;
  const c = await createCustomer(ctx, { code: `CUST${n}`, name: `Test Customer ${n} Ltd`, email: `buyer@cust${n}.test`, currency: "GBP" });
  await addAddress(ctx, { customerId: c.id }, { kind: "delivery", line1: `${n} Test Street`, city: "Testville", postcode: "TE5 7ST", isDefault: true, country: "United Kingdom" });
  return c;
}

/** Runs enquiry → quotation → review → send → acceptance → verified PO → job. */
export async function jobFromScratch(t: Team, opts: { qty?: string; lines?: { partNumber: string; description: string }[] } = {}) {
  const cust = await customer(t.sales.ctx);
  const enq = await createEnquiry(t.sales.ctx, { customerId: cust.id, subject: "Machined brackets", receivedVia: "email" }, [
    { partNumber: "BRK-100", description: "Bracket", quantity: opts.qty ?? "50", materialGrade: "6082-T6" },
  ]);
  const { quotation, revision } = await createQuotation(t.sales.ctx, { customerId: cust.id, enquiryId: enq.id, title: "Brackets", defaultMarginPct: "25" });
  for (const l of opts.lines ?? [{ partNumber: "BRK-100", description: "Bracket, 6082-T6" }]) {
    await saveQuoteLine(t.sales.ctx, revision.id, {
      ...l,
      quantity: opts.qty ?? "50",
      materialCostPerUnit: "3.50",
      materialWastagePct: "10",
      programmingCost: "120",
      materialSpec: "6082-T6",
      drawingNumber: `DRG-${l.partNumber}`,
      drawingRevision: "A",
      operations: [
        { description: "CNC mill", setupMinutes: "60", cycleMinutes: "5", ratePerHour: "60" },
        { description: "CNC turn", setupMinutes: "30", cycleMinutes: "3", ratePerHour: "55" },
      ],
    });
  }
  await submitForReview(t.sales.ctx, revision.id);
  await reviewQuotation(t.manager.ctx, revision.id, { decision: "approved", password: TEST_PASSWORD });
  await markQuotationSent(t.sales.ctx, revision.id, { sentTo: "buyer@example.test" });
  await recordCustomerResponse(t.sales.ctx, revision.id, { decision: "accepted", reference: "Email from buyer 12/10" });
  await verifyAcceptance(t.sales2.ctx, revision.id, { password: TEST_PASSWORD });
  const po = await registerCustomerOrder(
    t.sales.ctx,
    { customerId: cust.id, customerPoNumber: `PO-${Date.now()}-${n}`, quotationRevisionId: revision.id, requiredDate: "2030-01-31" },
    new File([new Uint8Array([37, 80, 68, 70])], "customer-po.pdf", { type: "application/pdf" }),
  );
  await verifyCustomerOrder(t.sales2.ctx, po.id, { password: TEST_PASSWORD });
  const job = await convertOrderToJob(t.sales.ctx, po.id, { title: "Brackets for test", ownerId: t.planner.userId });
  return { cust, enq, quotation, revision, po, job };
}
