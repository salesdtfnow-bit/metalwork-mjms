import { apiHandler } from "@/server/api";
import { getJob } from "@/server/services/jobs";
import { jobRoute } from "@/server/services/routing";

/** GET /api/v1/jobs/:id — job with lines and route (commercial fields redacted without permission). */
export const GET = apiHandler<{ id: string }>(async (ctx, _req, { id }) => {
  const job = await getJob(ctx, id);
  const route = await jobRoute(ctx, id);
  return { job: job.job, customer: { id: job.customer.id, code: job.customer.code, name: job.customer.name }, lines: job.lines, route: route.map((r) => ({ id: r.op.id, opNumber: r.op.opNumber, status: r.op.status, machine: r.machine?.code ?? null })) };
});
