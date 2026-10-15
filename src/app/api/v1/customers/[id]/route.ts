import { apiHandler } from "@/server/api";
import { getCustomer } from "@/server/services/parties";

/** GET /api/v1/customers/:id — commercially sensitive fields are redacted without permission. */
export const GET = apiHandler<{ id: string }>(async (ctx, _req, { id }) => getCustomer(ctx, id));
