import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { listMachines } from "@/server/services/machines";
import { userNames } from "@/server/services/ui/shopfloor";
import { fmtDateTime } from "@/lib/format";
import { MACHINE_STATUS, OP_STATUS } from "@/lib/status";
import { Badge, Empty, LinkButton, PageHeader, StatusBadge } from "@/components/ui";

export const metadata = { title: "Machines" };

export default async function MachinesPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const ctx = await requirePageCtx("machines.view");
  const sp = await searchParams;
  const rows = await listMachines(ctx, { includeInactive: sp.all === "1" });
  const names = await userNames(ctx, rows.map((r) => r.m.currentStatusBy));
  const counts = Object.keys(MACHINE_STATUS).map((k) => ({ k, n: rows.filter((r) => r.m.isActive && r.m.currentStatus === k).length })).filter((c) => c.n > 0);

  return (
    <>
      <PageHeader
        title="Machines"
        description="Machine status here is reported manually by operators and supervisors — it is not live machine telemetry. Each status shows who reported it and when."
        actions={can(ctx.actor, "machines.manage") && <LinkButton href="/machines/new" variant="primary">Register machine</LinkButton>}
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-steel">
          {counts.map((c) => (
            <span key={c.k} className="flex items-center gap-1.5">
              <StatusBadge map={MACHINE_STATUS} status={c.k} /> {c.n}
            </span>
          ))}
        </div>
        <form className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[13px] text-steel">
            <input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} className="accent-dykem" /> Include inactive
          </label>
          <button className="rounded-sm border border-line bg-sheet px-3 py-1.5 text-[13px]">Apply</button>
        </form>
      </div>

      {rows.length === 0 ? (
        <Empty title="No machines registered">Register machines to plan work on them, record downtime and track utilisation.</Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {rows.map((r) => {
            const { m } = r;
            return (
              <li key={m.id} className="flex flex-col rounded-md border border-line bg-sheet">
                <div className="flex items-start justify-between gap-2 border-b border-line px-3 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/machines/${m.id}`} className="plate text-[22px] leading-none text-dykem hover:underline">
                      {m.code}
                    </Link>
                    <p className="mt-1 truncate text-[13.5px] font-medium text-ink">{m.name}</p>
                    <p className="truncate text-[12.5px] text-steel">
                      {r.type}
                      {r.group ? ` · ${r.group}` : ""}
                      {m.location ? ` · ${m.location}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge map={MACHINE_STATUS} status={m.currentStatus} />
                    {!m.isActive && <Badge tone="muted">Inactive</Badge>}
                    {r.maintenanceLock && (
                      <Link href={`/maintenance/${r.maintenanceLock.id}`}>
                        <Badge tone="hold">Maintenance lock · {r.maintenanceLock.ref}</Badge>
                      </Link>
                    )}
                  </div>
                </div>
                <div className="flex-1 space-y-1.5 px-3 py-2.5 text-[13px]">
                  <p className="text-[12px] text-steel">
                    {m.currentStatusSource === "manual" ? "Manual" : m.currentStatusSource} status
                    {m.currentStatusBy ? ` — reported by ${names.get(m.currentStatusBy) ?? "unknown user"}` : ""}
                    {m.currentStatusAt ? `, at ${fmtDateTime(m.currentStatusAt)}` : ", not yet reported"}
                  </p>
                  {r.current.length ? (
                    r.current.map((c) => (
                      <p key={c.op.id} className="flex flex-wrap items-center gap-1.5">
                        <span className="text-steel">Now:</span>
                        <Link href={`/jobs/${c.op.jobId}?tab=route`} className="plate text-dykem hover:underline">
                          {c.jobNumber} / {c.op.opNumber}
                        </Link>
                        <span className="truncate">{c.op.title}</span>
                        <StatusBadge map={OP_STATUS} status={c.op.status} />
                      </p>
                    ))
                  ) : (
                    <p className="text-steel">No operation in progress.</p>
                  )}
                </div>
                <div className="flex items-center justify-between border-t border-line-2 px-3 py-2 text-[12.5px] text-steel">
                  <span>
                    {r.queued} queued operation{r.queued === 1 ? "" : "s"}
                  </span>
                  <Link href={`/machines/${m.id}`} className="link">
                    Dashboard
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
