import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { DOC_TYPES, listDocuments } from "@/server/services/documents";
import { fmtDate } from "@/lib/format";
import { REVISION_STATUS } from "@/lib/status";
import { Badge, LinkButton, PageHeader, StatusBadge, Table } from "@/components/ui";
import { docTypeLabel } from "./_components/labels";

export const metadata = { title: "Documents" };


export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string }> }) {
  const ctx = await requirePageCtx("documents.view");
  const sp = await searchParams;
  const type = sp.type && (DOC_TYPES as readonly string[]).includes(sp.type) ? sp.type : undefined;
  const rows = await listDocuments(ctx, { q: sp.q, docType: type });
  return (
    <>
      <PageHeader
        title="Documents"
        description="Controlled documents — drawings, specifications, setup sheets, work instructions and procedures. Only the released revision is valid for production."
        actions={can(ctx.actor, "documents.upload") && <LinkButton href="/documents/new" variant="primary">New document</LinkButton>}
      />
      <form className="mb-3 flex flex-wrap items-center gap-2" role="search">
        <input name="q" defaultValue={sp.q} placeholder="Filter by number or title" className="field-input max-w-xs" aria-label="Filter documents" />
        <select name="type" defaultValue={type ?? ""} className="field-input max-w-[200px]" aria-label="Document type">
          <option value="">All types</option>
          {DOC_TYPES.map((t) => (
            <option key={t} value={t}>
              {docTypeLabel(t)}
            </option>
          ))}
        </select>
        <button className="rounded-sm border border-line bg-sheet px-3 py-1.5 text-[13px]">Apply</button>
      </form>
      <Table head={["Document", "Title", "Type", "Current revision", "Status", "Effective", ""]} empty="No documents match. Upload a drawing or procedure to start controlling revisions.">
        {rows.map(({ doc, current }) => (
          <tr key={doc.id}>
            <td>
              <Link href={`/documents/${doc.id}`} className="plate text-dykem hover:underline">
                {doc.docNumber}
              </Link>
            </td>
            <td className="font-medium">{doc.title}</td>
            <td>{docTypeLabel(doc.docType)}</td>
            <td className="plate">{current?.revision ?? "—"}</td>
            <td>{current ? <StatusBadge map={REVISION_STATUS} status={current.status} /> : <Badge tone="warning">No released revision</Badge>}</td>
            <td>{fmtDate(current?.effectiveDate)}</td>
            <td>{doc.isCustomerSupplied && <Badge tone="info">Customer-supplied</Badge>}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
