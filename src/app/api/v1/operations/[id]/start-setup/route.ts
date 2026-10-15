import { apiHandler } from "@/server/api";
import { startSetup } from "@/server/services/production";

/** POST /api/v1/operations/:id/start-setup — all production gates are evaluated server-side. */
export const POST = apiHandler<{ id: string }>(async (ctx, _req, { id }) => {
  await startSetup(ctx, id);
  return { ok: true };
});
