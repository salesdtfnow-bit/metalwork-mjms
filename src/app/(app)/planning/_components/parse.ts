import "server-only";
import { z } from "zod";
import { COMPANY_TZ } from "@/lib/format";
import { zonedTime } from "@/server/services/machines";

/**
 * Parses a `datetime-local` value as wall-clock time in the COMPANY timezone (not the
 * server's). Full ISO strings with a zone (e.g. from the drag-and-drop board) are used as-is.
 */
export function parseCompanyDateTime(v: string): Date | null {
  const s = v.trim();
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(s);
  if (m) return zonedTime(m[1], m[2], COMPANY_TZ);
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** Zod fields for company-timezone date-times from forms. */
export const dtField = {
  req: (msg = "Enter a date and time.") =>
    z.preprocess(blank, z.string({ error: msg })).transform((v, c) => {
      const d = parseCompanyDateTime(v);
      if (!d) {
        c.addIssue({ code: "custom", message: msg });
        return z.NEVER;
      }
      return d;
    }),
  opt: () =>
    z.preprocess(blank, z.string().optional()).transform((v, c) => {
      if (!v) return null;
      const d = parseCompanyDateTime(v);
      if (!d) {
        c.addIssue({ code: "custom", message: "Enter a valid date and time." });
        return z.NEVER;
      }
      return d;
    }),
};
