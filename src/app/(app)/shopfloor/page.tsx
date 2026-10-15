import Link from "next/link";
import type { ReactNode } from "react";
import { requirePageCtx } from "@/server/auth/next";
import { AppError } from "@/server/errors";
import { myWork } from "@/server/services/production";
import { pendingBlockers } from "@/server/services/ui/shopfloor";
import { fmtDate, fmtDateTime, fmtMinutes, fmtQty, fmtTime } from "@/lib/format";
import { OP_STATUS } from "@/lib/status";
import { buttonClass, Notice, StatusBadge, Table } from "@/components/ui";
import { BIG_BADGE, OpCard } from "./_components/parts";

export const metadata = { title: "My work" };

const KIND_LABEL: Record<string, string> = { setup: "Setup", production: "Production", rework: "Rework", inspection: "Inspection" };

export default async function ShopfloorPage() {
  const ctx = await requirePageCtx("production.execute");
  let work: Awaited<ReturnType<typeof myWork>>;
  try {
    work = await myWork(ctx);
  } catch (e) {
    if (e instanceof AppError && e.code === "forbidden") {
      return (
        <div className="mx-auto max-w-3xl text-[16px]">
          <h1 className="plate mb-4 text-[30px] text-ink">My work</h1>
          <Notice tone="warning" title="Your sign-in is not linked to an employee record">
            {e.message} Until it is linked, the system cannot show the operations assigned to you or record your time.
          </Notice>
        </div>
      );
    }
    throw e;
  }
  const { employee, active, ready, pending, onHold, awaitingInspection, completed, openEntries, history } = work;
  const blockers = await pendingBlockers(ctx, pending.map((p) => p.op.id));
  const allRows = [...active, ...ready, ...pending, ...onHold, ...awaitingInspection, ...completed];
  const openOps = openEntries.map((t) => ({ t, row: allRows.find((r) => r.op.id === t.operationId) }));
  const nothing = !active.length && !ready.length && !pending.length && !onHold.length && !awaitingInspection.length;

  return (
    <div className="mx-auto max-w-[1280px] text-[16px]">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
        <div>
          <p className="text-[15px] text-steel">{fmtDate(new Date())}</p>
          <h1 className="plate text-[34px] leading-tight text-ink">
            {employee ? `${employee.firstName} ${employee.lastName}` : ctx.actor.name}
          </h1>
          <p className="text-[15px] text-steel">
            My work{employee?.employeeNo ? ` · Employee ${employee.employeeNo}` : ""}
            {employee?.shift ? ` · ${employee.shift} shift` : ""}
          </p>
        </div>
        <form action="/search" method="get" role="search" className="flex w-full max-w-xl items-stretch gap-2">
          <label htmlFor="sf-scan" className="sr-only">
            Scan traveller QR or type job / op
          </label>
          <input
            id="sf-scan"
            name="q"
            inputMode="search"
            autoComplete="off"
            placeholder="Scan traveller QR or type job / op"
            className="h-14 min-w-0 flex-1 rounded-sm border-2 border-ink/70 bg-sheet px-4 text-[18px] text-ink placeholder:text-steel-2 focus:border-dykem focus:outline-none focus:ring-2 focus:ring-dykem/25"
          />
          <button type="submit" className={buttonClass("primary", "xl", "h-14")}>
            Find
          </button>
        </form>
      </header>

      {openOps.length > 0 && (
        <div role="status" className="mb-5 rounded-md border-2 border-violet bg-violet-50 px-4 py-3 text-[16px] text-ink">
          <p className="font-semibold text-violet">Your clock is running</p>
          <ul className="mt-1 space-y-1">
            {openOps.map(({ t, row }) => (
              <li key={t.id}>
                {KIND_LABEL[t.kind] ?? t.kind} since {fmtTime(t.startedAt)}
                {row ? (
                  <>
                    {" "}
                    on{" "}
                    <Link href={`/shopfloor/op/${row.op.id}`} className="link font-semibold">
                      {row.job.jobNumber} op {row.op.opNumber}
                    </Link>
                  </>
                ) : (
                  <>
                    {" "}
                    —{" "}
                    <Link href={`/shopfloor/op/${t.operationId}`} className="link font-semibold">
                      open operation
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {active.length > 0 && (
        <Group title="In hand now" hint="Operations you are setting up, running, or waiting on first-off for.">
          <div className="grid gap-4 lg:grid-cols-2">
            {active.map((r) => (
              <OpCard key={r.op.id} row={r} emphasis cta="Open operation">
                {r.op.status === "awaiting_first_off" && (
                  <p className="rounded-sm bg-amber-50 px-3 py-2 text-[15px] text-[#6b4405]">Waiting for QC to approve the first-off part. Production stays blocked until then.</p>
                )}
              </OpCard>
            ))}
          </div>
        </Group>
      )}

      {nothing && (
        <div className="mb-8 rounded-md border border-dashed border-line bg-sheet px-6 py-12 text-center">
          <p className="text-[20px] font-semibold text-ink">No operations are assigned to you right now.</p>
          <p className="mx-auto mt-2 max-w-[56ch] text-[16px] text-steel">Ask your supervisor for your next job, or scan a traveller above to look it up.</p>
        </div>
      )}

      {ready.length > 0 && (
        <Group title="Ready to start" count={ready.length} hint="Prerequisites are complete. Open one to review the drawing and start setup.">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {ready.map((r) => (
              <OpCard key={r.op.id} row={r} emphasis={!active.length && r === ready[0]} cta={r.op.status === "paused" ? "Continue" : "Open"} />
            ))}
          </div>
        </Group>
      )}

      {pending.length > 0 && (
        <Group title="Next up" count={pending.length} hint="Assigned to you, but waiting on something before you can start.">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pending.map((r) => {
              const waits = blockers.get(r.op.id) ?? [];
              const reasons: string[] = [];
              if (r.line.routeStatus !== "released") reasons.push("Route not yet released by planning");
              if (!r.job.authorisedAt) reasons.push("Job not yet authorised for production");
              return (
                <OpCard key={r.op.id} row={r} cta="View">
                  <div className="rounded-sm bg-line-2/70 px-3 py-2 text-[15px] text-ink-2">
                    <p className="font-semibold text-ink">Waiting for</p>
                    <ul className="mt-0.5 list-disc pl-5">
                      {waits.map((w) => (
                        <li key={w.opNumber}>
                          Op {w.opNumber} {w.title} — {OP_STATUS[w.status as keyof typeof OP_STATUS]?.label.toLowerCase() ?? w.status}
                        </li>
                      ))}
                      {reasons.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                      {!waits.length && !reasons.length && <li>Readiness checks (material, program or drawing) — open to see details</li>}
                    </ul>
                  </div>
                </OpCard>
              );
            })}
          </div>
        </Group>
      )}

      {awaitingInspection.length > 0 && (
        <Group title="Awaiting inspection" count={awaitingInspection.length} hint="Submitted to quality. You can sign off once the inspection has passed.">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {awaitingInspection.map((r) => (
              <OpCard key={r.op.id} row={r} cta="View" />
            ))}
          </div>
        </Group>
      )}

      {onHold.length > 0 && (
        <Group title="On hold" count={onHold.length} hint="Do not work on these until a supervisor releases the hold.">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {onHold.map((r) => (
              <OpCard key={r.op.id} row={r} cta="View" />
            ))}
          </div>
        </Group>
      )}

      {completed.length > 0 && (
        <Group title="Recently completed" count={completed.length}>
          <Table head={["Job", "Op", "Operation", "Part", "Good", "Rejected / scrapped", "Status"]}>
            {completed.map((r) => (
              <tr key={r.op.id} className="text-[15px]">
                <td>
                  <Link href={`/shopfloor/op/${r.op.id}`} className="plate text-[16px] text-dykem hover:underline">
                    {r.job.jobNumber}
                  </Link>
                </td>
                <td className="plate text-[16px]">{r.op.opNumber}</td>
                <td>{r.op.title}</td>
                <td className="plate">{r.line.partNumber}</td>
                <td>{fmtQty(r.op.qtyGood)}</td>
                <td>
                  {fmtQty(r.op.qtyRejected)} / {fmtQty(r.op.qtyScrapped)}
                </td>
                <td>
                  <StatusBadge map={OP_STATUS} status={r.op.status} className={BIG_BADGE} />
                </td>
              </tr>
            ))}
          </Table>
        </Group>
      )}

      <Group title="My recent time" hint="Every setup and production run you have recorded. Times are entered manually from this terminal.">
        <Table head={["Started", "Ended", "Duration", "Type", "Job / op", "Good", "Rejected", "Scrapped", "Notes"]} empty="No time recorded yet.">
          {history.map(({ t, op, job }) => (
            <tr key={t.id} className="text-[15px]">
              <td className="whitespace-nowrap">{fmtDateTime(t.startedAt)}</td>
              <td className="whitespace-nowrap">{t.endedAt ? fmtTime(t.endedAt) : <span className="font-semibold text-violet">Running</span>}</td>
              <td className="whitespace-nowrap">{fmtMinutes(((t.endedAt ?? new Date()).getTime() - t.startedAt.getTime()) / 60_000)}</td>
              <td>{KIND_LABEL[t.kind] ?? t.kind}</td>
              <td className="whitespace-nowrap">
                <Link href={`/shopfloor/op/${op.id}`} className="link plate text-[15px]">
                  {job.jobNumber} / {op.opNumber}
                </Link>
              </td>
              <td>{fmtQty(t.qtyGood)}</td>
              <td>{fmtQty(t.qtyRejected)}</td>
              <td>{fmtQty(t.qtyScrapped)}</td>
              <td className="max-w-[280px] text-steel">{t.notes ?? ""}</td>
            </tr>
          ))}
        </Table>
      </Group>
    </div>
  );
}

function Group({ title, count, hint, children }: { title: string; count?: number; hint?: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-3 border-b border-line pb-2">
        <h2 className="text-[21px] font-semibold text-ink">
          {title}
          {count !== undefined && <span className="ml-2 rounded-sm bg-line-2 px-2 py-0.5 align-middle text-[14px] font-medium text-steel">{count}</span>}
        </h2>
        {hint && <p className="mt-0.5 text-[15px] text-steel">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
