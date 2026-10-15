import { apiHandler } from "@/server/api";
import { releaseLot } from "@/server/services/materials";

/** POST /api/v1/lots/:id/release { password } — signed release of quarantined/inspected material. */
export const POST = apiHandler<{ id: string }>(async (ctx, req, { id }) => {
  const body = (await req.json().catch(() => ({}))) as { password?: string; comment?: string };
  await releaseLot(ctx, id, { password: body.password ?? "", comment: body.comment ?? null });
  return { ok: true };
});
