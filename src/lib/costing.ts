import { d, Decimal, money2, rate4, sum, type Num } from "./decimal";

/**
 * Quotation line costing (decimal-safe). Definitions:
 *   batches          = ceil(quantity / batchSize)            (batchSize defaults to quantity)
 *   material         = materialCostPerUnit × (1 + wastage%) × quantity
 *   machining        = Σ ops [ setupMinutes/60 × rate × batches + cycleMinutes/60 × rate × quantity ]
 *   setup            = setupCostPerBatch × batches
 *   one-off costs    = programming + labour + tooling + consumables + subcontract + finishing
 *                      + inspection + certification + packaging + delivery + other   (line totals)
 *   totalCost        = material + machining + setup + one-off costs
 *   price (margin)   = totalCost / (1 − margin%)     ← gross margin on selling price, margin < 100
 *   unitPrice        = round(price / quantity, 2)    (or the manual override, with a reason)
 *   lineTotal        = unitPrice × quantity          (2 dp)
 */
export type CostOp = { setupMinutes: Num; cycleMinutes: Num; ratePerHour: Num };
export type CostLineInput = {
  quantity: Num;
  batchSize?: Num;
  materialCostPerUnit?: Num;
  materialWastagePct?: Num;
  programmingCost?: Num;
  setupCostPerBatch?: Num;
  labourCost?: Num;
  toolingCost?: Num;
  consumablesCost?: Num;
  subcontractCost?: Num;
  finishingCost?: Num;
  inspectionCost?: Num;
  certificationCost?: Num;
  packagingCost?: Num;
  deliveryCost?: Num;
  otherCost?: Num;
  marginPct?: Num;
  priceOverridePerUnit?: Num;
  operations?: CostOp[];
};

export type CostBreakdown = {
  batches: number;
  materialCost: string;
  machiningCost: string;
  setupCost: string;
  oneOffCost: string;
  totalCost: string;
  unitCost: string;
  marginPct: string;
  calculatedUnitPrice: string;
  unitPrice: string;
  lineTotal: string;
  achievedMarginPct: string;
  overridden: boolean;
};

export function costLine(input: CostLineInput, defaultMarginPct: Num = 25): CostBreakdown {
  const q = d(input.quantity);
  if (q.lessThanOrEqualTo(0)) throw new Error("Quantity must be greater than zero.");
  const bs = input.batchSize && d(input.batchSize).greaterThan(0) ? d(input.batchSize) : q;
  const batches = q.dividedBy(bs).ceil().toNumber();

  const material = d(input.materialCostPerUnit).times(d(1).plus(d(input.materialWastagePct).dividedBy(100))).times(q);
  const machining = sum(
    (input.operations ?? []).map((op) => {
      const r = d(op.ratePerHour);
      const setup = d(op.setupMinutes).dividedBy(60).times(r).times(batches);
      const cycle = d(op.cycleMinutes).dividedBy(60).times(r).times(q);
      return setup.plus(cycle);
    }),
  );
  const setup = d(input.setupCostPerBatch).times(batches);
  const oneOff = sum([
    input.programmingCost,
    input.labourCost,
    input.toolingCost,
    input.consumablesCost,
    input.subcontractCost,
    input.finishingCost,
    input.inspectionCost,
    input.certificationCost,
    input.packagingCost,
    input.deliveryCost,
    input.otherCost,
  ]);
  const total = material.plus(machining).plus(setup).plus(oneOff);
  const margin = input.marginPct !== null && input.marginPct !== undefined && input.marginPct !== "" ? d(input.marginPct) : d(defaultMarginPct);
  if (margin.greaterThanOrEqualTo(100) || margin.lessThan(-100)) throw new Error("Margin must be below 100%.");
  const price = total.dividedBy(d(1).minus(margin.dividedBy(100)));
  const calcUnit = price.dividedBy(q).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const overridden = input.priceOverridePerUnit !== null && input.priceOverridePerUnit !== undefined && input.priceOverridePerUnit !== "";
  const unit = overridden ? d(input.priceOverridePerUnit).toDecimalPlaces(4) : calcUnit;
  const lineTotal = unit.times(q).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const achieved = lineTotal.isZero() ? d(0) : lineTotal.minus(total).dividedBy(lineTotal).times(100);

  return {
    batches,
    materialCost: money2(material),
    machiningCost: money2(machining),
    setupCost: money2(setup),
    oneOffCost: money2(oneOff),
    totalCost: money2(total),
    unitCost: rate4(total.dividedBy(q)),
    marginPct: margin.toString(),
    calculatedUnitPrice: money2(calcUnit),
    unitPrice: rate4(unit),
    lineTotal: money2(lineTotal),
    achievedMarginPct: achieved.toDecimalPlaces(1).toString(),
    overridden,
  };
}

export type TaxTreatment = "standard" | "zero" | "exempt" | "reverse_charge";

export function quoteTotals(lineTotals: Num[], lineCosts: Num[], taxTreatment: TaxTreatment, taxRatePct: Num) {
  const subtotal = sum(lineTotals).toDecimalPlaces(2);
  const tax = taxTreatment === "standard" ? subtotal.times(d(taxRatePct)).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : d(0);
  return {
    subtotal: money2(subtotal),
    taxAmount: money2(tax),
    total: money2(subtotal.plus(tax)),
    totalCost: money2(sum(lineCosts)),
  };
}
