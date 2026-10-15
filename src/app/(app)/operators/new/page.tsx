import { requirePageCtx } from "@/server/auth/next";
import { calendarsList } from "@/server/services/machines";
import { employeeOptions } from "@/server/services/ui/shopfloor";
import { PageHeader, Panel } from "@/components/ui";
import { EmployeeForm } from "../EmployeeForm";
import { createEmployeeAction } from "../actions";

export const metadata = { title: "Add employee" };

export default async function NewEmployeePage() {
  const ctx = await requirePageCtx("employees.manage");
  const [supervisors, calendars] = await Promise.all([employeeOptions(ctx), calendarsList(ctx)]);
  return (
    <>
      <PageHeader title="Add employee" description="Competencies and training records are added after the employee is created. Sign-in accounts are linked to employees by an administrator." />
      <Panel className="max-w-5xl p-4">
        <EmployeeForm action={createEmployeeAction} supervisors={supervisors} calendars={calendars.map((c) => ({ value: c.id, label: c.name }))} submitLabel="Create employee" />
      </Panel>
    </>
  );
}
