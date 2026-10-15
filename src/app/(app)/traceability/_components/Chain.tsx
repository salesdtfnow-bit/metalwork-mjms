import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";

/**
 * Vertical traceability chain. Each node is one link in the record chain; a node with
 * `missing` is drawn dashed so gaps are visible in the diagram itself.
 */
export function Chain({ children }: { children: ReactNode }) {
  return <ol className="relative ml-3 border-l-2 border-ink/70 pl-0">{children}</ol>;
}

export function Node({
  stage,
  refNo,
  href,
  title,
  facts = [],
  status,
  missing,
  children,
}: {
  stage: string;
  refNo?: ReactNode;
  href?: string | null;
  title?: ReactNode;
  facts?: { label: string; value: ReactNode }[];
  status?: ReactNode;
  missing?: string | false;
  children?: ReactNode;
}) {
  return (
    <li className="relative mb-3 pl-6 last:mb-0">
      <span
        aria-hidden
        className={cx("absolute -left-[9px] top-3 h-4 w-4 rounded-full border-2", missing ? "border-amber bg-amber-50" : "border-ink bg-sheet")}
      />
      <div className={cx("rounded-md border bg-sheet", missing ? "border-dashed border-amber" : "border-line")}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2">
          <span className="w-[150px] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-steel">{stage}</span>
          {refNo &&
            (href ? (
              <Link href={href} className="plate text-[15px] text-dykem hover:underline">
                {refNo}
              </Link>
            ) : (
              <span className="plate text-[15px] text-ink">{refNo}</span>
            ))}
          {title && <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{title}</span>}
          {status && <span className="ml-auto flex flex-wrap items-center gap-1.5">{status}</span>}
        </div>
        {missing ? (
          <p className="px-3 py-2 text-[13px] text-[#7a4d06]">{missing}</p>
        ) : (
          (facts.length > 0 || children) && (
            <div className="px-3 py-2">
              {facts.length > 0 && (
                <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
                  {facts.map((f, i) => (
                    <div key={i} className="min-w-0">
                      <dt className="text-[11.5px] text-steel">{f.label}</dt>
                      <dd className="truncate text-ink">{f.value === null || f.value === undefined || f.value === "" ? "—" : f.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {children && <div className={cx(facts.length > 0 && "mt-2")}>{children}</div>}
            </div>
          )
        )}
      </div>
    </li>
  );
}

/** Indented sub-chain for repeated links (one per lot, operation, dispatch …). */
export function SubChain({ children }: { children: ReactNode }) {
  return <ol className="relative ml-2 mt-2 border-l border-dashed border-steel-2 pl-0">{children}</ol>;
}

export function SubNode({ label, children, warn }: { label: ReactNode; children?: ReactNode; warn?: boolean }) {
  return (
    <li className="relative mb-2 pl-4 last:mb-0">
      <span aria-hidden className={cx("absolute -left-[4px] top-2 h-2 w-2 rounded-full", warn ? "bg-amber" : "bg-steel-2")} />
      <div className="text-[13px] text-ink">{label}</div>
      {children && <div className="mt-0.5 text-[12.5px] text-steel">{children}</div>}
    </li>
  );
}
