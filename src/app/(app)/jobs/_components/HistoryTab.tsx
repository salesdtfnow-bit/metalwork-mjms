import { jobAuditEvents, jobScheduleChanges } from "@/server/services/ui/jobs";
import { canAny } from "@/server/context";
import { fmtDateTime } from "@/lib/format";
import { AuditList } from "@/components/AuditList";
import { Section, Table } from "@/components/ui";
import type { TabProps } from "./types";

export async function HistoryTab({ ctx, data }: TabProps) {
  const [events, changes] = await Promise.all([
    jobAuditEvents(ctx, data.job.id),
    canAny(ctx.actor, "jobs.view", "production.view_all", "planning.view") ? jobScheduleChanges(ctx, data.job.id) : Promise.resolve([]),
  ]);
  return (
    <>
      <Section title="Job history" actions={events.length === 500 && <span className="text-[12px] text-steel">Latest 500 events shown.</span>}>
        <AuditList events={events} empty="No history recorded for this job yet." />
      </Section>
      <Section title="Schedule changes">
        <Table head={["When", "Operation", "Machine", "Start", "End", "Reason", "By"]} empty="No schedule changes recorded.">
          {changes.map(({ c, opNumber, by, oldMachine, newMachine }) => (
            <tr key={c.id}>
              <td className="whitespace-nowrap text-steel">{fmtDateTime(c.changedAt)}</td>
              <td className="plate">{opNumber}</td>
              <td className="whitespace-nowrap">{oldMachine === newMachine ? (newMachine ?? "—") : `${oldMachine ?? "—"} → ${newMachine ?? "—"}`}</td>
              <td className="whitespace-nowrap text-[12.5px]">
                {fmtDateTime(c.oldStart)} → {fmtDateTime(c.newStart)}
              </td>
              <td className="whitespace-nowrap text-[12.5px]">
                {fmtDateTime(c.oldEnd)} → {fmtDateTime(c.newEnd)}
              </td>
              <td className="max-w-[320px] whitespace-pre-wrap text-steel">{c.reason ?? ""}</td>
              <td>{by ?? "—"}</td>
            </tr>
          ))}
        </Table>
      </Section>
    </>
  );
}
