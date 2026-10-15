import { asc, eq, inArray } from "drizzle-orm";
import type { Ctx } from "../context";
import {
  approvals,
  batches,
  controlledDocuments,
  customerOrders,
  customers,
  dispatchLines,
  dispatches,
  documentRevisions,
  finalReleases,
  jobLines,
  jobs,
  materialCertificates,
  materialLotCertificates,
  materialLots,
  materialTransactions,
  operationTypes,
  operations,
  machines,
  cncProgramRevisions,
  cncPrograms,
  users,
} from "../db/schema";
import { getSettings } from "../services/settings";
import { fmtDate, fmtDateTime, fmtQty, fmtMinutes } from "@/lib/format";
import { companyFromSettings, Doc, qrPng } from "./layout";

async function common(ctx: Ctx) {
  const s = await getSettings(ctx.db);
  return { company: companyFromSettings(s), demo: s.isDemo, settings: s };
}

/** Certificate of Conformity for an approved final release. */
export async function renderCocPdf(ctx: Ctx, releaseId: string) {
  const { company, demo } = await common(ctx);
  const [rel] = await ctx.db.select().from(finalReleases).where(eq(finalReleases.id, releaseId));
  const [line] = await ctx.db.select().from(jobLines).where(eq(jobLines.id, rel.jobLineId));
  const [job] = await ctx.db.select().from(jobs).where(eq(jobs.id, rel.jobId));
  const [cust] = await ctx.db.select().from(customers).where(eq(customers.id, job.customerId));
  const [order] = job.customerOrderId ? await ctx.db.select().from(customerOrders).where(eq(customerOrders.id, job.customerOrderId)) : [];
  const [drw] = line.drawingRevisionId ? await ctx.db.select({ r: documentRevisions, d: controlledDocuments }).from(documentRevisions).innerJoin(controlledDocuments, eq(controlledDocuments.id, documentRevisions.documentId)).where(eq(documentRevisions.id, line.drawingRevisionId)) : [];
  const [appr] = rel.approvalId ? await ctx.db.select().from(approvals).where(eq(approvals.id, rel.approvalId)) : [];
  const issued = await ctx.db.select({ lot: materialLots }).from(materialTransactions).innerJoin(materialLots, eq(materialLots.id, materialTransactions.lotId)).where(eq(materialTransactions.jobId, job.id));
  const lotIds = [...new Set(issued.map((i) => i.lot.id))];
  const certs = lotIds.length ? await ctx.db.select({ link: materialLotCertificates, c: materialCertificates }).from(materialLotCertificates).innerJoin(materialCertificates, eq(materialCertificates.id, materialLotCertificates.certificateId)).where(inArray(materialLotCertificates.lotId, lotIds)) : [];
  const doc = await Doc.create({
    title: "Certificate of Conformity",
    refNo: `CoC ${job.jobNumber}-${line.lineNo}`,
    company,
    demo,
    meta: [
      ["Date", fmtDate(rel.decidedAt ?? new Date())],
      ["Customer PO", order?.customerPoNumber ?? "-"],
      ["Our job", job.jobNumber],
    ],
  });
  doc.fields([
    ["Customer", cust.name],
    ["Part number", line.partNumber],
    ["Description", line.description],
    ["Drawing / revision", drw ? `${drw.d.docNumber} rev ${drw.r.revision}` : "-"],
    ["Quantity certified", fmtQty(rel.qtyReleased)],
    ["Material specification", line.materialSpec ?? "-"],
  ]);
  doc.heading("Material traceability");
  doc.table(
    ["Lot", "Heat / cast", "Certificate", "Type"],
    lotIds.map((id) => {
      const l = issued.find((i) => i.lot.id === id)!.lot;
      const c = certs.filter((x) => x.link.lotId === id).map((x) => x.c);
      return [l.lotNo, l.heatNumber, c.map((x) => x.certNumber ?? "-").join(", ") || "-", c.map((x) => x.certType).join(", ") || "-"];
    }),
    [0.2, 0.25, 0.35, 0.2],
  );
  doc.heading("Declaration");
  doc.text(
    `We certify that the parts listed above have been manufactured, inspected and tested in accordance with the requirements of the purchase order, the referenced drawing and specification, and conform in all respects to those requirements. Records supporting this certificate are retained and available on request.`,
  );
  doc.gap(12);
  doc.signatureBox("Authorised signatory (electronically approved)", appr?.userName ?? "-", appr ? `${fmtDateTime(appr.decidedAt)} - approval ${appr.id.slice(0, 8)}` : null);
  return doc.save();
}

