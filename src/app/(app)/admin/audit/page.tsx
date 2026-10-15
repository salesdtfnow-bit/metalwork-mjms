import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { auditFilterOptions, searchAudit, type AuditFilter } from "@/server/services/ui/records";
import { fmtDateTime } from "@/lib/format";
import { Badge, Notice, Panel, Section, Table } from "@/components/ui";
import { ActionForm, Disclosure } from "@/components/forms";
import { actionLabel } from "@/components/AuditList";
import { verifyAuditChainAction } from "../actions";

export const metadata = { title: "Audit trail" };

type SP = { entityType?: string; q?: string; userId?: string; action?: string; from?: string; to?: string; outcome?: string; before?: string };

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-steel">—</span>;
  return <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-paper p-2 text-[11.5px] leading-snug text-ink-2">{JSON.stringify(value, null, 2)}</pre>;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageCtx("audit.view");
  const sp = await searchParams;
  const filter: AuditFilter = { ...sp, before: sp.before ? Number(sp.before) : undefined };
  const [{ rows, nextBefore }, opts] = await Promise.all([searchAudit(ctx, filter), auditFilterOptions(ctx)]);
  const base = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== "before" && !!v) as [string, string][]);
  const nextHref = nextBefore ? `/admin/audit?${new URLSearchParams([...base.entries(), ["before", String(nextBefore)]]).toString()}` : null;

  return (
    <>
      <Notice tone="info" title="Append-only, tamper-evident record">
        Every change, approval, denied attempt and security event is written to the audit trail in the same transaction as the change itself. The database rejects updates and deletions of audit rows, and each event carries a SHA-256 hash of the previous event, so any alteration outside the application breaks the chain and is detected by verification.
      </Notice>

      <Section title="Verify integrity">
        <Panel className="p-3">
          <ActionForm action={verifyAuditChainAction} submitLabel="Verify hash chain" submitVariant="secondary">
            <p className="text-[13px] text-steel">Recomputes every event hash from the start of the trail. This may take a while on large databases.</p>
          </ActionForm>
        </Panel>
      </Section>

      <Section title="Search">
        <form className="mb-3 grid gap-2 rounded-md border border-line bg-sheet p-3 sm:grid-cols-2 lg:grid-cols-4" role="search">
          <label className="text-[12.5px] font-medium text-ink-2">
            <span className="mb-1 block">Entity type</span>
            <select name="entityType" defaultValue={sp.entityType ?? ""} className="field-input">
              <option value="">All</option>
              {opts.entityTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12.5px] font-medium text-ink-2">
            <span className="mb-1 block">Reference or ID</span>
            <input name="q" defaultValue={sp.q} placeholder="e.g. J-2026-0042 or a record ID" className="field-input" />
          </label>
          <label className="text-[12.5px] font-medium text-ink-2">
            <span className="mb-1 block">User</span>
            <select name="userId" defaultValue={sp.userId ?? ""} className="field-input">
              <option value="">Anyone</option>
              {opts.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12.5px] font-medium text-ink-2">
            <span className="mb-1 block">Action contains</span>
            <input name="action" defaultValue={sp.action} placeholder="e.g. release, user., login" className="field-input" />
          </label>
          <label className="text-[12.5px] font-medium text-ink-2">
            <span className="mb-1 block">From</span>
            <input type="date" name="from" defaultValue={sp.from} className="field-input" />
          </label>
          <label className="text-[12.5px] font-medium text-ink-2">
            <span className="mb-1 block">To</span>
            <input type="date" name="to" defaultValue={sp.to} className="field-input" />
          </label>
          <label className="text-[12.5px] font-medium text-ink-2">
            <span className="mb-1 block">Outcome</span>
            <select name="outcome" defaultValue={sp.outcome ?? ""} className="field-input">
              <option value="">All</option>
              <option value="success">Success</option>
              <option value="denied">Denied</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button className="h-8.5 rounded-sm border border-dykem bg-dykem px-3 text-[13px] font-medium text-white hover:bg-dykem-2">Search</button>
            <Link href="/admin/audit" className="h-8.5 rounded-sm border border-line bg-sheet px-3 py-1.5 text-[13px]">
              Clear
            </Link>
          </div>
        </form>

        <Table head={["#", "When", "Who", "Action", "Entity", "Reference", "Reason", "Outcome", "Detail"]} empty="No audit events match these filters.">
          {rows.map((e) => (
            <tr key={e.id} className={e.outcome !== "success" ? "bg-red-50/40" : undefined}>
              <td className="plate text-[12px] text-steel">{e.id}</td>
              <td className="whitespace-nowrap text-steel">{fmtDateTime(e.occurredAt)}</td>
              <td className="whitespace-nowrap">
                {e.userName ?? "System"}
                {e.ipAddress && <div className="text-[11.5px] text-steel">{e.ipAddress}</div>}
              </td>
              <td>
                {actionLabel(e.action)}
                <div className="plate text-[11.5px] text-steel">{e.action}</div>
              </td>
              <td className="text-steel">{e.entityType}</td>
              <td className="plate text-[13px]">{e.entityRef ?? e.entityId ?? "—"}</td>
              <td className="max-w-[260px] whitespace-pre-wrap text-steel">{e.reason ?? ""}</td>
              <td>
                <div className="flex flex-wrap gap-1">
                  {e.outcome === "success" ? <Badge tone="success">Success</Badge> : <Badge tone="danger">{e.outcome}</Badge>}
                  {e.approvalId && <Badge tone="info">Signed</Badge>}
                  {e.exceptionId && <Badge tone="warning">Exception</Badge>}
                </div>
              </td>
              <td>
                {(e.before !== null || e.after !== null) && (
                  <Disclosure label="Before / after" variant="ghost">
                    <div className="grid min-w-[320px] gap-2 lg:min-w-[560px] lg:grid-cols-2">
                      <div>
                        <div className="mb-0.5 text-[11.5px] font-semibold text-steel">Before</div>
                        <Json value={e.before} />
                      </div>
                      <div>
                        <div className="mb-0.5 text-[11.5px] font-semibold text-steel">After</div>
                        <Json value={e.after} />
                      </div>
                    </div>
                    <p className="mt-1 break-all text-[11px] text-steel">Hash {e.hash}</p>
                  </Disclosure>
                )}
              </td>
            </tr>
          ))}
        </Table>
        <div className="mt-2 flex items-center justify-between text-[13px]">
          <span className="text-steel">{rows.length} event(s) shown, newest first.</span>
          <span className="flex gap-3">
            {sp.before && (
              <Link href={`/admin/audit${base.toString() ? `?${base.toString()}` : ""}`} className="link">
                Newest
              </Link>
            )}
            {nextHref && (
              <Link href={nextHref} className="link">
                Older events →
              </Link>
            )}
          </span>
        </div>
      </Section>
    </>
  );
}
