import { apiHandler } from "@/server/api";
import { requirePermission } from "@/server/context";
import { invalid } from "@/server/errors";
import { jobsReport, ncrReport, operatorTimeReport, supplierPerformance, toCsv } from "@/server/services/reports";
import { addDaysISO, todayISO } from "@/lib/format";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function param(u: URL, key: string, kind: "date" | "uuid" | "text" = "text") {
  const v = u.searchParams.get(key)?.trim();
  if (!v) return undefined;
  if (kind === "date" && !ISO.test(v)) throw invalid(`Invalid date for ${key}.`);
  if (kind === "uuid" && !UUID.test(v)) throw invalid(`Invalid ${key}.`);
  return v;
}

const minutes = (a: Date, b: Date | null) => (b ? Math.round(((b.getTime() - a.getTime()) / 60_000) * 10) / 10 : "");

/**
 * CSV export of the operational reports. Uses the same filters as /reports and the same
 * service functions, so permissions and commercial redaction are identical.
 */
export const GET = apiHandler<{ kind: string }>(async (ctx, req, { kind }) => {
  requirePermission(ctx, "reports.export");
  const u = new URL(req.url);
  let rows: Record<string, unknown>[];
  let header: string[];
  switch (kind) {
    case "jobs": {
      const data = await jobsReport(ctx, {
        from: param(u, "from", "date"),
        to: param(u, "to", "date"),
        customerId: param(u, "customer", "uuid"),
        status: param(u, "status"),
        machineId: param(u, "machine", "uuid"),
        employeeId: param(u, "operator", "uuid"),
      });
      header = ["jobNumber", "title", "customer", "status", "requiredDate", "quantity", "good", "rejected", "scrapped", "dispatched", "value"];
      rows = data;
      break;
    }
    case "operator-time": {
      const to = param(u, "to", "date") ?? todayISO();
      const from = param(u, "from", "date") ?? addDaysISO(to, -30);
      const data = await operatorTimeReport(ctx, { from, to, employeeId: param(u, "employee", "uuid"), machineId: param(u, "machine", "uuid") });
      header = ["startedAt", "endedAt", "minutes", "kind", "employeeNo", "employee", "job", "operation", "machine", "qtyGood", "qtyRejected", "qtyScrapped", "source", "notes"];
      rows = data.map((r) => ({
        startedAt: r.t.startedAt,
        endedAt: r.t.endedAt ?? "",
        minutes: minutes(r.t.startedAt, r.t.endedAt),
        kind: r.t.kind,
        employeeNo: r.e.employeeNo,
        employee: `${r.e.firstName} ${r.e.lastName}`,
        job: r.job,
        operation: r.op,
        machine: r.machine ?? "",
        qtyGood: r.t.qtyGood ?? "",
        qtyRejected: r.t.qtyRejected ?? "",
        qtyScrapped: r.t.qtyScrapped ?? "",
        source: r.t.source,
        notes: r.t.notes ?? "",
      }));
      break;
    }
    case "ncr": {
      const data = await ncrReport(ctx, { from: param(u, "from", "date"), to: param(u, "to", "date"), category: param(u, "category"), supplierId: param(u, "supplier", "uuid") });
      header = ["ref", "raisedAt", "source", "category", "status", "job", "supplier", "heatNumber", "qtyAffected", "description", "disposition", "rootCause", "closedAt"];
      rows = data.map((r) => ({
        ref: r.n.ref,
        raisedAt: r.n.raisedAt,
        source: r.n.source,
        category: r.n.category,
        status: r.n.status,
        job: r.job ?? "",
        supplier: r.supplier ?? "",
        heatNumber: r.n.heatNumber ?? "",
        qtyAffected: r.n.qtyAffected ?? "",
        description: r.n.description,
        disposition: r.n.disposition ?? "",
        rootCause: r.n.rootCause ?? "",
        closedAt: r.n.closedAt ?? "",
      }));
      break;
    }
    case "supplier-performance": {
      const data = await supplierPerformance(ctx);
      header = ["code", "supplier", "approvalStatus", "poLines", "linesReceived", "receivedPct", "ncrs"];
      rows = data.map((r) => ({
        code: r.supplier.code,
        supplier: r.supplier.name,
        approvalStatus: r.supplier.approvalStatus,
        poLines: r.poLines,
        linesReceived: r.received,
        receivedPct: r.poLines ? Math.round((r.received / r.poLines) * 1000) / 10 : "",
        ncrs: r.ncrs,
      }));
      break;
    }
    default:
      throw invalid("Unknown report.");
  }
  const csv = rows.length ? toCsv(rows) : header.join(",");
  const name = `mjms-${kind}-${todayISO()}.csv`;
  return new Response(`﻿${csv}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
