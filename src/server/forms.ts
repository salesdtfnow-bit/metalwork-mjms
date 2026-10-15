import { z } from "zod";
import { parseDecimalInput } from "@/lib/decimal";

/** FormData → plain object. Repeated keys become arrays; File entries kept as File. */
export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (v instanceof File && v.size === 0 && !v.name) continue;
    if (k in out) {
      const cur = out[k];
      out[k] = Array.isArray(cur) ? [...cur, v] : [cur, v];
    } else out[k] = v;
  }
  return out;
}

const blankToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** Zod field helpers tuned for HTML forms. */
export const f = {
  str: (msg = "Required.") => z.preprocess(blankToUndef, z.string({ error: msg }).trim().min(1, msg)),
  optStr: () => z.preprocess(blankToUndef, z.string().trim().optional()).transform((v) => v ?? null),
  email: () => z.preprocess(blankToUndef, z.string().trim().toLowerCase().email("Enter a valid email address.").optional()).transform((v) => v ?? null),
  bool: () => z.preprocess((v) => v === "on" || v === "true" || v === true || v === "1", z.boolean()),
  int: (opts: { min?: number; max?: number } = {}) =>
    z.preprocess(
      blankToUndef,
      z.coerce
        .number({ error: "Enter a whole number." })
        .int("Enter a whole number.")
        .min(opts.min ?? Number.MIN_SAFE_INTEGER)
        .max(opts.max ?? Number.MAX_SAFE_INTEGER),
    ),
  optInt: () => z.preprocess(blankToUndef, z.coerce.number().int().optional()).transform((v) => v ?? null),
  /** Decimal as normalised string (never a float). */
  dec: (opts: { min?: number; allowNegative?: boolean; msg?: string } = {}) =>
    z.preprocess(blankToUndef, z.string({ error: opts.msg ?? "Required." })).transform((v, c) => {
      const n = parseDecimalInput(v, opts);
      if (n === null) {
        c.addIssue({ code: "custom", message: opts.msg ?? "Enter a valid number." });
        return z.NEVER;
      }
      return n;
    }),
  optDec: (opts: { min?: number; allowNegative?: boolean } = {}) =>
    z.preprocess(blankToUndef, z.string().optional()).transform((v, c) => {
      if (v === undefined) return null;
      const n = parseDecimalInput(v, opts);
      if (n === null) {
        c.addIssue({ code: "custom", message: "Enter a valid number." });
        return z.NEVER;
      }
      return n;
    }),
  date: (msg = "Enter a date.") => z.preprocess(blankToUndef, z.string({ error: msg }).regex(/^\d{4}-\d{2}-\d{2}$/, msg)),
  optDate: () => z.preprocess(blankToUndef, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.").optional()).transform((v) => v ?? null),
  /** datetime-local → Date */
  optDateTime: () =>
    z.preprocess(blankToUndef, z.string().optional()).transform((v, c) => {
      if (!v) return null;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        c.addIssue({ code: "custom", message: "Enter a valid date and time." });
        return z.NEVER;
      }
      return d;
    }),
  uuid: (msg = "Select an option.") => z.preprocess(blankToUndef, z.string({ error: msg }).uuid(msg)),
  optUuid: () => z.preprocess(blankToUndef, z.string().uuid().optional()).transform((v) => v ?? null),
  uuids: () => z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(z.string().uuid())),
  strs: () => z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(z.string())),
  enumOf: <T extends readonly [string, ...string[]]>(values: T, msg = "Select an option.") => z.preprocess(blankToUndef, z.enum(values, { error: msg })),
  file: () => z.instanceof(File).optional(),
  files: () =>
    z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(z.instanceof(File))).transform((a) => a.filter((x) => x.size > 0)),
};
