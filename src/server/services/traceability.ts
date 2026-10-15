import { asc, eq, ilike, inArray, or } from "drizzle-orm";
import {
  approvals,
  batchMaterials,
  batches,
  boxheroItems,
  cncProgramRevisions,
  cncPrograms,
  controlledDocuments,
  customerOrders,
  customers,
  dispatchLines,
  dispatchSerials,
  dispatches,
  documentRevisions,
  employees,
  enquiries,
  finalReleases,
  inspections,
  jobLines,
  jobs,
  machines,
  materialAllocations,
  materialCertificates,
  materialLotCertificates,
  materialLots,
  materialReceipts,
  materialTransactions,
  ncrs,
  operations,
  operationTypes,
  parts,
  partRevisions,
  purchaseOrderLines,
  purchaseOrders,
  quotationRevisions,
  quotations,
  serials,
  stockSyncTransactions,
  subcontractOrders,
  suppliers,
  timeEntries,
  users,
} from "../db/schema";
import { requirePermission, type Ctx } from "../context";
import { notFound } from "../errors";

/** Complete backward + forward record for one job. */
export async function jobTrace(ctx: Ctx, jobId: string) {
  requirePermission(ctx, "traceability.view");
  const [job] = await ctx.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw notFound("Job");
  const [customer] = await ctx.db.select().from(customers).where(eq(customers.id, job.customerId));
  const [order] = job.customerOrderId ? await ctx.db.select().from(customerOrders).where(eq(customerOrders.id, job.customerOrderId)) : [];
  const quote = job.quotationRevisionId
    ? (await ctx.db.select({ rev: quotationRevisions, q: quotations }).from(quotationRevisions).innerJoin(quotations, eq(quotations.id, quotationRevisions.quotationId)).where(eq(quotationRevisions.id, job.quotationRevisionId)))[0] ?? null
    : null;
  const [enquiry] = quote?.q.enquiryId ? await ctx.db.select().from(enquiries).where(eq(enquiries.id, quote.q.enquiryId)) : [];

  const lines = await ctx.db
    .select({ line: jobLines, part: parts, partRev: partRevisions, drawing: documentRevisions, doc: controlledDocuments })
    .from(jobLines)
    .innerJoin(parts, eq(parts.id, jobLines.partId))
    .leftJoin(partRevisions, eq(partRevisions.id, jobLines.partRevisionId))
    .leftJoin(documentRevisions, eq(documentRevisions.id, jobLines.drawingRevisionId))
    .leftJoin(controlledDocuments, eq(controlledDocuments.id, documentRevisions.documentId))
    .where(eq(jobLines.jobId, jobId))
    .orderBy(asc(jobLines.lineNo));

  const ops = await ctx.db
    .select({ op: operations, type: operationTypes.name, machine: machines.code, machineName: machines.name })
    .from(operations)
    .innerJoin(operationTypes, eq(operationTypes.id, operations.operationTypeId))
    .leftJoin(machines, eq(machines.id, operations.machineId))
    .where(eq(operations.jobId, jobId))
    .orderBy(asc(operations.jobLineId), asc(operations.sequence));
  const opIds = ops.map((o) => o.op.id);
  const runs = opIds.length
    ? await ctx.db
        .select({ t: timeEntries, operator: employees, machine: machines.code, progRev: cncProgramRevisions.revision, progStatus: cncProgramRevisions.status, progChecksum: cncProgramRevisions.checksum, program: cncPrograms.programNumber, lot: materialLots.lotNo, heat: materialLots.heatNumber })
        .from(timeEntries)
        .innerJoin(employees, eq(employees.id, timeEntries.employeeId))
        .leftJoin(machines, eq(machines.id, timeEntries.machineId))
        .leftJoin(cncProgramRevisions, eq(cncProgramRevisions.id, timeEntries.programRevisionId))
        .leftJoin(cncPrograms, eq(cncPrograms.id, cncProgramRevisions.programId))
        .leftJoin(materialLots, eq(materialLots.id, timeEntries.materialLotId))
        .where(inArray(timeEntries.operationId, opIds))
        .orderBy(asc(timeEntries.startedAt))
    : [];

  const materialTx = await ctx.db
    .select({ t: materialTransactions, lot: materialLots, sync: stockSyncTransactions, by: users.name })
    .from(materialTransactions)
    .innerJoin(materialLots, eq(materialLots.id, materialTransactions.lotId))
    .leftJoin(stockSyncTransactions, eq(stockSyncTransactions.id, materialTransactions.stockSyncId))
    .leftJoin(users, eq(users.id, materialTransactions.performedBy))
    .where(eq(materialTransactions.jobId, jobId))
    .orderBy(asc(materialTransactions.performedAt));
  const allocs = await ctx.db.select({ a: materialAllocations, lot: materialLots }).from(materialAllocations).innerJoin(materialLots, eq(materialLots.id, materialAllocations.lotId)).where(eq(materialAllocations.jobId, jobId));
  const lotIds = [...new Set([...materialTx.map((m) => m.lot.id), ...allocs.map((a) => a.lot.id)])];
  const lots = lotIds.length ? await lotChain(ctx, lotIds) : [];

  const insp = await ctx.db
    .select({ i: inspections, inspector: users.name })
    .from(inspections)
    .leftJoin(users, eq(users.id, inspections.inspectorId))
    .where(eq(inspections.jobId, jobId))
    .orderBy(asc(inspections.requestedAt));
  const ncrList = await ctx.db.select().from(ncrs).where(eq(ncrs.jobId, jobId)).orderBy(asc(ncrs.raisedAt));
  const releases = await ctx.db.select({ r: finalReleases, by: users.name, appr: approvals }).from(finalReleases).leftJoin(users, eq(users.id, finalReleases.decidedBy)).leftJoin(approvals, eq(approvals.id, finalReleases.approvalId)).where(eq(finalReleases.jobId, jobId));
  const dsp = await ctx.db.select().from(dispatches).where(eq(dispatches.jobId, jobId)).orderBy(asc(dispatches.createdAt));
  const dl = dsp.length ? await ctx.db.select().from(dispatchLines).where(inArray(dispatchLines.dispatchId, dsp.map((x) => x.id))) : [];
  const subcons = await ctx.db.select({ s: subcontractOrders, supplier: suppliers.name }).from(subcontractOrders).innerJoin(suppliers, eq(suppliers.id, subcontractOrders.supplierId)).where(eq(subcontractOrders.jobId, jobId));
  const jobBatches = lines.length ? await ctx.db.select().from(batches).where(inArray(batches.jobLineId, lines.map((l) => l.line.id))) : [];
  const jobSerials = lines.length ? await ctx.db.select().from(serials).where(inArray(serials.jobLineId, lines.map((l) => l.line.id))) : [];

  // Completeness: flags any missing link in the chain (used by tests and the report).
  const gaps: string[] = [];
  if (!order) gaps.push("No customer PO linked");
  if (!quote) gaps.push("No quotation revision linked");
  for (const l of lines) if (!l.drawing) gaps.push(`Line ${l.line.lineNo}: no controlled drawing revision pinned`);
  if (ops.some((o) => o.op.requiresMaterial) && !materialTx.some((m) => m.t.kind === "issue")) gaps.push("No material issue recorded");
  for (const lc of lots) if (!lc.certificates.length && lc.lot.certificateStatus !== "not_required") gaps.push(`Lot ${lc.lot.lotNo}: no certificate`);
  for (const o of ops.filter((x) => x.op.status === "complete" && x.op.requiresProgram)) if (!runs.some((r) => r.t.operationId === o.op.id && r.program)) gaps.push(`Op ${o.op.opNumber}: no program revision recorded on production runs`);

  return {
    job,
    customer,
    enquiry: enquiry ?? null,
    quote,
    order: order ?? null,
    lines,
    operations: ops.map((o) => ({ ...o, runs: runs.filter((r) => r.t.operationId === o.op.id), inspections: insp.filter((i) => i.i.operationId === o.op.id) })),
    materials: { transactions: materialTx, allocations: allocs, lots },
    inspections: insp,
    ncrs: ncrList,
    subcontract: subcons,
    releases,
    dispatches: dsp.map((x) => ({ ...x, lines: dl.filter((l) => l.dispatchId === x.id) })),
    batches: jobBatches,
    serials: jobSerials,
    gaps,
  };
}

