import { beforeAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import { auditEvents, emailOutbox, files, quotationRevisions, quoteAcceptanceLinks } from "@/server/db/schema";
import { createQuotation, createRevision, markQuotationSent, recordCustomerResponse, reviewQuotation, saveQuoteLine, submitForReview, verifyAcceptance } from "@/server/services/quotations";
import { getAcceptanceView, linkDocument, regenerateAcceptanceLink, respondViaLink } from "@/server/services/quote-acceptance";
import { verifyAuditChain } from "@/server/audit";
import { readFileBytes } from "@/server/storage";
import { setupDb, TEST_PASSWORD } from "../helpers/db";
import { customer, team, type Team } from "../helpers/fixtures";

let db: DB;
let t: Team;
beforeAll(async () => {
  db = await setupDb();
  t = await team(db);
});

const BASE = "https://mjms.example.test";
const tokenOf = (url: string | null) => url!.split("/q/")[1];
const meta = { ip: "203.0.113.7", userAgent: "vitest" };

async function sentQuote() {
  const cust = await customer(t.sales.ctx);
  const { quotation, revision } = await createQuotation(t.sales.ctx, { customerId: cust.id, title: "Hydraulic manifold blocks" });
  await saveQuoteLine(t.sales.ctx, revision.id, { partNumber: "MB-40", description: "Manifold block", quantity: "20", materialCostPerUnit: "30" });
  await submitForReview(t.sales.ctx, revision.id);
  await reviewQuotation(t.manager.ctx, revision.id, { decision: "approved", password: TEST_PASSWORD });
  const sent = await markQuotationSent(t.sales.ctx, revision.id, { sentTo: cust.email!, emailToCustomer: true, linkBaseUrl: BASE });
  return { cust, quotation, revision, token: tokenOf(sent.acceptanceUrl), url: sent.acceptanceUrl! };
}

describe("customer accepts a quotation online (mutual acceptance)", () => {
  it("customer accepts through the link, staff countersign, both get the signed order acceptance", async () => {
    const { quotation, revision, token, url } = await sentQuote();
    expect(url.startsWith(`${BASE}/q/`)).toBe(true);

    // The quotation email carries the link; only the token's hash is stored.
    const [mail] = await db.select().from(emailOutbox).where(eq(emailOutbox.idempotencyKey, `quote-sent:${revision.id}`));
    expect(mail.html).toContain(url);
    const [link] = await db.select().from(quoteAcceptanceLinks).where(eq(quoteAcceptanceLinks.revisionId, revision.id));
    expect(link.tokenHash).not.toContain(token);

    const view = await getAcceptanceView(db, token);
    expect(view?.state).toBe("open");
    expect(view?.lines[0].partNumber).toBe("MB-40");
    expect(view?.quote.pdfSha256).toMatch(/^[0-9a-f]{64}$/);

    await expect(respondViaLink(db, token, { decision: "accept", name: "Fiona Grant", position: "Senior Buyer", email: "f.grant@cust.test", confirm: false as never }, meta)).rejects.toThrow();

    const po = new File([Buffer.from("%PDF-1.4 customer purchase order")], "PO-7781.pdf", { type: "application/pdf" });
    await respondViaLink(db, token, { decision: "accept", name: "Fiona Grant", position: "Senior Buyer", email: "F.Grant@cust.test", poReference: "PO-7781", confirm: true }, { ...meta, poFile: po });

    await expect(respondViaLink(db, token, { decision: "reject", name: "Someone Else" }, meta)).rejects.toThrow(/already been recorded/);
    await expect(recordCustomerResponse(t.sales.ctx, revision.id, { decision: "accepted", reference: "x" })).rejects.toThrow(/already recorded/);

    const [rev] = await db.select().from(quotationRevisions).where(eq(quotationRevisions.id, revision.id));
    expect(rev.acceptanceChannel).toBe("customer_link");
    expect(rev.acceptedByEmail).toBe("f.grant@cust.test");
    expect(rev.acceptanceIp).toBe("203.0.113.7");
    expect(rev.acceptanceReference).toBe("PO-7781");
    expect(rev.acceptanceEvidenceFileId).toBeTruthy();
    expect(rev.acceptedPdfSha256).toBe(view?.quote.pdfSha256);
    expect((await getAcceptanceView(db, token))?.state).toBe("accepted_pending");

    // Our countersignature: any authorised member of staff (the acceptance was recorded by the system).
    await verifyAcceptance(t.sales.ctx, revision.id, { password: TEST_PASSWORD });
    const [done] = await db.select().from(quotationRevisions).where(eq(quotationRevisions.id, revision.id));
    expect(done.status).toBe("accepted");
    expect(done.acceptanceConfirmationFileId).toBeTruthy();
    const [conf] = await db.select().from(files).where(eq(files.id, done.acceptanceConfirmationFileId!));
    expect((await readFileBytes(conf)).subarray(0, 4).toString()).toBe("%PDF");
    const [confirmMail] = await db.select().from(emailOutbox).where(eq(emailOutbox.idempotencyKey, `quote-acceptance-confirmed:${revision.id}`));
    expect(confirmMail.to).toEqual(["f.grant@cust.test"]);
    expect(confirmMail.attachmentFileIds).toEqual([conf.id]);

    const after = await getAcceptanceView(db, token);
    expect(after?.state).toBe("accepted");
    expect(after?.acceptance?.hasConfirmation).toBe(true);
    expect((await linkDocument(db, token, "confirmation"))?.file.id).toBe(conf.id);

    const events = await db.select().from(auditEvents).where(eq(auditEvents.entityId, quotation.id));
    const recorded = events.find((e) => e.action === "quotation.acceptance_recorded");
    expect((recorded?.after as { channel?: string })?.channel).toBe("customer_link");
    expect((await verifyAuditChain(db)).ok).toBe(true);
  });

  it("lets the customer ask for changes (link stays open) or decline", async () => {
    const a = await sentQuote();
    await expect(respondViaLink(db, a.token, { decision: "changes", name: "Andy Patel", comment: "" }, meta)).rejects.toThrow();
    await respondViaLink(db, a.token, { decision: "changes", name: "Andy Patel", comment: "Can you quote 40 off as well?" }, meta);
    const [rev] = await db.select().from(quotationRevisions).where(eq(quotationRevisions.id, a.revision.id));
    expect(rev.customerFeedback).toContain("Can you quote 40 off as well?");
    expect((await getAcceptanceView(db, a.token))?.state).toBe("open");

    const b = await sentQuote();
    await respondViaLink(db, b.token, { decision: "reject", name: "Andy Patel", comment: "Lead time too long" }, meta);
    expect((await getAcceptanceView(db, b.token))?.state).toBe("rejected");
  });

  it("withdraws the old link when a new revision is sent or the link is replaced", async () => {
    const { quotation, revision, token } = await sentQuote();
    const rev2 = await createRevision(t.sales.ctx, quotation.id, "Customer asked for 40 off");
    await submitForReview(t.sales.ctx, rev2.id);
    await reviewQuotation(t.manager.ctx, rev2.id, { decision: "approved", password: TEST_PASSWORD });
    const sent2 = await markQuotationSent(t.sales.ctx, rev2.id, { sentTo: "buyer@x.test", linkBaseUrl: BASE });

    expect((await getAcceptanceView(db, token))?.state).toBe("withdrawn");
    await expect(respondViaLink(db, token, { decision: "accept", name: "A Buyer", position: "Buyer", email: "a@b.test", confirm: true }, meta)).rejects.toThrow(/replaced by a newer revision/);
    expect(await linkDocument(db, token, "quote")).toBeNull();
    expect(revision.id).not.toBe(rev2.id);

    const token2 = tokenOf(sent2.acceptanceUrl);
    expect((await getAcceptanceView(db, token2))?.state).toBe("open");
    await expect(regenerateAcceptanceLink(t.opA.ctx, rev2.id)).rejects.toThrow();
    const token3 = await regenerateAcceptanceLink(t.sales.ctx, rev2.id);
    expect((await getAcceptanceView(db, token2))?.state).toBe("withdrawn");
    expect((await getAcceptanceView(db, token3))?.state).toBe("open");
  });

  it("refuses responses after expiry and reveals nothing for unknown tokens", async () => {
    const { revision, token } = await sentQuote();
    await db.update(quoteAcceptanceLinks).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(quoteAcceptanceLinks.revisionId, revision.id));
    expect((await getAcceptanceView(db, token))?.state).toBe("expired");
    await expect(respondViaLink(db, token, { decision: "accept", name: "A Buyer", position: "Buyer", email: "a@b.test", confirm: true }, meta)).rejects.toThrow(/expired/);

    expect(await getAcceptanceView(db, "not-a-real-token-but-long-enough-xyz")).toBeNull();
    expect(await getAcceptanceView(db, "../../etc")).toBeNull();
    await expect(respondViaLink(db, "not-a-real-token-but-long-enough-xyz", { decision: "reject", name: "Nobody" }, meta)).rejects.toThrow();
    const leaked = await db.select().from(emailOutbox).where(like(emailOutbox.html, "%not-a-real-token%"));
    expect(leaked).toHaveLength(0);
  });
});
