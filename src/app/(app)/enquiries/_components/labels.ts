export const RECEIVED_VIA_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "portal", label: "Customer portal" },
  { value: "in_person", label: "In person" },
  { value: "other", label: "Other" },
];

export const receivedViaLabel = (v: string | null | undefined) => RECEIVED_VIA_OPTIONS.find((o) => o.value === v)?.label ?? v ?? "—";

export const ATTACHMENT_KIND_OPTIONS = [
  { value: "drawing", label: "Drawing (PDF)" },
  { value: "cad", label: "CAD model" },
  { value: "step", label: "STEP model" },
  { value: "dxf", label: "DXF profile" },
  { value: "specification", label: "Specification" },
  { value: "spreadsheet", label: "Spreadsheet / schedule" },
  { value: "photo", label: "Photo" },
  { value: "email", label: "Email" },
  { value: "other", label: "Other" },
];

export const attachmentKindLabel = (v: string) => ATTACHMENT_KIND_OPTIONS.find((o) => o.value === v)?.label ?? v;

/** Kinds that can be registered as controlled drawings. */
export const DRAWING_KINDS = ["drawing", "cad", "step", "dxf"];

/**
 * Manual status moves the enquiry service accepts (mirrors TRANSITIONS in
 * src/server/services/enquiries.ts; the service is the authority and rejects anything else).
 */
export const ENQUIRY_NEXT: Record<string, string[]> = {
  new: ["under_review", "quoting", "no_quote", "cancelled"],
  under_review: ["quoting", "no_quote", "cancelled", "new"],
  quoting: ["quoted", "no_quote", "cancelled", "under_review"],
  quoted: ["won", "lost", "quoting", "cancelled"],
  won: [],
  lost: ["quoting"],
  no_quote: ["under_review"],
  cancelled: [],
};

export const REASON_REQUIRED = ["lost", "no_quote", "cancelled"];
export const OPEN_ENQUIRY = ["new", "under_review", "quoting", "quoted"];
