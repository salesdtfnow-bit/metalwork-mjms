import "server-only";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { z } from "zod";
import { getDb } from "./db/client";
import { submissionKeys } from "./db/schema";
import { getActor } from "./auth/next";
import { isNextControlFlow, runService, toActionError, type ActionResult } from "./boundary";
import type { Ctx } from "./context";
import { formToObject } from "./forms";
import { isUniqueViolation } from "./errors";

type Handler<I> = (ctx: Ctx, input: I, fd: FormData) => Promise<ActionResult | void | string>;

/**
 * Builds a server action for `useActionState`:
 *   auth → duplicate-submission guard → zod parse → service (audited boundary) → revalidate.
 * Returning a string from the handler is shorthand for `{ ok: true, message }`.
 */
export function action<S extends z.ZodType>(
  name: string,
  schema: S,
  handler: Handler<z.output<S>>,
  opts: { revalidate?: string | string[] | ((input: z.output<S>) => string | string[]) } = {},
) {
  return async (_prev: ActionResult | null, fd: FormData): Promise<ActionResult> => {
    const actor = await getActor();
    if (!actor) return { ok: false, error: "Your session has expired. Sign in again to continue." };
    const db = await getDb();
    const ctx: Ctx = { db, actor };
    try {
      const raw = formToObject(fd);
      const key = typeof raw._key === "string" ? raw._key : undefined;
      if (key) {
        try {
          await db.insert(submissionKeys).values({ key, userId: actor.userId, action: name });
        } catch (e) {
          if (isUniqueViolation(e)) return { ok: false, error: "This form was already submitted. Refresh the page to see the result." };
          throw e;
        }
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        await releaseKey(key);
        return toActionError(parsed.error);
      }
      const res = await runService(ctx, (c) => handler(c, parsed.data, fd)).catch(async (e) => {
        if (!isNextControlFlow(e)) await releaseKey(key);
        throw e;
      });
      const paths = typeof opts.revalidate === "function" ? opts.revalidate(parsed.data) : opts.revalidate;
      for (const p of paths ? (Array.isArray(paths) ? paths : [paths]) : []) revalidatePath(p);
      // Send any queued emails / BoxHero movements right after the response (cron is the safety net).
      after(async () => {
        const { runOutboxes } = await import("./jobs/scheduled");
        await runOutboxes(db).catch((e) => console.error("[outbox]", e));
      });
      if (typeof res === "string") return { ok: true, message: res };
      return res ?? { ok: true };
    } catch (err) {
      if (isNextControlFlow(err)) throw err;
      return toActionError(err);
    }
  };

  async function releaseKey(key?: string) {
    // A failed attempt should not block a corrected resubmission with the same form.
    if (!key) return;
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    await db.delete(submissionKeys).where(eq(submissionKeys.key, key));
  }
}
