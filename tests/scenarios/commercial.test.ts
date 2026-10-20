import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import { enquiries, files, jobLines, jobs, quotationRevisions } from "@/server/db/schema";
import { createEnquiry, importEmlUpload, linkEmailToEnquiry, listInbox, getEnquiry } from "@/server/services/enquiries";
import {
  createQuotation,
  createRevision,
  markQuotationSent,
  recordCustomerResponse,
  reviewQuotation,
  saveQuoteLine,
  submitForReview,
  verifyAcceptance,
} from "@/server/services/quotations";
import { convertOrderToJob, registerCustomerOrder, verifyCustomerOrder } from "@/server/services/orders";
import { readFileBytes } from "@/server/storage";
import { setupDb, TEST_PASSWORD } from "../helpers/db";
import { customer, jobFromScratch, team, type Team } from "../helpers/fixtures";

let db: DB;
let t: Team;
beforeAll(async () => {
  db = await setupDb();
  t = await team(db);
});

describe("enquiry → quotation → PO → job", () => {
  it("runs the full commercial chain and creates a job with a permanent number", async () => {
    const { job, enq, revision } = await jobFromScratch(t);
    expect(job.jobNumber).toMatch(/^JOB-\d{2}-\d{4}$/);
    expect(job.status).toBe("order_confirmed");
    const [e] = await db.select().from(enquiries).where(eq(enquiries.id, enq.id));
    expect(e.status).toBe("won");
    const [rev] = await db.select().from(quotationRevisions).where(eq(quotationRevisions.id, revision.id));
    expect(rev.status).toBe("accepted");
    expect(rev.isLocked).toBe(true);
    expect(rev.pdfFileId).toBeTruthy();
    const [pdf] = await db.select().from(files).where(eq(files.id, rev.pdfFileId!));
    const bytes = await readFileBytes(pdf);
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    const lines = await db.select().from(jobLines).where(eq(jobLines.jobId, job.id));
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe("50.0000");
  });

  it("enforces review, independence, locking, verification and PO uniqueness", async () => {
    const cust = await customer(t.sales.ctx);
    const { revision, quotation } = await createQuotation(t.sales.ctx, { customerId: cust.id, title: "Shafts" });
    await expect(submitForReview(t.sales.ctx, revision.id)).rejects.toThrow(/at least one line/);
    await saveQuoteLine(t.sales.ctx, revision.id, { partNumber: "SH-1", description: "Shaft", quantity: "10", materialCostPerUnit: "12" });
    await expect(markQuotationSent(t.sales.ctx, revision.id, { sentTo: "x@y.test" })).rejects.toThrow(/approved in internal review/);
    await submitForReview(t.sales.ctx, revision.id);
    await expect(reviewQuotation(t.manager.ctx, revision.id, { decision: "approved", password: "wrong-password" })).rejects.toThrow(/Password incorrect/);
    await reviewQuotation(t.manager.ctx, revision.id, { decision: "approved", password: TEST_PASSWORD });
    await markQuotationSent(t.sales.ctx, revision.id, { sentTo: "buyer@cust.test" });
    // locked after sending
    await expect(saveQuoteLine(t.sales.ctx, revision.id, { partNumber: "SH-2", description: "x", quantity: "1" })).rejects.toThrow(/locked/);
    // acceptance needs evidence or a reference
    await expect(recordCustomerResponse(t.sales.ctx, revision.id, { decision: "accepted" })).rejects.toThrow(/evidence/);
    await recordCustomerResponse(t.sales.ctx, revision.id, { decision: "accepted", reference: "Phone call — awaiting PO" });
    // the recorder cannot verify their own recorded acceptance
    await expect(verifyAcceptance(t.sales.ctx, revision.id, { password: TEST_PASSWORD })).rejects.toThrow(/different person/);
    // PO can be registered but cannot be verified before acceptance is verified
    const po = await registerCustomerOrder(t.sales.ctx, { customerId: cust.id, customerPoNumber: "PO-778", quotationRevisionId: revision.id }, new File(["%PDF"], "po.pdf"));
    await expect(verifyCustomerOrder(t.sales2.ctx, po.id, { password: TEST_PASSWORD })).rejects.toThrow(/not been accepted and verified/);
    await expect(convertOrderToJob(t.sales.ctx, po.id, { title: "Shafts job" })).rejects.toThrow(/contract review/);
    await verifyAcceptance(t.sales2.ctx, revision.id, { password: TEST_PASSWORD });
    await verifyCustomerOrder(t.sales2.ctx, po.id, { password: TEST_PASSWORD });
    // duplicate PO number for the same customer is refused
    await expect(registerCustomerOrder(t.sales.ctx, { customerId: cust.id, customerPoNumber: "PO-778" })).rejects.toThrow(/already registered/);
    const job = await convertOrderToJob(t.sales.ctx, po.id, { title: "Shafts" });
    await expect(convertOrderToJob(t.sales.ctx, po.id, { title: "again" })).rejects.toThrow(/already been converted/);
    const [j] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(j.quotationRevisionId).toBe(revision.id);
    // an accepted quotation cannot be revised
    await expect(createRevision(t.sales.ctx, quotation.id, "change")).rejects.toThrow(/accepted revision/);
  });

  it("keeps previous revisions intact when a new revision is issued", async () => {
    const cust = await customer(t.sales.ctx);
    const { revision, quotation } = await createQuotation(t.sales.ctx, { customerId: cust.id, title: "Plates" });
    await saveQuoteLine(t.sales.ctx, revision.id, { partNumber: "PL-1", description: "Plate", quantity: "5", materialCostPerUnit: "20" });
    await submitForReview(t.sales.ctx, revision.id);
    await reviewQuotation(t.manager.ctx, revision.id, { decision: "approved", password: TEST_PASSWORD });
    await markQuotationSent(t.sales.ctx, revision.id, { sentTo: "a@b.test" });
    const rev2 = await createRevision(t.sales.ctx, quotation.id, "Customer asked for qty 10");
    expect(rev2.revisionNo).toBe(2);
    await saveQuoteLine(t.sales.ctx, rev2.id, { partNumber: "PL-1", description: "Plate", quantity: "10", materialCostPerUnit: "20" });
    await submitForReview(t.sales.ctx, rev2.id);
    await reviewQuotation(t.manager.ctx, rev2.id, { decision: "approved", password: TEST_PASSWORD });
    await markQuotationSent(t.sales.ctx, rev2.id, { sentTo: "a@b.test" });
    const [r1] = await db.select().from(quotationRevisions).where(eq(quotationRevisions.id, revision.id));
    expect(r1.status).toBe("superseded");
    expect(r1.total).not.toBe("0.00"); // original figures preserved
    expect(r1.pdfFileId).toBeTruthy();
  });
});

