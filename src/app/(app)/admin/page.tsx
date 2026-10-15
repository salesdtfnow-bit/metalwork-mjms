import { redirect } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { ADMIN_PERMS, visibleAdminSections } from "./_components/sections";

export default async function AdminIndex() {
  const ctx = await requirePageCtx(...ADMIN_PERMS);
  const first = visibleAdminSections(ctx.actor)[0];
  redirect(first ? first.href : "/forbidden");
}
