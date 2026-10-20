import { and, arrayContains, eq, or } from "drizzle-orm";
import {
  aiExtractions,
  calibrationRecords,
  cncProgramRevisions,
  cncPrograms,
  customerOrders,
  dispatches,
  documentRevisions,
  employeeCompetencies,
  enquiryAttachments,
  fileAccessLog,
  files,
  finalReleases,
  inboundEmailAttachments,
  inboundEmails,
  inspectionEvidence,
  maintenanceWorkOrders,
  materialCertificates,
  materialReceipts,
  ncrFiles,
  partyFiles,
  quotationRevisions,
  subcontractFiles,
  trainingRecords,
  companySettings,
} from "../db/schema";
import { can, type Ctx } from "../context";
import type { Permission } from "../auth/permissions";
import { AppError, notFound } from "../errors";
import { canSeeUnreleased } from "./documents";

type Check = { permission: Permission | null; label: string; extra?: () => boolean; denyReason?: string };

/**
 * Decides whether the actor may read a stored file. A file is readable when the actor may
 * view at least one record that references it. Superseded/unreleased drawings and programs
 * additionally require elevated permissions, so operators cannot open obsolete revisions.
 */
export async function authorizeFileAccess(ctx: Ctx, fileId: string): Promise<{ file: typeof files.$inferSelect; context: string }> {
  const [file] = await ctx.db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!file) throw notFound("File");
  const checks: Check[] = [];
  const db = ctx.db;

  const docRevs = await db.select().from(documentRevisions).where(eq(documentRevisions.fileId, fileId));
  for (const r of docRevs) {
    checks.push({
      permission: "documents.view",
      label: `document_revision:${r.id}`,
      extra: () => r.status === "released" || canSeeUnreleased(ctx),
      denyReason: `This drawing/document revision is ${r.status.replace("_", " ")} and not released for use.`,
    });
  }
  const progRevs = await db
    .select({ r: cncProgramRevisions, p: cncPrograms })
    .from(cncProgramRevisions)
    .innerJoin(cncPrograms, eq(cncPrograms.id, cncProgramRevisions.programId))
    .where(eq(cncProgramRevisions.fileId, fileId));
  for (const { r, p } of progRevs) {
    checks.push({
      permission: "programs.view",
      label: `program_revision:${r.id}`,
      extra: () => (r.status === "released" && p.currentReleasedRevisionId === r.id) || can(ctx.actor, "programs.access_unreleased"),
      denyReason: `Program ${p.programNumber} revision ${r.revision} is ${r.status} — only the current released revision may be used.`,
    });
  }
  const simple: [Promise<unknown[]>, Permission, string][] = [
    [db.select({ id: enquiryAttachments.id }).from(enquiryAttachments).where(eq(enquiryAttachments.fileId, fileId)), "enquiries.view", "enquiry_attachment"],
    [db.select({ id: inboundEmailAttachments.id }).from(inboundEmailAttachments).where(eq(inboundEmailAttachments.fileId, fileId)), "email.import", "inbound_email_attachment"],
    [db.select({ id: inboundEmails.id }).from(inboundEmails).where(eq(inboundEmails.rawFileId, fileId)), "email.import", "inbound_email"],
    [
      db
        .select({ id: quotationRevisions.id })
        .from(quotationRevisions)
        .where(or(eq(quotationRevisions.pdfFileId, fileId), eq(quotationRevisions.acceptanceEvidenceFileId, fileId), eq(quotationRevisions.acceptanceConfirmationFileId, fileId))),
      "quotations.view",
      "quotation",
    ],
    [db.select({ id: customerOrders.id }).from(customerOrders).where(eq(customerOrders.poFileId, fileId)), "orders.view", "customer_order"],
    [db.select({ id: materialCertificates.id }).from(materialCertificates).where(eq(materialCertificates.fileId, fileId)), "materials.view", "material_certificate"],
    [db.select({ id: materialReceipts.id }).from(materialReceipts).where(eq(materialReceipts.deliveryNoteFileId, fileId)), "materials.view", "material_receipt"],
    [db.select({ id: inspectionEvidence.id }).from(inspectionEvidence).where(eq(inspectionEvidence.fileId, fileId)), "quality.view", "inspection_evidence"],
    [db.select({ id: ncrFiles.id }).from(ncrFiles).where(eq(ncrFiles.fileId, fileId)), "ncr.view", "ncr_file"],
    [db.select({ id: subcontractFiles.id }).from(subcontractFiles).where(eq(subcontractFiles.fileId, fileId)), "subcontract.view", "subcontract_file"],
    [
      db.select({ id: dispatches.id }).from(dispatches).where(or(eq(dispatches.proofOfDeliveryFileId, fileId), eq(dispatches.deliveryNoteFileId, fileId))),
      "dispatch.view",
      "dispatch",
    ],
    [db.select({ id: finalReleases.id }).from(finalReleases).where(eq(finalReleases.cocFileId, fileId)), "quality.view", "final_release"],
    [db.select({ id: finalReleases.id }).from(finalReleases).where(eq(finalReleases.cocFileId, fileId)), "dispatch.view", "final_release"],
    [db.select({ id: calibrationRecords.id }).from(calibrationRecords).where(eq(calibrationRecords.fileId, fileId)), "quality.view", "calibration"],
    [db.select({ id: maintenanceWorkOrders.id }).from(maintenanceWorkOrders).where(eq(maintenanceWorkOrders.reportFileId, fileId)), "maintenance.view", "maintenance"],
    [db.select({ id: trainingRecords.id }).from(trainingRecords).where(eq(trainingRecords.fileId, fileId)), "employees.view", "training"],
    [db.select({ id: employeeCompetencies.id }).from(employeeCompetencies).where(eq(employeeCompetencies.evidenceFileId, fileId)), "employees.view", "competency"],
    [db.select({ id: partyFiles.id }).from(partyFiles).where(eq(partyFiles.fileId, fileId)), "customers.view", "party_file"],
    [db.select({ id: aiExtractions.id }).from(aiExtractions).where(and(eq(aiExtractions.kind, "purchase_order"), arrayContains(aiExtractions.sourceFileIds, [fileId]))), "orders.view", "ai_reading"],
    [db.select({ id: aiExtractions.id }).from(aiExtractions).where(and(eq(aiExtractions.kind, "drawing_quote"), arrayContains(aiExtractions.sourceFileIds, [fileId]))), "quotations.view", "ai_reading"],
    [db.select({ id: partyFiles.id }).from(partyFiles).where(eq(partyFiles.fileId, fileId)), "suppliers.view", "party_file"],
  ];
  for (const [q, permission, label] of simple) {
    const rows = await q;
    if (rows.length) checks.push({ permission, label });
  }
  const [logo] = await db.select({ id: companySettings.id }).from(companySettings).where(eq(companySettings.logoFileId, fileId));
  if (logo) checks.push({ permission: null, label: "company_logo" });
  if (!checks.length && (file.uploadedBy === ctx.actor.userId || can(ctx.actor, "admin.settings"))) checks.push({ permission: null, label: "unlinked_file" });

  const allowed = checks.find((c) => (c.permission === null || can(ctx.actor, c.permission)) && (!c.extra || c.extra()));
  if (!allowed) {
    await db.insert(fileAccessLog).values({ fileId, userId: ctx.actor.userId, action: "denied", context: checks.map((c) => c.label).join(",").slice(0, 300) || "unlinked", ipAddress: ctx.actor.ip ?? null });
    const reason = checks.find((c) => c.denyReason && c.permission && can(ctx.actor, c.permission))?.denyReason;
    throw new AppError(reason ?? "You do not have permission to open this file.", "forbidden", { entityType: "file", entityId: fileId });
  }
  return { file, context: allowed.label };
}

export async function logFileAccess(ctx: Ctx, fileId: string, context: string, action: "download" | "view") {
  await ctx.db.insert(fileAccessLog).values({ fileId, userId: ctx.actor.userId, action, context, ipAddress: ctx.actor.ip ?? null });
}
