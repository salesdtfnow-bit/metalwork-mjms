import { auditDenied } from "./audit";
import type { Ctx } from "./context";
import { AppError, userMessage } from "./errors";

/**
 * The single entry point from UI/API into services. It audits permission denials (after any
 * transaction rollback) and logs unexpected errors. Server actions and route handlers must
 * call services through this wrapper.
 */
export async function runService<T>(ctx: Ctx, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  try {
    return await fn(ctx);
  } catch (err) {
    if (err instanceof AppError && err.code === "forbidden") {
      await auditDenied(ctx, err).catch((e) => console.error("[audit] failed to record denial", e));
    } else if (!(err instanceof AppError) && !isNextControlFlow(err)) {
      console.error("[service] unexpected error", err);
    }
    throw err;
  }
}

/** redirect()/notFound() throw special errors that must propagate untouched. */
export function isNextControlFlow(err: unknown): boolean {
  const digest = (err as { digest?: unknown })?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND");
}

export type ActionResult<T = unknown> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; gates?: { gate: string; message: string }[] };

export function toActionError(err: unknown): ActionResult & { ok: false } {
  if (err instanceof AppError) {
    const field = err.details?.field as string | undefined;
    const gates = (err.details?.failures as { gate: string; message: string }[] | undefined) ?? undefined;
    return { ok: false, error: err.message, fieldErrors: field ? { [field]: err.message } : undefined, gates };
  }
  // zod errors
  const issues = (err as { issues?: { path: (string | number)[]; message: string }[] })?.issues;
  if (Array.isArray(issues)) {
    const fieldErrors: Record<string, string> = {};
    for (const i of issues) fieldErrors[String(i.path.join("."))] ??= i.message;
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors };
  }
  return { ok: false, error: userMessage(err) };
}

export function httpStatusFor(err: unknown): number {
  if (err instanceof AppError) {
    return { validation: 400, forbidden: 403, not_found: 404, conflict: 409, gate: 409, unauthenticated: 401, integration: 502 }[err.code];
  }
  if (Array.isArray((err as { issues?: unknown })?.issues)) return 400;
  return 500;
}
