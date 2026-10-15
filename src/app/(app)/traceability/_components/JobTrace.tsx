import Link from "next/link";
import type { jobTrace } from "@/server/services/traceability";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/format";
import { DISPATCH_STATUS, INSPECTION_STATUS, JOB_STATUS, LOT_STATUS, NCR_STATUS, OP_STATUS, ORDER_STATUS, QUOTE_STATUS, REVISION_STATUS, SUBCON_STATUS, SYNC_STATUS, ENQUIRY_STATUS } from "@/lib/status";
import { Badge, buttonClass, LinkButton, Notice, StatusBadge } from "@/components/ui";
import { Chain, Node, SubChain, SubNode } from "./Chain";

export type JobTraceData = Awaited<ReturnType<typeof jobTrace>>;

export function GapsPanel({ gaps }: { gaps: string[] }) {
  if (!gaps.length) {
    return (
      <Notice tone="success" title="No gaps found">
        Every link checked in the traceability chain is present (PO, quotation, drawing revisions, material issue, certificates and program revisions on production runs).
      </Notice>
    );
  }
  return (
    <Notice tone="warning" title={`${gaps.length} gap(s) in the traceability chain`}>
      <ul className="mt-1 list-disc pl-5">
        {gaps.map((g, i) => (
          <li key={i}>{g}</li>
        ))}
      </ul>
    </Notice>
  );
}

