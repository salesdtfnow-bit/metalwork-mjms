import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import { approvals, companySettings, quotationLines, quotationRevisions } from "@/server/db/schema";
import { approveAndSend, createQuotation, recordCustomerResponse, saveQuoteLine, submitForReview } from "@/server/services/quotations";
import { convertOrderToJob, registerCustomerOrder, verifyCustomerOrder } from "@/server/services/orders";
import { setupDb, TEST_PASSWORD } from "../helpers/db";
import { customer, team, type Team } from "../helpers/fixtures";

let db: DB;
let t: Team;
beforeAll(async () => {
  db = await setupDb({ quoteMode: "default" });
  t = await team(db);
});

const send = { sentTo: "buyer@cust.test", password: TEST_PASSWORD, linkBaseUrl: "https://mjms.example.test" };
const pdf = (name: string) => new File([Buffer.from("%PDF-1.4 test")], name, { type: "application/pdf" });

describe("quick quotations (shipped defaults: one-step approval and acceptance)", () => {
  it("prices a line directly, approves and sends in one signed step, and accepts in one step", async () => {
    // A one-person office: the administrator prepares, approves and sends.
    const cust = await customer(t.admin.ctx);
    const { quotation, revision } = await createQuotation(t.admin.ctx, { customerId: cust.id, title: "Repeat spacers" });

    // Quick line: just a unit price, no cost build-up and no override reason needed.
    await saveQuoteLine(t.admin.ctx, revision.id, { partNumber: "SP-10", description: "Spacer", quantity: "100", priceOverridePerUnit: "1.25" });
    const [line] = await db.select().from(quotationLines).where(eq(quotationLines.revisionId, revision.id));
    expect(line.lineTotal).toBe("125.00");
    // Replacing a price calculated from costs still needs a reason.
    await expect(saveQuoteLine(t.admin.ctx, revision.id, { partNumber: "SP-11", description: "Spacer", quantity: "10", materialCostPerUnit: "2", priceOverridePerUnit: "1" })).rejects.toThrow(/reason/);

    // The preparer approves and sends straight from draft.
    const res = await approveAndSend(t.admin.ctx, revision.id, send);
    expect(res.acceptanceUrl).toContain("/q/");
    const [rev] = await db.select().from(quotationRevisions).where(eq(quotationRevisions.id, revision.id));
    expect(rev.status).toBe("sent");
    expect(rev.reviewedBy).toBe(t.admin.userId);
    expect(rev.isLocked).toBe(true);
    const signed = await db.select().from(approvals).where(eq(approvals.entityId, revision.id));
    expect(signed.map((a) => a.kind)).toContain("quotation.review");

    // Acceptance recorded with evidence by someone allowed to verify → accepted at once.
    const r = await recordCustomerResponse(t.sales.ctx, revision.id, { decision: "accepted", reference: "Email 21/10", evidence: pdf("accept.pdf") });
    expect(r?.accepted).toBe(true);
    const [acc] = await db.select().from(quotationRevisions).where(eq(quotationRevisions.id, revision.id));
    expect(acc.status).toBe("accepted");
    expect(acc.acceptanceVerifiedAt).toBeTruthy();

    // …and the normal PO → job chain works from it.
    const o = await registerCustomerOrder(t.sales.ctx, { customerId: cust.id, customerPoNumber: "PO-QQ-1", quotationRevisionId: revision.id }, pdf("po.pdf"));
    await verifyCustomerOrder(t.manager.ctx, o.id, { password: TEST_PASSWORD });
    const job = await convertOrderToJob(t.sales.ctx, o.id, { title: quotation.title });
    expect(job.jobNumber).toMatch(/^JOB-/);
  });

  it("lets an approver approve-and-send a quote someone else submitted, and enforces independence when switched on", async () => {
    const cust = await customer(t.sales.ctx);
    const { revision } = await createQuotation(t.sales.ctx, { customerId: cust.id, title: "Brackets" });
    await saveQuoteLine(t.sales.ctx, revision.id, { partNumber: "BR-1", description: "Bracket", quantity: "5", priceOverridePerUnit: "20" });
    // Sales cannot approve; they submit, and a manager approves and sends from the review state.
    await expect(approveAndSend(t.sales.ctx, revision.id, send)).rejects.toThrow();
    await submitForReview(t.sales.ctx, revision.id);
    await approveAndSend(t.manager.ctx, revision.id, send);
    const [rev] = await db.select().from(quotationRevisions).where(eq(quotationRevisions.id, revision.id));
    expect(rev.status).toBe("sent");

    await db.update(companySettings).set({ quoteApprovalMode: "independent" }).where(eq(companySettings.id, 1));
    try {
      const own = await createQuotation(t.admin.ctx, { customerId: cust.id, title: "Own quote" });
      await saveQuoteLine(t.admin.ctx, own.revision.id, { partNumber: "X-1", description: "X", quantity: "1", priceOverridePerUnit: "10" });
      await expect(approveAndSend(t.admin.ctx, own.revision.id, send)).rejects.toThrow(/Independent approval/);
    } finally {
      await db.update(companySettings).set({ quoteApprovalMode: "single_step" }).where(eq(companySettings.id, 1));
    }
  });
});
