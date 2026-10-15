import { getDb } from "./db/client";
import { loadActor, validateSession } from "./auth/session";
import { httpStatusFor, runService, toActionError } from "./boundary";
import type { Ctx } from "./context";

const COOKIE_NAMES = ["__Host-mjms_session", "mjms_session"];

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/** Resolves the actor from the session cookie of a raw Request (no framework globals). */
export async function ctxFromRequest(req: Request): Promise<Ctx | null> {
  const token = COOKIE_NAMES.map((n) => readCookie(req, n)).find(Boolean);
  if (!token) return null;
  const db = await getDb();
  const s = await validateSession(db, token);
  if (!s) return null;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
  const actor = await loadActor(db, s.user.id, { sessionId: s.session.id, ip });
  return actor ? { db, actor } : null;
}

/**
 * Wraps a JSON route handler: authenticates, rejects cross-site mutation requests (Origin
 * check), runs the service through the audited boundary, and maps errors to HTTP codes.
 */
export function apiHandler<P = Record<string, string>>(fn: (ctx: Ctx, req: Request, params: P) => Promise<unknown>) {
  return async (req: Request, routeCtx: { params: Promise<P> }) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      const origin = req.headers.get("origin");
      const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
      if (origin && host && new URL(origin).host !== host) return Response.json({ error: "Cross-site request rejected." }, { status: 403 });
    }
    const ctx = await ctxFromRequest(req);
    if (!ctx) return Response.json({ error: "Not signed in." }, { status: 401 });
    try {
      const params = routeCtx?.params ? await routeCtx.params : ({} as P);
      const result = await runService(ctx, (c) => fn(c, req, params));
      if (result instanceof Response) return result;
      return Response.json(result ?? { ok: true });
    } catch (err) {
      const e = toActionError(err);
      return Response.json({ error: e.error, fieldErrors: e.fieldErrors, gates: e.gates }, { status: httpStatusFor(err) });
    }
  };
}

