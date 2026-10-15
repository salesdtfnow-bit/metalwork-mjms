import Link from "next/link";
import { listInspections } from "@/server/services/inspections";
import { listNcrs } from "@/server/services/ncr";
import { releasesForJob } from "@/server/services/release";
import { can, canAny } from "@/server/context";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { INSPECTION_STATUS, NCR_STATUS } from "@/lib/status";
import { buttonClass, Ref, Section, StatusBadge, Table } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { prepareReleaseAction } from "../actions";
import { RELEASE_STATUS } from "./maps";
import { TERMINAL_JOB, type TabProps } from "./types";

const STAGE: Record<string, string> = {
  incoming: "Incoming",
  first_off: "First-off",
  in_process: "In-process",
  final: "Final",
  subcontract_return: "Subcontract return",
  other: "Other",
};

export async function QualityTab({ ctx, data }: TabProps) {
  const { job: j, lines } = data;
  const open = !TERMINAL_JOB.includes(j.status);
  const seeInspections = canAny(ctx.actor, "quality.view", "quality.inspect");
  const seeNcrs = can(ctx.actor, "ncr.view");
  const seeReleases = canAny(ctx.actor, "quality.view", "quality.release", "quality.final_inspect");
  const canPrepare = canAny(ctx.actor, "quality.release", "quality.final_inspect") && open;
  const canFinal = canAny(ctx.actor, "quality.final_inspect", "quality.inspect") && open;
  const [inspections, ncrs, releases] = await Promise.all([
    seeInspections ? listInspections(ctx, { jobId: j.id }) : Promise.resolve([]),
    seeNcrs ? listNcrs(ctx, { jobId: j.id }) : Promise.resolve([]),
    seeReleases ? releasesForJob(ctx, j.id) : Promise.resolve([]),
  ]);
  const lineLabel = (id: string | null) => {
    const l = lines.find((x) => x.line.id === id)?.line;
    return l ? `Line ${l.lineNo} — ${l.partNumber}` : "—";
  };

  return (
    <>
      <Section title="Final inspection and release by line">
        <Table head={["Line", "Part", "Qty", "Good", "Accepted", "Released", "Latest release", ""]} empty="This job has no lines.">
          {lines.map(({ line: l }) => {
            const latest = releases.find((r) => r.r.jobLineId === l.id);
            return (
              <tr key={l.id}>
                <td className="plate">{l.lineNo}</td>
                <td className="plate text-[13px]">{l.partNumber}</td>
                <td className="tabular-nums">{fmtQty(l.quantity)}</td>
                <td className="tabular-nums">{fmtQty(l.qtyGood)}</td>
                <td className="tabular-nums">{fmtQty(l.qtyAccepted)}</td>
                <td className="tabular-nums">{fmtQty(l.qtyReleased)}</td>
                <td>{latest ? <StatusBadge map={RELEASE_STATUS} status={latest.r.status} /> : <span className="text-steel">None</span>}</td>
                <td>
                  <div className="flex flex-wrap items-center gap-2">
                    {canFinal && (
                      <Link href={`/quality/inspections/new?jobLineId=${l.id}&stage=final`} className={buttonClass("secondary", "sm")}>
                        Start final inspection
                      </Link>
                    )}
                    {canPrepare && (
                      <ActionForm action={prepareReleaseAction} submitLabel={latest?.r.status === "draft" ? "Open release" : "Prepare final release"} submitSize="sm" inline>
                        <input type="hidden" name="jobId" value={j.id} />
                        <input type="hidden" name="jobLineId" value={l.id} />
                      </ActionForm>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      </Section>

      <Section title="Final quality releases">
        {seeReleases ? (
          <Table head={["Release", "Line", "Status", "Qty released", "Decided by", "Decided", "Comments"]} empty="No final releases prepared yet.">
            {releases.map(({ r, by }) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/quality/releases/${r.id}`} className="link">
                    View
                  </Link>
                </td>
                <td className="whitespace-nowrap">{lineLabel(r.jobLineId)}</td>
                <td>
                  <StatusBadge map={RELEASE_STATUS} status={r.status} />
                </td>
                <td className="tabular-nums">{fmtQty(r.qtyReleased)}</td>
                <td>{by ?? "—"}</td>
                <td className="whitespace-nowrap text-steel">{fmtDateTime(r.decidedAt)}</td>
                <td className="max-w-[300px] text-steel">{r.comments ?? ""}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="text-[13px] text-steel">You do not have permission to view quality releases.</p>
        )}
      </Section>

      <Section title="Inspections">
        {seeInspections ? (
          <Table head={["Inspection", "Stage", "Operation / lot", "Status", "Result", "Accepted / rejected", "Inspector", "Requested"]} empty="No inspections recorded for this job.">
            {inspections.map(({ i, opNumber, lotNo, inspector }) => (
              <tr key={i.id}>
                <td className="whitespace-nowrap">
                  <Ref href={`/quality/inspections/${i.id}`} size="sm">
                    {i.ref}
                  </Ref>
                </td>
                <td>{STAGE[i.stage] ?? i.stage}</td>
                <td className="whitespace-nowrap">{opNumber ? `Op ${opNumber}` : lotNo ? `Lot ${lotNo}` : "—"}</td>
                <td>
                  <StatusBadge map={INSPECTION_STATUS} status={i.status} />
                </td>
                <td className="capitalize">{i.result ?? "—"}</td>
                <td className="tabular-nums">
                  {i.qtyAccepted || i.qtyRejected ? `${fmtQty(i.qtyAccepted)} / ${fmtQty(i.qtyRejected)}` : "—"}
                </td>
                <td>{inspector ?? "—"}</td>
                <td className="whitespace-nowrap text-steel">{fmtDateTime(i.requestedAt)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="text-[13px] text-steel">You do not have permission to view inspection records.</p>
        )}
      </Section>

      <Section title="Non-conformances">
        {seeNcrs ? (
          <Table head={["NCR", "Category", "Status", "Disposition", "Qty affected", "Description", "Raised"]} empty="No non-conformances on this job.">
            {ncrs.map(({ n, raisedBy }) => (
              <tr key={n.id}>
                <td className="whitespace-nowrap">
                  <Ref href={`/ncr/${n.id}`} size="sm">
                    {n.ref}
                  </Ref>
                </td>
                <td className="capitalize">{n.category.replace(/_/g, " ")}</td>
                <td>
                  <StatusBadge map={NCR_STATUS} status={n.status} />
                </td>
                <td className="capitalize">{n.disposition?.replace(/_/g, " ") ?? "—"}</td>
                <td className="tabular-nums">{fmtQty(n.qtyAffected)}</td>
                <td className="max-w-[320px]">{n.description}</td>
                <td className="whitespace-nowrap text-steel">
                  {fmtDateTime(n.raisedAt)}
                  {raisedBy && <div>{raisedBy}</div>}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="text-[13px] text-steel">You do not have permission to view non-conformance records.</p>
        )}
      </Section>
    </>
  );
}
