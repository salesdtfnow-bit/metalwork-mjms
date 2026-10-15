import { apiHandler } from "@/server/api";
import { releaseProgramRevision } from "@/server/services/programs";

/** POST /api/v1/programs/revisions/:id/release { password, comment } — signed release. */
export const POST = apiHandler<{ id: string }>(async (ctx, req, { id }) => {
  const body = (await req.json().catch(() => ({}))) as { password?: string; comment?: string };
  return releaseProgramRevision(ctx, id, { password: body.password ?? "", comment: body.comment ?? null });
});
