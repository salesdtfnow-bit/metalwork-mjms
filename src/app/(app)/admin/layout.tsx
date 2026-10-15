import { requirePageCtx } from "@/server/auth/next";
import { PageHeader } from "@/components/ui";
import { AdminNav } from "./_components/AdminNav";
import { ADMIN_PERMS, visibleAdminSections } from "./_components/sections";

export const metadata = { title: "Administration" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageCtx(...ADMIN_PERMS);
  const items = visibleAdminSections(ctx.actor).map(({ href, label }) => ({ href, label }));
  return (
    <>
      <PageHeader title="Administration" description="Users and roles, company settings, configuration, audit trail and integrations. Every change here is recorded in the audit trail." />
      <AdminNav items={items} />
      {children}
    </>
  );
}
