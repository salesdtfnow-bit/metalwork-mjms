import { requirePageCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { PageHeader, Panel } from "@/components/ui";
import { CustomerForm } from "../CustomerForm";
import { createCustomerAction } from "../actions";

export const metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  const ctx = await requirePageCtx("customers.manage");
  return (
    <>
      <PageHeader title="New customer" description="Contacts, addresses and requirements can be added after the customer is created." />
      <Panel className="max-w-5xl p-4">
        <CustomerForm action={createCustomerAction} showCommercial={can(ctx.actor, "customers.view_commercial")} submitLabel="Create customer" />
      </Panel>
    </>
  );
}