export async function renderDeliveryNotePdf(ctx: Ctx, dispatchId: string, packingList = false) {
  const { company, demo } = await common(ctx);
  const [d] = await ctx.db.select().from(dispatches).where(eq(dispatches.id, dispatchId));
  const [job] = await ctx.db.select().from(jobs).where(eq(jobs.id, d.jobId));
  const [cust] = await ctx.db.select().from(customers).where(eq(customers.id, d.customerId));
  const lines = await ctx.db.select({ l: dispatchLines, jl: jobLines, b: batches.batchNo }).from(dispatchLines).innerJoin(jobLines, eq(jobLines.id, dispatchLines.jobLineId)).leftJoin(batches, eq(batches.id, dispatchLines.batchId)).where(eq(dispatchLines.dispatchId, dispatchId)).orderBy(asc(jobLines.lineNo));
  const [by] = d.dispatchedBy ? await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, d.dispatchedBy)) : [];
  const doc = await Doc.create({
    title: packingList ? "Packing list" : "Delivery note",
    refNo: d.ref,
    company,
    demo,
    meta: [
      ["Date", fmtDate(d.dispatchedAt ?? new Date())],
      ["Customer PO", d.customerPoNumber ?? "-"],
      ["Our job", job.jobNumber],
      ["Carrier", [d.carrier, d.trackingRef].filter(Boolean).join(" ") || d.deliveryMethod || "-"],
    ],
  });
  doc.fields([
    ["Deliver to", `${cust.name}\n${d.deliveryAddressText}`],
    ["Packaging", [d.packageCount && `${d.packageCount} package(s)`, d.grossWeightKg && `${d.grossWeightKg} kg gross`, d.packagingNotes].filter(Boolean).join("\n") || "-"],
  ]);
  doc.heading("Items");
  doc.table(
    packingList ? ["Line", "Part number / description", "Batch", "Qty", "Packed"] : ["Line", "Part number / description", "Batch", "Qty ordered", "Qty this delivery"],
    lines.map((x) => (packingList ? [x.jl.lineNo, `${x.jl.partNumber}\n${x.jl.description}`, x.b ?? "-", fmtQty(x.l.quantity), "[   ]"] : [x.jl.lineNo, `${x.jl.partNumber}\n${x.jl.description}`, x.b ?? "-", fmtQty(x.jl.quantity), fmtQty(x.l.quantity)])),
    [0.08, 0.47, 0.17, 0.14, 0.14],
    { align: ["l", "l", "l", "r", packingList ? "l" : "r"] },
  );
  if (d.certificatesIncluded) doc.fields([["Documents enclosed", d.certificatesIncluded]], 1);
  doc.gap(14);
  doc.signatureBox("Dispatched by", by?.name, d.dispatchedAt ? fmtDateTime(d.dispatchedAt) : null);
  doc.signatureBox("Received in good condition (print name, sign, date)");
  return doc.save();
}

