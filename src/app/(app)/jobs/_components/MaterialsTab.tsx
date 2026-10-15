import Link from "next/link";
import { availableLots, jobMaterialStatus, listMaterialSpecs } from "@/server/services/materials";
import { jobRoute } from "@/server/services/routing";
import { userNames } from "@/server/services/ui/jobs";
import { can, canAny } from "@/server/context";
import { d } from "@/lib/decimal";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/format";
import { LOT_STATUS, SYNC_STATUS } from "@/lib/status";
import { Notice, Section, StatusBadge, Table } from "@/components/ui";
import { ActionForm, Disclosure, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { allocateLotAction, materialEventAction, requestMaterialAction } from "../actions";
import { MATERIAL_KIND, PO_LINE_STATUS } from "./maps";
import { TERMINAL_JOB, type TabProps } from "./types";

const Tick = ({ on, children }: { on: boolean; children?: React.ReactNode }) =>
  on ? (
    <span className="text-green">
      <span aria-hidden>✓</span>
      {children ? <span className="ml-1 tabular-nums">{children}</span> : <span className="sr-only">Yes</span>}
    </span>
  ) : (
    <span className="text-steel-2">
      <span aria-hidden>—</span>
      <span className="sr-only">None</span>
    </span>
  );

export async function MaterialsTab({ ctx, data }: TabProps) {
  const { job: j, lines } = data;
  const open = !TERMINAL_JOB.includes(j.status);
  const canRequest = can(ctx.actor, "purchasing.manage") && open;
  const canAllocate = can(ctx.actor, "materials.allocate") && open;
  const canIssue = can(ctx.actor, "materials.issue") && open;
  const canScrap = can(ctx.actor, "materials.adjust") && open;
  const canMove = canIssue || canScrap;
  const [status, lots, specs, route] = await Promise.all([
    jobMaterialStatus(ctx, j.id),
    canAllocate ? availableLots(ctx) : Promise.resolve([]),
    canRequest ? listMaterialSpecs(ctx) : Promise.resolve([]),
    canMove ? jobRoute(ctx, j.id) : Promise.resolve([]),
  ]);
  const names = await userNames(ctx, status.transactions.map((t) => t.t.performedBy));
  const lineLabel = (id: string | null) => {
    const l = lines.find((x) => x.line.id === id)?.line;
    return l ? `Line ${l.lineNo} (${l.partNumber})` : "—";
  };
  const lineOptions = lines.map(({ line: l }) => ({ value: l.id, label: `Line ${l.lineNo} — ${l.partNumber}` }));
  const allocatedLots = status.lots.filter((x) => d(x.stages.allocated).greaterThan(0));
  const kinds = [
    ...(canIssue
      ? [
          { value: "issue", label: "Issue to production (BoxHero stock out)" },
          { value: "consume", label: "Consume (used in parts)" },
          { value: "remnant", label: "Remnant / offcut kept" },
          { value: "return", label: "Return unused to stores (BoxHero stock in)" },
        ]
      : []),
    ...(canScrap ? [{ value: "scrap", label: "Scrap" }] : []),
  ];

  return (
    <>
      <Section title="Material ordered for this job">
        <Table head={["Purchase order", "Supplier", "Line", "Material", "Ordered", "Received", "Required", "Status"]} empty="No purchase order lines are linked to this job.">
          {status.ordered.map(({ l, po, supplier }) => (
            <tr key={l.id}>
              <td className="whitespace-nowrap">
                {can(ctx.actor, "purchasing.view") ? (
                  <Link href={`/purchasing/${po.id}`} className="plate text-[13px] text-dykem hover:underline">
                    {po.ref}
                  </Link>
                ) : (
                  <span className="plate text-[13px]">{po.ref}</span>
                )}
              </td>
              <td>{supplier}</td>
              <td className="tabular-nums">{l.lineNo}</td>
              <td>
                {l.description}
                {l.dimensions && <div className="text-[12px] text-steel">{l.dimensions}</div>}
              </td>
              <td className="whitespace-nowrap tabular-nums">{fmtQty(l.quantity, l.uom)}</td>
              <td className="whitespace-nowrap tabular-nums">{fmtQty(l.qtyReceived, l.uom)}</td>
              <td className="whitespace-nowrap">{fmtDate(l.requiredDate ?? po.requiredDate)}</td>
              <td>
                <StatusBadge map={PO_LINE_STATUS} status={l.status} />
              </td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Material lots — lifecycle">
        <p className="mb-2 text-[12.5px] text-steel">Each stage is a separate recorded step. Quantities are in the lot&apos;s unit of measure; &quot;Remaining at job&quot; = issued − consumed − remnant − scrapped.</p>
        <Table
          head={["Lot", "Heat", "Status", "Received", "In BoxHero", "Released", "Allocated", "Issued", "Consumed", "Remnant", "Returned", "Scrapped", "Remaining at job"]}
          empty="No material lots received or allocated for this job yet."
        >
          {status.lots.map(({ lot, stages: s }) => {
            const pos = (v: string) => d(v).greaterThan(0);
            return (
              <tr key={lot.id}>
                <td className="whitespace-nowrap">
                  <Link href={`/materials/lots/${lot.id}`} className="plate text-[13px] text-dykem hover:underline">
                    {lot.lotNo}
                  </Link>
                  {lot.dimensions && <div className="text-[12px] text-steel">{lot.dimensions}</div>}
                </td>
                <td className="whitespace-nowrap font-mono text-[12.5px]">{lot.heatNumber}</td>
                <td>
                  <StatusBadge map={LOT_STATUS} status={lot.status} />
                </td>
                <td className="whitespace-nowrap">
                  <Tick on={pos(s.received)}>{fmtQty(s.received, lot.uom)}</Tick>
                </td>
                <td className="whitespace-nowrap">{s.recordedInBoxhero === "yes" ? <Tick on /> : s.recordedInBoxhero === "not tracked" ? <span className="text-[12px] text-steel">Not tracked</span> : <StatusBadge map={SYNC_STATUS} status={s.recordedInBoxhero} />}</td>
                <td>
                  <Tick on={s.released} />
                </td>
                {(["allocated", "issued", "consumed", "remnant", "returned", "scrapped"] as const).map((k) => (
                  <td key={k} className="whitespace-nowrap">
                    <Tick on={pos(s[k])}>{fmtQty(s[k])}</Tick>
                  </td>
                ))}
                <td className="whitespace-nowrap font-semibold tabular-nums">{d(s.remainingAtJob).isZero() ? <span className="font-normal text-steel">0</span> : fmtQty(s.remainingAtJob, lot.uom)}</td>
              </tr>
            );
          })}
        </Table>
      </Section>

      {(canRequest || canAllocate || canMove) && (
        <div className="mb-6 flex flex-wrap items-start gap-2">
          {canRequest && (
            <Disclosure label="Request material">
              {!j.authorisedAt ? (
                <Notice tone="warning">Material cannot be requested until the job is authorised.</Notice>
              ) : (
                <ActionForm action={requestMaterialAction} submitLabel="Raise request" resetOnSuccess>
                  <input type="hidden" name="jobId" value={j.id} />
                  <FormGrid cols={3}>
                    <SelectField label="Job line" name="jobLineId" placeholder="Whole job" options={lineOptions} />
                    <SelectField label="Material specification" name="materialSpecId" placeholder="Not specified" options={specs.map((s) => ({ value: s.id, label: `${s.code} — ${s.grade}${s.form ? ` ${s.form}` : ""}` }))} />
                    <TextField label="Required date" name="requiredDate" type="date" defaultValue={j.requiredDate} />
                    <TextField label="Description" name="description" required className="sm:col-span-3" placeholder="e.g. 6082-T6 round bar" defaultValue={j.materialRequirements} />
                    <TextField label="Dimensions" name="dimensions" placeholder="e.g. Ø50 × 3000" />
                    <TextField label="Quantity" name="quantity" required inputMode="decimal" />
                    <TextField label="Unit" name="uom" defaultValue="pcs" />
                  </FormGrid>
                  <TextArea label="Notes for purchasing" name="notes" rows={2} />
                </ActionForm>
              )}
            </Disclosure>
          )}
          {canAllocate && (
            <Disclosure label="Allocate lot">
              {lots.length ? (
                <ActionForm action={allocateLotAction} submitLabel="Allocate" resetOnSuccess>
                  <input type="hidden" name="jobId" value={j.id} />
                  <SelectField
                    label="Released lot"
                    name="lotId"
                    required
                    placeholder="Select lot"
                    options={lots.map((l) => ({ value: l.lot.id, label: `${l.lot.lotNo} — ${l.spec ?? "no spec"}, heat ${l.lot.heatNumber}${l.lot.dimensions ? `, ${l.lot.dimensions}` : ""} — ${fmtQty(l.free, l.lot.uom)} free` }))}
                    hint="Only released lots with unallocated quantity are listed."
                  />
                  <FormGrid cols={2}>
                    <SelectField label="Job line" name="jobLineId" placeholder="Whole job" options={lineOptions} />
                    <TextField label="Quantity" name="quantity" required inputMode="decimal" />
                  </FormGrid>
                </ActionForm>
              ) : (
                <p className="text-[13px] text-steel">No released lots with free quantity are available.</p>
              )}
            </Disclosure>
          )}
          {canMove && (
            <Disclosure label="Issue, consume, return or scrap">
              {allocatedLots.length ? (
                <ActionForm action={materialEventAction} submitLabel="Record movement" resetOnSuccess>
                  <input type="hidden" name="jobId" value={j.id} />
                  <SelectField
                    label="Allocated lot"
                    name="lotId"
                    required
                    placeholder="Select lot"
                    options={allocatedLots.map(({ lot, stages: s }) => ({ value: lot.id, label: `${lot.lotNo} (heat ${lot.heatNumber}) — allocated ${fmtQty(s.allocated)}, issued ${fmtQty(s.issued)}, at job ${fmtQty(s.remainingAtJob)} ${lot.uom}` }))}
                  />
                  <FormGrid cols={2}>
                    <SelectField label="Movement" name="kind" required defaultValue={kinds[0]?.value} options={kinds} />
                    <TextField label="Quantity" name="quantity" required inputMode="decimal" />
                    <SelectField
                      label="Operation"
                      name="operationId"
                      placeholder="Not linked to an operation"
                      options={route.filter((r) => r.op.status !== "cancelled").map((r) => ({ value: r.op.id, label: `${lineLabel(r.op.jobLineId)} op ${r.op.opNumber} — ${r.op.title}` }))}
                    />
                  </FormGrid>
                  <TextArea label="Reason" name="reason" rows={2} hint="Required for returns and scrap." />
                </ActionForm>
              ) : (
                <p className="text-[13px] text-steel">Allocate a released lot to this job before issuing material.</p>
              )}
            </Disclosure>
          )}
        </div>
      )}

      <Section title="Material transactions">
        <Table head={["Ref", "Movement", "Lot", "Quantity", "Line / op", "Reason", "By", "When", "BoxHero"]} empty="No material movements recorded for this job.">
          {[...status.transactions]
            .sort((a, b) => +new Date(b.t.performedAt) - +new Date(a.t.performedAt))
            .map(({ t, lot, sync }) => (
              <tr key={t.id}>
                <td className="plate whitespace-nowrap text-[13px]">{t.ref}</td>
                <td>{MATERIAL_KIND[t.kind] ?? t.kind}</td>
                <td className="whitespace-nowrap">
                  <Link href={`/materials/lots/${lot.id}`} className="link">
                    {lot.lotNo}
                  </Link>
                </td>
                <td className="whitespace-nowrap tabular-nums">{fmtQty(t.quantity, t.uom)}</td>
                <td className="whitespace-nowrap text-[12.5px]">{t.jobLineId ? lineLabel(t.jobLineId) : "—"}</td>
                <td className="max-w-[240px] text-steel">{t.reason ?? ""}</td>
                <td className="whitespace-nowrap">{names.get(t.performedBy) ?? "—"}</td>
                <td className="whitespace-nowrap text-steel">{fmtDateTime(t.performedAt)}</td>
                <td>{sync ? <StatusBadge map={SYNC_STATUS} status={sync.status} /> : <span className="text-[12px] text-steel">{["issue", "return", "adjust"].includes(t.kind) ? "Not tracked" : "No stock movement"}</span>}</td>
              </tr>
            ))}
        </Table>
        {canAny(ctx.actor, "boxhero.reconcile") && status.transactions.some((x) => x.sync && ["failed", "needs_reconciliation"].includes(x.sync.status)) && (
          <p className="mt-2 text-[12.5px] text-red">
            Some BoxHero movements failed. Resolve them on the{" "}
            <Link href="/materials" className="link">
              Materials &amp; BoxHero
            </Link>{" "}
            page.
          </p>
        )}
      </Section>
    </>
  );
}
