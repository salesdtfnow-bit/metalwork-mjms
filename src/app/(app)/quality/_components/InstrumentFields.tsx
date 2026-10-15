import { CheckboxField, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { INSTRUMENT_TYPES } from "./labels";

type Inst = Partial<{
  id: string;
  assetNo: string;
  description: string;
  instrumentType: string;
  manufacturer: string | null;
  serialNumber: string | null;
  range: string | null;
  resolution: string | null;
  location: string | null;
  calibrationRequired: boolean;
  calibrationIntervalDays: number;
  notes: string | null;
}>;

/** Instrument register fields (used inside an ActionForm bound to saveInstrumentAction). */
export function InstrumentFields({ i = {} }: { i?: Inst }) {
  return (
    <>
      {i.id && <input type="hidden" name="id" value={i.id} />}
      <FormGrid cols={3}>
        <TextField label="Asset number" name="assetNo" required defaultValue={i.assetNo} hint="Etched / labelled ID, e.g. MIC-014" />
        <TextField label="Description" name="description" required defaultValue={i.description} className="sm:col-span-2" placeholder="e.g. Outside micrometer 25–50 mm" />
        <SelectField label="Type" name="instrumentType" required placeholder="Select…" options={INSTRUMENT_TYPES} defaultValue={i.instrumentType} />
        <TextField label="Manufacturer" name="manufacturer" defaultValue={i.manufacturer} />
        <TextField label="Serial number" name="serialNumber" defaultValue={i.serialNumber} />
        <TextField label="Range" name="range" defaultValue={i.range} placeholder="e.g. 25–50 mm" />
        <TextField label="Resolution" name="resolution" defaultValue={i.resolution} placeholder="e.g. 0.001 mm" />
        <TextField label="Location" name="location" defaultValue={i.location} placeholder="e.g. QC room, cabinet 2" />
        <TextField label="Calibration interval (days)" name="calibrationIntervalDays" required inputMode="numeric" defaultValue={i.calibrationIntervalDays ?? 365} />
      </FormGrid>
      <CheckboxField label="Calibration required" name="calibrationRequired" defaultChecked={i.calibrationRequired ?? true} hint="Instruments needing calibration cannot be used for inspection once the due date passes." />
      <TextArea label="Notes" name="notes" rows={2} defaultValue={i.notes} />
    </>
  );
}
