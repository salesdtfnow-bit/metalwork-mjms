import Link from "next/link";
import clsx from "clsx";
import type { ReactNode } from "react";
import { statusDef, type Tone } from "@/lib/status";

export const cx = clsx;

const TONE: Record<Tone, string> = {
  neutral: "bg-line-2 text-ink-2 border-line",
  info: "bg-dykem-50 text-dykem-2 border-dykem/25",
  progress: "bg-violet-50 text-violet border-violet/25",
  warning: "bg-amber-50 text-amber border-amber/30",
  danger: "bg-red-50 text-red border-red/30",
  success: "bg-green-50 text-green border-green/30",
  hold: "bg-amber-50 text-[#8a4b00] border-[#8a4b00]/40 [background-image:repeating-linear-gradient(135deg,transparent_0_6px,rgba(185,119,14,.10)_6px_12px)]",
  muted: "bg-transparent text-steel border-line",
};

const DOT: Record<Tone, string> = {
  neutral: "bg-steel-2",
  info: "bg-dykem",
  progress: "bg-violet",
  warning: "bg-amber",
  danger: "bg-red",
  success: "bg-green",
  hold: "bg-[#8a4b00]",
  muted: "bg-line",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-[12px] font-medium leading-4", TONE[tone], className)}>
      <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", DOT[tone])} />
      {children}
    </span>
  );
}

export function StatusBadge({ map, status, className }: { map: Record<string, { label: string; tone: Tone }>; status: string | null | undefined; className?: string }) {
  const s = statusDef(map, status);
  return (
    <Badge tone={s.tone} className={className}>
      {s.label}
    </Badge>
  );
}

/** Reference nameplate (job/quote/NCR number). */
export function Ref({ children, href, size = "md" }: { children: ReactNode; href?: string; size?: "sm" | "md" | "lg" }) {
  const cls = cx("plate text-ink", size === "lg" ? "text-[26px] leading-none" : size === "md" ? "text-[15px]" : "text-[13px]");
  return href ? (
    <Link href={href} className={cx(cls, "text-dykem hover:underline underline-offset-2")}>
      {children}
    </Link>
  ) : (
    <span className={cls}>{children}</span>
  );
}

/**
 * Title block — modelled on an engineering drawing title block. The first cell carries the
 * reference plate; the rest are labelled cells. Used at the top of every record page.
 */
