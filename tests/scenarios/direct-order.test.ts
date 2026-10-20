import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import { approvals, customerOrders, jobLines, jobs } from "@/server/db/schema";
import { convertOrderToJob, linkQuotationToOrder, registerAndCreateJob, registerCustomerOrder, verifyCustomerOrder } from "@/server/services/orders";
import { storeFile } from "@/server/storage";
import { verifyAuditChain } from "@/server/audit";
import { setupDb, TEST_PASSWORD } from "../helpers/db";
import { customer, team, type Team } from "../helpers/fixtures";

let db: DB;
let t: Team;
beforeAll(async () => {
  db = await setupDb({ quoteMode: "default" });
  t = await team(db);
});

const pdf = (name = "po.pdf") => new File([Buffer.from("%PDF-1.4 purchase order")], name, { type: "application/pdf" });
const lines = [
  { partNumber: "SP-10", description: "Spacer 10mm", quantity: "200", unitPrice: "1.10" },
  { partNumber: "BR-22", description: "Bracket", drawingRevision: "C", materialSpec: "6082-T6", quantity: "50", unitPrice: "14.50" },
];

describe("customer PO received without a quotation", () => {
  it("registers the PO with its own lines, reviews it and creates the job from those lines", async () => {
    const cust = await customer(t.sales.ctx);
    const o = await registerCustomerOrder(t.sales.ctx, { customerId: cust.id, customerPoNumber: "PO-D-1", lines }, pdf());
    expect(o.orderValue).toBe("945.00");

    await verifyCustomerOrder(t.manager.ctx, o.id, { password: TEST_PASSWORD });
    const [signed] = await db.select().from(approvals).where(eq(approvals.entityId, o.id));
    expect(signed.meaning).toMatch(/without a quotation/);

    const job = await convertOrderToJob(t.sales.ctx, o.id, { title: "Spacers and brackets" });
    expect(job.quotationRevisionId).toBeNull();
    const jl = await db.select().from(jobLines).where(eq(jobLines.jobId, job.id));
    expect(jl.map((l) => [l.partNumber, l.quantity])).toEqual([
      ["SP-10", "200.0000"],
      ["BR-22", "50.0000"],
    ]);
    expect(jl.every((l) => l.customerOrderLineId && !l.quotationLineId)).toBe(true);
    expect(jl[1].materialSpec).toBe("6082-T6");
    expect((await verifyAuditChain(db)).ok).toBe(true);
  });

  it("does it all in one step (register → signed contract review → job), and rolls back on a wrong password", async () => {
    const cust = await customer(t.sales.ctx);
    await expect(
      registerAndCreateJob(t.admin.ctx, { customerId: cust.id, customerPoNumber: "PO-D-2", lines }, pdf(), { password: "wrong-password" }, { title: "Rush order" }),
    ).rejects.toThrow(/Password incorrect/);
    expect(await db.select().from(customerOrders).where(eq(customerOrders.customerPoNumber, "PO-D-2"))).toHaveLength(0);

    const { order, job } = await registerAndCreateJob(t.admin.ctx, { customerId: cust.id, customerPoNumber: "PO-D-2", lines }, pdf(), { password: TEST_PASSWORD }, { title: "Rush order", priority: 1 });
    const [o] = await db.select().from(customerOrders).where(eq(customerOrders.id, order.id));
    expect(o.status).toBe("converted");
    const [j] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(j.priority).toBe(1);
    expect(j.status).toBe("order_confirmed");
    // Sales alone cannot fast-track (no contract review permission).
    await expect(registerAndCreateJob(t.sales.ctx, { customerId: cust.id, customerPoNumber: "PO-D-3", lines }, pdf(), { password: TEST_PASSWORD }, { title: "x" })).rejects.toThrow();
  });

  it("guards the edges: lines or quote (not both), something to review, own uploads only", async () => {
    const cust = await customer(t.sales.ctx);
    const empty = await registerCustomerOrder(t.sales.ctx, { customerId: cust.id, customerPoNumber: "PO-D-4" }, pdf());
    await expect(verifyCustomerOrder(t.manager.ctx, empty.id, { password: TEST_PASSWORD })).rejects.toThrow(/ordered lines/);

    const direct = await registerCustomerOrder(t.sales.ctx, { customerId: cust.id, customerPoNumber: "PO-D-5", lines }, pdf());
    await expect(linkQuotationToOrder(t.sales.ctx, direct.id, crypto.randomUUID())).rejects.toThrow(/own lines/);

    const othersFile = await storeFile(db, { bytes: Buffer.from("%PDF-1.4"), name: "other.pdf", uploadedBy: t.purchasing.userId });
    await expect(registerCustomerOrder(t.sales.ctx, { customerId: cust.id, customerPoNumber: "PO-D-6", lines }, null, othersFile.id)).rejects.toThrow(/could not be found/);
    const mine = await storeFile(db, { bytes: Buffer.from("%PDF-1.4"), name: "mine.pdf", uploadedBy: t.sales.userId });
    const ok = await registerCustomerOrder(t.sales.ctx, { customerId: cust.id, customerPoNumber: "PO-D-7", lines }, null, mine.id);
    expect(ok.poFileId).toBe(mine.id);
    await expect(registerCustomerOrder(t.sales.ctx, { customerId: cust.id, customerPoNumber: "PO-D-8", lines }, null, mine.id)).rejects.toThrow(/already attached/);
  });
});
