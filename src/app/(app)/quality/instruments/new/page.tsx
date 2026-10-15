import { requirePageCtx } from "@/server/auth/next";
import { PageHeader, Panel } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { InstrumentFields } from "../../_components/InstrumentFields";
import { saveInstrumentAction } from "../../actions";

export const metadata = { title: "Add instrument" };

export default async function NewInstrumentPage() {
  await requirePageCtx("quality.instruments");
  return (
    <>
      <PageHeader title="Add measuring instrument" description="Record the first calibration on the instrument page after it is created. Until then an instrument that requires calibration cannot be used for inspection." />
      <Panel className="max-w-5xl p-4">
        <ActionForm action={saveInstrumentAction} submitLabel="Add instrument">
          <InstrumentFields />
        </ActionForm>
      </Panel>
    </>
  );
}
