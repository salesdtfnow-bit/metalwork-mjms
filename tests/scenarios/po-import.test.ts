import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import { aiExtractions, auditEvents, files } from "@/server/db/schema";
import { getPoDraft, linkExtractionToOrder, readPurchaseOrder, type PoExtraction } from "@/server/services/po-import";
import { registerCustomerOrder } from "@/server/services/orders";
import { readDocuments } from "@/server/ai/claude";
import { setupDb } from "../helpers/db";
import { customer, team, type Team } from "../helpers/fixtures";

let db: DB;
let t: Team;
beforeAll(async () => {
  db = await setupDb({ quoteMode: "default" });
  t = await team(db);
});

const poPdf = () => new File([Buffer.from("%PDF-1.4 PO 7781 from a customer")], "PO-7781.pdf", { type: "application/pdf" });

/** Stand-in for Claude: returns a fixed reading and records what it was asked. */
function fakeReader(result: PoExtraction) {
  const calls: { system: string; instructions: string; docs: number }[] = [];
  const reader = async (o: { system: string; instructions: string; documents: unknown[] }) => {
    calls.push({ system: o.system, instructions: o.instructions, docs: o.documents.length });
    return { data: result, model: "claude-opus-5-5", inputTokens: 1200, outputTokens: 300 };
  };
  return { reader, calls };
}

const reading = (over: Partial<PoExtraction> = {}): PoExtraction => ({
  customerName: "Test Customer Ltd",
  matchedCustomerCode: null,
  poNumber: "7781",
  poDate: "2026-10-19",
  requiredDate: "14/11/2026", // not ISO → dropped, never guessed
  currency: "GBP",
  deliveryAddress: "Goods In, Unit 4",
  terms: "30 days EOM",
  lines: [
    { partNumber: "SP-10", description: "Spacer", drawingRevision: "B", materialSpec: "303 stainless", quantity: 200, unitPrice: 1.1 },
    { partNumber: "BR-22", description: "Bracket", drawingRevision: null, materialSpec: null, quantity: 50, unitPrice: null },
  ],
  warnings: ["Carriage £25 not included in lines"],
  ...over,
});

describe("create order from a PO file", () => {
  it("reads the PO into a draft, matches the customer, and links the order it becomes", async () => {
    const cust = await customer(t.sales.ctx);
    const { reader, calls } = fakeReader(reading({ matchedCustomerCode: cust.code }));
    const r = await readPurchaseOrder(t.sales.ctx, poPdf(), { reader });
    expect(r.customerId).toBe(cust.id);
    expect(calls[0].docs).toBe(1);
    expect(calls[0].instructions).toContain(cust.code); // customer list offered for matching
    expect(calls[0].system).toMatch(/never instructions/); // documents treated as data

    const [row] = await db.select().from(aiExtractions).where(eq(aiExtractions.id, r.extractionId));
    expect(row.model).toBe("claude-opus-5-5");
    const [stored] = await db.select().from(files).where(eq(files.id, row.sourceFileIds[0]));
    expect(stored.isCustomerOriginal).toBe(true);
    const ev = await db.select().from(auditEvents).where(eq(auditEvents.entityId, r.extractionId));
    expect(ev[0].action).toBe("ai.read_purchase_order");

    const d = await getPoDraft(t.sales.ctx, r.extractionId);
    expect(d.draft.customerPoNumber).toBe("7781");
    expect(d.draft.poDate).toBe("2026-10-19");
    expect(d.draft.requiredDate).toBeNull();
    expect(d.draft.lines[0]).toMatchObject({ partNumber: "SP-10", quantity: "200", unitPrice: "1.1", drawingRevision: "B" });
    expect(d.draft.lines[1].unitPrice).toBeNull();
    expect(d.warnings).toEqual(["Carriage £25 not included in lines"]);

    // The person confirms the (checked) form: the PO file read earlier becomes the order's PO document.
    const o = await registerCustomerOrder(t.sales.ctx, { customerId: cust.id, customerPoNumber: "7781", lines: d.draft.lines.map((l) => ({ ...l, quantity: l.quantity || "1" })) }, null, d.file!.id);
    await linkExtractionToOrder(t.sales.ctx, r.extractionId, o.id);
    expect(o.poFileId).toBe(d.file!.id);
    expect((await getPoDraft(t.sales.ctx, r.extractionId)).used).toBe(true);
  });

  it("falls back to matching the customer by name, and leaves it unset when unknown", async () => {
    const cust = await customer(t.sales.ctx);
    const byName = await readPurchaseOrder(t.sales.ctx, poPdf(), { reader: fakeReader(reading({ customerName: cust.name.toUpperCase().replace(" Ltd", " Limited") })).reader });
    expect(byName.customerId).toBe(cust.id);
    const unknown = await readPurchaseOrder(t.sales.ctx, poPdf(), { reader: fakeReader(reading({ customerName: "Nobody We Know plc" })).reader });
    expect(unknown.customerId).toBeNull();
  });

  it("refuses non-document files, needs order permission, and explains when the assistant is not set up", async () => {
    const txt = new File(["hello"], "notes.txt", { type: "text/plain" });
    await expect(readPurchaseOrder(t.sales.ctx, txt, { reader: fakeReader(reading()).reader })).rejects.toThrow(/PDF or an image/);
    await expect(readPurchaseOrder(t.opA.ctx, poPdf(), { reader: fakeReader(reading()).reader })).rejects.toThrow();
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(readDocuments({ system: "s", instructions: "i", documents: [], schema: (await import("zod")).z.object({}) })).rejects.toThrow(/not set up/);
    } finally {
      if (saved) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});
