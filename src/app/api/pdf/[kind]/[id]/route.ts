import { eq } from "drizzle-orm";
import { apiHandler } from "@/server/api";
import { requireAnyPermission } from "@/server/context";
import { invalid } from "@/server/errors";
import { jobs, dispatches, quotationRevisions } from "@/server/db/schema";
import { renderDeliveryNotePdf, renderTraceabilityPdf, renderTravellerPdf } from "@/server/pdf/documents";
import { renderQuotationPdf } from "@/server/pdf/quotation";

/**
 * On-demand PDFs. Issued documents (sent quotations, CoCs, delivery notes) are also stored as
 * immutable files at the moment of issue — those stored copies are the formal record.
 */
export const GET = apiHandler<{ kind: string; id: string }>(async (ctx, req, { kind, id }) => {
  let bytes: Buffer;
  let name: string;
  const base = process.env.APP_BASE_URL ?? new URL(req.url).origin;
  switch (kind) {
    case "traveller": {
      requireAnyPermission(ctx, "jobs.view", "production.view_all");
      const [j] = await ctx.db.select().from(jobs).where(eq(jobs.id, id));
      bytes = await renderTravellerPdf(ctx, id, base);
      name = `${j?.jobNumber ?? "job"}-traveller.pdf`;
      break;
    }
    case "traceability": {
      requireAnyPermission(ctx, "traceability.view");
      const [j] = await ctx.db.select().from(jobs).where(eq(jobs.id, id));
      bytes = await renderTraceabilityPdf(ctx, id);
      name = `${j?.jobNumber ?? "job"}-traceability.pdf`;
      break;
    }
    case "packing-list":
    case "delivery-note": {
      requireAnyPermission(ctx, "dispatch.view");
      const [dsp] = await ctx.db.select().from(dispatches).where(eq(dispatches.id, id));
      bytes = await renderDeliveryNotePdf(ctx, id, kind === "packing-list");
      name = `${dsp?.ref ?? "dispatch"}-${kind}.pdf`;
      break;
    }
    case "quotation-preview": {
      requireAnyPermission(ctx, "quotations.view");
      const [r] = await ctx.db.select().from(quotationRevisions).where(eq(quotationRevisions.id, id));
      if (!r) throw invalid("Unknown revision");
      bytes = await renderQuotationPdf(ctx, id);
      name = `quotation-preview-rev${r.revisionNo}.pdf`;
      break;
    }
    default:
      throw invalid("Unknown document type.");
  }
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
});
