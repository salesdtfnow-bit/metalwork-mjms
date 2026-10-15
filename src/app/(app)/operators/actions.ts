"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/server/action";
import { f } from "@/server/forms";
import { addTrainingRecord, grantCompetency, revokeCompetency, saveEmployee, setEmployeeActive } from "@/server/services/employees";

const employeeForm = z.object({
  employeeNo: f.str("Employee ID is required."),
  firstName: f.str("First name is required."),
  lastName: f.str("Last name is required."),
  email: f.email(),
  phone: f.optStr(),
  jobTitle: f.optStr(),
  department: f.optStr(),
  supervisorId: f.optUuid(),
  calendarId: f.optUuid(),
  shift: f.optStr(),
  badgeCode: f.optStr(),
  startDate: f.optDate(),
  notes: f.optStr(),
});

export const createEmployeeAction = action("employee.create", employeeForm, async (ctx, input) => {
  const e = await saveEmployee(ctx, input);
  redirect(`/operators/${e.id}`);
});

export const updateEmployeeAction = action(
  "employee.update",
  employeeForm.extend({ id: f.uuid() }),
  async (ctx, { id, ...input }) => {
    await saveEmployee(ctx, input, id);
    return "Employee details saved.";
  },
  { revalidate: (i) => [`/operators/${i.id}`, "/operators"] },
);

export const setEmployeeActiveAction = action(
  "employee.active",
  z.object({ id: f.uuid(), active: f.bool(), reason: f.str("A reason is required.") }),
  async (ctx, i) => {
    await setEmployeeActive(ctx, i.id, i.active, i.reason);
    return i.active ? "Employee reactivated." : "Employee deactivated. Their assignments on unstarted operations have been ended.";
  },
  { revalidate: (i) => [`/operators/${i.id}`, "/operators"] },
);

export const grantCompetencyAction = action(
  "employee.competency_grant",
  z.object({
    employeeId: f.uuid(),
    competencyId: f.uuid("Select a competency."),
    level: f.enumOf(["trainee", "competent", "trainer"] as const),
    expiresOn: f.optDate(),
    notes: f.optStr(),
    evidence: f.file(),
  }),
  async (ctx, i) => {
    await grantCompetency(ctx, { employeeId: i.employeeId, competencyId: i.competencyId, level: i.level, expiresOn: i.expiresOn, notes: i.notes, evidence: i.evidence ?? null });
    return "Competency recorded and verified.";
  },
  { revalidate: (i) => [`/operators/${i.employeeId}`, "/operators"] },
);

export const revokeCompetencyAction = action(
  "employee.competency_revoke",
  z.object({ employeeId: f.uuid(), employeeCompetencyId: f.uuid(), reason: f.str("A reason is required.") }),
  async (ctx, i) => {
    await revokeCompetency(ctx, i.employeeCompetencyId, i.reason);
    return "Competency revoked.";
  },
  { revalidate: (i) => [`/operators/${i.employeeId}`, "/operators"] },
);

export const addTrainingAction = action(
  "employee.training_add",
  z.object({
    employeeId: f.uuid(),
    title: f.str("Title is required."),
    provider: f.optStr(),
    completedOn: f.date("Enter the completion date."),
    expiresOn: f.optDate(),
    notes: f.optStr(),
    file: f.file(),
  }),
  async (ctx, i) => {
    await addTrainingRecord(ctx, { employeeId: i.employeeId, title: i.title, provider: i.provider, completedOn: i.completedOn, expiresOn: i.expiresOn, notes: i.notes, file: i.file ?? null });
    return "Training record added.";
  },
  { revalidate: (i) => `/operators/${i.employeeId}` },
);
