import { fmtDateTime } from "@/lib/format";
import { Badge, Table } from "./ui";

type Ev = {
  id: number;
  occurredAt: Date;
  userName: string | null;
  action: string;
  entityRef: string | null;
  reason: string | null;
  outcome: string;
  approvalId?: string | null;
  exceptionId?: string | null;
};

/** Human labels for common audit actions; unknown actions fall back to a readable form. */
export function actionLabel(a: string) {
  return a.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function AuditList({ events, empty = "No history recorded yet." }: { events: Ev[]; empty?: string }) {
  return (
    <Table head={["When", "Who", "What", "Reference", "Reason / note", ""]} empty={empty}>
      {events.map((e) => (
        <tr key={e.id}>
          <td className="whitespace-nowrap text-steel">{fmtDateTime(e.occurredAt)}</td>
          <td className="whitespace-nowrap">{e.userName ?? "System"}</td>
          <td>{actionLabel(e.action)}</td>
          <td className="plate text-[13px]">{e.entityRef ?? "—"}</td>
          <td className="max-w-[420px] whitespace-pre-wrap text-steel">{e.reason ?? ""}</td>
          <td className="whitespace-nowrap">
            {e.outcome !== "success" && <Badge tone="danger">{e.outcome}</Badge>}
            {e.approvalId && <Badge tone="info">Signed</Badge>}
            {e.exceptionId && <Badge tone="warning">Exception</Badge>}
          </td>
        </tr>
      ))}
    </Table>
  );
}
