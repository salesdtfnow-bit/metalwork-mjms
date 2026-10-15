import { apiHandler } from "@/server/api";
import { globalSearch, resolveCode } from "@/server/services/search";

/** GET /api/v1/search?q= — permission-filtered results plus exact-code resolution. */
export const GET = apiHandler(async (ctx, req) => {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return { exact: await resolveCode(ctx, q), hits: await globalSearch(ctx, q) };
});
