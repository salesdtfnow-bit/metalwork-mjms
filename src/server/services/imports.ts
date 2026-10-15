import type { z } from "zod";
import { requirePermission, type Ctx } from "../context";
import { AppError, invalid, userMessage } from "../errors";
import { createCustomer, createSupplier, customerInput, supplierInput } from "./parties";
import { materialSpecInput, saveMaterialSpec } from "./materials";

/**
 * CSV import of master data (customers, suppliers, material specifications). Each row is
 * validated with the same input schema the forms use and created through the normal
 * create service (permission check, transaction, audit). Rows whose code already exists
 * are skipped, never overwritten.
 */

export type ImportRowResult = { row: number; ref: string; outcome: "created" | "skipped" | "error"; message: string };
export type ImportReport = { kind: string; total: number; created: number; skipped: number; errors: number; rows: ImportRowResult[] };

export const MAX_IMPORT_ROWS = 2000;

/** RFC 4180 parser: quoted fields, escaped quotes (""), CRLF/LF line breaks, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += ch === "\r" && src[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += ch;
    i++;
  }
  if (inQuotes) throw invalid("The CSV file has an unterminated quoted field.");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Drop completely empty lines.
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Turns CSV text into objects keyed by the expected column names (header match ignores case, spaces and underscores). */
function toRecords(text: string, columns: readonly string[], required: readonly string[]) {
  const rows = parseCsv(text);
  if (!rows.length) throw invalid("The file is empty.", { field: "file" });
  const header = rows[0].map(norm);
  const index = new Map<string, number>();
  for (const col of columns) {
    const at = header.indexOf(norm(col));
    if (at >= 0) index.set(col, at);
  }
  const missing = required.filter((c) => !index.has(c));
  if (missing.length) throw invalid(`Missing required column(s): ${missing.join(", ")}. Expected header: ${columns.join(",")}`, { field: "file" });
  const body = rows.slice(1);
  if (body.length > MAX_IMPORT_ROWS) throw invalid(`At most ${MAX_IMPORT_ROWS} rows can be imported at once (file has ${body.length}).`, { field: "file" });
  return body.map((cells) => {
    const rec: Record<string, string | undefined> = {};
    for (const [col, at] of index) {
      const v = (cells[at] ?? "").trim();
      rec[col] = v === "" ? undefined : v;
    }
    return rec;
  });
}

function zodMessage(err: z.ZodError) {
  return err.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`).join("; ");
}

async function runImport<S extends z.ZodType>(
  kind: string,
  records: Record<string, string | undefined>[],
  schema: S,
  shape: (r: Record<string, string | undefined>) => unknown,
  create: (data: z.input<S>) => Promise<unknown>,
): Promise<ImportReport> {
  const out: ImportRowResult[] = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const ref = r.code ?? "";
    const rowNo = i + 2; // header is row 1
    const raw = shape(r);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      out.push({ row: rowNo, ref, outcome: "error", message: zodMessage(parsed.error) });
      continue;
    }
    try {
      await create(raw as z.input<S>);
      out.push({ row: rowNo, ref: ref.toUpperCase(), outcome: "created", message: "Created." });
    } catch (e) {
      if (e instanceof AppError && e.code === "conflict") out.push({ row: rowNo, ref: ref.toUpperCase(), outcome: "skipped", message: `Skipped — ${e.message}` });
      else if (e instanceof AppError && e.code === "forbidden") throw e; // stop: the whole import is not permitted
      else out.push({ row: rowNo, ref, outcome: "error", message: userMessage(e) });
    }
  }
  return {
    kind,
    total: out.length,
    created: out.filter((x) => x.outcome === "created").length,
    skipped: out.filter((x) => x.outcome === "skipped").length,
    errors: out.filter((x) => x.outcome === "error").length,
    rows: out,
  };
}

export const CUSTOMER_COLUMNS = [
  "code",
  "name",
  "email",
  "phone",
  "website",
  "vatNumber",
  "accountRef",
  "paymentTerms",
  "currency",
  "creditLimit",
  "deliveryPreferences",
  "qualityRequirements",
  "requiredCertificates",
  "packagingRequirements",
  "notes",
] as const;

export async function importCustomersCsv(ctx: Ctx, text: string) {
  requirePermission(ctx, "admin.settings");
  requirePermission(ctx, "customers.manage");
  const records = toRecords(text, CUSTOMER_COLUMNS, ["code", "name"]);
  return runImport("customers", records, customerInput, (r) => ({ ...r, currency: r.currency ?? "GBP" }), (data) => createCustomer(ctx, data));
}

export const SUPPLIER_COLUMNS = ["code", "name", "email", "phone", "website", "vatNumber", "accountRef", "paymentTerms", "currency", "categories", "certifications", "notes", "boxheroPartnerId"] as const;

export async function importSuppliersCsv(ctx: Ctx, text: string) {
  requirePermission(ctx, "admin.settings");
  requirePermission(ctx, "suppliers.manage");
  const records = toRecords(text, SUPPLIER_COLUMNS, ["code", "name"]);
  return runImport(
    "suppliers",
    records,
    supplierInput,
    (r) => ({
      ...r,
      currency: r.currency ?? "GBP",
      categories: r.categories
        ? r.categories
            .split(/[;|]/)
            .map((c) => c.trim().toLowerCase())
            .filter(Boolean)
        : [],
    }),
    (data) => createSupplier(ctx, data),
  );
}

export const MATERIAL_SPEC_COLUMNS = ["code", "grade", "standard", "materialFamily", "form", "description", "certRequirement", "uom"] as const;

export async function importMaterialSpecsCsv(ctx: Ctx, text: string) {
  requirePermission(ctx, "admin.settings");
  requirePermission(ctx, "materials.manage_specs");
  const records = toRecords(text, MATERIAL_SPEC_COLUMNS, ["code", "grade", "form"]);
  return runImport(
    "material specifications",
    records,
    materialSpecInput,
    (r) => ({ ...r, form: r.form?.toLowerCase(), certRequirement: r.certRequirement ?? undefined, uom: r.uom ?? undefined }),
    (data) => saveMaterialSpec(ctx, data),
  );
}
