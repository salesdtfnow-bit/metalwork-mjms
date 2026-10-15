import { requirePageCtx } from "@/server/auth/next";
import { PageHeader, Panel } from "@/components/ui";
import { SupplierForm } from "../_components/SupplierForm";
import { createSupplierAction } from "../actions";

export const metadata = { title: "New supplier" };

export default async function NewSupplierPage() {
  await requirePageCtx("suppliers.manage");
  return (
    <>
      <PageHeader title="New supplier" description="New suppliers start as pending approval. Approval status, contacts, addresses and files are added after the supplier is created." />
      <Panel className="max-w-5xl p-4">
        <SupplierForm action={createSupplierAction} submitLabel="Create supplier" />
      </Panel>
    </>
  );
}