export function TitleBlock({
  refNo,
  title,
  kind,
  status,
  cells = [],
  actions,
}: {
  refNo: string;
  title: string;
  kind: string;
  status?: ReactNode;
  cells?: { label: string; value: ReactNode }[];
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 border border-ink/80 bg-sheet">
      <div className="flex flex-wrap items-stretch">
        <div className="flex min-w-[220px] flex-col justify-center border-r border-ink/80 px-4 py-3">
          <div className="text-[11px] font-medium text-steel">{kind}</div>
          <div className="plate text-[30px] leading-[1.05] text-ink">{refNo}</div>
        </div>
        <div className="flex min-w-[260px] flex-1 flex-col justify-center px-4 py-3">
          <h1 className="text-[18px] font-semibold leading-snug text-ink">{title}</h1>
          {status && <div className="mt-1.5 flex flex-wrap items-center gap-2">{status}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 px-4 py-3">{actions}</div>}
      </div>
      {cells.length > 0 && (
        <dl className="grid grid-cols-2 border-t border-ink/80 sm:grid-cols-3 lg:grid-cols-6">
          {cells.map((c, i) => (
            <div key={i} className="border-line px-4 py-2 [&:not(:last-child)]:border-r max-lg:[&:nth-child(n+3)]:border-t">
              <dt className="text-[11px] text-steel">{c.label}</dt>
              <dd className="mt-0.5 truncate text-[13.5px] font-medium text-ink">{c.value ?? "—"}</dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div>
        <h1 className="plate text-[26px] leading-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-[75ch] text-[13.5px] text-steel">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, actions, children, className, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx("mb-6", className)}>
      {(title || actions) && (
        <div className="mb-2 flex items-center justify-between gap-3 border-b border-line pb-1.5">
          {title && <h2 className="text-[14.5px] font-semibold text-ink">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-md border border-line bg-sheet", className)}>{children}</div>;
}

export function KeyValues({ items, cols = 3 }: { items: { label: string; value: ReactNode; wide?: boolean }[]; cols?: 2 | 3 | 4 }) {
  return (
    <dl className={cx("grid gap-x-6 gap-y-3", cols === 2 ? "sm:grid-cols-2" : cols === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4")}>
      {items.map((it, i) => (
        <div key={i} className={cx(it.wide && "sm:col-span-full")}>
          <dt className="text-[12px] text-steel">{it.label}</dt>
          <dd className="mt-0.5 whitespace-pre-wrap text-[13.5px] text-ink">{it.value === null || it.value === undefined || it.value === "" ? "—" : it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Table({ head, children, empty, footer }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode; footer?: ReactNode }) {
  const hasRows = Array.isArray(children) ? children.flat().filter(Boolean).length > 0 : !!children;
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-sheet">
      <table className="data-table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hasRows ? (
            children
          ) : (
            <tr>
              <td colSpan={head.length} className="py-8 text-center text-steel">
                {empty ?? "Nothing here yet."}
              </td>
            </tr>
          )}
        </tbody>
        {footer}
      </table>
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line bg-sheet px-6 py-10 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-[60ch] text-[13.5px] text-steel">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warning" | "danger" | "success"; title?: string; children?: ReactNode }) {
  const cls = {
    info: "border-dykem/30 bg-dykem-50 text-dykem-2",
    warning: "border-amber/40 bg-amber-50 text-[#7a4d06]",
    danger: "border-red/40 bg-red-50 text-red",
    success: "border-green/40 bg-green-50 text-green",
  }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("mb-4 rounded-md border px-3 py-2 text-[13.5px]", cls)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cx(title && "mt-0.5")}>{children}</div>}
    </div>
  );
}

const BTN = {
  primary: "bg-dykem text-white border-dykem hover:bg-dykem-2",
  secondary: "bg-sheet text-ink border-line hover:border-steel-2 hover:bg-line-2/50",
  danger: "bg-red text-white border-red hover:bg-[#8f1e18]",
  ghost: "bg-transparent text-ink border-transparent hover:bg-line-2",
} as const;
const SIZE = { sm: "h-7 px-2.5 text-[12.5px]", md: "h-8.5 px-3 text-[13.5px]", lg: "h-12 px-5 text-[15px]", xl: "h-16 px-6 text-[17px]" } as const;

export type ButtonVariant = keyof typeof BTN;
export type ButtonSize = keyof typeof SIZE;
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra?: string) {
  return cx(
    "inline-flex items-center justify-center gap-1.5 rounded-sm border font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    BTN[variant],
    SIZE[size],
    extra,
  );
}

export function LinkButton({ href, children, variant = "secondary", size = "md", className, prefetch }: { href: string; children: ReactNode; variant?: ButtonVariant; size?: ButtonSize; className?: string; prefetch?: boolean }) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} prefetch={prefetch}>
      {children}
    </Link>
  );
}

/** Link-based tabs (state in the URL so tabs are shareable and work without JS). */
export function Tabs({ tabs, current, base }: { tabs: { key: string; label: string; count?: number }[]; current: string; base: string }) {
  return (
    <nav aria-label="Sections" className="mb-4 flex gap-0.5 overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const active = t.key === current;
        const href = `${base}${base.includes("?") ? "&" : "?"}tab=${t.key}`;
        return (
          <Link
            key={t.key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13.5px]",
              active ? "border-dykem font-semibold text-ink" : "border-transparent text-steel hover:text-ink",
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 rounded-sm bg-line-2 px-1 text-[11.5px] text-steel">{t.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export function Stat({ label, value, sub, href, tone }: { label: string; value: ReactNode; sub?: ReactNode; href?: string; tone?: "danger" | "warning" | "success" }) {
  const body = (
    <div className={cx("h-full border-l-[3px] bg-sheet px-3 py-2.5", tone === "danger" ? "border-red" : tone === "warning" ? "border-amber" : tone === "success" ? "border-green" : "border-line")}>
      <div className="text-[12px] text-steel">{label}</div>
      <div className="plate mt-0.5 text-[26px] leading-none text-ink">{value}</div>
      {sub && <div className="mt-1 text-[12px] text-steel">{sub}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-sm outline-offset-2 hover:bg-line-2/40">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Honest placeholder for features not yet implemented (never a fake control). */
export function NotYet({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-steel-2 bg-line-2/40 px-3 py-2 text-[13px] text-steel">
      <span className="font-semibold text-ink-2">Not available yet: </span>
      {children}
    </div>
  );
}
