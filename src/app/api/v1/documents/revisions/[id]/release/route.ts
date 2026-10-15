import { apiHandler } from "@/server/api";
import { approveAndReleaseRevision } from "@/server/services/documents";

/** POST /api/v1/documents/revisions/:id/release { password } — signed approval and release. */
export const POST = apiHandler<{ id: string }>(async (ctx, req, { id }) => {
  const body = (await req.json().catch(() => ({}))) as { password?: string; effectiveDate?: string };
  const r = await approveAndReleaseRevision(ctx, id, { password: body.password ?? "", effectiveDate: body.effectiveDate ?? null });
  return { ok: true, impact: r.impact };
});
