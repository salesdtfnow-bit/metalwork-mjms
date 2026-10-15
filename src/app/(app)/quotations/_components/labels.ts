export const TAX_OPTIONS = [
  { value: "standard", label: "Standard rate" },
  { value: "zero", label: "Zero rated" },
  { value: "exempt", label: "Exempt" },
  { value: "reverse_charge", label: "Reverse charge" },
];

export const taxLabel = (v: string) => TAX_OPTIONS.find((o) => o.value === v)?.label ?? v;

/** Cost input fields stored on a quotation line, with display labels. */
export const LINE_COST_FIELDS = [
  ["materialCostPerUnit", "Material cost per unit"],
  ["materialWastagePct", "Material wastage %"],
  ["programmingCost", "Programming"],
  ["setupCostPerBatch", "Setup per batch"],
  ["labourCost", "Labour (other)"],
  ["toolingCost", "Tooling"],
  ["consumablesCost", "Consumables"],
  ["subcontractCost", "Subcontract"],
  ["finishingCost", "Finishing"],
  ["inspectionCost", "Inspection"],
  ["certificationCost", "Certification"],
  ["packagingCost", "Packaging"],
  ["deliveryCost", "Delivery"],
  ["otherCost", "Other"],
] as const;
