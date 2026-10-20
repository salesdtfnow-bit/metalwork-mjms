import { getDb } from "@/server/db/client";
import { fileAccessLog } from "@/server/db/schema";
import { requestClient } from "@/server/http";
import { linkDocument } from "@/server/services/quote-acceptance";
import { readFileBytes } from "@/server/storage";

/** Public download of the issued quotation or the signed order acceptance, authorised by the customer link. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; kind: string }> }) {
  const { token, kind } = await params;
  if (kind !== "quote" && kind !== "confirmation") return new Response("Not found", { status: 404 });
  const db = await getDb();
  const doc = await linkDocument(db, token, kind);
  if (!doc) return new Response("This link is not valid or has expired.", { status: 404, headers: { "Cache-Control": "no-store" } });
  const bytes = await readFileBytes(doc.file);
  const { ip } = await requestClient();
  await db.insert(fileAccessLog).values({ fileId: doc.file.id, userId: null, action: "view", context: `customer_link:${doc.linkId}`, ipAddress: ip });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="${doc.file.originalName.replace(/[^\x20-\x7e]|"/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...(doc.file.sha256 ? { "X-Content-SHA256": doc.file.sha256 } : {}),
    },
  });
}
