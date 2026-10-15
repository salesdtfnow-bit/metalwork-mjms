import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { currentDrawingRevision, getPart } from "@/server/services/parts";
import { documentsForPart } from "@/server/services/documents";
import { linkableDrawingDocuments, partDetailExtras } from "@/server/services/ui/jobs";
import { can, canAny } from "@/server/context";
import { AppError } from "@/server/errors";
import { fmtDate, fmtQty } from "@/lib/format";
import { JOB_STATUS, REVISION_STATUS } from "@/lib/status";
import { Badge, KeyValues, Notice, Ref, Section, StatusBadge, Table, Tabs, TitleBlock } from "@/components/ui";
import { ActionForm, Disclosure, SelectField } from "@/components/forms";
import { setPartDrawingAction } from "../actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACE: Record<string, string> = { job: "Job", batch: "Batch", piece: "Piece (serialised)" };
const TABS = ["overview", "documents", "jobs", "programs"] as const;
type Tab = (typeof TABS)[number];

export const metadata = { title: "Part" };

export default async function PartPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageCtx("jobs.view", "quotations.view", "documents.view", "production.view_all");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "overview";
  const data = await getPart(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const { part: p, revisions } = data;
  const canLink = canAny(ctx.actor, "documents.upload", "jobs.manage");
  const seeDocs = can(ctx.actor, "documents.view");
  const seeJobs = canAny(ctx.actor, "jobs.view", "production.view_all");
  const [extras, current, linkable, docs] = await Promise.all([
    partDetailExtras(ctx, id),
    currentDrawingRevision(ctx, id),
    canLink && tab === "overview" ? linkableDrawingDocuments(ctx, id) : Promise.resolve([]),
    seeDocs && tab === "documents" ? documentsForPart(ctx, id) : Promise.resolve([]),
  ]);
  if (!extras) notFound();
  const { customer, drawingDocument, revisionDrawings, jobs, programs } = extras;
  const openJobs = jobs.filter((x) => !["completed", "cancelled"].includes(x.job.status)).length;

  return (
    <>
      <TitleBlock
        kind="Part"
        refNo={p.partNumber}
        title={p.description}
        status={
          <>
            {p.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="muted">Inactive</Badge>}
            {!p.drawingDocumentId && <Badge tone="warning">No drawing linked</Badge>}
            {p.drawingDocumentId && !current && <Badge tone="danger">No released drawing revision</Badge>}
          </>
        }
        cells={[
          {
            label: "Customer",
            value: customer ? (
              can(ctx.actor, "customers.view") ? (
                <Link href={`/customers/${customer.id}`} className="link">
                  {customer.code} — {customer.name}
                </Link>
              ) : (
                `${customer.code} — ${customer.name}`
              )
            ) : (
              "Internal / any customer"
            ),
          },
          {
            label: "Drawing",
            value: drawingDocument ? (
              seeDocs ? (
                <Link href={`/documents/${drawingDocument.id}`} className="link">
                  {drawingDocument.docNumber}
                </Link>
              ) : (
                drawingDocument.docNumber
              )
            ) : null,
          },
          { label: "Released drawing revision", value: current ? `Rev ${current.rev.revision}` : null },
          { label: "Current part revision", value: revisions.find((r) => r.isCurrent)?.revision ?? null },
          { label: "Traceability", value: TRACE[p.traceabilityLevel] ?? p.traceabilityLevel },
          { label: "Open jobs", value: seeJobs ? openJobs : "Restricted" },
        ]}
      />
      <Tabs
        base={`/parts/${id}`}
        current={tab}
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "documents", label: "Documents" },
          { key: "jobs", label: "Jobs", count: seeJobs ? jobs.length : undefined },
          { key: "programs", label: "CNC programs", count: programs.length },
        ]}
      />

      {tab === "overview" && (
        <>
          <Section title="Details">
            <KeyValues
              items={[
                { label: "Part number", value: p.partNumber },
                { label: "Description", value: p.description },
                { label: "Default traceability level", value: TRACE[p.traceabilityLevel] ?? p.traceabilityLevel },
                { label: "Created", value: fmtDate(p.createdAt) },
                { label: "Notes", value: p.notes, wide: true },
              ]}
            />
          </Section>

          <Section title="Drawing">
            {drawingDocument ? (
              <KeyValues
                cols={4}
                items={[
                  { label: "Document", value: seeDocs ? <Link href={`/documents/${drawingDocument.id}`} className="link">{drawingDocument.docNumber}</Link> : drawingDocument.docNumber },
                  { label: "Title", value: drawingDocument.title },
                  { label: "Released revision", value: current ? `Rev ${current.rev.revision}` : "None released" },
                  { label: "Effective", value: current ? fmtDate(current.rev.effectiveDate ?? current.rev.releasedAt) : null },
                ]}
              />
            ) : (
              <Notice tone="warning">No drawing document is linked. New jobs for this part will have no pinned drawing revision.</Notice>
            )}
            {canLink && (
              <div className="mt-3">
                <Disclosure label={drawingDocument ? "Change drawing document" : "Link drawing document"}>
                  {linkable.length ? (
                    <ActionForm action={setPartDrawingAction} submitLabel="Link drawing" confirm="Link this drawing to the part? Its released revision becomes the default for new jobs; existing jobs keep their pinned revision.">
                      <input type="hidden" name="partId" value={p.id} />
                      <SelectField
                        label="Drawing document"
                        name="documentId"
                        required
                        defaultValue={p.drawingDocumentId}
                        placeholder="Select drawing"
                        options={linkable.map((x) => ({ value: x.doc.id, label: `${x.doc.docNumber} — ${x.doc.title}${x.rev ? ` (rev ${x.rev.revision} ${x.rev.status})` : " (no released revision)"}` }))}
                        hint={customer ? `Drawings for ${customer.code} or already linked to this part.` : "Drawings not tied to a customer."}
                      />
                    </ActionForm>
                  ) : (
                    <p className="text-[13px] text-steel">No drawing documents are registered for this customer. Upload the drawing in Documents first.</p>
                  )}
                </Disclosure>
              </div>
            )}
          </Section>

          <Section title="Part revisions">
            <Table head={["Revision", "Drawing revision", "Current", "Created", "Notes"]} empty="No revisions recorded. Revisions are created when jobs are raised against a drawing revision.">
              {revisions.map((r) => {
                const dr = revisionDrawings.find((x) => x.partRevisionId === r.id);
                return (
                  <tr key={r.id}>
                    <td className="plate">{r.revision}</td>
                    <td>
                      {dr ? (
                        <span className="flex flex-wrap items-center gap-2">
                          {dr.doc.docNumber} rev {dr.rev.revision}
                          <StatusBadge map={REVISION_STATUS} status={dr.rev.status} />
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{r.isCurrent ? <Badge tone="info">Current</Badge> : ""}</td>
                    <td className="text-steel">{fmtDate(r.createdAt)}</td>
                    <td className="text-steel">{r.notes ?? ""}</td>
                  </tr>
                );
              })}
            </Table>
          </Section>
        </>
      )}

      {tab === "documents" && (
        <Section title="Controlled documents for this part">
          {seeDocs ? (
            <Table head={["Document", "Title", "Type", "Current revision", "Status"]} empty="No documents linked to this part.">
              {docs.map(({ doc, current: rev }) => (
                <tr key={doc.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`/documents/${doc.id}`} className="plate text-[13px] text-dykem hover:underline">
                      {doc.docNumber}
                    </Link>
                  </td>
                  <td>{doc.title}</td>
                  <td className="capitalize">{doc.docType.replace(/_/g, " ")}</td>
                  <td>{rev ? `Rev ${rev.revision}` : "None released"}</td>
                  <td>{rev ? <StatusBadge map={REVISION_STATUS} status={rev.status} /> : <Badge tone="warning">Not released</Badge>}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="text-[13px] text-steel">You do not have permission to view controlled documents.</p>
          )}
        </Section>
      )}

      {tab === "jobs" && (
        <Section title="Jobs using this part">
          {seeJobs ? (
            <Table head={["Job", "Line", "Title", "Status", "Quantity", "Dispatched", "Required"]} empty="No jobs for this part yet.">
              {jobs.map(({ job, line }) => (
                <tr key={line.id}>
                  <td className="whitespace-nowrap">
                    <Ref href={`/jobs/${job.id}`} size="sm">
                      {job.jobNumber}
                    </Ref>
                  </td>
                  <td className="plate">{line.lineNo}</td>
                  <td>{job.title}</td>
                  <td>
                    <StatusBadge map={JOB_STATUS} status={job.status} />
                  </td>
                  <td className="tabular-nums">{fmtQty(line.quantity)}</td>
                  <td className="tabular-nums">{fmtQty(line.qtyDispatched)}</td>
                  <td className="whitespace-nowrap">{fmtDate(job.requiredDate)}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="text-[13px] text-steel">You do not have permission to view jobs.</p>
          )}
        </Section>
      )}

      {tab === "programs" && (
        <Section title="CNC programs for this part">
          <Table head={["Program", "Name", "Op", "Released revision", "Status"]} empty="No CNC programs registered for this part.">
            {programs.map(({ p: prog, rev }) => (
              <tr key={prog.id}>
                <td className="whitespace-nowrap">
                  {can(ctx.actor, "programs.view") ? (
                    <Link href={`/programs/${prog.id}`} className="plate text-[13px] text-dykem hover:underline">
                      {prog.programNumber}
                    </Link>
                  ) : (
                    <span className="plate text-[13px]">{prog.programNumber}</span>
                  )}
                </td>
                <td>{prog.name}</td>
                <td className="plate">{prog.opNumber ?? "—"}</td>
                <td>{rev ? `Rev ${rev.revision}` : <span className="text-amber">None released</span>}</td>
                <td>{prog.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="muted">Inactive</Badge>}</td>
              </tr>
            ))}
          </Table>
        </Section>
      )}
    </>
  );
}
