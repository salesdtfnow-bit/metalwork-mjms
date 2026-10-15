import { describe, expect, it } from "vitest";
import { costLine, quoteTotals } from "@/lib/costing";

describe("quotation costing", () => {
  it("costs a milled + turned part with batches, wastage and margin on selling price", () => {
    const r = costLine(
      {
        quantity: "250",
        batchSize: "100", // → 3 batches
        materialCostPerUnit: "4.20",
        materialWastagePct: "10",
        programmingCost: "180",
        setupCostPerBatch: "0",
        inspectionCost: "75",
        certificationCost: "25",
        operations: [
          { setupMinutes: "90", cycleMinutes: "6.5", ratePerHour: "65" }, // mill
          { setupMinutes: "45", cycleMinutes: "3", ratePerHour: "55" }, // lathe
        ],
        marginPct: "30",
      },
      25,
    );
    expect(r.batches).toBe(3);
    expect(r.materialCost).toBe("1155.00"); // 4.20 × 1.10 × 250
    // mill: 1.5h×65×3 = 292.5 ; 6.5/60×65×250 = 1760.4166… → 2052.9166…
    // lathe: 0.75h×55×3 = 123.75 ; 3/60×55×250 = 687.5 → 811.25
    expect(r.machiningCost).toBe("2864.17");
    expect(r.oneOffCost).toBe("280.00");
    expect(r.totalCost).toBe("4299.17");
    // price = 4299.1666…/0.7 = 6141.666… → unit 24.5667 → 24.57
    expect(r.unitPrice).toBe("24.5700");
    expect(r.lineTotal).toBe("6142.50");
    expect(Number(r.achievedMarginPct)).toBeCloseTo(30, 0);
  });

  it("uses the revision default margin when the line has none, and honours overrides", () => {
    const base = costLine({ quantity: 10, materialCostPerUnit: "10" }, 20);
    expect(base.totalCost).toBe("100.00");
    expect(base.unitPrice).toBe("12.5000"); // 100 / 0.8 / 10
    const over = costLine({ quantity: 10, materialCostPerUnit: "10", priceOverridePerUnit: "11.99" }, 20);
    expect(over.overridden).toBe(true);
    expect(over.lineTotal).toBe("119.90");
  });

  it("avoids floating point drift (0.1 + 0.2 style values)", () => {
    const r = costLine({ quantity: "3", materialCostPerUnit: "0.1", otherCost: "0.2", marginPct: "0" });
    expect(r.totalCost).toBe("0.50");
    expect(r.unitCost).toBe("0.1667");
  });

  it("rejects zero quantity and margin ≥ 100%", () => {
    expect(() => costLine({ quantity: 0 })).toThrow(/Quantity/);
    expect(() => costLine({ quantity: 1, marginPct: 100 })).toThrow(/Margin/);
  });

  it("totals with VAT treatment", () => {
    expect(quoteTotals(["6142.50", "100.00"], ["4299.17", "80"], "standard", "20")).toEqual({
      subtotal: "6242.50",
      taxAmount: "1248.50",
      total: "7491.00",
      totalCost: "4379.17",
    });
    expect(quoteTotals(["100"], ["50"], "zero", "20").taxAmount).toBe("0.00");
    expect(quoteTotals(["100"], ["50"], "reverse_charge", "20").total).toBe("100.00");
  });
});
