import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { AppError } from "@/server/errors";
import { getDispatch } from "@/server/services/dispatch";
import { jobConformityCertificates } from "@/server/services/ui/workshop";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/format";
import { DISPATCH_STATUS } from "@/lib/status";
import { KeyValues, Notice, Section, StatusBadge, Table, TitleBlock, buttonClass } from "@/components/ui";
import { ActionForm, Disclosure, FileField, FormGrid, TextArea, TextField } from "@/components/forms";
import { toLocalInput } from "../../planning/_components/datetime";
import { cancelDispatchAction, confirmDispatchAction, recordDeliveryAction } from "../actions";

export const metadata = { title: "Dispatch" };

export default async function DispatchRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageCtx("dispatch.view");
  const { id } = await params;
  const data = await getDispatch(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const { d: dsp, job, customer, by, lines } = data;
  const cocs = await jobConformityCertificates(ctx, job.id);
  const draft = dsp.status === "draft";
  const canConfirm = draft && can(ctx.actor, "dispatch.dispatch");
  const canManage = can(ctx.actor, "dispatch.manage");
  const totalQty = lines.reduce((a, l) => a + Number(l.l.quantity), 0);

  return (
    <>
      <TitleBlock
        kind="Delivery note"
        refNo={dsp.ref}
        title={`${job.jobNumber} — ${customer.name}`}
        status={<StatusBadge map={DISPATCH_STATUS} status={dsp.status} />}
        cells={[
          {
            label: "Job",
            value: (
              <Link href={`/jobs/${job.id}`} className="link">
                {job.jobNumber}
              </Link>
            ),
          },
          { label: "Customer", value: customer.name },
          { label: "Customer PO", value: dsp.customerPoNumber },
          { label: "Method", value: (dsp.deliveryMethod ?? "—").replace(/_/g, " ") },
          { label: "Dispatched", value: dsp.dispatchedAt ? `${fmtDateTime(dsp.dispatchedAt)}${by ? ` · ${by}` : ""}` : null },
          { label: "Delivered", value: fmtDateTime(dsp.deliveredAt) },
        ]}
      />

      {draft && (
        <Notice tone="info" title="Draft — goods have not left">
          This dispatch reserves its quantities but nothing is shipped until it is confirmed. Confirming re-checks releases and holds, updates dispatched quantities and issues the delivery note.
        </Notice>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div>
          <Section title={`Lines (${fmtQty(totalQty)} pcs)`}>
            <Table head={["Line", "Part / description", "Batch", "Quantity", "Serial numbers"]} empty="No lines.">
              {lines.map((l) => (
                <tr key={l.l.id}>
                  <td>{l.jl.lineNo}</td>
                  <td>
                    <span className="font-medium">{l.jl.partNumber}</span>
                    <span className="block text-[12px] text-steel">{l.l.description}</span>
                  </td>
                  <td className="plate text-[12.5px]">{l.batch ?? "—"}</td>
                  <td className="font-semibold">{fmtQty(l.l.quantity)}</td>
                  <td className="max-w-[320px]">{l.serials.length ? <span className="plate text-[12.5px]">{l.serials.join(", ")}</span> : <span className="text-steel">—</span>}</td>
                </tr>
              ))}
            </Table>
          </Section>

          <Section title="Delivery">
            <KeyValues
              items={[
                { label: "Delivery address", value: dsp.deliveryAddressText, wide: true },
                { label: "Carrier", value: dsp.carrier },
                { label: "Tracking ref.", value: dsp.trackingRef },
                { label: "Packages", value: dsp.packageCount },
                { label: "Gross weight", value: dsp.grossWeightKg ? `${dsp.grossWeightKg} kg` : null },
                { label: "Certificates included", value: dsp.certificatesIncluded },
                { label: "Packaging notes", value: dsp.packagingNotes, wide: true },
                { label: "Notes", value: dsp.notes, wide: true },
              ]}
            />
          </Section>

          <Section title="Documents">
            <ul className="space-y-1.5 text-[13.5px]">
              <li>
                {dsp.deliveryNoteFileId ? (
                  <a className="link" href={`/api/files/${dsp.deliveryNoteFileId}`}>
                    Delivery note {dsp.ref} (issued PDF)
                  </a>
                ) : (
                  <>
                    <a className="link" href={`/api/pdf/delivery-note/${dsp.id}`}>
                      Delivery note — preview
                    </a>
                    <span className="ml-1.5 text-[12px] text-steel">The formal copy is stored when the dispatch is confirmed.</span>
                  </>
                )}
              </li>
              <li>
                <a className="link" href={`/api/pdf/packing-list/${dsp.id}`}>
                  Packing list
                </a>
              </li>
              {dsp.proofOfDeliveryFileId && (
                <li>
                  <a className="link" href={`/api/files/${dsp.proofOfDeliveryFileId}`}>
                    Proof of delivery
                  </a>
                </li>
              )}
            </ul>
            <h3 className="mt-4 mb-1.5 text-[13px] font-semibold text-ink">Certificates of Conformity (approved final releases)</h3>
            <Table head={["Line", "Part", "Qty released", "Released", "Certificate"]} empty="No CoC has been issued for this job's releases.">
              {cocs.map((c) => (
                <tr key={c.releaseId}>
                  <td>{c.lineNo}</td>
                  <td>{c.partNumber}</td>
                  <td>{fmtQty(c.qtyReleased)}</td>
                  <td>{fmtDate(c.decidedAt)}</td>
                  <td>
                    <a className="link" href={`/api/files/${c.fileId}`}>
                      {c.fileName}
                    </a>
                  </td>
                </tr>
              ))}
            </Table>
          </Section>
        </div>

        <div className="space-y-5">
          {canConfirm && (
            <Section title="Confirm dispatch">
              <div className="rounded-md border border-line bg-sheet p-3">
                <ActionForm
                  action={confirmDispatchAction}
                  submitLabel="Confirm dispatch"
                  confirm={`Confirm that the goods on ${dsp.ref} have physically left the premises. Dispatched quantities are updated and the delivery note is issued — this cannot be undone (returns go through a customer return / NCR).`}
                >
                  <input type="hidden" name="id" value={dsp.id} />
                  <FormGrid cols={1}>
                    <TextField label="Carrier" name="carrier" defaultValue={dsp.carrier} />
                    <TextField label="Tracking ref." name="trackingRef" defaultValue={dsp.trackingRef} />
                  </FormGrid>
                </ActionForm>
              </div>
            </Section>
          )}
          {dsp.status === "dispatched" && canManage && (
            <Section title="Record delivery">
              <div className="rounded-md border border-line bg-sheet p-3">
                <ActionForm action={recordDeliveryAction} submitLabel="Mark delivered">
                  <input type="hidden" name="id" value={dsp.id} />
                  <TextField label="Delivered at" name="deliveredAt" type="datetime-local" defaultValue={toLocalInput(new Date())} hint="Blank = now." />
                  <FileField label="Proof of delivery" name="pod" hint="Signed POD or carrier confirmation (kept as a customer original)." />
                </ActionForm>
              </div>
            </Section>
          )}
          {draft && canManage && (
            <Section title="Cancel draft">
              <Disclosure label="Cancel this draft" variant="ghost">
                <ActionForm action={cancelDispatchAction} submitLabel="Cancel draft dispatch" submitVariant="danger" confirm="The draft is cancelled and its quantities become available to dispatch again.">
                  <input type="hidden" name="id" value={dsp.id} />
                  <TextArea label="Reason" name="reason" required rows={2} />
                </ActionForm>
              </Disclosure>
            </Section>
          )}
          {draft && !canConfirm && <p className="text-[12.5px] text-steel">Confirming a dispatch requires the &quot;Confirm dispatch of goods&quot; permission.</p>}
          <a href={`/api/pdf/packing-list/${dsp.id}`} className={buttonClass("secondary", "sm")}>
            Print packing list
          </a>
        </div>
      </div>
    </>
  );
}
