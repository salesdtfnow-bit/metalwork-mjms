import Link from "next/link";
import type { Ctx } from "@/server/context";
import { lotsAwaitingRelease } from "@/server/services/ui/materials";
import { LOT_STATUS } from "@/lib/status";
import { fmtDate, fmtQty } from "@/lib/format";
import { Badge, Ref, StatusBadge, Table } from "@/components/ui";
import { CheckList } from "./Lifecycle";

export async function ReleaseTab({ ctx }: { ctx: Ctx }) {
  const rows = await lotsAwaitingRelease(ctx);
  return (
    <>
      <p className="mb-3 max-w-[90ch] text-[13px] text-steel">
        Lots received but not yet released. None of these can be allocated or issued to production. A lot can be released only when incoming inspection has passed, the
        certificate is verified (or not required), the BoxHero stock-in is confirmed (when tracked) and there are no active holds.
      </p>
      <Table head={["Lot", "Heat / cast", "Spec", "Supplier", "PO", "Quantity", "Status", "Release checks", "Ready", "Received", ""]} empty="No lots are waiting for inspection or release.">
        {rows.map(({ lot, supplier, spec, grade, poRef, poId, checks, ready }) => (
          <tr key={lot.id}>
            <td>
              <Ref href={`/materials/lots/${lot.id}`} size="sm">
                {lot.lotNo}
              </Ref>
            </td>
            <td className="plate text-[13px]">{lot.heatNumber}</td>
            <td>
              {spec ?? <span className="text-steel">—</span>}
              {grade && <span className="block text-[12px] text-steel">{grade}</span>}
            </td>
            <td>{supplier}</td>
            <td>
              <Link href={`/purchasing/${poId}`} className="link">
                {poRef}
              </Link>
            </td>
            <td className="whitespace-nowrap">{fmtQty(lot.qtyReceived, lot.uom)}</td>
            <td>
              <StatusBadge map={LOT_STATUS} status={lot.status} />
            </td>
            <td className="min-w-[260px]">
              <CheckList checks={checks} compact failLinks={{ hold: <Link href="/ncr?tab=holds" className="link">Review holds</Link> }} />
            </td>
            <td>{ready ? <Badge tone="success">Ready to release</Badge> : <Badge tone="warning">Not ready</Badge>}</td>
            <td className="whitespace-nowrap text-steel">{fmtDate(lot.createdAt)}</td>
            <td className="whitespace-nowrap text-[12.5px]">
              <Link href={`/materials/lots/${lot.id}#release`} className="link">
                Inspect / release
              </Link>
              <br />
              <Link href={`/materials/lots/${lot.id}#certificates`} className="link">
                Certificates
              </Link>
            </td>
          </tr>
        ))}
      </Table>
    </>
  );
}
