"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Boxes,
  Building2,
  CalendarRange,
  ChartColumn,
  ClipboardCheck,
  Cog,
  Factory,
  FileCode,
  FileText,
  Folder,
  Gauge,
  GitBranch,
  Hammer,
  HardHat,
  Inbox,
  Layers,
  Menu,
  PackageCheck,
  Ruler,
  Shield,
  ShoppingCart,
  TriangleAlert,
  Truck,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import type { NavGroup } from "@/lib/nav";
import { cx } from "../ui";

const ICONS: Record<string, LucideIcon> = {
  gauge: Gauge,
  "hard-hat": HardHat,
  inbox: Inbox,
  "file-text": FileText,
  building: Building2,
  "clipboard-check": ClipboardCheck,
  layers: Layers,
  "calendar-range": CalendarRange,
  cog: Cog,
  users: Users,
  "file-code": FileCode,
  boxes: Boxes,
  "shopping-cart": ShoppingCart,
  truck: Truck,
  ruler: Ruler,
  "triangle-alert": TriangleAlert,
  wrench: Wrench,
  hammer: Hammer,
  factory: Factory,
  "package-check": PackageCheck,
  "git-branch": GitBranch,
  "bar-chart": ChartColumn,
  folder: Folder,
  shield: Shield,
};

export function Sidebar({ groups, companyName }: { groups: NavGroup[]; companyName: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  const nav = (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 pb-6">
      {groups.map((g) => (
        <div key={g.label} className="mt-4">
          <div className="px-2 pb-1 text-[11px] font-medium text-[#8a97a6]">{g.label}</div>
          <ul>
            {g.items.map((it) => {
              const Icon = ICONS[it.icon] ?? Folder;
              const active = isActive(it.href);
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-[13.5px]",
                      active ? "bg-white/10 font-semibold text-white shadow-[inset_3px_0_0_#6f97de]" : "text-[#c9d2dc] hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <Icon aria-hidden size={16} strokeWidth={1.75} />
                    {it.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const brand = (
    <div className="flex h-14 items-center gap-2.5 border-b border-white/10 px-4">
      <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" className="shrink-0">
        {/* stylised end-mill cross-section */}
        <circle cx="12" cy="12" r="10" fill="none" stroke="#6f97de" strokeWidth="2" />
        <path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z" fill="#6f97de" opacity=".85" />
      </svg>
      <div className="min-w-0">
        <div className="plate truncate text-[17px] leading-none text-white">MJMS</div>
        <div className="truncate text-[11px] text-[#8a97a6]">{companyName}</div>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        className="fixed left-2 top-2.5 z-40 rounded-sm bg-ink p-2 text-white lg:hidden"
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Menu size={18} />
      </button>
      <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col bg-ink lg:flex">
        {brand}
        {nav}
      </aside>
      {open && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="flex w-[260px] flex-col bg-ink">
            <div className="relative">
              {brand}
              <button type="button" className="absolute right-2 top-3 rounded-sm p-1.5 text-white" aria-label="Close navigation" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </div>
            {nav}
          </div>
          <button type="button" aria-label="Close navigation" className="flex-1 bg-ink/50" onClick={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}