/** Job traveller / route card with QR codes for the job and each operation. */
export async function renderTravellerPdf(ctx: Ctx, jobId: string, baseUrl: string) {
  const { company, demo } = await common(ctx);
  const [job] = await ctx.db.select().from(jobs).where(eq(jobs.id, jobId));
  const [cust] = await ctx.db.select().from(customers).where(eq(customers.id, job.customerId));
  const lines = await ctx.db.select().from(jobLines).where(eq(jobLines.jobId, jobId)).orderBy(asc(jobLines.lineNo));
  const ops = await ctx.db
    .select({ op: operations, type: operationTypes.name, machine: machines.code, prog: cncPrograms.programNumber, progRev: cncProgramRevisions.revision })
    .from(operations)
    .innerJoin(operationTypes, eq(operationTypes.id, operations.operationTypeId))
    .leftJoin(machines, eq(machines.id, operations.machineId))
    .leftJoin(cncProgramRevisions, eq(cncProgramRevisions.id, operations.programRevisionId))
    .leftJoin(cncPrograms, eq(cncPrograms.id, cncProgramRevisions.programId))
    .where(eq(operations.jobId, jobId))
    .orderBy(asc(operations.jobLineId), asc(operations.sequence));
  const doc = await Doc.create({
    title: "Job traveller",
    refNo: job.jobNumber,
    company,
    demo,
    meta: [
      ["Customer", cust.code],
      ["Required", fmtDate(job.requiredDate)],
      ["Priority", ["", "URGENT", "High", "Normal", "Low"][job.priority] ?? String(job.priority)],
      ["Printed", fmtDateTime(new Date())],
    ],
  });
  const qr = await doc.pdf.embedPng(await qrPng(`${baseUrl}/jobs/${jobId}`));
  await doc.image(qr, 70);
  doc.y += 4;
  doc.fields([
    ["Title", job.title],
    ["Customer", cust.name],
    ["Inspection requirements", job.inspectionRequirements ?? "-"],
    ["Certification", job.certificationRequirements ?? "-"],
  ]);
  for (const l of lines) {
    doc.heading(`Line ${l.lineNo}: ${l.partNumber} — ${l.description} (qty ${fmtQty(l.quantity)})`);
    const lineOps = ops.filter((o) => o.op.jobLineId === l.id && o.op.status !== "cancelled");
    doc.table(
      ["Op", "Operation / instructions", "Machine", "Program", "Est.", "Operator / date", "QC"],
      lineOps.map((o) => [
        o.op.opNumber,
        `${o.type}: ${o.op.title}${o.op.requiresFirstOff ? "\nFIRST-OFF REQUIRED" : ""}`,
        o.machine ?? "-",
        o.prog ? `${o.prog} rev ${o.progRev}` : "-",
        fmtMinutes(Number(o.op.setupMinutesEst) + Number(o.op.cycleMinutesEst) * Number(o.op.plannedQty)),
        "",
        "",
      ]),
      [0.06, 0.34, 0.1, 0.16, 0.09, 0.17, 0.08],
    );
  }
  doc.heading("Operation QR codes (scan to open on the shop floor)");
  let x = 40;
  for (const o of ops.filter((x) => x.op.status !== "cancelled").slice(0, 16)) {
    const img = await doc.pdf.embedPng(await qrPng(`${baseUrl}/shopfloor/op/${o.op.id}`));
    if (x > 480) {
      x = 40;
      doc.y -= 78;
    }
    doc.ensure(80);
    doc.page.drawImage(img, { x, y: doc.y - 60, width: 60, height: 60 });
    doc.page.drawText(`Op ${o.op.opNumber}`, { x, y: doc.y - 70, size: 7, font: doc.font });
    x += 70;
  }
  doc.y -= 80;
  doc.text("The electronic record in MJMS is the controlling record. Paper copies are uncontrolled once printed.", { size: 7.5, color: "steel" });
  return doc.save();
}

