"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/server/action";
import { f } from "@/server/forms";
import { invalid } from "@/server/errors";
import { fromLocalInput } from "./_components/time";

function receivedAtOf(v: string | null): Date | undefined {
  if (!v) return undefined;
  const d = fromLocalInput(v);
  if (!d) throw invalid("Enter a valid date and time.", { field: "receivedAt" });
  return d;
}
import {
  addEnquiryAttachments,
  addEnquiryLine,
  createEnquiry,
  createEnquiryFromEmail,
  ignoreEmail,
  importEmlUpload,
  linkEmailToEnquiry,
  registerAttachmentAsDocument,
  setEnquiryStatus,
  updateEnquiry,
} from "@/server/services/enquiries";

const RECEIVED_VIA = ["email", "phone", "portal", "in_person", "other"] as const;

const enquiryFields = {
  subject: f.str("Subject is required."),
  description: f.optStr(),
  receivedAt: f.optStr(),
  receivedVia: f.enumOf(RECEIVED_VIA),
  customerReference: f.optStr(),
  requestedDeliveryDate: f.optDate(),
  ownerId: f.optUuid(),
};

export const createEnquiryAction = action(
  "enquiry.create",
  z.object({
    customerId: f.uuid("Select a customer."),
    contactId: f.optUuid(),
    ...enquiryFields,
    files: f.files(),
    line_part: f.strs(),
    line_desc: f.strs(),
    line_qty: f.strs(),
    line_drg: f.strs(),
    line_rev: f.strs(),
    line_mat: f.strs(),
  }),
  async (ctx, i) => {
    const lines = i.line_part
      .map((p, n) => ({
        partNumber: p.trim(),
        description: (i.line_desc[n] ?? "").trim() || p.trim(),
        quantity: (i.line_qty[n] ?? "").trim().replace(/,/g, ""),
        drawingNumber: i.line_drg[n]?.trim() || null,
        drawingRevision: i.line_rev[n]?.trim() || null,
        materialGrade: i.line_mat[n]?.trim() || null,
      }))
      .filter((l) => l.partNumber);
    lines.forEach((l, n) => {
      if (!/^\d+(\.\d+)?$/.test(l.quantity)) throw invalid(`Initial line ${n + 1} (${l.partNumber}): enter a quantity.`);
    });
    const e = await createEnquiry(
      ctx,
      {
        customerId: i.customerId,
        contactId: i.contactId,
        subject: i.subject,
        description: i.description,
        receivedAt: receivedAtOf(i.receivedAt),
        receivedVia: i.receivedVia,
        customerReference: i.customerReference,
        requestedDeliveryDate: i.requestedDeliveryDate,
        ownerId: i.ownerId,
      },
      lines,
    );
    if (i.files.length) {
      // The enquiry exists at this point; if storing a file fails, open it and say so.
      const ok = await addEnquiryAttachments(ctx, e.id, i.files).then(
        () => true,
        () => false,
      );
      if (!ok) redirect(`/enquiries/${e.id}?tab=attachments&upload=failed`);
    }
    redirect(`/enquiries/${e.id}`);
  },
  { revalidate: "/enquiries" },
);

export const updateEnquiryAction = action(
  "enquiry.update",
  z.object({ id: f.uuid(), ...enquiryFields }),
  async (ctx, { id, receivedAt, ...rest }) => {
    await updateEnquiry(ctx, id, { ...rest, receivedAt: receivedAtOf(receivedAt) });
    return "Enquiry details saved.";
  },
  { revalidate: (i) => `/enquiries/${i.id}` },
);

