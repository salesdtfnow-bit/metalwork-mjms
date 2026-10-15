import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type Num = Decimal.Value | null | undefined;

/** Parses DB numeric strings / user input. Empty → 0. Throws on garbage. */
export function d(v: Num): Decimal {
  if (v === null || v === undefined || v === "") return new Decimal(0);
  if (typeof v === "string") return new Decimal(v.trim().replace(/,/g, ""));
  return new Decimal(v);
}

export const money2 = (v: Num) => d(v).toDecimalPlaces(2).toFixed(2);
export const rate4 = (v: Num) => d(v).toDecimalPlaces(4).toFixed(4);
export const qty4 = (v: Num) => d(v).toDecimalPlaces(4).toFixed(4);

export function sum(values: Num[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(d(v)), new Decimal(0));
}

export const gt = (a: Num, b: Num) => d(a).greaterThan(d(b));
export const gte = (a: Num, b: Num) => d(a).greaterThanOrEqualTo(d(b));
export const lt = (a: Num, b: Num) => d(a).lessThan(d(b));
export const isZero = (a: Num) => d(a).isZero();

/** Validates a decimal string from a form: returns normalised string or null. */
export function parseDecimalInput(v: unknown, opts: { min?: number; allowNegative?: boolean } = {}): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/,/g, "");
  if (s === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = new Decimal(s);
  if (!opts.allowNegative && n.isNegative()) return null;
  if (opts.min !== undefined && n.lessThan(opts.min)) return null;
  return n.toString();
}

/** Trims trailing zeros for display: "12.5000" → "12.5". */
export function trimQty(v: Num): string {
  return d(v).toDecimalPlaces(4).toString();
}
