import { sql } from "drizzle-orm";
import { queryRows, type DB } from "./db/client";

/** Human-readable reference prefixes. */
export const REF = {
  enquiry: "ENQ",
  quotation: "QUO",
  customerOrder: "SO",
  job: "JOB",
  purchaseRequisition: "PR",
  purchaseOrder: "PO",
  receipt: "GRN",
  lot: "LOT",
  materialTx: "MTX",
  inspection: "INS",
  ncr: "NCR",
  capa: "CA",
  maintenance: "MWO",
  subcontract: "SCO",
  dispatch: "DN",
  gateException: "GEX",
  document: "DOC",
  program: "PRG",
} as const;

/**
 * Atomically allocates the next number for `PREFIX-YY`. Runs inside the caller's
 * transaction, so a rolled-back business transaction does not consume the number.
 */
export async function nextRef(db: DB, prefix: string, opts: { year?: number; pad?: number; yearly?: boolean } = {}): Promise<string> {
  const yearly = opts.yearly ?? true;
  const yy = String((opts.year ?? new Date().getUTCFullYear()) % 100).padStart(2, "0");
  const key = yearly ? `${prefix}-${yy}` : prefix;
  const rows = await queryRows<{ value: number }>(
    db,
    sql`insert into counters (key, value) values (${key}, 1)
        on conflict (key) do update set value = counters.value + 1
        returning value`,
  );
  const n = Number(rows[0].value);
  return `${key}-${String(n).padStart(opts.pad ?? 4, "0")}`;
}
