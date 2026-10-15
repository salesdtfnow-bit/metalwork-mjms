import Link from "next/link";
import { Bell, LogOut, Search } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import { ScanButton } from "./ScanButton";

export function TopBar({ userName, roles, unread }: { userName: string; roles: string; unread: number }) {
  return (
    <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-sheet/95 px-4 pl-14 backdrop-blur lg:pl-4">
      <form action="/search" method="get" role="search" className="flex max-w-xl flex-1 items-center gap-1.5">
        <label htmlFor="global-search" className="sr-only">
          Search jobs, customers, quotations, lots, drawings, programs, machines
        </label>
        <div className="relative flex-1">
          <Search aria-hidden size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-steel-2" />
          <input
            id="global-search"
            name="q"
            type="search"
            autoComplete="off"
            placeholder="Search or scan: job, PO, heat no., drawing, program…"
            className="field-input h-9 pl-8"
          />
        </div>
        <ScanButton targetId="global-search" />
      </form>
      <div className="ml-auto flex items-center gap-1">
        <Link href="/notifications" className="relative rounded-sm p-2 text-ink-2 hover:bg-line-2" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}>
          <Bell size={18} />
          {unread > 0 && (
            <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-red px-1 text-center text-[10.5px] font-semibold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>
          )}
        </Link>
        <Link href="/account" className="hidden rounded-sm px-2 py-1 text-right hover:bg-line-2 sm:block">
          <div className="text-[13px] font-medium leading-tight text-ink">{userName}</div>
          <div className="max-w-[220px] truncate text-[11px] leading-tight text-steel">{roles}</div>
        </Link>
        <form action={logoutAction}>
          <button type="submit" className="rounded-sm p-2 text-ink-2 hover:bg-line-2" aria-label="Sign out" title="Sign out">
            <LogOut size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}
