import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../db/client";
import { loadActor, validateSession } from "./session";
import type { Actor, Ctx } from "../context";
import type { Permission } from "./permissions";

const SECURE = process.env.NODE_ENV === "production";
/** `__Host-` prefix forces Secure, Path=/ and no Domain in production. */
export const SESSION_COOKIE = SECURE ? "__Host-mjms_session" : "mjms_session";

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: SECURE,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function clientIp(): Promise<string | undefined> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined;
}

/** Current actor for this request (memoised per request), or null. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const s = await validateSession(db, token);
  if (!s) return null;
  return loadActor(db, s.user.id, { sessionId: s.session.id, ip: await clientIp() });
});

export const getMustChangePassword = cache(async (): Promise<boolean> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return false;
  const s = await validateSession(await getDb(), token);
  return !!s?.user.mustChangePassword;
});

/** For pages: redirects to /login when not signed in. */
export async function requireCtx(): Promise<Ctx> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return { db: await getDb(), actor };
}

/** For pages: shows the 403 page when the permission is missing. */
export async function requirePageCtx(...anyOf: Permission[]): Promise<Ctx> {
  const ctx = await requireCtx();
  if (anyOf.length && !anyOf.some((p) => ctx.actor.permissions.has(p))) redirect("/forbidden");
  return ctx;
}
