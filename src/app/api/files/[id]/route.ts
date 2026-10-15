import { apiHandler } from "@/server/api";
import { authorizeFileAccess, logFileAccess } from "@/server/services/files";
import { INLINE_TYPES, readFileBytes } from "@/server/storage";

/** Authorised, logged file download. Files are never served from a public path. */
export const GET = apiHandler<{ id: string }>(async (ctx, req, { id }) => {
  const { file, context } = await authorizeFileAccess(ctx, id);
  const bytes = await readFileBytes(file);
  const wantsDownload = new URL(req.url).searchParams.has("download");
  const inline = INLINE_TYPES.has(file.mimeType) && !wantsDownload;
  await logFileAccess(ctx, file.id, context, inline ? "view" : "download");
  const encoded = encodeURIComponent(file.originalName);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file.originalName.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      ...(file.sha256 ? { "X-Content-SHA256": file.sha256 } : {}),
    },
  });
});
