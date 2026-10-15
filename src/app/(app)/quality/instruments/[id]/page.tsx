import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { AppError } from "@/server/errors";
import { getInstrument } from "@/server/services/inspections";
import { characteristicNames, qualityHistory, supplierNames, supplierOptions } from "@/server/services/ui/quality";
import { fmtDate, fmtDateTime, todayISO } from "@/lib/format";
import { trimQty } from "@/lib/decimal";
import { INSPECTION_STATUS } from "@/lib/status";
import { Badge, KeyValues, Notice, Ref, Section, StatusBadge, Table, TitleBlock } from "@/components/ui";
import { ActionForm, CheckboxField, Disclosure, FileField, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { AuditList } from "@/components/AuditList";
import { ResultBadge } from "../../_components/ResultsGrid";
import { InstrumentFields } from "../../_components/InstrumentFields";
import { INSTRUMENT_STATUS, INSTRUMENT_TYPES } from "../../_components/labels";
import { recordCalibrationAction, reviewFlaggedResultAction, saveInstrumentAction, setInstrumentStatusAction } from "../../actions";

export default async function InstrumentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageCtx("quality.view", "quality.instruments");
  const { id } = await params;
  const data = await getInstrument(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const { instrument: i, validity, records, flagged } = data;
  const manage = can(ctx.actor, "quality.instruments");
  const [providers, provNames, charNames, history] = await Promise.all([
    manage ? supplierOptions(ctx, "calibration") : Promise.resolve([]),
    supplierNames(ctx, records.map((r) => r.providerId)),
    characteristicNames(ctx, flagged.map((f) => f.r.characteristicId)),
    qualityHistory(ctx, "instrument", id),
  ]);
  const today = todayISO();
  const overdue = i.calibrationRequired && (!i.calibrationDueOn || i.calibrationDueOn < today);
  const underReview = flagged.filter((f) => f.r.underReview);

  return (
    <>
      <TitleBlock
        kind="Measuring instrument"
        refNo={i.assetNo}
        title={i.description}
        status={
          <>
            <StatusBadge map={INSTRUMENT_STATUS} status={i.status} />
            {validity.ok ? <Badge tone="success">Valid for inspection</Badge> : <Badge tone="danger">Not usable: {validity.reason}</Badge>}
          </>
        }
        cells={[
          { label: "Type", value: INSTRUMENT_TYPES.find((t) => t.value === i.instrumentType)?.label ?? i.instrumentType },
          { label: "Location", value: i.location },
          { label: "Last calibrated", value: fmtDate(i.lastCalibratedOn) },
          { label: "Calibration due", value: i.calibrationRequired ? <span className={overdue ? "text-red" : undefined}>{fmtDate(i.calibrationDueOn)}{overdue ? " (overdue)" : ""}</span> : "Not required" },
          { label: "Interval", value: `${i.calibrationIntervalDays} days` },
          { label: "Results under review", value: underReview.length },
        ]}
      />

      {underReview.length > 0 && (
        <Notice tone="danger" title={`${underReview.length} result(s) under review`}>
          This instrument was found out of tolerance at calibration. Results measured with it since its last good calibration must be reviewed below.
        </Notice>
      )}

      <Section title="Details">
        <KeyValues
          items={[
            { label: "Manufacturer", value: i.manufacturer },
            { label: "Serial number", value: i.serialNumber },
            { label: "Range", value: i.range },
            { label: "Resolution", value: i.resolution },
            { label: "Calibration required", value: i.calibrationRequired ? "Yes" : "No" },
            { label: "Notes", value: i.notes, wide: true },
          ]}
        />
        {manage && (
          <div className="mt-3 flex flex-wrap gap-3">
            <Disclosure label="Edit details">
              <ActionForm action={saveInstrumentAction} submitLabel="Save changes">
                <InstrumentFields i={i} />
              </ActionForm>
            </Disclosure>
            <Disclosure label="Change status">
              <ActionForm action={setInstrumentStatusAction} submitLabel="Change status" confirm="Changing the status affects whether the instrument can be selected for inspection results.">
                <input type="hidden" name="id" value={i.id} />
                <FormGrid>
                  <SelectField label="New status" name="status" required defaultValue={i.status} options={Object.entries(INSTRUMENT_STATUS).map(([value, s]) => ({ value, label: s.label }))} />
                  <TextField label="Reason" name="reason" required placeholder="e.g. Dropped — sent for checking" />
                </FormGrid>
              </ActionForm>
            </Disclosure>
          </div>
        )}
      </Section>

      <Section title="Calibration records">
        <Table head={["Calibrated", "Due", "Result", "As found", "Certificate", "Provider", "Performed by", "Certificate file", "Notes"]} empty="No calibration recorded yet.">
          {records.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap">{fmtDate(r.calibratedOn)}</td>
              <td className="whitespace-nowrap">{fmtDate(r.dueOn)}</td>
              <td>{r.result === "pass" ? <Badge tone="success">Pass</Badge> : r.result === "adjusted" ? <Badge tone="info">Adjusted</Badge> : <Badge tone="danger">Fail</Badge>}</td>
              <td>{r.asFoundInTolerance ? "In tolerance" : <Badge tone="danger">Out of tolerance</Badge>}</td>
              <td className="plate">{r.certificateNo ?? "—"}</td>
              <td>{(r.providerId && provNames[r.providerId]) ?? "—"}</td>
              <td>{r.performedBy ?? "—"}</td>
              <td>{r.fileId ? <a href={`/api/files/${r.fileId}`} className="link">View certificate</a> : "—"}</td>
              <td className="max-w-[260px] whitespace-pre-wrap text-steel">{r.notes ?? ""}</td>
            </tr>
          ))}
        </Table>
        {manage && (
          <div className="mt-3">
            <Disclosure label="Record calibration" defaultOpen={records.length === 0}>
              <ActionForm action={recordCalibrationAction} submitLabel="Record calibration" resetOnSuccess>
                <input type="hidden" name="instrumentId" value={i.id} />
                <FormGrid cols={3}>
                  <TextField label="Calibrated on" name="calibratedOn" type="date" required defaultValue={today} />
                  <SelectField
                    label="Result"
                    name="result"
                    required
                    placeholder="Select…"
                    options={[
                      { value: "pass", label: "Pass — within specification" },
                      { value: "adjusted", label: "Adjusted — now within specification" },
                      { value: "fail", label: "Fail — instrument out of calibration" },
                    ]}
                  />
                  <TextField label="Next due (optional)" name="dueOn" type="date" hint={`Defaults to calibration date + ${i.calibrationIntervalDays} days`} />
                  <TextField label="Certificate number" name="certificateNo" />
                  <SelectField label="Provider" name="providerId" placeholder={providers.length ? "In-house / not listed" : "No calibration suppliers on file"} options={providers.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} />
                  <TextField label="Performed by" name="performedBy" placeholder="Technician name" />
                </FormGrid>
                <CheckboxField
                  label="As found: in tolerance (before any adjustment)"
                  name="asFoundInTolerance"
                  defaultChecked
                  hint="Untick this if the instrument was found out of tolerance. Every inspection result measured with it since its last good calibration will be flagged for review."
                />
                <FileField label="Calibration certificate" name="file" accept=".pdf,image/*" />
                <TextArea label="Notes" name="notes" rows={2} />
              </ActionForm>
            </Disclosure>
          </div>
        )}
      </Section>

      <Section title="Flagged results">
        <Table head={["Inspection", "Characteristic", "Sample", "Value", "Result", "Recorded", "Review"]} empty="No results have been flagged for this instrument.">
          {flagged.map(({ r, insp }) => (
            <tr key={r.id} className={r.underReview ? "bg-amber-50/50" : undefined}>
              <td>
                <Ref href={`/quality/inspections/${insp.id}`} size="sm">{insp.ref}</Ref> <StatusBadge map={INSPECTION_STATUS} status={insp.status} />
              </td>
              <td>{(r.characteristicId && charNames[r.characteristicId]) ?? "Ad-hoc"}</td>
              <td className="plate">{r.sampleNo}</td>
              <td className="plate">{r.measuredValue ? trimQty(r.measuredValue) : r.attributeResult ?? "—"}</td>
              <td><ResultBadge result={r.result} /></td>
              <td className="whitespace-nowrap text-steel">{fmtDateTime(r.recordedAt)}</td>
              <td className="min-w-[280px]">
                {r.underReview ? (
                  manage ? (
                    <ActionForm action={reviewFlaggedResultAction} submitLabel="Record review" submitSize="sm" inline>
                      <input type="hidden" name="instrumentId" value={i.id} />
                      <input type="hidden" name="resultId" value={r.id} />
                      <input name="outcome" required placeholder="e.g. Re-measured with MIC-020 — conforms" className="field-input min-w-[220px] flex-1 py-1 text-[12.5px]" aria-label="Review outcome" />
                    </ActionForm>
                  ) : (
                    <Badge tone="hold">Under review</Badge>
                  )
                ) : (
                  <span className="text-[12.5px]">{r.reviewOutcome}</span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="History">
        <AuditList events={history} />
      </Section>
    </>
  );
}
