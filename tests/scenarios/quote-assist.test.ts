import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import { aiExtractions, enquiryAttachments, quotationLineOperations, quotationLines, quotationRevisions } from "@/server/db/schema";
import { createEnquiry } from "@/server/services/enquiries";
import { draftQuoteFromEnquiry, type DrawingQuote } from "@/server/services/quote-assist";
import { approveAndSend, saveQuoteLine } from "@/server/services/quotations";
import { storeFile } from "@/server/storage";
import { setupDb, TEST_PASSWORD } from "../helpers/db";
import { customer, team, type Team } from "../helpers/fixtures";

let db: DB;
let t: Team;
beforeAll(async () => {
  db = await setupDb({ quoteMode: "default" });
  t = await team(db);
});

const proposal: DrawingQuote = {
  title: "Machined brackets — 2 part numbers",
  lines: [
    {
      partNumber: "KB-100",
      description: "Mounting bracket",
      drawingNumber: "KB-100",
      drawingRevision: "C",
      materialSpec: "6082-T6 aluminium plate",
      quantity: 50,
      otherQuantities: [100, 250],
      finish: "Clear anodise",
      criticalFeatures: ["Ø10 H7 bore", "M6 tapped x4"],
      suggestedOperations: ["CNC mill op 1", "CNC mill op 2", "Deburr", "Anodise — subcontract"],
      sourceFile: "KB-100 revC.pdf",
    },
    { partNumber: "KB-101", description: "Spacer", drawingNumber: null, drawingRevision: null, materialSpec: null, quantity: null, otherQuantities: [], finish: null, criticalFeatures: [], suggestedOperations: [], sourceFile: null },
  ],
  questionsForCustomer: ["Is a material certificate (3.1) required?", "Quantity for KB-101?"],
  notes: ["Email mentions rev B but drawing is rev C"],
};

describe("draft quote from an enquiry's drawings", () => {
  it("creates an unpriced draft from the assistant's reading, which cannot be sent until every line is priced", async () => {
    const cust = await customer(t.sales.ctx);
    const enq = await createEnquiry(t.sales.ctx, { customerId: cust.id, subject: "RFQ brackets", description: "Please quote 50, 100 and 250 off KB-100 to the attached drawing, plus spacers." });
    const drawing = await storeFile(db, { bytes: Buffer.from("%PDF-1.4 drawing"), name: "KB-100 revC.pdf", mimeType: "application/pdf", uploadedBy: t.sales.userId, isCustomerOriginal: true });
    const step = await storeFile(db, { bytes: Buffer.from("ISO-10303-21;"), name: "KB-100.step", mimeType: "application/step", uploadedBy: t.sales.userId });
    await db.insert(enquiryAttachments).values([
      { enquiryId: enq.id, fileId: drawing.id, kind: "drawing", addedBy: t.sales.userId },
      { enquiryId: enq.id, fileId: step.id, kind: "step", addedBy: t.sales.userId },
    ]);

    const seen: { docs: string[]; instructions: string }[] = [];
    const reader = async (o: { instructions: string; documents: { name: string }[] }) => {
      seen.push({ docs: o.documents.map((d) => d.name), instructions: o.instructions });
      return { data: proposal, model: "claude-opus-5-5", inputTokens: 5000, outputTokens: 800 };
    };
    const r = await draftQuoteFromEnquiry(t.sales.ctx, enq.id, { reader });
    expect(seen[0].docs).toEqual(["KB-100 revC.pdf"]); // the STEP file can't be read and is listed as skipped
    expect(seen[0].instructions).toContain("KB-100.step");
    expect(seen[0].instructions).toContain("250 off");

    const [rev] = await db.select().from(quotationRevisions).where(eq(quotationRevisions.quotationId, r.quotationId));
    expect(rev.status).toBe("draft");
    expect(rev.internalNotes).toContain("material certificate");
    expect(rev.internalNotes).toContain("Not read");
    const lines = await db.select().from(quotationLines).where(eq(quotationLines.revisionId, rev.id));
    expect(lines.map((l) => [l.partNumber, l.quantity, l.unitPrice])).toEqual([
      ["KB-100", "50.0000", "0.0000"],
      ["KB-101", "1.0000", "0.0000"],
    ]);
    expect(lines[0].materialSpec).toBe("6082-T6 aluminium plate; Finish: Clear anodise");
    expect(lines[0].notes).toContain("100, 250");
    expect(lines[1].notes).toContain("Quantity not stated");
    const ops = await db.select().from(quotationLineOperations).where(eq(quotationLineOperations.lineId, lines[0].id));
    expect(ops.map((o) => o.description)).toEqual(["CNC mill op 1", "CNC mill op 2", "Deburr", "Anodise — subcontract"]);
    const [x] = await db.select().from(aiExtractions).where(eq(aiExtractions.quotationId, r.quotationId));
    expect(x.kind).toBe("drawing_quote");

    // Cannot go out unpriced.
    const send = { sentTo: "buyer@cust.test", password: TEST_PASSWORD };
    await expect(approveAndSend(t.admin.ctx, rev.id, send)).rejects.toThrow(/Price every line/);
    await saveQuoteLine(t.sales.ctx, rev.id, { partNumber: "KB-100", description: "Mounting bracket", quantity: "50", priceOverridePerUnit: "12.40" }, lines[0].id);
    await expect(approveAndSend(t.admin.ctx, rev.id, send)).rejects.toThrow(/line 2 \(KB-101\)/);
    await saveQuoteLine(t.sales.ctx, rev.id, { partNumber: "KB-101", description: "Spacer", quantity: "100", priceOverridePerUnit: "0.95" }, lines[1].id);
    await approveAndSend(t.admin.ctx, rev.id, send);
  });

  it("refuses when there is nothing to read", async () => {
    const cust = await customer(t.sales.ctx);
    const enq = await createEnquiry(t.sales.ctx, { customerId: cust.id, subject: "Call me" });
    await expect(draftQuoteFromEnquiry(t.sales.ctx, enq.id, { reader: async () => ({ data: proposal, model: "m", inputTokens: 0, outputTokens: 0 }) })).rejects.toThrow(/nothing for the assistant to read/);
  });
});
