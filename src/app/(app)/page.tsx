import { requireCtx } from "@/server/auth/next";
import { PageHeader } from "@/components/ui";

export default async function Dashboard() {
  const ctx = await requireCtx();
  return <PageHeader title="Dashboard" description={`Signed in as ${ctx.actor.name}.`} />;
}