export const addEnquiryLineAction = action(
  "enquiry.line_add",
  z.object({
    enquiryId: f.uuid(),
    partNumber: f.str("Part number is required."),
    description: f.str("Description is required."),
    quantity: f.dec({ msg: "Enter a quantity." }),
    drawingNumber: f.optStr(),
    drawingRevision: f.optStr(),
    materialGrade: f.optStr(),
    tolerances: f.optStr(),
    surfaceFinish: f.optStr(),
    specialRequirements: f.optStr(),
  }),
  async (ctx, { enquiryId, ...line }) => {
    await addEnquiryLine(ctx, enquiryId, line);
    return `Line ${line.partNumber} added.`;
  },
  { revalidate: (i) => `/enquiries/${i.enquiryId}` },
);

export const setEnquiryStatusAction = action(
  "enquiry.status",
  z.object({ id: f.uuid(), status: f.str("Choose the new status."), reason: f.optStr() }),
  async (ctx, { id, status, reason }) => {
    await setEnquiryStatus(ctx, id, status, reason);
    return "Enquiry status updated.";
  },
  { revalidate: (i) => [`/enquiries/${i.id}`, "/enquiries"] },
);

export const addAttachmentsAction = action(
  "enquiry.attachments",
  z.object({ enquiryId: f.uuid(), files: f.files(), kind: f.optStr(), note: f.optStr() }),
  async (ctx, { enquiryId, files, kind, note }) => {
    const out = await addEnquiryAttachments(ctx, enquiryId, files, { kind: kind ?? undefined, note });
    return out.length === 1 ? "File attached." : `${out.length} files attached.`;
  },
  { revalidate: (i) => `/enquiries/${i.enquiryId}` },
);

export const registerDrawingAction = action(
  "enquiry.register_document",
  z.object({
    enquiryId: f.uuid(),
    attachmentId: f.uuid(),
    docNumber: f.str("Document number is required."),
    title: f.str("Title is required."),
    revision: f.str("Revision is required."),
    partId: f.optUuid(),
  }),
  async (ctx, { attachmentId, docNumber, title, revision, partId }) => {
    const rev = await registerAttachmentAsDocument(ctx, attachmentId, { docNumber, title, revision, partId });
    return `Registered as controlled drawing ${docNumber} revision ${rev.revision} (draft). Review and release it in Documents before production use.`;
  },
  { revalidate: (i) => `/enquiries/${i.enquiryId}` },
);

// ───────────── Inbox ─────────────

export const importEmlAction = action(
  "email.import_eml",
  z.object({ file: z.instanceof(File, { message: "Choose an .eml file." }) }),
  async (ctx, { file }) => {
    const res = await importEmlUpload(ctx, file);
    return res.duplicate ? `This email was already imported ("${res.email.subject}").` : `Imported "${res.email.subject}".`;
  },
  { revalidate: "/enquiries/inbox" },
);

export const createEnquiryFromEmailAction = action(
  "email.create_enquiry",
  z.object({ emailId: f.uuid(), customerId: f.uuid("Select a customer."), subject: f.optStr() }),
  async (ctx, { emailId, customerId, subject }) => {
    const e = await createEnquiryFromEmail(ctx, emailId, { customerId, subject: subject ?? undefined });
    redirect(`/enquiries/${e.id}`);
  },
  { revalidate: "/enquiries/inbox" },
);

export const linkEmailAction = action(
  "email.link",
  z.object({ emailId: f.uuid(), enquiryId: f.uuid("Select an enquiry.") }),
  async (ctx, { emailId, enquiryId }) => {
    await linkEmailToEnquiry(ctx, emailId, enquiryId);
    return "Email linked. Its attachments were added to the enquiry.";
  },
  { revalidate: (i) => ["/enquiries/inbox", `/enquiries/inbox/${i.emailId}`, `/enquiries/${i.enquiryId}`] },
);

export const ignoreEmailAction = action(
  "email.ignore",
  z.object({ emailId: f.uuid(), reason: f.str("Give a reason.") }),
  async (ctx, { emailId, reason }) => {
    await ignoreEmail(ctx, emailId, reason);
    return "Email moved to Ignored.";
  },
  { revalidate: (i) => ["/enquiries/inbox", `/enquiries/inbox/${i.emailId}`] },
);
