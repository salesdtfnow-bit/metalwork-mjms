import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { AppError } from "@/server/errors";
import { jobTrace, resolveTraceQuery, traceHeat, traceSerialOrBatch } from "@/server/services/traceability";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/format";
import { DISPATCH_STATUS, INSPECTION_STATUS, JOB_STATUS, LOT_STATUS, OP_STATUS, REVISION_STATUS } from "@/lib/status";
import { Badge, Empty, Notice, PageHeader, Ref, Section, StatusBadge, Table, TitleBlock } from "@/components/ui";
import { Chain, Node, SubChain, SubNode } from "./_components/Chain";
import { GapsPanel, JobTrace } from "./_components/JobTrace";

export const metadata = { title: "Traceability" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TraceabilityPage({ searchParams }: { searchParams: Promise<{ q?: string; job?: string }> }) {
  const ctx = await requirePageCtx("traceability.view");
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";

  let view: React.ReactNode = null;
  if (sp.job && UUID.test(sp.job)) {
    const t = await jobTrace(ctx, sp.job).catch((e) => {
      if (e instanceof AppError && e.code === "not_found") notFound();
      throw e;
    });
    view = <JobView t={t} />;
  } else if (q) {
    const r = await resolveTraceQuery(ctx, q);
    if (r.kind === "job") view = <JobView t={await jobTrace(ctx, r.id)} />;
    else if (r.kind === "heat") view = <HeatView data={await traceHeat(ctx, r.heat)} />;
    else if (r.kind === "piece") {
      const p = await traceSerialOrBatch(ctx, r.code);
      view = p ? <PieceView p={p} /> : <NoMatch q={q} />;
    } else view = <NoMatch q={q} />;
  }

  return (
    <>
      <PageHeader title="Traceability" description="Follow any job, heat/cast number, lot, batch, serial or delivery note through the complete record chain — from enquiry to proof of delivery." />
      <form className="mb-5 flex flex-wrap items-center gap-2" role="search">
        <label htmlFor="trace-q" className="sr-only">
          Trace query
        </label>
        <input id="trace-q" name="q" defaultValue={q} autoFocus={!q} placeholder="Job number, heat/cast no., lot no., serial, batch or delivery note" className="field-input h-10 max-w-xl flex-1 text-[15px]" />
        <button className="h-10 rounded-sm border border-dykem bg-dykem px-4 text-[14px] font-medium text-white hover:bg-dykem-2">Trace</button>
      </form>
      {view ?? (
        <Empty title="Enter a reference to trace">
          <ul className="mx-auto mt-2 max-w-md list-disc pl-5 text-left">
            <li>
              <strong>Job number</strong> or <strong>delivery note</strong> — full chain for the job (backward and forward).
            </li>
            <li>
              <strong>Heat / cast number</strong> or <strong>lot number</strong> — forward trace: every job, batch, delivery and customer that used the material.
            </li>
            <li>
              <strong>Serial</strong> or <strong>batch number</strong> — backward trace from the piece to its materials, operations and inspections.
            </li>
          </ul>
        </Empty>
      )}
    </>
  );
}

function NoMatch({ q }: { q: string }) {
  return (
    <Empty title={`Nothing found for “${q}”`}>
      Check the reference and try again. Matching is exact for job numbers, heat/lot numbers, serials, batches and delivery notes (case-insensitive for jobs, heats, lots and delivery notes). For a broader search use the{" "}
      <Link href={`/search?q=${encodeURIComponent(q)}`} className="link">
        global search
      </Link>
      .
    </Empty>
  );
}

function JobView({ t }: { t: Awaited<ReturnType<typeof jobTrace>> }) {
  return (
    <>
      <TitleBlock
        kind="Job trace"
        refNo={t.job.jobNumber}
        title={t.job.title}
        status={
          <>
            <StatusBadge map={JOB_STATUS} status={t.job.status} />
            {t.gaps.length ? <Badge tone="warning">{t.gaps.length} gap(s)</Badge> : <Badge tone="success">Complete chain</Badge>}
          </>
        }
        cells={[
          { label: "Customer", value: t.customer.name },
          { label: "Customer PO", value: t.order?.customerPoNumber },
          { label: "Lines", value: t.lines.length },
          { label: "Material lots", value: t.materials.lots.length },
          { label: "Inspections", value: t.inspections.length },
          { label: "Dispatches", value: t.dispatches.length },
        ]}
      />
      <JobTrace t={t} />
    </>
  );
}

function HeatView({ data }: { data: Awaited<ReturnType<typeof traceHeat>> }) {
  const lotNo = new Map(data.lots.map((l) => [l.lot.id, l.lot.lotNo]));
  return (
    <>
      <TitleBlock
        kind="Heat / cast trace (forward)"
        refNo={data.heatNumber ?? "—"}
        title={`${data.lots.length} lot(s) · ${data.jobs.length} job(s) · ${data.customers.length} customer(s)`}
        status={data.dispatches.length ? <Badge tone="warning">Material has been delivered to customers</Badge> : <Badge tone="info">Not delivered</Badge>}
        cells={[
          { label: "Lots", value: data.lots.length },
          { label: "Jobs", value: data.jobs.length },
          { label: "Batches", value: data.batches.length },
          { label: "Dispatches", value: data.dispatches.length },
          { label: "Customers", value: data.customers.map((c) => c.code).join(", ") || "—" },
        ]}
      />
      {!data.lots.length && <Notice tone="warning">No material lots carry this heat number.</Notice>}

      <Section title="Material lots with this heat">
        <Table head={["Lot", "Status", "Supplier", "Material PO", "Receipt", "Received qty", "Certificates", "BoxHero"]} empty="No lots.">
          {data.lots.map((l) => (
            <tr key={l.lot.id}>
              <td>
                <Ref href={`/materials/lots/${l.lot.id}`} size="sm">
                  {l.lot.lotNo}
                </Ref>
              </td>
              <td>
                <StatusBadge map={LOT_STATUS} status={l.lot.status} />
              </td>
              <td>
                <Link href={`/suppliers/${l.supplier.id}`} className="link">
                  {l.supplier.name}
                </Link>
              </td>
              <td>
                <Ref href={`/purchasing/${l.po.id}`} size="sm">
                  {l.po.ref}
                </Ref>
              </td>
              <td className="plate">{l.receipt.ref}</td>
              <td>{fmtQty(l.lot.qtyReceived, l.lot.uom)}</td>
              <td>
                {l.certificates.length
                  ? l.certificates.map((c, i) => (
                      <span key={c.id}>
                        {i > 0 && ", "}
                        {c.fileId ? (
                          <a href={`/api/files/${c.fileId}`} className="link">
                            {c.certNumber ?? c.certType}
                          </a>
                        ) : (
                          c.certNumber ?? c.certType
                        )}
                      </span>
                    ))
                  : <Badge tone="warning">None</Badge>}
              </td>
              <td>{l.item ? l.item.name : "—"}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Affected jobs">
        <Table head={["Job", "Title", "Status", "Required", "Issued", "Allocated"]} empty="The material has not been allocated or issued to any job.">
          {data.jobs.map((j) => (
            <tr key={j.job.id}>
              <td>
                <Ref href={`/traceability?job=${j.job.id}`} size="sm">
                  {j.job.jobNumber}
                </Ref>
              </td>
              <td>{j.job.title}</td>
              <td>
                <StatusBadge map={JOB_STATUS} status={j.job.status} />
              </td>
              <td>{fmtDate(j.job.requiredDate)}</td>
              <td>{j.issued.length ? j.issued.map((x, i) => <div key={i}>{fmtQty(x.qty)} from {lotNo.get(x.lotId) ?? "lot"} <span className="text-steel">({x.ref})</span></div>) : "—"}</td>
              <td>{j.allocated.length ? j.allocated.map((x, i) => <div key={i}>{fmtQty(x.qty)} from {lotNo.get(x.lotId) ?? "lot"} <span className="text-steel">({x.status})</span></div>) : "—"}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Batches made from this material">
          <Table head={["Batch", "Lot", "Quantity", "Status"]} empty="No batch-level material records.">
            {data.batches.map((b) => (
              <tr key={`${b.b.id}-${b.bm.lotId}`}>
                <td>
                  <Link href={`/traceability?q=${encodeURIComponent(b.b.batchNo)}`} className="link plate">
                    {b.b.batchNo}
                  </Link>
                </td>
                <td className="plate">{lotNo.get(b.bm.lotId) ?? "—"}</td>
                <td>{fmtQty(b.bm.quantity)}</td>
                <td className="capitalize">{b.b.status}</td>
              </tr>
            ))}
          </Table>
        </Section>
        <Section title="Dispatches & customers">
          <Table head={["Delivery", "Customer", "Status", "Dispatched", "Delivered"]} empty="Nothing from these jobs has been dispatched.">
            {data.dispatches.map((x) => (
              <tr key={x.d.id}>
                <td>
                  <Ref href={`/dispatch/${x.d.id}`} size="sm">
                    {x.d.ref}
                  </Ref>
                </td>
                <td>
                  <Link href={`/customers/${x.c.id}`} className="link">
                    {x.c.name}
                  </Link>
                </td>
                <td>
                  <StatusBadge map={DISPATCH_STATUS} status={x.d.status} />
                </td>
                <td>{fmtDateTime(x.d.dispatchedAt)}</td>
                <td>{fmtDateTime(x.d.deliveredAt)}</td>
              </tr>
            ))}
          </Table>
        </Section>
      </div>
    </>
  );
}

function PieceView({ p }: { p: NonNullable<Awaited<ReturnType<typeof traceSerialOrBatch>>> }) {
  const code = p.serial?.serialNo ?? p.batch?.batchNo ?? "—";
  const j = p.job;
  return (
    <>
      <TitleBlock
        kind={p.level === "piece" ? "Piece trace (backward)" : "Batch trace (backward)"}
        refNo={code}
        title={`${p.line.partNumber} — ${p.line.description}`}
        status={
          <>
            <Badge tone="info">{p.level === "piece" ? "Serialised piece" : "Batch"}</Badge>
            {j.gaps.length ? <Badge tone="warning">{j.gaps.length} gap(s) on the job</Badge> : <Badge tone="success">No gaps on the job</Badge>}
          </>
        }
        cells={[
          { label: "Job", value: <Link href={`/traceability?job=${j.job.id}`} className="link">{j.job.jobNumber}</Link> },
          { label: "Customer", value: j.customer.name },
          { label: "Line", value: p.line.lineNo },
          { label: "Batch", value: p.batch?.batchNo },
          { label: "Material lots", value: p.materialLots.length },
          { label: "Dispatches", value: p.dispatches.length },
        ]}
      />
      <GapsPanel gaps={j.gaps} />
      <Chain>
        <Node stage={p.level === "piece" ? "Piece" : "Batch"} refNo={code} title={p.serial ? `Serial status: ${p.serial.status}` : p.batch ? `Batch qty ${fmtQty(p.batch.quantity)} · ${p.batch.status}` : undefined} />
        <Node stage="Job line" refNo={`${j.job.jobNumber} / line ${p.line.lineNo}`} href={`/jobs/${j.job.id}`} title={`${p.line.partNumber} — ${p.line.description}`} status={<StatusBadge map={JOB_STATUS} status={j.job.status} />}>
          {(() => {
            const l = j.lines.find((x) => x.line.id === p.line.id);
            return l?.drawing && l.doc ? (
              <span className="text-[13px]">
                Drawing{" "}
                <Link href={`/documents/${l.doc.id}`} className="link plate">
                  {l.doc.docNumber} rev {l.drawing.revision}
                </Link>{" "}
                <StatusBadge map={REVISION_STATUS} status={l.drawing.status} />
              </span>
            ) : (
              <span className="text-[13px] text-[#7a4d06]">No controlled drawing revision pinned.</span>
            );
          })()}
        </Node>
        <Node stage="Material" refNo={`${p.materialLots.length} lot(s)`} missing={!p.materialLots.length && "No material lots recorded for this batch or job."}>
          <SubChain>
            {p.materialLots.map((l) => (
              <SubNode key={l.lot.id} warn={!l.certificates.length && l.lot.certificateStatus !== "not_required"} label={<>Lot <Link href={`/materials/lots/${l.lot.id}`} className="link plate">{l.lot.lotNo}</Link> · heat <Link href={`/traceability?q=${encodeURIComponent(l.lot.heatNumber)}`} className="link plate">{l.lot.heatNumber}</Link></>}>
                Supplier {l.supplier.name} · PO {l.po.ref} · certificates: {l.certificates.map((c) => c.certNumber ?? c.certType).join(", ") || "none"}
              </SubNode>
            ))}
          </SubChain>
        </Node>
        <Node stage="Operations" refNo={`${p.operations.length} operation(s)`} missing={!p.operations.length && "No operations recorded."}>
          <SubChain>
            {p.operations.map((o) => (
              <SubNode key={o.op.id} label={<><span className="font-medium">Op {o.op.opNumber}</span> {o.type} · <span className="plate">{o.machine ?? "—"}</span> <StatusBadge map={OP_STATUS} status={o.op.status} /></>}>
                {o.runs.length
                  ? o.runs.map((r) => (
                      <div key={r.t.id}>
                        {fmtDateTime(r.t.startedAt)} · {r.operator.firstName} {r.operator.lastName}
                        {r.program && <> · program <span className="plate">{r.program} rev {r.progRev}</span></>}
                        {r.lot && <> · lot <span className="plate">{r.lot}</span></>}
                      </div>
                    ))
                  : "No time recorded."}
                {o.inspections.map((i) => (
                  <div key={i.i.id}>
                    Inspection{" "}
                    <Link href={`/quality/inspections/${i.i.id}`} className="link plate">
                      {i.i.ref}
                    </Link>{" "}
                    <StatusBadge map={INSPECTION_STATUS} status={i.i.status} />
                  </div>
                ))}
              </SubNode>
            ))}
          </SubChain>
        </Node>
        <Node stage="Final release" refNo={j.releases.filter((r) => r.r.jobLineId === p.line.id && r.r.status === "approved").length ? "Released" : undefined} missing={!j.releases.some((r) => r.r.jobLineId === p.line.id) && "No final release recorded for this line."}>
          {j.releases
            .filter((r) => r.r.jobLineId === p.line.id)
            .map((r) => (
              <div key={r.r.id} className="text-[13px]">
                <span className="capitalize">{r.r.status}</span> by {r.appr?.userName ?? r.by ?? "—"} on {fmtDateTime(r.r.decidedAt)} · qty {fmtQty(r.r.qtyReleased)}
              </div>
            ))}
        </Node>
        <Node stage="Dispatch" refNo={p.dispatches.length ? `${p.dispatches.length} consignment(s)` : undefined} missing={!p.dispatches.length && "Not dispatched."}>
          <SubChain>
            {p.dispatches.map((x) => (
              <SubNode key={x.id} label={<><Link href={`/dispatch/${x.id}`} className="link plate">{x.ref}</Link> <StatusBadge map={DISPATCH_STATUS} status={x.status} /></>}>
                Dispatched {fmtDateTime(x.dispatchedAt)} · delivered {fmtDateTime(x.deliveredAt)} {x.proofOfDeliveryFileId ? <a className="link" href={`/api/files/${x.proofOfDeliveryFileId}`}>proof of delivery</a> : "· no POD"}
              </SubNode>
            ))}
          </SubChain>
        </Node>
      </Chain>
      <p className="mt-4 text-[12.5px] text-steel">
        <Link href={`/traceability?job=${j.job.id}`} className="link">
          Open the full job trace
        </Link>{" "}
        · <a href={`/api/pdf/traceability/${j.job.id}`} className="link">Traceability PDF</a>
      </p>
    </>
  );
}
