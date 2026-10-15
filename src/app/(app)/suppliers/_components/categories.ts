export const CATEGORY_OPTIONS = [
  { value: "material", label: "Material" },
  { value: "subcontract", label: "Subcontract" },
  { value: "tooling", label: "Tooling" },
  { value: "calibration", label: "Calibration" },
  { value: "maintenance", label: "Maintenance" },
  { value: "carrier", label: "Carrier" },
  { value: "other", label: "Other" },
];

export const categoryLabel = (v: string) => CATEGORY_OPTIONS.find((o) => o.value === v)?.label ?? v;
