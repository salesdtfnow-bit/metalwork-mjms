import { ActionForm, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { saveSpecAction } from "../actions";
import { CERT_REQ_OPTIONS, FAMILY_OPTIONS, FORM_OPTIONS } from "./labels";

type Spec = {
  id: string;
  code: string;
  grade: string;
  standard: string | null;
  materialFamily: string | null;
  form: string;
  description: string | null;
  certRequirement: string;
  uom: string;
};

export function SpecForm({ spec, submitLabel }: { spec?: Spec; submitLabel: string }) {
  return (
    <ActionForm action={saveSpecAction} submitLabel={submitLabel} resetOnSuccess={!spec}>
      {spec && <input type="hidden" name="id" value={spec.id} />}
      <FormGrid cols={4}>
        <TextField label="Code" name="code" required defaultValue={spec?.code} hint="Unique, e.g. AL6082-T6-BAR" />
        <TextField label="Grade" name="grade" required defaultValue={spec?.grade} placeholder="e.g. 6082-T6, EN24T, 316L" />
        <TextField label="Standard" name="standard" defaultValue={spec?.standard} placeholder="e.g. BS EN 573-3" />
        <SelectField label="Material family" name="materialFamily" options={FAMILY_OPTIONS} defaultValue={spec?.materialFamily} placeholder="—" />
        <SelectField label="Form" name="form" required options={FORM_OPTIONS} defaultValue={spec?.form ?? "bar"} />
        <SelectField label="Certificate requirement" name="certRequirement" required options={CERT_REQ_OPTIONS} defaultValue={spec?.certRequirement ?? "3.1"} />
        <TextField label="Dimension unit" name="uom" defaultValue={spec?.uom ?? "mm"} />
      </FormGrid>
      <TextArea label="Description" name="description" rows={2} defaultValue={spec?.description} />
    </ActionForm>
  );
}
