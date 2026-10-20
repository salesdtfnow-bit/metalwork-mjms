"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/server/action";
import { f } from "@/server/forms";
import { invalid } from "@/server/errors";
import { linkExtractionToOrder, readPurchaseOrder } from "@/server/services/po-import";
import { cancelCustomerOrder, convertOrderToJob, linkQuotationToOrder, registerAndCreateJob, registerCustomerOrder, verifyCustomerOrder } from "@/server/services/orders";

const TRACE = ["job", "batch", "piece"] as const;

export const registerOrderAction = action(
  "order.register",
  z.object({
    customerId: f.uuid("Select a customer."),
    customerPoNumber: f.str("Customer PO number is required."),
    poDate: f.optDate(),
    quotationRevisionId: f.optUuid(),
    deliveryAddressId: f.optUuid(),
    requiredDate: f.optDate(),
    orderValue: f.optDec(),
    commercialTerms: f.optStr(),
    notes: f.optStr(),
    poFile: f.file(),
    poFileId: f.optUuid(),
    createJob: f.bool(),
    jobTitle: f.optStr(),
    priority: f.optInt(),
    discrepancies: f.optStr(),
    password: f.optStr(),
    aiExtractionId: f.optUuid(),
  }),
  async (ctx, { poFile, poFileId, createJob, jobTitle, priority, discrepancies, password, aiExtractionId, ...i }, fd) => {
    const lines = readLines(fd);
    if (i.quotationRevisionId) lines.length = 0;
    else if (!lines.length) throw invalid("Enter at least one ordered line, or choose the quotation.");
    const order = { ...i, lines };
    const file = poFile ?? null;
    if (createJob) {
      if (!password) throw invalid("Enter your password to sign the contract review.", { field: "password" });
      if (!jobTitle) throw invalid("Give the job a title.", { field: "jobTitle" });
      const { job, order: created } = await registerAndCreateJob(ctx, order, file, { password, discrepancies }, { title: jobTitle, priority: priority ?? 3 }, poFileId);
      if (aiExtractionId) await linkExtractionToOrder(ctx, aiExtractionId, created.id);
      redirect(`/jobs/${job.id}`);
    }
    const o = await registerCustomerOrder(ctx, order, file, poFileId);
    if (aiExtractionId) await linkExtractionToOrder(ctx, aiExtractionId, o.id);
    redirect(`/orders/${o.id}`);
  },
  { revalidate: ["/orders", "/jobs"] },
);

/** Ordered lines typed into the PO form (rows left completely empty are ignored). */
function readLines(fd: FormData) {
  const col = (k: string) => fd.getAll(k).map((v) => String(v).trim());
  const parts = col("line_part");
  const descs = col("line_desc");
  const revs = col("line_rev");
  const mats = col("line_mat");
  const qtys = col("line_qty").map((v) => v.replace(/,/g, ""));
  const prices = col("line_price").map((v) => v.replace(/[,£$€\s]/g, ""));
  const out = [];
  for (let n = 0; n < parts.length; n++) {
    if (![parts[n], descs[n], revs[n], mats[n], qtys[n], prices[n]].some(Boolean)) continue;
    const row = out.length + 1;
    if (!parts[n]) throw invalid(`Line ${row}: enter the part number.`);
    if (!/^\d+(\.\d+)?$/.test(qtys[n] ?? "") || Number(qtys[n]) <= 0) throw invalid(`Line ${row}: enter a quantity greater than zero.`);
    if (prices[n] && !/^\d+(\.\d+)?$/.test(prices[n])) throw invalid(`Line ${row}: the unit price must be a number.`);
    out.push({ partNumber: parts[n], description: descs[n] || parts[n], drawingRevision: revs[n] || null, materialSpec: mats[n] || null, quantity: qtys[n], unitPrice: prices[n] || null });
  }
  return out;
}

export const readPoAction = action(
  "order.read_pdf",
  z.object({ poFile: f.file() }),
  async (ctx, { poFile }) => {
    if (!poFile) throw invalid("Choose the customer's PO file.", { field: "poFile" });
    const r = await readPurchaseOrder(ctx, poFile);
    redirect(`/orders/new?draft=${r.extractionId}${r.customerId ? `&customerId=${r.customerId}` : ""}`);
  },
);

export const verifyOrderAction = action(
  "order.verify",
  z.object({ orderId: f.uuid(), discrepancies: f.optStr(), comment: f.optStr(), poFile: f.file(), password: f.str("Enter your password to sign.") }),
  async (ctx, i) => {
    await verifyCustomerOrder(ctx, i.orderId, { password: i.password, discrepancies: i.discrepancies, comment: i.comment, poFile: i.poFile ?? null });
    return "Contract review signed. The order is verified and a job can be created.";
  },
  { revalidate: (i) => [`/orders/${i.orderId}`, "/orders"] },
);

export const convertToJobAction = action(
  "order.convert",
  z.object({
    orderId: f.uuid(),
    title: f.str("Job title is required."),
    ownerId: f.optUuid(),
    priority: f.int({ min: 1, max: 4 }),
    requiredDate: f.optDate(),
    traceabilityLevel: f.enumOf(TRACE),
    lineIds: f.uuids(),
  }),
  async (ctx, i, fd) => {
    const lines = i.lineIds.map((id) => {
      const qty = String(fd.get(`qty_${id}`) ?? "").trim().replace(/,/g, "");
      const trace = String(fd.get(`trace_${id}`) ?? "");
      if (qty && !/^\d+(\.\d+)?$/.test(qty)) throw invalid("Quantities must be numbers.");
      return {
        lineId: id,
        include: fd.get(`inc_${id}`) === "on",
        quantity: qty || undefined,
        traceabilityLevel: (TRACE as readonly string[]).includes(trace) ? (trace as (typeof TRACE)[number]) : undefined,
      };
    });
    if (lines.length && !lines.some((l) => l.include)) throw invalid("Select at least one line.");
    const job = await convertOrderToJob(ctx, i.orderId, {
      title: i.title,
      ownerId: i.ownerId,
      priority: i.priority,
      requiredDate: i.requiredDate,
      traceabilityLevel: i.traceabilityLevel,
      lines,
    });
    redirect(`/jobs/${job.id}`);
  },
  { revalidate: (i) => [`/orders/${i.orderId}`, "/orders", "/jobs"] },
);

export const linkQuotationAction = action(
  "order.link_quotation",
  z.object({ orderId: f.uuid(), quotationRevisionId: f.uuid("Select a quotation revision.") }),
  async (ctx, i) => {
    await linkQuotationToOrder(ctx, i.orderId, i.quotationRevisionId);
    return "Quotation revision linked to the order.";
  },
  { revalidate: (i) => [`/orders/${i.orderId}`, "/orders"] },
);

export const cancelOrderAction = action(
  "order.cancel",
  z.object({ orderId: f.uuid(), reason: f.str("A reason is required.") }),
  async (ctx, i) => {
    await cancelCustomerOrder(ctx, i.orderId, i.reason);
    return "Order cancelled.";
  },
  { revalidate: (i) => [`/orders/${i.orderId}`, "/orders"] },
);