describe("email import", () => {
  it("imports an .eml with attachments idempotently and links it to an enquiry", async () => {
    const eml = [
      "From: Fiona Buyer <buyer@cust-mail.test>",
      "To: sales@workshop.test",
      "Subject: RFQ - 200 off flange",
      "Message-ID: <rfq-123@cust-mail.test>",
      "Date: Tue, 13 Oct 2026 09:12:00 +0100",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Please quote 200 off FL-200 rev C, 316L, delivery 6 weeks.",
      "--b1",
      'Content-Type: application/pdf; name="FL-200-C.pdf"',
      'Content-Disposition: attachment; filename="FL-200-C.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("%PDF-1.4 fake drawing").toString("base64"),
      "--b1--",
      "",
    ].join("\r\n");
    const file = new File([eml], "rfq.eml", { type: "message/rfc822" });
    const first = await importEmlUpload(t.sales.ctx, file);
    expect(first.duplicate).toBe(false);
    const again = await importEmlUpload(t.sales.ctx, new File([eml], "rfq.eml"));
    expect(again.duplicate).toBe(true);
    const inbox = await listInbox(t.sales.ctx);
    const item = inbox.find((m) => m.id === first.email.id)!;
    expect(item.subject).toBe("RFQ - 200 off flange");
    expect(item.attachmentCount).toBe(1);
    const cust = await customer(t.sales.ctx);
    const enq = await createEnquiry(t.sales.ctx, { customerId: cust.id, subject: "Flange RFQ" });
    await linkEmailToEnquiry(t.sales.ctx, first.email.id, enq.id);
    const full = await getEnquiry(t.sales.ctx, enq.id);
    expect(full.attachments.map((a) => a.a.kind).sort()).toEqual(["drawing", "email"]);
    expect(full.attachments.every((a) => a.f.isCustomerOriginal)).toBe(true);
  });
});
