import Link from "next/link";
import { jobBatchesAndSerials, jobLineDrawings } from "@/server/services/ui/jobs";
import { can } from "@/server/context";
import { d } from "@/lib/decimal";
import { fmtMoney, fmtQty } from "@/lib/format";
import { REVISION_STATUS } from "@/lib/status";
import { Badge, Panel, Section, StatusBadge, Table } from "@/components/ui";
import { ActionForm, Disclosure, SelectField, TextField } from "@/components/forms";
import { createBatchAction, generateSerialsAction } from "../actions";
import { BATCH_STATUS, ROUTE_STATUS, SERIAL_STATUS, TRACE_LEVEL } from "./maps";
import { TERMINAL_JOB, type TabProps } from "./types";

const SERIAL_PREVIEW = 120;

export async function LinesTab({ ctx, data }: TabProps) {
  const { job: j, lines, showCommercial } = data;
  const [drawings, bs] = await Promise.all([jobLineDrawings(ctx, j.id), jobBatchesAndSerials(ctx, j.id)]);
  const manage = can(ctx.actor, "routing.manage") && !TERMINAL_JOB.includes(j.status);
  const currency = data.order?.currency ?? "GBP";

  return (
    <>
      <Section title="Job lines">
        <Table
          head={[
            "Line",
            "Part number",
            "Description",
            "Drawing",
            "Qty",
            "Good",
            "Rejected",
            "Scrapped",
            "Accepted",
            "Released",
            "Dispatched",
            ...(showCommercial ? ["Unit price"] : []),
            "Traceability",
            "Route",
          ]}
          empty="This job has no lines."
        >
          {lines.map(({ line: l, part }) => {
            const dr = drawings.find((x) => x.lineId === l.id);
            return (
              <tr key={l.id}>
                <td className="plate">{l.lineNo}</td>
                <td className="whitespace-nowrap">
                  <Link href={`/parts/${part.id}`} className="plate text-[13px] text-dykem hover:underline">
                    {l.partNumber}
                  </Link>
                </td>
                <td>
                  {l.description}
                  {l.materialSpec && <div className="text-[12px] text-steel">{l.materialSpec}</div>}
                </td>
                <td className="whitespace-nowrap">
                  {dr ? (
                    <div className="space-y-1">
                      <div>
                        <Link href={`/documents/${dr.doc.id}`} className="link">
                          {dr.doc.docNumber}
                        </Link>{" "}
                        rev {dr.rev.revision}
                      </div>
                      <StatusBadge map={REVISION_STATUS} status={dr.rev.status} />
                    </div>
                  ) : (
                    <span className="text-steel">No drawing pinned</span>
                  )}
                  {l.drawingReviewRequired && (
                    <div className="mt-1">
                      <Badge tone="danger">Review required</Badge>
                    </div>
                  )}
                </td>
                <td className="text-right tabular-nums">{fmtQty(l.quantity)}</td>
                <td className="text-right tabular-nums">{fmtQty(l.qtyGood)}</td>
                <td className="text-right tabular-nums">{fmtQty(l.qtyRejected)}</td>
                <td className="text-right tabular-nums">{fmtQty(l.qtyScrapped)}</td>
                <td className="text-right tabular-nums">{fmtQty(l.qtyAccepted)}</td>
                <td className="text-right tabular-nums">{fmtQty(l.qtyReleased)}</td>
                <td className="text-right tabular-nums">{fmtQty(l.qtyDispatched)}</td>
                {showCommercial && <td className="whitespace-nowrap text-right tabular-nums">{l.unitPrice ? fmtMoney(l.unitPrice, currency) : "—"}</td>}
                <td className="whitespace-nowrap">{TRACE_LEVEL[l.traceabilityLevel] ?? l.traceabilityLevel}</td>
                <td>
                  <StatusBadge map={ROUTE_STATUS} status={l.routeStatus} />
                </td>
              </tr>
            );
          })}
        </Table>
      </Section>

      <Section title="Batches and serial numbers">
        <div className="grid gap-4 lg:grid-cols-2">
          {lines.map(({ line: l }) => {
            const lineBatches = bs.batches.filter((b) => b.jobLineId === l.id);
            const lineSerials = bs.serials.filter((s) => s.jobLineId === l.id);
            const batchTotal = lineBatches.reduce((a, b) => a.plus(d(b.quantity)), d(0));
            return (
              <Panel key={l.id} className="p-3">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-[13.5px] font-semibold">
                    Line {l.lineNo} — <span className="plate">{l.partNumber}</span>
                  </h3>
                  <span className="text-[12px] text-steel">Traceability: {TRACE_LEVEL[l.traceabilityLevel] ?? l.traceabilityLevel}</span>
                </div>
                <Table head={["Batch", "Quantity", "Status", "Serials"]} empty="No batches. Production is traced at job level unless batches are created.">
                  {lineBatches.map((b) => (
                    <tr key={b.id}>
                      <td className="plate text-[13px]">{b.batchNo}</td>
                      <td className="tabular-nums">{fmtQty(b.quantity)}</td>
                      <td>
                        <StatusBadge map={BATCH_STATUS} status={b.status} />
                      </td>
                      <td className="tabular-nums">{lineSerials.filter((s) => s.batchId === b.id).length || "—"}</td>
                    </tr>
                  ))}
                </Table>
                {lineBatches.length > 0 && (
                  <p className="mt-1 text-[12px] text-steel">
                    Batched {fmtQty(batchTotal.toString())} of {fmtQty(l.quantity)}.
                  </p>
                )}
                {l.traceabilityLevel === "piece" && (
                  <div className="mt-3">
                    <p className="text-[12.5px] font-medium text-ink-2">
                      Serial numbers: {lineSerials.length} of {fmtQty(l.quantity)} generated
                    </p>
                    {lineSerials.length > 0 && (
                      <ul className="mt-1 flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                        {lineSerials.slice(0, SERIAL_PREVIEW).map((s) => (
                          <li key={s.id} title={SERIAL_STATUS[s.status]?.label ?? s.status} className="rounded-sm border border-line bg-paper px-1.5 py-0.5 font-mono text-[11.5px]">
                            {s.serialNo}
                            {s.status !== "in_process" && <span className="ml-1 text-steel">({SERIAL_STATUS[s.status]?.label ?? s.status})</span>}
                          </li>
                        ))}
                        {lineSerials.length > SERIAL_PREVIEW && <li className="px-1 text-[12px] text-steel">and {lineSerials.length - SERIAL_PREVIEW} more — see traceability</li>}
                      </ul>
                    )}
                  </div>
                )}
                {manage && (
                  <div className="mt-3 flex flex-wrap items-start gap-2">
                    <Disclosure label="Create batch">
                      <ActionForm action={createBatchAction} submitLabel="Create batch" resetOnSuccess>
                        <input type="hidden" name="jobId" value={j.id} />
                        <input type="hidden" name="jobLineId" value={l.id} />
                        <TextField label="Batch quantity" name="quantity" required inputMode="decimal" />
                      </ActionForm>
                    </Disclosure>
                    {l.traceabilityLevel === "piece" && d(lineSerials.length).lessThan(d(l.quantity)) && (
                      <Disclosure label="Generate serials">
                        <ActionForm action={generateSerialsAction} submitLabel="Generate" resetOnSuccess>
                          <input type="hidden" name="jobId" value={j.id} />
                          <input type="hidden" name="jobLineId" value={l.id} />
                          <TextField label="How many" name="count" required inputMode="numeric" defaultValue={d(l.quantity).minus(lineSerials.length).toString()} />
                          <SelectField label="Batch" name="batchId" placeholder="No batch" options={lineBatches.map((b) => ({ value: b.id, label: `${b.batchNo} (${fmtQty(b.quantity)})` }))} />
                        </ActionForm>
                      </Disclosure>
                    )}
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      </Section>
    </>
  );
}
