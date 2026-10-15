"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/server/action";
import { f } from "@/server/forms";
import {
  addRevision,
  approveAndReleaseRevision,
  createDocument,
  DOC_TYPES,
  obsoleteRevision,
  reviewRevision,
  submitRevisionForReview,
} from "@/server/services/documents";

export const createDocumentAction = action(
  "document.create",
  z.object({
    docNumber: f.optStr(),
    title: f.str("Title is required."),
    docType: f.enumOf(DOC_TYPES),
    customerId: f.optUuid(),
    partId: f.optUuid(),
    machineId: f.optUuid(),
    supplierId: f.optUuid(),
    isCustomerSupplied: f.bool(),
    revision: f.str("Revision is required."),
    changeDescription: f.optStr(),
    file: z.instanceof(File, { message: "Attach the document file." }),
  }),
  async (ctx, { file, ...input }) => {
    const { doc } = await createDocument(ctx, input, file);
    redirect(`/documents/${doc.id}`);
  },
  { revalidate: "/documents" },
);

export const addRevisionAction = action(
  "document.revision_add",
  z.object({
    documentId: f.uuid(),
    revision: f.str("Revision is required."),
    changeDescription: f.str("Describe what changed in this revision."),
    file: z.instanceof(File, { message: "Attach the revision file." }),
  }),
  async (ctx, { documentId, file, ...input }) => {
    const rev = await addRevision(ctx, documentId, input, file);
    return `Draft revision ${rev.revision} added. Submit it for review when ready.`;
  },
  { revalidate: (i) => `/documents/${i.documentId}` },
);

export const submitRevisionAction = action(
  "document.revision_submit",
  z.object({ documentId: f.uuid(), revisionId: f.uuid() }),
  async (ctx, { revisionId }) => {
    await submitRevisionForReview(ctx, revisionId);
    return "Revision submitted for review.";
  },
  { revalidate: (i) => `/documents/${i.documentId}` },
);

export const reviewRevisionAction = action(
  "document.revision_review",
  z.object({ documentId: f.uuid(), revisionId: f.uuid(), outcome: f.enumOf(["reviewed", "rejected"] as const), comment: f.optStr() }),
  async (ctx, { revisionId, outcome, comment }) => {
    await reviewRevision(ctx, revisionId, outcome, comment);
    return outcome === "rejected" ? "Revision rejected." : "Review recorded. The revision can now be approved and released.";
  },
  { revalidate: (i) => `/documents/${i.documentId}` },
);

export const approveReleaseAction = action(
  "document.revision_release",
  z.object({ documentId: f.uuid(), revisionId: f.uuid(), password: f.str("Enter your password to sign."), effectiveDate: f.optDate(), comment: f.optStr() }),
  async (ctx, { revisionId, password, effectiveDate, comment }) => {
    const { impact } = await approveAndReleaseRevision(ctx, revisionId, { password, effectiveDate, comment });
    const flagged =
      impact.jobLines || impact.operations
        ? ` ${impact.jobLines} open job line(s) and ${impact.operations} operation(s) on ${impact.jobIds.length} job(s) using the previous revision have been flagged for review — they were not changed automatically.`
        : " No open jobs or operations referenced the previous revision.";
    return `Revision approved and released.${flagged}`;
  },
  { revalidate: (i) => `/documents/${i.documentId}` },
);

export const obsoleteRevisionAction = action(
  "document.revision_obsolete",
  z.object({ documentId: f.uuid(), revisionId: f.uuid(), reason: f.str("A reason is required.") }),
  async (ctx, { revisionId, reason }) => {
    await obsoleteRevision(ctx, revisionId, reason);
    return "Revision made obsolete.";
  },
  { revalidate: (i) => `/documents/${i.documentId}` },
);
