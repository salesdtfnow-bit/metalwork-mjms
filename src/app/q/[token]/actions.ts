"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { toActionError, type ActionResult } from "@/server/boundary";
import { AppError } from "@/server/errors";
import { requestClient } from "@/server/http";
import { respondViaLink, type CustomerResponseInput } from "@/server/services/quote-acceptance";

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

/** Public (no sign-in): the customer's response through their secure link. The token is the only credential. */
export async function respondAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const token = str(fd, "token") ?? "";
  try {
    const file = fd.get("poFile");
    const input = {
      decision: str(fd, "decision"),
      name: str(fd, "name"),
      position: str(fd, "position"),
      email: str(fd, "email"),
      poReference: str(fd, "poReference"),
      comment: str(fd, "comment"),
      confirm: fd.get("confirm") === "on",
    } as CustomerResponseInput;
    const res = await respondViaLink(await getDb(), token, input, { ...(await requestClient()), poFile: file instanceof File && file.size > 0 ? file : null });
    revalidatePath(`/q/${token}`);
    return {
      ok: true,
      message:
        res.decision === "accept"
          ? "Thank you — your acceptance has been recorded. We will countersign it and email you the signed order acceptance."
          : res.decision === "reject"
            ? "Thank you — we have recorded that you are not going ahead."
            : "Thank you — your request has been sent. We will come back to you with a revised quotation.",
    };
  } catch (e) {
    if (!(e instanceof AppError) && !Array.isArray((e as { issues?: unknown })?.issues)) console.error("[quote-link] unexpected error", e);
    return toActionError(e);
  }
}