/** For material lots: receipt → PO → supplier → certificates → BoxHero refs. */
export async function lotChain(ctx: Ctx, lotIds: string[]) {
  const rows = await ctx.db
    .select({ lot: materialLots, receipt: materialReceipts, po: purchaseOrders, pol: purchaseOrderLines, supplier: suppliers, item: boxheroItems, stockIn: stockSyncTransactions })
    .from(materialLots)
    .innerJoin(materialReceipts, eq(materialReceipts.id, materialLots.receiptId))
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, materialReceipts.purchaseOrderId))
    .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.id, materialLots.purchaseOrderLineId))
    .innerJoin(suppliers, eq(suppliers.id, materialLots.supplierId))
    .leftJoin(boxheroItems, eq(boxheroItems.id, materialLots.boxheroItemId))
    .leftJoin(stockSyncTransactions, eq(stockSyncTransactions.id, materialLots.stockInSyncId))
    .where(inArray(materialLots.id, lotIds));
  const certs = await ctx.db.select({ link: materialLotCertificates, c: materialCertificates }).from(materialLotCertificates).innerJoin(materialCertificates, eq(materialCertificates.id, materialLotCertificates.certificateId)).where(inArray(materialLotCertificates.lotId, lotIds));
  return rows.map((r) => ({ ...r, certificates: certs.filter((c) => c.link.lotId === r.lot.id).map((c) => c.c) }));
}

