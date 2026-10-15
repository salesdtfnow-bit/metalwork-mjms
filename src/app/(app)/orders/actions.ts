"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/server/action";
import { f } from "@/server/forms";
import { invalid } from "@/server/errors";
import { cancelCustomerOrder, convertOrderToJob, linkQuotationToOrder, registerCustomerOrder, verifyCustomerOrder } from "@/server/services/orders";

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
  }),
  async (ctx, { poFile, ...i }) => {
    const o = await registerCustomerOrder(ctx, i, poFile ?? null);
    redirect(`/orders/${o.id}`);
  },
  { revalidate: "/orders" },
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
        quotationLineId: id,
        include: fd.get(`inc_${id}`) === "on",
        quantity: qty || undefined,
        traceabilityLevel: (TRACE as readonly string[]).includes(trace) ? (trace as (typeof TRACE)[number]) : undefined,
      };
    });
    if (lines.length && !lines.some((l) => l.include)) throw invalid("Select at least one quotation line.");
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