export function JobTrace({ t }: { t: JobTraceData }) {
  const { job } = t;
  const lots = t.materials.lots;
  const supplierIds = new Set<string>();
  const suppliers = lots.filter((l) => (supplierIds.has(l.supplier.id) ? false : (supplierIds.add(l.supplier.id), true))).map((l) => l.supplier);
  const issues = t.materials.transactions;
  const ncrOps = t.operations.filter((o) => o.op.isRework);
  const approvedReleases = t.releases.filter((r) => r.r.status === "approved");

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <a href={`/api/pdf/traceability/${job.id}`} className={buttonClass("primary", "sm")} target="_blank" rel="noopener">
          Traceability report (PDF)
        </a>
        <LinkButton href={`/jobs/${job.id}`} size="sm">
          Open job
        </LinkButton>
      </div>
      <GapsPanel gaps={t.gaps} />

      <Chain>
        <Node
          stage="Enquiry"
          refNo={t.enquiry?.ref}
          href={t.enquiry ? `/enquiries/${t.enquiry.id}` : null}
          title={t.enquiry?.subject}
          status={t.enquiry && <StatusBadge map={ENQUIRY_STATUS} status={t.enquiry.status} />}
          facts={t.enquiry ? [{ label: "Received", value: fmtDateTime(t.enquiry.receivedAt) }, { label: "Via", value: t.enquiry.receivedVia }, { label: "Customer reference", value: t.enquiry.customerReference }] : []}
          missing={!t.enquiry && "No enquiry linked (job may have been created from a direct order)."}
        />
        <Node
          stage="Quotation revision"
          refNo={t.quote ? `${t.quote.q.ref} rev ${t.quote.rev.revisionNo}` : undefined}
          href={t.quote ? `/quotations/${t.quote.q.id}` : null}
          title={t.quote?.q.title}
          status={t.quote && <StatusBadge map={QUOTE_STATUS} status={t.quote.rev.status} />}
          facts={
            t.quote
              ? [
                  { label: "Sent", value: fmtDateTime(t.quote.rev.sentAt) },
                  { label: "Acceptance recorded", value: fmtDateTime(t.quote.rev.acceptanceRecordedAt) },
                  { label: "Acceptance verified", value: fmtDateTime(t.quote.rev.acceptanceVerifiedAt) },
                  { label: "Acceptance reference", value: t.quote.rev.acceptanceReference },
                ]
              : []
          }
          missing={!t.quote && "No quotation revision linked."}
        />
        <Node
          stage="Customer PO"
          refNo={t.order ? t.order.customerPoNumber : undefined}
          href={t.order ? `/orders/${t.order.id}` : null}
          title={t.order ? `${t.customer.name} · ${t.order.ref}` : undefined}
          status={t.order && <StatusBadge map={ORDER_STATUS} status={t.order.status} />}
          facts={t.order ? [{ label: "PO date", value: fmtDate(t.order.poDate) }, { label: "Verified", value: fmtDateTime(t.order.verifiedAt) }, { label: "Required", value: fmtDate(t.order.requiredDate) }] : []}
          missing={!t.order && "No customer PO linked."}
        />
        <Node
          stage="Job"
          refNo={job.jobNumber}
          href={`/jobs/${job.id}`}
          title={job.title}
          status={<StatusBadge map={JOB_STATUS} status={job.status} />}
          facts={[
            { label: "Customer", value: <Link className="link" href={`/customers/${t.customer.id}`}>{t.customer.name}</Link> },
            { label: "Required", value: fmtDate(job.requiredDate) },
            { label: "Authorised", value: fmtDateTime(job.authorisedAt) },
            { label: "Completed", value: fmtDateTime(job.completedAt) },
          ]}
        />
        <Node stage="Lines / parts & drawings" refNo={`${t.lines.length} line(s)`} missing={!t.lines.length && "No job lines."}>
          <SubChain>
            {t.lines.map((l) => (
              <SubNode
                key={l.line.id}
                warn={!l.drawing}
                label={
                  <>
                    <span className="font-medium">Line {l.line.lineNo}:</span> <span className="plate">{l.line.partNumber}</span>
                    {l.partRev && <span className="text-steel"> rev {l.partRev.revision}</span>} — {l.line.description} · qty {fmtQty(l.line.quantity)} · traceability: {l.line.traceabilityLevel}
                  </>
                }
              >
                Drawing:{" "}
                {l.drawing && l.doc ? (
                  <>
                    <Link href={`/documents/${l.doc.id}`} className="link plate">
                      {l.doc.docNumber} rev {l.drawing.revision}
                    </Link>{" "}
                    <StatusBadge map={REVISION_STATUS} status={l.drawing.status} />
                    {l.line.drawingReviewRequired && (
                      <Badge tone="warning" className="ml-1">
                        Review required — newer revision released
                      </Badge>
                    )}
                  </>
                ) : (
                  <span className="text-[#7a4d06]">no controlled drawing revision pinned</span>
                )}
                {" · "}good {fmtQty(l.line.qtyGood)}, rejected {fmtQty(l.line.qtyRejected)}, scrapped {fmtQty(l.line.qtyScrapped)}, released {fmtQty(l.line.qtyReleased)}, dispatched {fmtQty(l.line.qtyDispatched)}
              </SubNode>
            ))}
          </SubChain>
        </Node>

        <Node stage="Material PO → supplier → certificate → heat" refNo={`${lots.length} lot(s)`} missing={!lots.length && "No material lots allocated or issued to this job."}>
          <SubChain>
            {lots.map((l) => (
              <SubNode
                key={l.lot.id}
                warn={!l.certificates.length && l.lot.certificateStatus !== "not_required"}
                label={
                  <>
                    Lot{" "}
                    <Link href={`/materials/lots/${l.lot.id}`} className="link plate">
                      {l.lot.lotNo}
                    </Link>{" "}
                    · heat <span className="plate">{l.lot.heatNumber}</span> <StatusBadge map={LOT_STATUS} status={l.lot.status} />
                  </>
                }
              >
                <div>
                  Material PO{" "}
                  <Link href={`/purchasing/${l.po.id}`} className="link plate">
                    {l.po.ref}
                  </Link>{" "}
                  line {l.pol.lineNo} ({l.pol.description}) · receipt <span className="plate">{l.receipt.ref}</span>
                  {l.receipt.deliveryNoteNo && <> · supplier delivery note {l.receipt.deliveryNoteNo}</>} · received {fmtDate(l.receipt.receivedAt)}
                </div>
                <div>
                  Supplier{" "}
                  <Link href={`/suppliers/${l.supplier.id}`} className="link">
                    {l.supplier.name}
                  </Link>{" "}
                  ({l.supplier.approvalStatus.replace(/_/g, " ")}) · supplier batch {l.lot.supplierBatchNo ?? "—"}
                </div>
                <div>
                  Certificates:{" "}
                  {l.certificates.length
                    ? l.certificates.map((c, i) => (
                        <span key={c.id}>
                          {i > 0 && ", "}
                          {c.fileId ? (
                            <a href={`/api/files/${c.fileId}`} className="link">
                              {c.certNumber ?? "certificate"} ({c.certType})
                            </a>
                          ) : (
                            `${c.certNumber ?? "certificate"} (${c.certType})`
                          )}{" "}
                          — {c.verificationResult ?? "not verified"}
                        </span>
                      ))
                    : <span className="text-[#7a4d06]">none ({l.lot.certificateStatus.replace(/_/g, " ")})</span>}
                </div>
                <div>
                  BoxHero: {l.item ? <>{l.item.name} {l.item.sku && <span className="plate">({l.item.sku})</span>}</> : "not linked"}
                  {l.stockIn && (
                    <>
                      {" "}
                      · stock-in <StatusBadge map={SYNC_STATUS} status={l.stockIn.status} /> {l.stockIn.boxheroTxId && <span className="plate">ref {l.stockIn.boxheroTxId}</span>}
                    </>
                  )}
                </div>
              </SubNode>
            ))}
          </SubChain>
          {suppliers.length > 0 && <p className="mt-2 text-[12px] text-steel">Material suppliers: {suppliers.map((s) => s.name).join(", ")}</p>}
        </Node>

        <Node
          stage="Material issue"
          refNo={`${issues.filter((m) => m.t.kind === "issue").length} issue(s)`}
          missing={!issues.length && !t.materials.allocations.length && "No material allocations or movements recorded."}
        >
          <SubChain>
            {t.materials.allocations.map((al) => (
              <SubNode key={al.a.id} label={<>Allocated {fmtQty(al.a.quantity, al.lot.uom)} from lot <span className="plate">{al.lot.lotNo}</span> — {al.a.status}</>}>
                {fmtDateTime(al.a.allocatedAt)}
              </SubNode>
            ))}
            {issues.map((m) => (
              <SubNode key={m.t.id} label={<><span className="capitalize">{m.t.kind}</span> {fmtQty(m.t.quantity, m.t.uom)} from lot <span className="plate">{m.lot.lotNo}</span> (heat {m.lot.heatNumber}) · <span className="plate">{m.t.ref}</span></>}>
                {fmtDateTime(m.t.performedAt)} by {m.by ?? "—"}
                {m.sync && (
                  <>
                    {" "}
                    · BoxHero <StatusBadge map={SYNC_STATUS} status={m.sync.status} /> {m.sync.boxheroTxId && <span className="plate">ref {m.sync.boxheroTxId}</span>}
                  </>
                )}
              </SubNode>
            ))}
          </SubChain>
        </Node>

        <Node stage="Operations" refNo={`${t.operations.length} operation(s)`} missing={!t.operations.length && "No route defined."}>
          <SubChain>
            {t.operations.map((o) => (
              <SubNode
                key={o.op.id}
                warn={o.op.status === "complete" && o.op.requiresProgram && !o.runs.some((r) => r.program)}
                label={
                  <>
                    <span className="font-medium">Op {o.op.opNumber}</span> {o.type}
                    {o.op.title ? ` — ${o.op.title}` : ""} · machine <span className="plate">{o.machine ?? "—"}</span> <StatusBadge map={OP_STATUS} status={o.op.status} />
                    {o.op.isRework && <Badge tone="danger" className="ml-1">Rework</Badge>}
                    {o.op.reviewRequired && <Badge tone="warning" className="ml-1">Review required</Badge>}
                  </>
                }
              >
                {o.runs.length ? (
                  <ul className="list-disc pl-5">
                    {o.runs.map((r) => (
                      <li key={r.t.id}>
                        {fmtDateTime(r.t.startedAt)} · <span className="capitalize">{r.t.kind}</span> · {r.operator.firstName} {r.operator.lastName} on <span className="plate">{r.machine ?? "—"}</span>
                        {r.program ? (
                          <>
                            {" "}
                            · program{" "}
                            <Link href={`/search?q=${encodeURIComponent(r.program)}`} className="link plate">
                              {r.program} rev {r.progRev}
                            </Link>{" "}
                            <StatusBadge map={REVISION_STATUS} status={r.progStatus} />
                          </>
                        ) : (
                          o.op.requiresProgram && <span className="text-[#7a4d06]"> · no program revision recorded</span>
                        )}
                        {r.lot && (
                          <>
                            {" "}
                            · lot <span className="plate">{r.lot}</span> (heat {r.heat})
                          </>
                        )}
                        {r.t.qtyGood !== null && <> · good {fmtQty(r.t.qtyGood)}</>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  "No time recorded."
                )}
                {o.op.signedOffAt && <div>Signed off {fmtDateTime(o.op.signedOffAt)}</div>}
              </SubNode>
            ))}
          </SubChain>
          {t.subcontract.length > 0 && (
            <SubChain>
              {t.subcontract.map((s) => (
                <SubNode key={s.s.id} label={<>Subcontract <Link href={`/subcontract/${s.s.id}`} className="link plate">{s.s.ref}</Link> — {s.s.process} at {s.supplier} <StatusBadge map={SUBCON_STATUS} status={s.s.status} /></>}>
                  Sent {fmtQty(s.s.qtySent)} · returned {fmtQty(s.s.qtyReturned)} · accepted {fmtQty(s.s.qtyAccepted)}
                </SubNode>
              ))}
            </SubChain>
          )}
        </Node>

        <Node stage="Inspections" refNo={`${t.inspections.length} inspection(s)`} missing={!t.inspections.length && "No inspections recorded."}>
          <SubChain>
            {t.inspections.map((i) => (
              <SubNode key={i.i.id} warn={i.i.status === "failed"} label={<><Link href={`/quality/inspections/${i.i.id}`} className="link plate">{i.i.ref}</Link> <span className="capitalize">{i.i.stage.replace(/_/g, " ")}</span> <StatusBadge map={INSPECTION_STATUS} status={i.i.status} /></>}>
                Inspector {i.inspector ?? "—"} · completed {fmtDateTime(i.i.completedAt)} · accepted {fmtQty(i.i.qtyAccepted)} / rejected {fmtQty(i.i.qtyRejected)}
              </SubNode>
            ))}
          </SubChain>
        </Node>

        <Node stage="NCRs & rework" refNo={`${t.ncrs.length} NCR(s)`} status={t.ncrs.length === 0 ? <Badge tone="success">None raised</Badge> : undefined}>
          {t.ncrs.length > 0 && (
            <SubChain>
              {t.ncrs.map((n) => (
                <SubNode key={n.id} warn={!["closed", "cancelled"].includes(n.status)} label={<><Link href={`/ncr/${n.id}`} className="link plate">{n.ref}</Link> {n.description} <StatusBadge map={NCR_STATUS} status={n.status} /></>}>
                  Disposition: {n.disposition ? n.disposition.replace(/_/g, " ") : "—"} · qty affected {fmtQty(n.qtyAffected)}
                  {ncrOps.filter((o) => o.op.ncrId === n.id).map((o) => (
                    <span key={o.op.id}> · rework op {o.op.opNumber} <StatusBadge map={OP_STATUS} status={o.op.status} /></span>
                  ))}
                </SubNode>
              ))}
            </SubChain>
          )}
        </Node>

        <Node
          stage="Final release"
          refNo={approvedReleases.length ? `${approvedReleases.length} release(s)` : undefined}
          missing={!t.releases.length && "No final quality release recorded yet."}
        >
          <SubChain>
            {t.releases.map((r) => (
              <SubNode key={r.r.id} warn={r.r.status !== "approved"} label={<><span className="capitalize font-medium">{r.r.status}</span> · qty {fmtQty(r.r.qtyReleased)} · approver {r.appr?.userName ?? r.by ?? "—"} · {fmtDateTime(r.r.decidedAt)}</>}>
                {r.appr?.meaning && <>“{r.appr.meaning}”</>}
                {r.r.cocFileId && (
                  <>
                    {" "}
                    ·{" "}
                    <a href={`/api/files/${r.r.cocFileId}`} className="link">
                      Certificate of Conformity
                    </a>
                  </>
                )}
              </SubNode>
            ))}
          </SubChain>
        </Node>

        <Node stage="Dispatch → delivery (POD)" refNo={t.dispatches.length ? `${t.dispatches.length} consignment(s)` : undefined} missing={!t.dispatches.length && "Not dispatched yet."}>
          <SubChain>
            {t.dispatches.map((x) => (
              <SubNode key={x.id} warn={x.status === "dispatched" && !x.proofOfDeliveryFileId} label={<><Link href={`/dispatch/${x.id}`} className="link plate">{x.ref}</Link> <StatusBadge map={DISPATCH_STATUS} status={x.status} /> · {x.lines.reduce((a, l) => a + Number(l.quantity), 0)} pcs</>}>
                Dispatched {fmtDateTime(x.dispatchedAt)} {x.carrier && `via ${x.carrier}`} {x.trackingRef && <>· tracking <span className="plate">{x.trackingRef}</span></>} · delivered {fmtDateTime(x.deliveredAt)}
                {x.deliveryNoteFileId && (
                  <>
                    {" "}
                    · <a href={`/api/files/${x.deliveryNoteFileId}`} className="link">delivery note</a>
                  </>
                )}
                {x.proofOfDeliveryFileId ? (
                  <>
                    {" "}
                    · <a href={`/api/files/${x.proofOfDeliveryFileId}`} className="link">proof of delivery</a>
                  </>
                ) : (
                  <> · no proof of delivery attached</>
                )}
              </SubNode>
            ))}
          </SubChain>
        </Node>
      </Chain>

      {(t.batches.length > 0 || t.serials.length > 0) && (
        <p className="mt-4 text-[12.5px] text-steel">
          Batches: {t.batches.map((b) => b.batchNo).join(", ") || "—"} · Serials: {t.serials.length ? `${t.serials.length} (${t.serials.slice(0, 5).map((s) => s.serialNo).join(", ")}${t.serials.length > 5 ? "…" : ""})` : "—"}. Search a batch or serial number for the piece-level trace.
        </p>
      )}
    </>
  );
}
