"use client";

import { ActionForm, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import type { ActionResult } from "@/server/boundary";

type Opt = { value: string; label: string };
type Employee = Partial<Record<string, string | null>> & { id?: string };

export function EmployeeForm({
  action,
  employee,
  supervisors,
  calendars,
  submitLabel,
}: {
  action: (p: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  employee?: Employee;
  supervisors: Opt[];
  calendars: Opt[];
  submitLabel: string;
}) {
  const e = employee ?? {};
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      {e.id && <input type="hidden" name="id" value={e.id} />}
      <FormGrid cols={3}>
        <TextField label="Employee ID" name="employeeNo" required defaultValue={e.employeeNo} hint="Payroll / clock number" />
        <TextField label="First name" name="firstName" required defaultValue={e.firstName} />
        <TextField label="Last name" name="lastName" required defaultValue={e.lastName} />
        <TextField label="Job title" name="jobTitle" defaultValue={e.jobTitle} placeholder="e.g. CNC setter-operator" />
        <TextField label="Department" name="department" defaultValue={e.department} />
        <SelectField label="Supervisor" name="supervisorId" options={supervisors.filter((s) => s.value !== e.id)} defaultValue={e.supervisorId} placeholder="None" />
        <TextField label="Email" name="email" type="email" defaultValue={e.email} />
        <TextField label="Phone" name="phone" defaultValue={e.phone} />
        <TextField label="Shift" name="shift" defaultValue={e.shift} placeholder="e.g. Days, Lates" />
        <SelectField label="Working calendar" name="calendarId" options={calendars} defaultValue={e.calendarId} placeholder="Default" />
        <TextField label="Badge code" name="badgeCode" defaultValue={e.badgeCode} hint="Shop-floor badge barcode (not a password)." />
        <TextField label="Start date" name="startDate" type="date" defaultValue={e.startDate} />
      </FormGrid>
      <TextArea label="Notes" name="notes" defaultValue={e.notes} />
    </ActionForm>
  );
}
