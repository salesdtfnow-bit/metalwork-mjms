import Link from "next/link";
import { jobDispatchRows } from "@/server/services/ui/jobs";
import { can } from "@/server/context";
import { d } from "@/lib/decimal";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { DISPATCH_STATUS } from "@/lib/status";
import { cx, LinkButton, Ref, Section, StatusBadge, Table } from "@/components/ui";
import { TERMINAL_JOB, type TabProps } from "./types";

export async function DispatchTab({ ctx, data }: TabProps) {
  const { job: j, lines } = data;
  const rows = await jobDispatchRows(ctx, j.id);
  const canPrepare = can(ctx.actor, "dispatch.manage") && !TERMINAL_JOB.includes(j.status);
  const seeDispatch = can(ctx.actor, "dispatch.view");
  const totalReady = lines.reduce((a, { line: l }) => a.plus(d(l.qtyReleased).minus(d(l.qtyDispatched))), d(0));

  return (
    <>
      <Section
        title="Ready to dispatch"
        actions={
          canPrepare && (
            <LinkButton href={`/dispatch/new?jobId=${j.id}`} variant={totalReady.greaterThan(0) ? "primary" : "secondary"} size="sm">
              Prepare dispatch
            </LinkButton>
          )
        }
      >
        <p className="mb-2 text-[12.5px] text-steel">Only quantity covered by an approved final quality release can be dispatched. Ready = released − dispatched.</p>
        <Table head={["Line", "Part", "Order qty", "Accepted", "Released", "Dispatched", "Ready", "Outstanding"]} empty="This job has no lines.">
          {lines.map(({ line: l }) => {
            const ready = d(l.qtyReleased).minus(d(l.qtyDispatched));
            const outstanding = d(l.quantity).minus(d(l.qtyDispatched));
            return (
              <tr key={l.id}>
                <td className="plate">{l.lineNo}</td>
                <td className="plate text-[13px]">{l.partNumber}</td>
                <td className="tabular-nums">{fmtQty(l.quantity)}</td>
                <td className="tabular-nums">{fmtQty(l.qtyAccepted)}</td>
                <td className="tabular-nums">{fmtQty(l.qtyReleased)}</td>
                <td className="tabular-nums">{fmtQty(l.qtyDispatched)}</td>
                <td className={cx("tabular-nums", ready.greaterThan(0) && "font-semibold text-green")}>{fmtQty(ready.toString())}</td>
                <td className="tabular-nums text-steel">{fmtQty(outstanding.greaterThan(0) ? outstanding.toString() : "0")}</td>
              </tr>
            );
          })}
        </Table>
      </Section>

      <Section title="Dispatches">
        <Table head={["Delivery note", "Status", "Lines", "Customer PO", "Method / carrier", "Tracking", "Dispatched", "Delivered"]} empty="Nothing has been dispatched on this job.">
          {rows.map(({ dispatch: x, lines: dl }) => (
            <tr key={x.id}>
              <td className="whitespace-nowrap">{seeDispatch ? <Ref href={`/dispatch/${x.id}`} size="sm">{x.ref}</Ref> : <Ref size="sm">{x.ref}</Ref>}</td>
              <td>
                <StatusBadge map={DISPATCH_STATUS} status={x.status} />
              </td>
              <td className="text-[12.5px]">
                {dl.map((l) => (
                  <div key={l.l.id} className="whitespace-nowrap">
                    Line {l.lineNo} <span className="plate">{l.partNumber}</span> × {fmtQty(l.l.quantity)}
                  </div>
                ))}
              </td>
              <td>{x.customerPoNumber ?? "—"}</td>
              <td className="capitalize">{[x.deliveryMethod?.replace(/_/g, " "), x.carrier].filter(Boolean).join(" — ") || "—"}</td>
              <td>{x.trackingRef ?? "—"}</td>
              <td className="whitespace-nowrap text-steel">{fmtDateTime(x.dispatchedAt)}</td>
              <td className="whitespace-nowrap text-steel">
                {fmtDateTime(x.deliveredAt)}
                {x.proofOfDeliveryFileId && (
                  <div>
                    <a href={`/api/files/${x.proofOfDeliveryFileId}`} className="link">
                      Proof of delivery
                    </a>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
        {seeDispatch && (
          <p className="mt-2 text-[12.5px] text-steel">
            All dispatches are on the{" "}
            <Link href="/dispatch" className="link">
              Dispatch
            </Link>{" "}
            page.
          </p>
        )}
      </Section>
    </>
  );
}