/**
 * FORWARD trace from a supplier heat / cast number: every lot with that heat, every job it
 * was allocated or issued to, the batches/serials made from it, and where they were dispatched.
 */
export async function traceHeat(ctx: Ctx, heatNumber: string) {
  requirePermission(ctx, "traceability.view");
  const lots = await ctx.db.select().from(materialLots).where(ilike(materialLots.heatNumber, heatNumber.trim()));
  if (!lots.length) return { heatNumber, lots: [], jobs: [], batches: [], dispatches: [], customers: [] };
  const ids = lots.map((l) => l.id);
  const chain = await lotChain(ctx, ids);
  const tx = await ctx.db.select({ t: materialTransactions, job: jobs }).from(materialTransactions).innerJoin(jobs, eq(jobs.id, materialTransactions.jobId)).where(inArray(materialTransactions.lotId, ids));
  const al = await ctx.db.select({ a: materialAllocations, job: jobs }).from(materialAllocations).innerJoin(jobs, eq(jobs.id, materialAllocations.jobId)).where(inArray(materialAllocations.lotId, ids));
  const jobMap = new Map<string, typeof jobs.$inferSelect>();
  for (const x of [...tx, ...al]) jobMap.set(x.job.id, x.job);
  const jobIds = [...jobMap.keys()];
  const bm = await ctx.db.select({ bm: batchMaterials, b: batches }).from(batchMaterials).innerJoin(batches, eq(batches.id, batchMaterials.batchId)).where(inArray(batchMaterials.lotId, ids));
  const dsp = jobIds.length ? await ctx.db.select({ d: dispatches, c: customers }).from(dispatches).innerJoin(customers, eq(customers.id, dispatches.customerId)).where(inArray(dispatches.jobId, jobIds)) : [];
  const custIds = new Set([...jobMap.values()].map((j) => j.customerId));
  const custs = custIds.size ? await ctx.db.select().from(customers).where(inArray(customers.id, [...custIds])) : [];
  return {
    heatNumber,
    lots: chain,
    jobs: [...jobMap.values()].map((j) => ({
      job: j,
      issued: tx.filter((t) => t.job.id === j.id && t.t.kind === "issue").map((t) => ({ lotId: t.t.lotId, qty: t.t.quantity, ref: t.t.ref })),
      allocated: al.filter((a) => a.job.id === j.id).map((a) => ({ lotId: a.a.lotId, qty: a.a.quantity, status: a.a.status })),
    })),
    batches: bm,
    dispatches: dsp,
    customers: custs,
  };
}

