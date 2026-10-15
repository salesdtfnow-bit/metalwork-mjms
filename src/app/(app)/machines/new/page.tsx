import { requirePageCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { PageHeader, Panel } from "@/components/ui";
import { ActionForm, Disclosure, FormGrid, TextField } from "@/components/forms";
import { MachineForm } from "../MachineForm";
import { machineFormOptions } from "../formData";
import { createMachineAction, createMachineGroupAction } from "../actions";

export const metadata = { title: "Register machine" };

export default async function NewMachinePage() {
  const ctx = await requirePageCtx("machines.manage");
  const opts = await machineFormOptions(ctx);
  return (
    <>
      <PageHeader title="Register machine" description="Machine types (and their extra fields) are configured by an administrator. Status, downtime and maintenance are recorded after the machine is registered." />
      <Panel className="max-w-6xl p-4">
        <MachineForm action={createMachineAction} showRate={can(ctx.actor, "jobs.view_commercial")} submitLabel="Register machine" {...opts} />
      </Panel>
      <div className="mt-4 max-w-6xl">
        <Disclosure label="New machine group">
          <p className="mb-2 text-[13px] text-steel">Groups let planning schedule an operation on any machine in the group (e.g. all 3-axis VMCs). Reload this page after creating one.</p>
          <ActionForm action={createMachineGroupAction} submitLabel="Create group" resetOnSuccess>
            <FormGrid cols={3}>
              <TextField label="Code" name="code" required placeholder="e.g. VMC3" />
              <TextField label="Name" name="name" required />
              <TextField label="Description" name="description" />
            </FormGrid>
          </ActionForm>
        </Disclosure>
      </div>
    </>
  );
}