/** Traceability report built from jobTrace() output. */
export async function renderTraceabilityPdf(ctx: Ctx, jobId: string) {
  const { jobTrace } = await import("../services/traceability");
  const t = await jobTrace(ctx, jobId);
  const { company, demo } = await common(ctx);
  const doc = await Doc.create({ title: "Traceability report", refNo: t.job.jobNumber, company, demo, meta: [["Customer", t.customer.code], ["Status", t.job.status.replace(/_/g, " ")], ["Generated", fmtDateTime(new Date())]] });
  doc.heading("Commercial chain");
  doc.fields([
    ["Enquiry", t.enquiry ? `${t.enquiry.ref} received ${fmtDate(t.enquiry.receivedAt)}` : "-"],
    ["Quotation", t.quote ? `${t.quote.q.ref} rev ${t.quote.rev.revisionNo} (accepted ${fmtDate(t.quote.rev.acceptanceVerifiedAt)})` : "-"],
    ["Customer PO", t.order ? `${t.order.customerPoNumber} (${t.order.ref}, verified ${fmtDate(t.order.verifiedAt)})` : "-"],
    ["Customer", t.customer.name],
  ]);
  doc.heading("Parts and drawings");
  doc.table(["Line", "Part", "Drawing revision", "Qty", "Accepted", "Released", "Dispatched"], t.lines.map((l) => [l.line.lineNo, `${l.line.partNumber} ${l.line.description}`, l.doc ? `${l.doc.docNumber} rev ${l.drawing?.revision}` : "-", fmtQty(l.line.quantity), fmtQty(l.line.qtyAccepted), fmtQty(l.line.qtyReleased), fmtQty(l.line.qtyDispatched)]), [0.06, 0.32, 0.2, 0.1, 0.1, 0.1, 0.12]);
  doc.heading("Material");
  doc.table(["Lot", "Heat", "Supplier / PO", "Certificate", "BoxHero ref", "Issued"], t.materials.lots.map((l) => [l.lot.lotNo, l.lot.heatNumber, `${l.supplier.name} / ${l.po.ref}`, l.certificates.map((c) => `${c.certType} ${c.certNumber ?? ""} (${c.verificationResult ?? "unverified"})`).join("; ") || "-", l.stockIn?.boxheroTxId ?? (l.item ? l.item.sku ?? l.item.boxheroItemId : "-"), t.materials.transactions.filter((x) => x.lot.id === l.lot.id && x.t.kind === "issue").map((x) => `${x.t.quantity} ${x.t.ref}`).join(", ")]), [0.12, 0.13, 0.22, 0.25, 0.13, 0.15]);
  doc.heading("Operations, machines, operators, programs");
  doc.table(
    ["Op", "Operation", "Machine", "Operator(s)", "Program rev used", "Good / rej / scrap", "Signed off"],
    t.operations.map((o) => [
      o.op.opNumber,
      `${o.type}: ${o.op.title}${o.op.isRework ? " (REWORK)" : ""}`,
      o.machine ?? "-",
      [...new Set(o.runs.map((r) => `${r.operator.firstName} ${r.operator.lastName}`))].join(", ") || "-",
      [...new Set(o.runs.filter((r) => r.program).map((r) => `${r.program} rev ${r.progRev}`))].join(", ") || "-",
      `${fmtQty(o.op.qtyGood)} / ${fmtQty(o.op.qtyRejected)} / ${fmtQty(o.op.qtyScrapped)}`,
      o.op.signedOffAt ? fmtDate(o.op.signedOffAt) : "-",
    ]),
    [0.06, 0.25, 0.09, 0.17, 0.16, 0.15, 0.12],
  );
  doc.heading("Inspections");
  doc.table(["Ref", "Stage", "Result", "Inspector", "Completed"], t.inspections.map((i) => [i.i.ref, i.i.stage.replace("_", " "), i.i.status, i.inspector ?? "-", fmtDateTime(i.i.completedAt)]), [0.18, 0.2, 0.15, 0.25, 0.22]);
  if (t.ncrs.length) {
    doc.heading("Non-conformances");
    doc.table(["Ref", "Category", "Disposition", "Status", "Qty"], t.ncrs.map((n) => [n.ref, n.category, n.disposition ?? "-", n.status, fmtQty(n.qtyAffected)]), [0.18, 0.22, 0.22, 0.22, 0.16]);
  }
  doc.heading("Release and dispatch");
  doc.table(["Release", "Qty", "Approved by", "Date"], t.releases.filter((r) => r.r.status === "approved").map((r) => [r.r.id.slice(0, 8), fmtQty(r.r.qtyReleased), r.by ?? "-", fmtDateTime(r.r.decidedAt)]), [0.25, 0.2, 0.3, 0.25]);
  doc.table(["Delivery note", "Status", "Dispatched", "Delivered"], t.dispatches.map((x) => [x.ref, x.status, fmtDateTime(x.dispatchedAt), fmtDateTime(x.deliveredAt)]), [0.3, 0.2, 0.25, 0.25]);
  if (t.gaps.length) {
    doc.heading("Traceability gaps");
    for (const g of t.gaps) doc.text(`- ${g}`);
  }
  return doc.save();
}