/** BACKWARD trace from a finished piece (serial) or batch number to everything that made it. */
export async function traceSerialOrBatch(ctx: Ctx, code: string) {
  requirePermission(ctx, "traceability.view");
  const c = code.trim();
  const [serial] = await ctx.db.select().from(serials).where(eq(serials.serialNo, c)).limit(1);
  const [batch] = serial?.batchId ? await ctx.db.select().from(batches).where(eq(batches.id, serial.batchId)) : await ctx.db.select().from(batches).where(eq(batches.batchNo, c)).limit(1);
  const lineId = serial?.jobLineId ?? batch?.jobLineId;
  if (!lineId) return null;
  const [line] = await ctx.db.select().from(jobLines).where(eq(jobLines.id, lineId));
  const job = await jobTrace(ctx, line.jobId);
  // Narrow material and runs to the batch where batch-level records exist.
  const batchLots = batch ? await ctx.db.select({ lotId: batchMaterials.lotId }).from(batchMaterials).where(eq(batchMaterials.batchId, batch.id)) : [];
  const dispatchedIn = serial
    ? await ctx.db.select({ d: dispatches }).from(dispatchSerials).innerJoin(dispatchLines, eq(dispatchLines.id, dispatchSerials.dispatchLineId)).innerJoin(dispatches, eq(dispatches.id, dispatchLines.dispatchId)).where(eq(dispatchSerials.serialId, serial.id))
    : batch
      ? await ctx.db.select({ d: dispatches }).from(dispatchLines).innerJoin(dispatches, eq(dispatches.id, dispatchLines.dispatchId)).where(eq(dispatchLines.batchId, batch.id))
      : [];
  return {
    serial: serial ?? null,
    batch: batch ?? null,
    line,
    level: serial ? "piece" : "batch",
    materialLots: batchLots.length ? job.materials.lots.filter((l) => batchLots.some((b) => b.lotId === l.lot.id)) : job.materials.lots,
    operations: batch ? job.operations.filter((o) => !o.op.batchId || o.op.batchId === batch.id) : job.operations.filter((o) => o.op.jobLineId === lineId),
    dispatches: dispatchedIn.map((x) => x.d),
    job,
  };
}

/** Resolves a free-text trace query: job number, heat number, lot, serial, batch. */
export async function resolveTraceQuery(ctx: Ctx, q: string) {
  requirePermission(ctx, "traceability.view");
  const s = q.trim();
  if (!s) return { kind: "none" as const };
  const [job] = await ctx.db.select({ id: jobs.id }).from(jobs).where(ilike(jobs.jobNumber, s)).limit(1);
  if (job) return { kind: "job" as const, id: job.id };
  const [lot] = await ctx.db.select({ heat: materialLots.heatNumber }).from(materialLots).where(or(ilike(materialLots.lotNo, s), ilike(materialLots.heatNumber, s))).limit(1);
  if (lot) return { kind: "heat" as const, heat: lot.heat };
  const [ser] = await ctx.db.select({ id: serials.id }).from(serials).where(eq(serials.serialNo, s)).limit(1);
  const [bat] = await ctx.db.select({ id: batches.id }).from(batches).where(eq(batches.batchNo, s)).limit(1);
  if (ser || bat) return { kind: "piece" as const, code: s };
  const [dn] = await ctx.db.select({ jobId: dispatches.jobId }).from(dispatches).where(ilike(dispatches.ref, s)).limit(1);
  if (dn) return { kind: "job" as const, id: dn.jobId };
  return { kind: "none" as const };
}

