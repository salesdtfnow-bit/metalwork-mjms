import { headers } from "next/headers";

/**
 * Public origin for links sent to customers. APP_BASE_URL wins (set it in production); otherwise the
 * request's host, which on Vercel only ever carries one of this project's own domains.
 */
export async function requestBaseUrl(): Promise<string> {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/** Client IP and browser for evidence records (first X-Forwarded-For hop as set by the platform). */
export async function requestClient(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return { ip, userAgent: h.get("user-agent") };
}
