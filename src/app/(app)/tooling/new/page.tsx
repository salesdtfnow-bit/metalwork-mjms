import { requirePageCtx } from "@/server/auth/next";
import { boxheroItemOptions, machineOptions } from "@/server/services/ui/workshop";
import { PageHeader, Panel } from "@/components/ui";
import { ToolForm } from "../_components/ToolForm";
import { createToolAction } from "../actions";

export const metadata = { title: "Add tool" };

export default async function NewToolPage() {
  const ctx = await requirePageCtx("tooling.manage");
  const [machines, items] = await Promise.all([machineOptions(ctx), boxheroItemOptions(ctx)]);
  return (
    <>
      <PageHeader title="Add tool" description="Register a tool, fixture, jig or gauge. Usage, inspections and regrinds are recorded on the tool's page afterwards." />
      <Panel className="max-w-5xl p-4">
        <ToolForm action={createToolAction} machines={machines} boxheroItems={items} submitLabel="Add tool" />
      </Panel>
    </>
  );
}
