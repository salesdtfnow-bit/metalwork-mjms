"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

/** Sub-navigation for /admin/* (route-based, so each section has its own URL). */
export function AdminNav({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Administration sections" className="mb-4 flex gap-0.5 overflow-x-auto border-b border-line">
      {items.map((t) => {
        const active = path === t.href || path.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cx("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13.5px]", active ? "border-dykem font-semibold text-ink" : "border-transparent text-steel hover:text-ink")}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
