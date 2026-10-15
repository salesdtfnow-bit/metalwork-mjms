"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/server/action";
import { f } from "@/server/forms";
import { invalid } from "@/server/errors";
import {
  addProgramRevision,
  approveProgramRevision,
  createProgram,
  recordProgramVerification,
  rejectProgramRevision,
  releaseProgramRevision,
  submitProgramRevision,
} from "@/server/services/programs";

const revisionFields = {
  revision: f.str("Revision is required."),
  changeDescription: f.str("Describe the change."),
  drawingRevisionId: f.optUuid(),
  setupSheetRevisionId: f.optUuid(),
  file: z.instanceof(File, { message: "Attach the program file." }),
};

export const createProgramAction = action(
  "program.create",
  z.object({
    programNumber: f.optStr(),
    name: f.str("Program name is required."),
    partId: f.optUuid(),
    jobId: f.optUuid(),
    operationTypeId: f.optUuid(),
    opNumber: f.optStr(),
    description: f.optStr(),
    machineIds: f.uuids(),
    ...revisionFields,
  }),
  async (ctx, i) => {
    const { revision, changeDescription, drawingRevisionId, setupSheetRevisionId, file, ...p } = i;
    if (!p.machineIds.length) throw invalid("Select at least one compatible machine.");
    const r = await createProgram(ctx, p, { revision, changeDescription, drawingRevisionId, setupSheetRevisionId }, file);
    redirect(`/programs/${r.program.id}`);
  },
);

export const addRevisionAction = action(
  "program.revision_add",
  z.object({ programId: f.uuid(), ...revisionFields }),
  async (ctx, { programId, file, ...rev }) => {
    const r = await addProgramRevision(ctx, programId, rev, file);
    return `Revision ${r.revision} added as a draft. The released revision stays in force until this one is approved and released.`;
  },
  { revalidate: (i) => [`/programs/${i.programId}`, "/programs"] },
);

const revRef = { programId: f.uuid(), revisionId: f.uuid() };
const paths = (i: { programId: string }) => [`/programs/${i.programId}`, "/programs"];

export const submitRevisionAction = action(
  "program.revision_submit",
  z.object(revRef),
  async (ctx, i) => {
    await submitProgramRevision(ctx, i.revisionId);
    return "Revision submitted for approval. Approvers have been notified.";
  },
  { revalidate: paths },
);

export const verificationAction = action(
  "program.verification",
  z.object({ ...revRef, status: f.enumOf(["not_required", "simulated", "proved_out", "failed"] as const), notes: f.optStr() }),
  async (ctx, i) => {
    await recordProgramVerification(ctx, i.revisionId, i.status, i.notes);
    return "Verification recorded.";
  },
  { revalidate: paths },
);

export const approveRevisionAction = action(
  "program.revision_approve",
  z.object({ ...revRef, password: f.str("Enter your password to sign."), comment: f.optStr() }),
  async (ctx, i) => {
    await approveProgramRevision(ctx, i.revisionId, { password: i.password, comment: i.comment });
    return "Revision approved (signed). It can now be released to production.";
  },
  { revalidate: paths },
);

export const releaseRevisionAction = action(
  "program.revision_release",
  z.object({ ...revRef, password: f.str("Enter your password to sign."), comment: f.optStr() }),
  async (ctx, i) => {
    const r = await releaseProgramRevision(ctx, i.revisionId, { password: i.password, comment: i.comment });
    return r.flagged
      ? `Revision released (signed). ${r.flagged} open operation(s) that used the previous revision have been flagged for review.`
      : "Revision released (signed). It is now the only revision operators can use.";
  },
  { revalidate: paths },
);

export const rejectRevisionAction = action(
  "program.revision_reject",
  z.object({ ...revRef, reason: f.str("Give a reason for rejecting.") }),
  async (ctx, i) => {
    await rejectProgramRevision(ctx, i.revisionId, i.reason);
    return "Revision rejected.";
  },
  { revalidate: paths },
);
