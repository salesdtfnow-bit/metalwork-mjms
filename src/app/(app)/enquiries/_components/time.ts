import { COMPANY_TZ } from "@/lib/format";

/**
 * datetime-local inputs carry no timezone. These helpers read and write them in the company
 * timezone, so a value shows and saves the same wall-clock time whatever the server's zone.
 */

function wallClock(at: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: g("year"), m: g("month"), d: g("day"), h: g("hour") % 24, min: g("minute") };
}

/** Date → "YYYY-MM-DDTHH:mm" in the company timezone. */
export function toLocalInput(at: Date, tz = COMPANY_TZ): string {
  const w = wallClock(at, tz);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${w.y}-${p(w.m)}-${p(w.d)}T${p(w.h)}:${p(w.min)}`;
}

/** "YYYY-MM-DDTHH:mm" in the company timezone → Date. Returns null for blank or invalid input. */
export function fromLocalInput(v: string | null | undefined, tz = COMPANY_TZ): Date | null {
  const m = v?.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const w = wallClock(new Date(guess), tz);
  const offset = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min) - guess;
  return new Date(guess - offset);
}
