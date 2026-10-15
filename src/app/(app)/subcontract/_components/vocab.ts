export const PROCESSES = [
  { value: "heat_treatment", label: "Heat treatment" },
  { value: "plating", label: "Plating" },
  { value: "anodising", label: "Anodising" },
  { value: "grinding", label: "Grinding" },
  { value: "machining", label: "Machining" },
  { value: "painting", label: "Painting" },
  { value: "other", label: "Other" },
];
export const processLabel = (p: string) => PROCESSES.find((x) => x.value === p)?.label ?? p;
