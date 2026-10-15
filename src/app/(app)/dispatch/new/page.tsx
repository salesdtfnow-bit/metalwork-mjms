import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { AppError } from "@/server/errors";
import { dispatchableQty, readyToDispatch } from "@/server/services/dispatch";
import { formatAddress } from "@/server/services/parties";
import { dispatchJobContext } from "@/server/services/ui/workshop";
import { fmtDate, fmtQty } from "@/lib/format";
import { JOB_STATUS } from "@/lib/status";
import { Badge, Empty, Notice, PageHeader, Panel, Section, StatusBadge, Table } from "@/components/ui";
import { ActionForm, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { createDispatchAction } from "../actions";

export const metadata = { title: "Prepare dispatch" };

const METHODS = [
  { value: "carrier", label: "Carrier / haulier" },
  { value: "courier", label: "Courier" },
  { value: "own_vehicle", label: "Own vehicle" },
  { value: "collection", label: "Customer collection" },
];

/** Prefill the certificates line from the job's certification requirements. */
function certificatesFor(req: string | null) {
  if (!req) return "";
  const out: string[] = [];
  if (/conformity|\bcoc\b|c of c/i.test(req)) out.push("Certificate of Conformity");
  if (/material|3\.1|3\.2|mill|10204/i.test(req)) out.push("material certificates");
  return out.join("; ");
}

export default async function NewDispatchPage({ searchParams }: { searchParams: Promise<{ jobId?: string }> }) {
  const ctx = await requirePageCtx("dispatch.manage");
  const { jobId } = await searchParams;

  if (!jobId) {
    const ready = await readyToDispatch(ctx);
    const jobs = [...new Map(ready.map((r) => [r.job.id, r])).values()];
    return (
      <>
        <PageHeader title="Prepare dispatch" description="Choose a job with released quantity to ship." />
        {jobs.length === 0 ? (
          <Empty title="Nothing to dispatch">No job has quality-released quantity waiting to ship.</Empty>
        ) : (
          <form className="flex flex-wrap items-end gap-2" action="/dispatch/new">
            <label className="block">
              <span className="mb-1 block text-[12.5px] font-medium text-ink-2">Job</span>
              <select name="jobId" required defaultValue="" className="field-input min-w-[360px]">
                <option value="" disabled>
                  Select a job…
                </option>
                {jobs.map((r) => (
                  <option key={r.job.id} value={r.job.id}>
                    {r.job.jobNumber} — {r.customer} — {r.job.title}
                  </option>
                ))}
              </select>
            </label>
            <button className="h-8.5 rounded-sm border border-line bg-sheet px-3 text-[13.5px]">Continue</button>
          </form>
        )}
      </>
    );
  }

  const data = await dispatchJobContext(ctx, jobId).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const { job, customer, addresses } = data;
  const lines = await Promise.all(data.lines.map(async (l) => ({ ...l, free: (await dispatchableQty(ctx, l.line.id)).free.toString() })));
  const shippable = lines.filter((l) => l.released && Number(l.free) > 0);
  const defaultAddr = job.deliveryAddressId ?? addresses.find((a) => a.kind === "delivery" && a.isDefault)?.id ?? addresses.find((a) => a.kind === "delivery")?.id ?? null;
  const blocked = data.jobOnHold || ["on_hold", "cancelled", "completed"].includes(job.status);

  return (
    <>
      <PageHeader
        title={`Prepare dispatch — ${job.jobNumber}`}
        description={
          <>
            {customer.name} · {job.title} · required {fmtDate(job.requiredDate)} · <StatusBadge map={JOB_STATUS} status={job.status} />
          </>
        }
        actions={
          <Link href={`/jobs/${job.id}`} className="link text-[13px]">
            Open job
          </Link>
        }
      />
      {blocked && (
        <Notice tone="danger" title="This job cannot be dispatched">
          The job is {job.status.replace(/_/g, " ")}
          {data.jobOnHold && " or has an active hold"}. Release the hold before preparing a dispatch.
        </Notice>
      )}
      {(job.packagingRequirements || job.deliveryRequirements || job.certificationRequirements) && (
        <Notice tone="info" title="Job requirements">
          {job.certificationRequirements && <p>Certification: {job.certificationRequirements}</p>}
          {job.packagingRequirements && <p>Packaging: {job.packagingRequirements}</p>}
          {job.deliveryRequirements && <p>Delivery: {job.deliveryRequirements}</p>}
        </Notice>
      )}

      {shippable.length === 0 && !blocked && (
        <Notice tone="warning" title="No quantity available to dispatch">
          Every line is either without an approved final release, already dispatched, on a draft dispatch, or held.
        </Notice>
      )}

      {addresses.length === 0 && !blocked && (
        <Notice tone="warning" title="No delivery address">
          Add a delivery address to the customer record ({customer.code}) before preparing a dispatch.
        </Notice>
      )}

      {!blocked && shippable.length > 0 && (
      <Panel className="p-4">
        <ActionForm action={createDispatchAction} submitLabel="Create draft dispatch">
          <input type="hidden" name="jobId" value={job.id} />
          <Section title="Lines">
            <Table head={["Line", "Part", "Ordered", "Released", "Dispatched", "Available now", "Dispatch qty", "Batch / serials"]}>
              {lines.map((l) => {
                const can = l.released && Number(l.free) > 0;
                return (
                  <tr key={l.line.id} className={can ? undefined : "opacity-70"}>
                    <td>{l.line.lineNo}</td>
                    <td>
                      <span className="font-medium">{l.line.partNumber}</span>
                      <span className="block max-w-[240px] truncate text-[12px] text-steel">{l.line.description}</span>
                    </td>
                    <td>{fmtQty(l.line.quantity)}</td>
                    <td>{fmtQty(l.line.qtyReleased)}</td>
                    <td>{fmtQty(l.line.qtyDispatched)}</td>
                    <td className="font-semibold">
                      {fmtQty(l.free)}
                      {!l.released && (
                        <span className="block">
                          <Badge tone="warning">No final release</Badge>
                        </span>
                      )}
                    </td>
                    <td>
                      {can ? (
                        <>
                          <input type="hidden" name="lineIds" value={l.line.id} />
                          <input name={`qty_${l.line.id}`} defaultValue={l.free} inputMode="decimal" aria-label={`Dispatch quantity for line ${l.line.lineNo}`} className="field-input w-24" />
                        </>
                      ) : (
                        <span className="text-steel">—</span>
                      )}
                    </td>
                    <td className="min-w-[200px]">
                      {can && l.batches.length > 0 && (
                        <select name={`batch_${l.line.id}`} defaultValue="" aria-label={`Batch for line ${l.line.lineNo}`} className="field-input mb-1.5">
                          <option value="">No specific batch</option>
                          {l.batches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.batchNo} ({b.status.replace(/_/g, " ")})
                            </option>
                          ))}
                        </select>
                      )}
                      {can && l.line.traceabilityLevel === "piece" && (
                        <fieldset>
                          <legend className="text-[12px] font-medium text-ink-2">Serials (select one per piece)</legend>
                          {l.serials.length === 0 ? (
                            <p className="text-[12px] text-red">No accepted serials available.</p>
                          ) : (
                            <div className="max-h-32 overflow-y-auto">
                              {l.serials.map((s) => (
                                <label key={s.id} className="flex items-center gap-1.5 text-[12.5px]">
                                  <input type="checkbox" name={`serial_${l.line.id}`} value={s.id} className="accent-dykem" />
                                  <span className="plate">{s.serialNo}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </fieldset>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
            <p className="mt-1 text-[12px] text-steel">Set a line&apos;s quantity to 0 to leave it off this dispatch. Piece-traceable lines need exactly one serial per dispatched piece.</p>
          </Section>

          <Section title="Delivery">
            <FormGrid cols={3}>
              <SelectField
                label="Delivery address"
                name="deliveryAddressId"
                required
                options={addresses.map((a) => ({ value: a.id, label: `${a.label ? `${a.label}: ` : ""}${formatAddress(a).replace(/\n/g, ", ")}${a.id === job.deliveryAddressId ? " (job address)" : ""}` }))}
                defaultValue={defaultAddr}
                placeholder={addresses.length ? undefined : "No addresses on the customer record"}
                className="sm:col-span-3"
              />
              <SelectField label="Delivery method" name="deliveryMethod" required options={METHODS} defaultValue="carrier" />
              <TextField label="Carrier" name="carrier" />
              <TextField label="Tracking ref." name="trackingRef" />
              <TextField label="Package count" name="packageCount" inputMode="numeric" />
              <TextField label="Gross weight (kg)" name="grossWeightKg" inputMode="decimal" />
              <TextField label="Certificates included" name="certificatesIncluded" defaultValue={certificatesFor(job.certificationRequirements)} hint="Printed on the delivery note." />
            </FormGrid>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <TextArea label="Packaging notes" name="packagingNotes" rows={2} defaultValue={job.packagingRequirements} />
              <TextArea label="Notes" name="notes" rows={2} />
            </div>
          </Section>
        </ActionForm>
      </Panel>
      )}
    </>
  );
}
