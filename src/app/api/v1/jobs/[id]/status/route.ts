import { apiHandler } from "@/server/api";
import { transitionJob } from "@/server/services/jobs";
import type { JobStatus } from "@/lib/status";

/** POST /api/v1/jobs/:id/status { status, reason } — configured transitions + hard gates apply. */
export const POST = apiHandler<{ id: string }>(async (ctx, req, { id }) => {
  const body = (await req.json().catch(() => ({}))) as { status?: string; reason?: string };
  await transitionJob(ctx, id, body.status as JobStatus, body.reason ?? null);
  return { ok: true };
});
