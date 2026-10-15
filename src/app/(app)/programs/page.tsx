import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { can, canAny } from "@/server/context";
import { listMachines } from "@/server/services/machines";
import { listPrograms, programApprovalQueue } from "@/server/services/programs";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { REVISION_STATUS } from "@/lib/status";
import { Badge, LinkButton, PageHeader, Section, StatusBadge, Table } from "@/components/ui";
import { VERIFICATION_STATUS } from "./labels";

export const metadata = { title: "CNC programs" };

export default async function ProgramsPage({ searchParams }: { searchParams: Promise<{ q?: string; machine?: string }> }) {
  const ctx = await requirePageCtx("programs.view");
  const sp = await searchParams;
  const showQueue = canAny(ctx.actor, "programs.approve", "programs.release");
  const machineId = sp.machine && /^[0-9a-f-]{36}$/i.test(sp.machine) ? sp.machine : undefined;
  const [rows, queue, machines] = await Promise.all([
    listPrograms(ctx, { q: sp.q, machineId }),
    showQueue ? programApprovalQueue(ctx) : Promise.resolve([]),
    can(ctx.actor, "machines.view") ? listMachines(ctx) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title="CNC programs"
        description="Controlled CNC programs. Each program has exactly one released revision that operators may use; new revisions are verified, approved and released (signed) before they replace it."
        actions={can(ctx.actor, "programs.create") && <LinkButton href="/programs/new" variant="primary">New program</LinkButton>}
      />

      {showQueue && (
        <Section title={`Awaiting approval or release (${queue.length})`}>
          <Table head={["Program", "Name", "Revision", "Status", "Verification", "Programmer", "Submitted", ""]} empty="Nothing waiting for approval or release.">
            {queue.map(({ rev, p, programmer }) => {
              const nextStep = rev.status === "submitted" ? (can(ctx.actor, "programs.approve") ? "Approve" : null) : can(ctx.actor, "programs.release") ? "Release" : null;
              return (
                <tr key={rev.id}>
                  <td>
                    <Link href={`/programs/${p.id}`} className="plate text-dykem hover:underline">
                      {p.programNumber}
                    </Link>
                  </td>
                  <td>{p.name}</td>
                  <td className="plate">{rev.revision}</td>
                  <td>
                    <StatusBadge map={REVISION_STATUS} status={rev.status} />
                  </td>
                  <td>
                    <StatusBadge map={VERIFICATION_STATUS} status={rev.verificationStatus} />
                  </td>
                  <td>{programmer ?? "—"}</td>
                  <td className="whitespace-nowrap">{fmtDateTime(rev.submittedAt)}</td>
                  <td>
                    {nextStep && (
                      <Link href={`/programs/${p.id}#rev-${rev.id}`} className="link font-medium">
                        {nextStep} →
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        </Section>
      )}

      <form className="mb-3 flex flex-wrap items-center gap-2" role="search">
        <input name="q" defaultValue={sp.q} placeholder="Program number, name or part" className="field-input max-w-xs" aria-label="Filter programs" />
        {machines.length > 0 && (
          <select name="machine" defaultValue={machineId ?? ""} className="field-input max-w-[220px]" aria-label="Filter by machine">
            <option value="">All machines</option>
            {machines.map((m) => (
              <option key={m.m.id} value={m.m.id}>
                {m.m.code} — {m.m.name}
              </option>
            ))}
          </select>
        )}
        <button className="rounded-sm border border-line bg-sheet px-3 py-1.5 text-[13px]">Apply</button>
      </form>
      <Table head={["Program", "Name", "Part", "Job", "Machines", "Released revision", "Pending revisions"]} empty="No programs match.">
        {rows.map((r) => (
          <tr key={r.p.id}>
            <td>
              <Link href={`/programs/${r.p.id}`} className="plate text-dykem hover:underline">
                {r.p.programNumber}
              </Link>
              {!r.p.isActive && <Badge tone="muted" className="ml-1.5">Inactive</Badge>}
            </td>
            <td className="font-medium">{r.p.name}</td>
            <td className="plate">{r.part ?? "—"}</td>
            <td className="plate">{r.job ?? "—"}</td>
            <td>
              <div className="flex flex-wrap gap-1">
                {r.machines.map((m) => (
                  <span key={m.id} className="plate rounded-sm border border-line px-1 text-[12.5px]">
                    {m.code}
                  </span>
                ))}
              </div>
            </td>
            <td>
              {r.current ? (
                <span>
                  <span className="plate">Rev {r.current.revision}</span> <span className="text-[12px] text-steel">released {fmtDate(r.current.releasedAt)}</span>
                </span>
              ) : (
                <Badge tone="warning">None released</Badge>
              )}
            </td>
            <td>
              {r.pending.length ? (
                <span className="flex flex-wrap gap-1">
                  {r.pending.map((x) => (
                    <StatusBadge key={x.id} map={REVISION_STATUS} status={x.status} className="whitespace-nowrap" />
                  ))}
                </span>
              ) : (
                <span className="text-steel">—</span>
              )}
            </td>
          </tr>
        ))}
      </Table>
    </>
  );
}
