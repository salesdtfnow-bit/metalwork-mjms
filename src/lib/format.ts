import { d, type Num } from "./decimal";

/** Company timezone (configurable via NEXT_PUBLIC_COMPANY_TZ; company settings mirror it). */
export const COMPANY_TZ = process.env.NEXT_PUBLIC_COMPANY_TZ ?? "Europe/London";
export const LOCALE = "en-GB";

type DateLike = Date | string | null | undefined;

function toDate(v: DateLike): Date | null {
  if (!v) return null;
  const dt = v instanceof Date ? v : new Date(v.length === 10 ? `${v}T00:00:00Z` : v);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** 15 Oct 2026 */
export function fmtDate(v: DateLike, tz = COMPANY_TZ): string {
  const dt = toDate(v);
  if (!dt) return "—";
  // Plain dates (YYYY-MM-DD) are calendar dates — format them in UTC so they don't shift.
  const zone = typeof v === "string" && v.length === 10 ? "UTC" : tz;
  return new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "short", year: "numeric", timeZone: zone }).format(dt);
}

/** 15 Oct 2026, 14:05 */
export function fmtDateTime(v: DateLike, tz = COMPANY_TZ): string {
  const dt = toDate(v);
  if (!dt) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).format(dt);
}

export function fmtTime(v: DateLike, tz = COMPANY_TZ): string {
  const dt = toDate(v);
  if (!dt) return "—";
  return new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(dt);
}

export function fmtMoney(v: Num, currency = "GBP"): string {
  if (v === null || v === undefined || v === "") return "—";
  return new Intl.NumberFormat(LOCALE, { style: "currency", currency, minimumFractionDigits: 2 }).format(d(v).toNumber());
}

/** Quantities: up to 4 decimals, thousands separators, optional unit. */
export function fmtQty(v: Num, unit?: string | null): string {
  if (v === null || v === undefined || v === "") return "—";
  const s = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 4 }).format(d(v).toNumber());
  return unit ? `${s} ${unit}` : s;
}

export function fmtMinutes(v: Num): string {
  const m = d(v).toNumber();
  if (!m) return "0 min";
  if (m < 60) return `${Math.round(m * 10) / 10} min`;
  const h = Math.floor(m / 60);
  const r = Math.round(m - h * 60);
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function fmtPct(v: Num, dp = 1): string {
  if (v === null || v === undefined || v === "") return "—";
  return `${d(v).toDecimalPlaces(dp).toString()}%`;
}

/** Today's date (YYYY-MM-DD) in the company timezone. */
export function todayISO(tz = COMPANY_TZ, at = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  return parts; // en-CA yields YYYY-MM-DD
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function addDaysISO(dateIso: string, days: number): string {
  const t = Date.parse(`${dateIso}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Converts a wall-clock date + time in `tz` (e.g. from an <input type="datetime-local">) to a UTC instant.
 * Handles DST by correcting against the zone's actual offset at that moment.
 */
export function zonedToUtc(dateIso: string, hhmm: string, tz = COMPANY_TZ): Date {
  const guess = new Date(`${dateIso}T${hhmm.length === 5 ? `${hhmm}:00` : hhmm}Z`);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asLocal = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return new Date(guess.getTime() - (asLocal - guess.getTime()));
}

/** Parses a datetime-local string ("YYYY-MM-DDTHH:mm") as company-timezone wall-clock time. */
export function parseLocalDateTime(v: string, tz = COMPANY_TZ): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)$/.exec(v.trim());
  if (!m) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return zonedToUtc(m[1], m[2], tz);
}
