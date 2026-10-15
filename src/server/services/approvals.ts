import { and, desc, eq } from "drizzle-orm";
import { approvals } from "../db/schema";
import { verifyReauth } from "../auth/session";
import type { Ctx } from "../context";
import { invalid } from "../errors";

export type SignInput = {
  kind: string;
  entityType: string;
  entityId: string;
  decision: "approved" | "rejected";
  /** The statement the signer is agreeing to (stored verbatim with the record). */
  meaning: string;
  comment?: string | null;
  /** The signer's password (re-authentication). */
  password: string | null | undefined;
};

/**
 * Records an electronic approval: the signer re-enters their password, and the record stores
 * who, when, what decision and the meaning of the signature. Approval rows are append-only.
 * NOTE: this is an authenticated, audited approval record — not a qualified electronic
 * signature under eIDAS or similar; see docs/ISO9001_EVIDENCE_MAP.md.
 */
export async function signApproval(ctx: Ctx, input: SignInput) {
  if (!input.meaning) throw invalid("Approval meaning is required.");
  await verifyReauth(ctx.db, ctx.actor.userId, input.password);
  const [row] = await ctx.db
    .insert(approvals)
    .values({
      kind: input.kind,
      entityType: input.entityType,
      entityId: input.entityId,
      decision: input.decision,
      meaning: input.meaning,
      userId: ctx.actor.userId,
      userName: ctx.actor.name,
      reauthenticated: true,
      comment: input.comment ?? null,
    })
    .returning();
  return row;
}

export async function approvalsFor(ctx: Ctx, entityType: string, entityId: string) {
  return ctx.db
    .select()
    .from(approvals)
    .where(and(eq(approvals.entityType, entityType), eq(approvals.entityId, entityId)))
    .orderBy(desc(approvals.decidedAt));
}
