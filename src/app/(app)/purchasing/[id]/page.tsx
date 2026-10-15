import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { can, canAny } from "@/server/context";
import { AppError } from "@/server/errors";
import { getPurchaseOrder } from "@/server/services/purchasing";
import { boxheroLocations, receiptsForPurchaseOrder } from "@/server/services/ui/materials";
import { d, Decimal } from "@/lib/decimal";
import { fmtDate, fmtDateTime, fmtMoney, fmtQty } from "@/lib/format";
import { LOT_STATUS, PO_STATUS } from "@/lib/status";
import { Badge, KeyValues, Notice, Ref, Section, StatusBadge, Table, TitleBlock } from "@/components/ui";
import { ActionForm, Disclosure, FileField, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { StageLegend, SyncCell } from "../../materials/_components/Lifecycle";
import { CERT_STATUS, UUID_RE, certReqLabel } from "../../materials/_components/labels";
import { approvalLabel } from "../_components/supplier";
import { approvePoAction, cancelPoAction, closePoAction, markPoSentAction, receiveGoodsAction, updateLinePriceAction } from "../actions";

export const metadata = { title: "Purchase order" };

/** Highlights the receipt just recorded (within the last 30 minutes). */
function receivedRecently(at: Date) {
  return Date.now() - new Date(at).getTime() < 30 * 60_000;
}

const LINE_STATUS = {
  open: { label: "Open", tone: "info" },
  partially_received: { label: "Partially received", tone: "warning" },
  received: { label: "Received", tone: "success" },
  cancelled: { label: "Cancelled", tone: "muted" },
} as const;

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageCtx("purchasing.view");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const data = await getPurchaseOrder(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const { po, supplier, createdByName, lines } = data;
  const manage = can(ctx.actor, "purchasing.manage");
  const approve = can(ctx.actor, "purchasing.approve");
  const receive = can(ctx.actor, "materials.receive");
  const seeLots = can(ctx.actor, "materials.view");
  const seeJobs = canAny(ctx.actor, "jobs.view", "production.view_all");
  const receivable = ["sent", "partially_received"].includes(po.status);
  const openLines = lines.filter((l) => ["open", "partially_received"].includes(l.l.status));
  const anyReceived = lines.some((l) => d(l.l.qtyReceived).greaterThan(0));
  const [receipts, locations] = await Promise.all([receiptsForPurchaseOrder(ctx, id), receive && receivable ? boxheroLocations(ctx) : Promise.resolve([])]);
  const isCreator = po.createdBy === ctx.actor.userId;
  const priceEditable = manage && ["draft", "approved"].includes(po.status);
  const latest = receipts[0];
  const latestIsRecent = !!latest && receivedRecently(latest.r.receivedAt);

  return (
    <>
      <TitleBlock
        kind="Purchase order"
        refNo={po.ref}
        title={supplier.name}
        status={
          <>
            <StatusBadge map={PO_STATUS} status={po.status} />
            <Badge tone={["approved", "conditional"].includes(supplier.approvalStatus) ? "success" : "warning"}>Supplier: {approvalLabel(supplier.approvalStatus)}</Badge>
          </>
        }
        cells={[
          { label: "Kind", value: <span className="capitalize">{po.kind}</span> },
          { label: "Order date", value: fmtDate(po.orderDate) },
          { label: "Required", value: fmtDate(po.requiredDate) },
          { label: "Supplier ref", value: po.supplierReference },
          { label: "Total", value: fmtMoney(po.total, po.currency) },
          { label: "Created by", value: createdByName },
        ]}
      />

      <div className="mb-5 flex flex-wrap items-start gap-3">
        {approve && po.status === "draft" &&
          (isCreator ? (
            <p className="rounded-sm border border-line bg-sheet px-3 py-1.5 text-[13px] text-steel">You created this purchase order — a different person must approve it.</p>
          ) : (
            <div className="max-w-md">
              <ActionForm action={approvePoAction} submitLabel="Approve purchase order" confirm={`Approve ${po.ref} to ${supplier.name} for ${fmtMoney(po.total, po.currency)}? The approver must be a different person from the creator.`}>
                <input type="hidden" name="id" value={po.id} />
              </ActionForm>
              <p className="mt-1 text-[12px] text-steel">Approval must be by a different person from the creator.</p>
            </div>
          ))}
        {manage && po.status === "draft" && !approve && <p className="text-[13px] text-steel">Awaiting approval by someone with purchase order approval rights (not the creator).</p>}
        {manage && po.status === "approved" && (
          <Disclosure label="Mark as sent to supplier" variant="primary">
            <ActionForm action={markPoSentAction} submitLabel="Mark sent">
              <input type="hidden" name="id" value={po.id} />
              <TextField label="Supplier reference / order acknowledgement" name="supplierReference" defaultValue={po.supplierReference} />
            </ActionForm>
          </Disclosure>
        )}
        {manage && !["cancelled", "received", "closed"].includes(po.status) && !anyReceived && (
          <Disclosure label="Cancel purchase order" variant="ghost">
            <ActionForm action={cancelPoAction} submitLabel="Cancel purchase order" submitVariant="danger" confirm={`Cancel ${po.ref}? All lines will be cancelled. This cannot be undone.`}>
              <input type="hidden" name="id" value={po.id} />
              <TextArea label="Reason" name="reason" rows={2} required />
            </ActionForm>
          </Disclosure>
        )}
        {manage && ["sent", "partially_received", "received"].includes(po.status) && (
          <Disclosure label="Close purchase order" variant="ghost">
            <ActionForm
              action={closePoAction}
              submitLabel="Close purchase order"
              submitVariant="danger"
              confirm={`Close ${po.ref}? Any lines not yet fully received will be cancelled and no further goods can be received against this order.`}
            >
              <input type="hidden" name="id" value={po.id} />
              <TextArea label="Reason" name="reason" rows={2} required placeholder="e.g. Supplier short-shipped; balance no longer required" />
            </ActionForm>
          </Disclosure>
        )}
      </div>

      <Section title="Lines">
        <Table head={["Line", "Job", "Spec", "Description", "Dimensions", "Ordered", "Received", "Unit price", "Required", "Cert req.", "Status"]} empty="No lines.">
          {lines.map(({ l, job, spec }) => (
            <tr key={l.id}>
              <td>{l.lineNo}</td>
              <td>{job && l.jobId ? seeJobs ? <Ref href={`/jobs/${l.jobId}`} size="sm">{job}</Ref> : job : <span className="text-steel">Stock</span>}</td>
              <td>{spec ?? "—"}</td>
              <td>
                {l.description}
                {l.form && <span className="block text-[12px] capitalize text-steel">{l.form}</span>}
              </td>
              <td>{l.dimensions ?? "—"}</td>
              <td className="whitespace-nowrap">{fmtQty(l.quantity, l.uom)}</td>
              <td className="whitespace-nowrap">{fmtQty(l.qtyReceived, l.uom)}</td>
              <td className="whitespace-nowrap text-right">
                {fmtMoney(l.unitPrice, po.currency)}
                {priceEditable && l.status !== "cancelled" && (
                  <div className="mt-1 text-left">
                    <Disclosure label="Edit price" variant="ghost">
                      <ActionForm action={updateLinePriceAction} submitLabel="Save price">
                        <input type="hidden" name="id" value={po.id} />
                        <input type="hidden" name="lineId" value={l.id} />
                        <TextField label={`Unit price (${po.currency})`} name="unitPrice" required inputMode="decimal" defaultValue={l.unitPrice} />
                        {po.status === "approved" && (
                          <>
                            <TextArea label="Reason for change" name="reason" rows={2} required />
                            <p className="text-[12px] text-amber">Changing a price on an approved PO returns it to draft — it must be approved again before it can be sent.</p>
                          </>
                        )}
                      </ActionForm>
                    </Disclosure>
                  </div>
                )}
              </td>
              <td className="whitespace-nowrap">{fmtDate(l.requiredDate ?? po.requiredDate)}</td>
              <td>{certReqLabel(l.certRequirement)}</td>
              <td>
                <StatusBadge map={LINE_STATUS} status={l.status} />
              </td>
            </tr>
          ))}
        </Table>
        <KeyValues
          cols={2}
          items={[
            { label: "Delivery instructions", value: po.deliveryInstructions },
            { label: "Notes", value: po.notes },
          ]}
        />
      </Section>

      {receive && receivable && openLines.length > 0 && (
        <Section title="Receive goods" id="receive">
          <Notice tone="warning" title="Receiving does not make material usable">
            Each line received creates a material lot (one per heat / cast number) with status <strong>awaiting inspection</strong>. It cannot be allocated or issued until it has
            been inspected, its certificate verified and it has been formally released. Receive a separate delivery for each heat number.
          </Notice>
          <ActionForm action={receiveGoodsAction} submitLabel="Record goods receipt" resetOnSuccess>
            <input type="hidden" name="purchaseOrderId" value={po.id} />
            <FormGrid cols={3}>
              <TextField label="Delivery note number" name="deliveryNoteNo" />
              <FileField label="Delivery note (scan / photo)" name="deliveryNoteFile" accept=".pdf,image/*" />
              <TextField label="Notes" name="notes" />
            </FormGrid>
            {openLines.map(({ l, spec }) => {
              const outstanding = Decimal.max(d(l.quantity).minus(d(l.qtyReceived)), 0);
              return (
                <fieldset key={l.id} className="rounded-sm border border-line bg-paper p-3">
                  <legend className="px-1 text-[12.5px] font-semibold text-ink">
                    Line {l.lineNo}: {l.description}
                    {spec ? ` · ${spec}` : ""} — ordered {fmtQty(l.quantity, l.uom)}, received {fmtQty(l.qtyReceived, l.uom)}, outstanding {fmtQty(outstanding.toString(), l.uom)}
                  </legend>
                  <input type="hidden" name="lineId" value={l.id} />
                  <FormGrid cols={3}>
                    <TextField label={`Quantity received now (${l.uom})`} name={`qty_${l.id}`} inputMode="decimal" hint="Leave blank if nothing arrived for this line." />
                    <TextField label="Heat / cast number" name={`heat_${l.id}`} hint="Required when a quantity is entered — from the material or its certificate." />
                    <TextField label="Supplier batch no" name={`batch_${l.id}`} />
                    <TextField label="Dimensions (as received)" name={`dims_${l.id}`} defaultValue={l.dimensions} />
                    {l.boxheroItemId ? (
                      <SelectField
                        label="BoxHero location"
                        name={`loc_${l.id}`}
                        placeholder={locations.length ? "Default location" : "No cached locations — sync the catalogue"}
                        options={locations.map((x) => ({ value: x.boxheroLocationId, label: x.name }))}
                        hint="The BoxHero stock-in is queued for this location."
                      />
                    ) : (
                      <p className="self-end pb-2 text-[12.5px] text-steel">No BoxHero item on this line — stock will not be tracked in BoxHero.</p>
                    )}
                    <TextField label="Storage location" name={`store_${l.id}`} placeholder="e.g. Rack B3" />
                  </FormGrid>
                </fieldset>
              );
            })}
          </ActionForm>
        </Section>
      )}
      {receive && po.status === "approved" && <Notice tone="info">Mark the order as sent before receiving goods against it.</Notice>}

      <Section title="Receipts" id="receipts">
        {latestIsRecent && latest.lots.length > 0 && (
          <Notice tone="warning" title={`${latest.r.ref}: ${latest.lots.length} lot(s) created — awaiting inspection, NOT yet usable`}>
            {latest.lots.map(({ lot }, i) => (
              <span key={lot.id}>
                {i > 0 && ", "}
                {seeLots ? (
                  <Link href={`/materials/lots/${lot.id}`} className="link font-semibold">
                    {lot.lotNo}
                  </Link>
                ) : (
                  lot.lotNo
                )}{" "}
                (heat {lot.heatNumber})
              </span>
            ))}
            . Upload and verify certificates, inspect and release each lot before it can be allocated to a job.
          </Notice>
        )}
        <StageLegend compact />
        {receipts.length === 0 ? (
          <p className="text-[13px] text-steel">Nothing received against this order yet.</p>
        ) : (
          <div className="space-y-4">
            {receipts.map(({ r, receivedBy, deliveryNote, lots }) => (
              <div key={r.id}>
                <p className="mb-1 text-[13px]">
                  <span className="plate">{r.ref}</span> · received {fmtDateTime(r.receivedAt)} by {receivedBy ?? "—"}
                  {r.deliveryNoteNo && <> · delivery note {r.deliveryNoteNo}</>}
                  {deliveryNote && (
                    <>
                      {" "}
                      ·{" "}
                      <a href={`/api/files/${deliveryNote.id}`} className="link">
                        {deliveryNote.originalName}
                      </a>
                    </>
                  )}
                  {r.notes && <span className="text-steel"> · {r.notes}</span>}
                </p>
                <Table head={["Lot", "Heat / cast", "Quantity", "Certificate", "BoxHero stock-in", "Lot status"]}>
                  {lots.map(({ lot, sync }) => (
                    <tr key={lot.id}>
                      <td>
                        {seeLots ? (
                          <Ref href={`/materials/lots/${lot.id}`} size="sm">
                            {lot.lotNo}
                          </Ref>
                        ) : (
                          <Ref size="sm">{lot.lotNo}</Ref>
                        )}
                      </td>
                      <td className="plate text-[13px]">{lot.heatNumber}</td>
                      <td className="whitespace-nowrap">{fmtQty(lot.qtyReceived, lot.uom)}</td>
                      <td>
                        <StatusBadge map={CERT_STATUS} status={lot.certificateStatus} />
                      </td>
                      <td>
                        <SyncCell sync={sync} />
                      </td>
                      <td>
                        <StatusBadge map={LOT_STATUS} status={lot.status} />
                      </td>
                    </tr>
                  ))}
                </Table>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
