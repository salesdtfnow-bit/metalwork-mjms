import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requirePageCtx } from "@/server/auth/next";
import { can, canAny } from "@/server/context";
import { AppError } from "@/server/errors";
import { getSubcontractOrder } from "@/server/services/subcontract";
import { subcontractExtras } from "@/server/services/ui/workshop";
import { fmtDate, fmtDateTime, fmtMoney, fmtQty, todayISO } from "@/lib/format";
import { INSPECTION_STATUS, OP_STATUS, SUBCON_STATUS } from "@/lib/status";
import { Badge, KeyValues, Notice, Ref, Section, StatusBadge, Table, TitleBlock, cx } from "@/components/ui";
import { ActionForm, FileField, FormGrid, TextField } from "@/components/forms";
import { processLabel } from "../_components/vocab";
import { receiveSubcontractAction, sendSubcontractAction } from "../actions";

export const metadata = { title: "Subcontract order" };

export default async function SubcontractOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageCtx("subcontract.view");
  const { id } = await params;
  const data = await getSubcontractOrder(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const { sco, supplier, job, op, line, files } = data;
  const extras = await subcontractExtras(ctx, sco);
  const canSend = can(ctx.actor, "subcontract.manage") && sco.status === "draft";
  const canReceive = can(ctx.actor, "subcontract.receive") && ["sent", "at_supplier"].includes(sco.status);
  const showCost = canAny(ctx.actor, "purchasing.view", "jobs.view_commercial");
  const today = todayISO();
  const overdue = ["draft", "sent", "at_supplier"].includes(sco.status) && !!sco.requiredReturnDate && sco.requiredReturnDate < today;

  const timeline: { label: string; at: Date | null; who: string | null; detail?: ReactNode; done: boolean }[] = [
    { label: "Order created", at: sco.createdAt, who: extras.createdBy, done: true },
    { label: "Sent to subcontractor", at: sco.dispatchedAt, who: extras.dispatchedBy, detail: sco.dispatchedAt ? `${fmtQty(sco.qtySent)} sent${sco.dispatchNoteRef ? ` · dispatch note ${sco.dispatchNoteRef}` : ""}` : undefined, done: !!sco.dispatchedAt },
    {
      label: "Returned — incoming inspection opened",
      at: sco.returnedAt,
      who: extras.receivedBy,
      detail: sco.returnedAt ? `${fmtQty(sco.qtyReturned)} returned${sco.supplierDeliveryNote ? ` · supplier delivery note ${sco.supplierDeliveryNote}` : ""}` : undefined,
      done: !!sco.returnedAt,
    },
    {
      label: sco.status === "rejected" ? "Rejected at incoming inspection" : "Accepted at incoming inspection — operation complete",
      at: sco.acceptedAt,
      who: extras.acceptedBy,
      detail: sco.acceptedAt ? `${fmtQty(sco.qtyAccepted)} accepted, ${fmtQty(sco.qtyRejected)} rejected` : undefined,
      done: !!sco.acceptedAt,
    },
  ];

  return (
    <>
      <TitleBlock
        kind="Subcontract order"
        refNo={sco.ref}
        title={`${processLabel(sco.process)} — ${line.partNumber}`}
        status={
          <>
            <StatusBadge map={SUBCON_STATUS} status={sco.status} />
            {overdue && <Badge tone="danger">Return overdue</Badge>}
          </>
        }
        cells={[
          {
            label: "Supplier",
            value: (
              <Link href={`/suppliers/${supplier.id}`} className="link">
                {supplier.name}
              </Link>
            ),
          },
          {
            label: "Job",
            value: (
              <Link href={`/jobs/${job.id}?tab=route`} className="link">
                {job.jobNumber}
              </Link>
            ),
          },
          { label: "Operation", value: `${op.opNumber} — ${op.title}` },
          { label: "Qty sent / returned", value: `${fmtQty(sco.qtySent)} / ${fmtQty(sco.qtyReturned)}` },
          { label: "Return due", value: <span className={cx(overdue && "font-semibold text-red")}>{fmtDate(sco.requiredReturnDate)}</span> },
          { label: "Operation status", value: <StatusBadge map={OP_STATUS} status={op.status} /> },
        ]}
      />

      {sco.status === "returned" && (
        <Notice tone="warning" title="Not complete yet">
          Parts are back from {supplier.name}, but the operation is <span className="font-semibold">not complete</span> until the incoming inspection is accepted.
          {extras.inspection && (
            <>
              {" "}
              <Link href={`/quality/inspections/${extras.inspection.id}`} className="underline">
                Open inspection {extras.inspection.ref}
              </Link>
              .
            </>
          )}
        </Notice>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div>
          <Section title="Details">
            <KeyValues
              items={[
                { label: "Process", value: processLabel(sco.process) },
                { label: "Part", value: `${line.partNumber} — ${line.description}` },
                { label: "Planned quantity", value: fmtQty(op.plannedQty) },
                { label: "Specification", value: sco.specification, wide: true },
                { label: "Estimated cost", value: showCost ? fmtMoney(sco.estimatedCost) : "Restricted" },
                { label: "Actual cost", value: showCost ? fmtMoney(sco.actualCost) : "Restricted" },
                { label: "Supplier approval", value: `${supplier.approvalStatus.replace(/_/g, " ")}${supplier.approvalExpiresOn ? ` (expires ${fmtDate(supplier.approvalExpiresOn)})` : ""}` },
                {
                  label: "Incoming inspection",
                  value: extras.inspection ? (
                    <span className="inline-flex items-center gap-2">
                      <Ref href={`/quality/inspections/${extras.inspection.id}`} size="sm">
                        {extras.inspection.ref}
                      </Ref>
                      <StatusBadge map={INSPECTION_STATUS} status={extras.inspection.status} />
                    </span>
                  ) : (
                    "Opened automatically when the parts are received back"
                  ),
                },
                { label: "Notes", value: sco.notes, wide: true },
              ]}
            />
          </Section>

          <Section title="Timeline">
            <ol className="relative ml-2 border-l border-line">
              {timeline.map((t, i) => (
                <li key={i} className="mb-3 ml-4">
                  <span aria-hidden className={cx("absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border", t.done ? "border-green bg-green" : "border-line bg-sheet")} />
                  <p className={cx("text-[13.5px]", t.done ? "font-medium text-ink" : "text-steel")}>
                    {t.label}
                    {!t.done && <span className="ml-1.5 text-[12px] font-normal">(pending)</span>}
                  </p>
                  {t.done && (
                    <p className="text-[12.5px] text-steel">
                      {fmtDateTime(t.at)}
                      {t.who && ` · ${t.who}`}
                      {t.detail && <> · {t.detail}</>}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </Section>

          <Section title="Files">
            <Table head={["File", "Kind", "Uploaded"]} empty="No certificates or documents attached.">
              {files.map(({ sf, f }) => (
                <tr key={sf.id}>
                  <td>
                    <a className="link" href={`/api/files/${f.id}`}>
                      {f.originalName}
                    </a>
                  </td>
                  <td className="capitalize">{sf.kind.replace(/_/g, " ")}</td>
                  <td className="text-steel">{fmtDateTime(f.uploadedAt)}</td>
                </tr>
              ))}
            </Table>
          </Section>
        </div>

        <div>
          {canSend && (
            <Section title="Send to subcontractor">
              <div className="rounded-md border border-line bg-sheet p-3">
                <ActionForm action={sendSubcontractAction} submitLabel="Record as sent" confirm={`Confirm the parts have been sent to ${supplier.name}. Operation ${op.opNumber} will be marked as at the subcontractor.`}>
                  <input type="hidden" name="id" value={sco.id} />
                  <FormGrid>
                    <TextField label="Quantity sent" name="qtySent" required inputMode="decimal" defaultValue={op.plannedQty} />
                    <TextField label="Dispatch note ref." name="dispatchNoteRef" />
                  </FormGrid>
                </ActionForm>
              </div>
            </Section>
          )}
          {canReceive && (
            <Section title="Receive back">
              <div className="rounded-md border border-line bg-sheet p-3">
                <p className="mb-3 text-[12.5px] text-steel">
                  Receiving opens an incoming (subcontract-return) inspection. The operation stays <span className="font-medium">awaiting inspection</span> and is only completed when that inspection is accepted.
                </p>
                <ActionForm action={receiveSubcontractAction} submitLabel="Receive parts">
                  <input type="hidden" name="id" value={sco.id} />
                  <FormGrid>
                    <TextField label="Quantity returned" name="qtyReturned" required inputMode="decimal" defaultValue={sco.qtySent} />
                    <TextField label="Supplier delivery note" name="supplierDeliveryNote" />
                    {showCost && <TextField label="Actual cost" name="actualCost" inputMode="decimal" />}
                  </FormGrid>
                  <FileField label="Certificates" name="certificates" multiple hint="Process / test certificates from the subcontractor." />
                </ActionForm>
              </div>
            </Section>
          )}
          {!canSend && !canReceive && ["draft", "sent", "at_supplier"].includes(sco.status) && (
            <p className="text-[12.5px] text-steel">You can view this order. Sending requires subcontract management permission; receiving requires subcontract receipt permission.</p>
          )}
        </div>
      </div>
    </>
  );
}
