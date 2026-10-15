"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { consumePasswordReset, createPasswordReset, login, revokeSession, setPassword, validateSession } from "@/server/auth/session";
import { clearSessionCookie, clientIp, SESSION_COOKIE, setSessionCookie } from "@/server/auth/next";
import { verifyPassword } from "@/server/auth/password";
import type { ActionResult } from "@/server/boundary";
import { AppError } from "@/server/errors";
import { queueEmail } from "@/server/integrations/email/outbox";
import { auditSecurity } from "@/server/audit";

/** Only same-site relative paths are allowed as post-login destinations. */
function safeNext(v: FormDataEntryValue | null): string {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : "/";
}

export async function loginAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const email = String(fd.get("email") ?? "");
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { ok: false, error: "Enter your email and password." };
  const db = await getDb();
  const h = await headers();
  const res = await login(db, email, password, { ip: await clientIp(), userAgent: h.get("user-agent") });
  if (!res.ok) return { ok: false, error: res.error };
  await setSessionCookie(res.token, res.expiresAt);
  redirect(res.mustChangePassword ? "/change-password" : safeNext(fd.get("next")));
}

export async function logoutAction() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    const s = await validateSession(db, token);
    await revokeSession(db, token);
    if (s) await auditSecurity(db, { action: "auth.logout", entityType: "user", entityId: s.user.id, userId: s.user.id, userName: s.user.name });
  }
  await clearSessionCookie();
  redirect("/login");
}

export async function requestResetAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const email = String(fd.get("email") ?? "");
  const db = await getDb();
  const r = await createPasswordReset(db, email);
  if (r) {
    const base = process.env.APP_BASE_URL ?? `${(await headers()).get("x-forwarded-proto") ?? "http"}://${(await headers()).get("host")}`;
    const link = `${base}/reset-password?token=${encodeURIComponent(r.token)}`;
    await queueEmail(db, {
      idempotencyKey: `pwreset:${r.userId}:${r.token.slice(0, 12)}`,
      to: [r.email],
      subject: "Reset your MJMS password",
      html: `<p>Hello ${r.name},</p><p>Use this link within one hour to choose a new password:</p><p><a href="${link}">${link}</a></p><p>If you did not ask for this, ignore this email — your password has not changed.</p>`,
      text: `Reset your MJMS password (valid for 1 hour): ${link}`,
    });
  }
  // Same response either way (no account enumeration).
  return { ok: true, message: "If that email belongs to an active account, a reset link has been sent. It expires in one hour." };
}

export async function resetPasswordAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const token = String(fd.get("token") ?? "");
  const pw = String(fd.get("password") ?? "");
  if (pw !== String(fd.get("confirm") ?? "")) return { ok: false, error: "The two passwords do not match.", fieldErrors: { confirm: "Passwords do not match." } };
  try {
    await consumePasswordReset(await getDb(), token, pw);
  } catch (e) {
    return { ok: false, error: e instanceof AppError ? e.message : "Could not reset password." };
  }
  redirect("/login?reset=1");
}

export async function changePasswordAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const db = await getDb();
  const s = await validateSession(db, token);
  if (!s) redirect("/login");
  const current = String(fd.get("current") ?? "");
  const pw = String(fd.get("password") ?? "");
  if (pw !== String(fd.get("confirm") ?? "")) return { ok: false, error: "The two passwords do not match.", fieldErrors: { confirm: "Passwords do not match." } };
  if (!(await verifyPassword(current, s.user.passwordHash))) return { ok: false, error: "Current password is incorrect.", fieldErrors: { current: "Incorrect password." } };
  try {
    await setPassword(db, s.user.id, pw, s.user.email); // revokes all sessions
  } catch (e) {
    return { ok: false, error: e instanceof AppError ? e.message : "Could not change password.", fieldErrors: { password: e instanceof AppError ? e.message : "" } };
  }
  await auditSecurity(db, { action: "auth.password_changed", entityType: "user", entityId: s.user.id, userId: s.user.id, userName: s.user.name });
  await clearSessionCookie();
  redirect("/login?changed=1");
}
