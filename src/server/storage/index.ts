import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { DB } from "../db/client";
import { files } from "../db/schema";
import { AppError } from "../errors";

export type StoredFile = typeof files.$inferSelect;
type Backend = "local" | "blob" | "memory";

/** Never accepted: executable/script content. */
const BLOCKED_EXT = new Set([".exe", ".bat", ".cmd", ".com", ".msi", ".ps1", ".vbs", ".js", ".mjs", ".jar", ".scr", ".dll", ".sh", ".app", ".hta"]);
/** Served inline (viewable in the browser); everything else downloads as an attachment. */
export const INLINE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain"]);

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 50) * 1024 * 1024;

const memory = new Map<string, Buffer>();

export function storageBackend(): Backend {
  const v = process.env.MJMS_STORAGE;
  if (v === "memory" || v === "local" || v === "blob") return v;
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID ? "blob" : "local";
}

function localRoot() {
  return path.resolve(process.env.STORAGE_DIR ?? "./storage");
}

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".step": "application/step",
  ".stp": "application/step",
  ".dxf": "image/vnd.dxf",
  ".dwg": "image/vnd.dwg",
  ".igs": "model/iges",
  ".iges": "model/iges",
  ".stl": "model/stl",
  ".eml": "message/rfc822",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".nc": "text/x-gcode",
  ".tap": "text/x-gcode",
  ".gcode": "text/x-gcode",
  ".mpf": "text/x-gcode",
  ".h": "text/x-gcode",
  ".zip": "application/zip",
};

export function guessMime(name: string, provided?: string | null): string {
  const ext = path.extname(name).toLowerCase();
  // Text-like G-code and HTML/SVG are never trusted as their provided type for inline display.
  if (MIME_BY_EXT[ext]) return MIME_BY_EXT[ext];
  if (provided && provided !== "application/octet-stream" && !/html|svg|javascript/i.test(provided)) return provided;
  return "application/octet-stream";
}

export function safeFileName(name: string): string {
  const base = path.basename(name).replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").trim();
  return (base || "file").slice(0, 180);
}

export function validateUpload(name: string, size: number) {
  const ext = path.extname(name).toLowerCase();
  if (BLOCKED_EXT.has(ext)) throw new AppError(`Files of type ${ext} are not accepted.`, "validation", { field: "file" });
  if (size <= 0) throw new AppError("The file is empty.", "validation", { field: "file" });
  if (size > MAX_UPLOAD_BYTES) throw new AppError(`File exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB limit.`, "validation", { field: "file" });
}

/** Stores bytes and creates the immutable `files` row. Call inside the business transaction. */
export async function storeFile(
  db: DB,
  input: { bytes: Buffer; name: string; mimeType?: string | null; uploadedBy: string | null; isCustomerOriginal?: boolean },
): Promise<StoredFile> {
  const name = safeFileName(input.name);
  validateUpload(name, input.bytes.length);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const now = new Date();
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}-${name}`;
  const backend = storageBackend();
  const mimeType = guessMime(name, input.mimeType);
  let storageKey = key;
  if (backend === "memory") memory.set(key, input.bytes);
  else if (backend === "local") {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const full = path.join(localRoot(), key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, input.bytes, { flag: "wx" });
  } else {
    const { put } = await import("@vercel/blob");
    const res = await put(`mjms/${key}`, input.bytes, { access: "private", contentType: mimeType, addRandomSuffix: false });
    storageKey = res.pathname;
  }
  const [row] = await db
    .insert(files)
    .values({
      storage: backend,
      storageKey,
      originalName: name,
      mimeType,
      sizeBytes: input.bytes.length,
      sha256,
      isCustomerOriginal: input.isCustomerOriginal ?? false,
      uploadedBy: input.uploadedBy,
    })
    .returning();
  return row;
}

export async function storeUpload(db: DB, file: File, uploadedBy: string | null, opts: { isCustomerOriginal?: boolean } = {}) {
  validateUpload(file.name, file.size);
  return storeFile(db, { bytes: Buffer.from(await file.arrayBuffer()), name: file.name, mimeType: file.type, uploadedBy, isCustomerOriginal: opts.isCustomerOriginal });
}

export async function readFileBytes(f: Pick<StoredFile, "storage" | "storageKey">): Promise<Buffer> {
  if (f.storage === "memory") {
    const b = memory.get(f.storageKey);
    if (!b) throw new AppError("File content not found.", "not_found");
    return b;
  }
  if (f.storage === "local") {
    const { readFile } = await import("node:fs/promises");
    const full = path.join(localRoot(), f.storageKey);
    if (!full.startsWith(localRoot())) throw new AppError("Invalid file path.", "forbidden");
    return readFile(full);
  }
  const { get } = await import("@vercel/blob");
  const res = await get(f.storageKey, { access: "private" });
  if (!res || !res.stream) throw new AppError("File content not found.", "not_found");
  const chunks: Uint8Array[] = [];
  const reader = res.stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Re-hashes stored content and compares to the recorded checksum (integrity check). */
export async function verifyFileIntegrity(f: StoredFile): Promise<boolean> {
  if (!f.sha256) return false;
  const bytes = await readFileBytes(f);
  return createHash("sha256").update(bytes).digest("hex") === f.sha256;
}
