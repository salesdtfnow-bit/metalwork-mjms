import { redirect } from "next/navigation";
import { getMustChangePassword, requireCtx } from "@/server/auth/next";
import { visibleNav } from "@/lib/nav";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { getSettings } from "@/server/services/settings";
import { unreadCount } from "@/server/services/notifications";
import { SYSTEM_ROLES } from "@/server/auth/permissions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  if (await getMustChangePassword()) redirect("/change-password");
  const [settings, unread] = await Promise.all([getSettings(ctx.db), unreadCount(ctx.db, ctx.actor.userId)]);
  const roles = ctx.actor.roles.map((r) => SYSTEM_ROLES[r]?.name ?? r).join(", ");
  const demo = settings.isDemo || process.env.DEMO_MODE === "true";

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only z-50 bg-dykem px-3 py-2 text-white focus:not-sr-only focus:fixed focus:left-2 focus:top-2">
        Skip to content
      </a>
      <Sidebar groups={visibleNav(ctx.actor.permissions)} companyName={settings.companyName} />
      <div className="flex min-w-0 flex-1 flex-col">
        {demo && (
          <div className="bg-[repeating-linear-gradient(135deg,#1b2430_0_10px,#2b3644_10px_20px)] px-4 py-1 text-center text-[12px] font-medium text-[#f3c969]">
            Demonstration environment — all customers, parts and records are fictitious. Do not enter real customer data.
          </div>
        )}
        <TopBar userName={ctx.actor.name} roles={roles} unread={unread} />
        <main id="main" className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-5 lg:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
