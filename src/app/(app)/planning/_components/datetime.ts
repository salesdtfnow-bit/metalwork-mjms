import { COMPANY_TZ } from "@/lib/format";

/**
 * Formats an instant as a `datetime-local` value (YYYY-MM-DDTHH:mm) in the company timezone,
 * so form defaults match what the server will interpret (see `parse.ts`). Client-safe.
 */
export function toLocalInput(v: Date | string | null | undefined, tz = COMPANY_TZ): string {
  if (!v) return "";
  const dt = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(dt.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(dt);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
}
