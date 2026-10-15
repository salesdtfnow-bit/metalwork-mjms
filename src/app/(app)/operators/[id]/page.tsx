import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { AppError } from "@/server/errors";
import { employeeTime, getEmployee, listCompetencies } from "@/server/services/employees";
import { calendarsList } from "@/server/services/machines";
import { employeeAssignments, employeeOptions } from "@/server/services/ui/shopfloor";
import { fmtDate, fmtDateTime, fmtMinutes, fmtQty, fmtTime, todayISO } from "@/lib/format";
import { OP_STATUS, PRIORITY } from "@/lib/status";
import { Badge, KeyValues, Ref, Section, StatusBadge, Table, Tabs, TitleBlock } from "@/components/ui";
import { ActionForm, Disclosure, FileField, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { EmployeeForm } from "../EmployeeForm";
import { addTrainingAction, grantCompetencyAction, revokeCompetencyAction, setEmployeeActiveAction, updateEmployeeAction } from "../actions";

export const metadata = { title: "Employee" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEVELS = [
  { value: "competent", label: "Competent" },
  { value: "trainee", label: "Trainee (supervised — does not pass the competency gate)" },
  { value: "trainer", label: "Trainer" },
];
const KIND_LABEL: Record<string, string> = { setup: "Setup", production: "Production", rework: "Rework", inspection: "Inspection" };

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageCtx("employees.view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const tab = (await searchParams).tab ?? "competencies";
  const data = await getEmployee(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const { employee: e, name, competencies, training, user, supervisor } = data;
  const manage = can(ctx.actor, "employees.manage");
  const verify = can(ctx.actor, "competencies.verify");
  const today = todayISO();
  const isSelf = ctx.actor.employeeId === id;

  const [compList, assignments, time, supervisors, calendars] = await Promise.all([
    tab === "competencies" && verify ? listCompetencies(ctx) : Promise.resolve([]),
    tab === "work" ? employeeAssignments(ctx, id) : Promise.resolve([]),
    tab === "work" ? employeeTime(ctx, id, 50) : Promise.resolve([]),
    tab === "details" && manage ? employeeOptions(ctx) : Promise.resolve([]),
    calendarsList(ctx),
  ]);
  const calendar = calendars.find((c) => c.id === e.calendarId);
  const activeComps = competencies.filter((c) => c.ec.status === "active");

  return (
    <>
      <TitleBlock
        kind="Employee"
        refNo={e.employeeNo}
        title={name}
        status={
          <>
            {e.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="muted">Inactive{e.leftDate ? ` since ${fmtDate(e.leftDate)}` : ""}</Badge>}
            {activeComps.some((c) => c.ec.expiresOn && c.ec.expiresOn < today) && <Badge tone="danger">Expired competency</Badge>}
          </>
        }
        cells={[
          { label: "Job title", value: e.jobTitle },
          { label: "Department", value: e.department },
          { label: "Supervisor", value: supervisor ? <Link href={`/operators/${supervisor.id}`} className="link">{`${supervisor.firstName} ${supervisor.lastName}`}</Link> : null },
          { label: "Shift", value: e.shift },
          { label: "Linked sign-in", value: user ? `${user.email}${user.isActive ? "" : " (disabled)"}` : "Not linked" },
          { label: "Valid competencies", value: activeComps.filter((c) => !c.ec.expiresOn || c.ec.expiresOn >= today).length },
        ]}
      />
      <Tabs
        base={`/operators/${id}`}
        current={tab}
        tabs={[
          { key: "competencies", label: "Competencies", count: activeComps.length },
          { key: "training", label: "Training", count: training.length },
          { key: "work", label: "Work" },
          { key: "details", label: "Details" },
        ]}
      />

      {tab === "competencies" && (
        <Section title="Competencies" actions={<span className="text-[12px] text-steel">Only active, verified, unexpired competencies at Competent or Trainer level pass the operator gate.</span>}>
          <Table head={["Competency", "Applies to", "Level", "Verified by", "Expires", "Status", "Evidence", ""]} empty="No competencies recorded.">
            {competencies.map(({ ec, c, verifier, opType, machineType, machine }) => {
              const expired = !!ec.expiresOn && ec.expiresOn < today;
              return (
                <tr key={ec.id} className={ec.status !== "active" ? "text-steel" : undefined}>
                  <td>
                    <span className="plate">{c.code}</span> <span className="font-medium">{c.name}</span>
                    {ec.notes && <span className="block text-[12px] text-steel">{ec.notes}</span>}
                  </td>
                  <td className="text-[13px]">{[opType, machineType, machine].filter(Boolean).join(" · ") || "General"}</td>
                  <td className="capitalize">{ec.level}</td>
                  <td>
                    {verifier ?? "—"}
                    <span className="block text-[12px] text-steel">{fmtDateTime(ec.verifiedAt)}</span>
                  </td>
                  <td className={expired && ec.status === "active" ? "font-semibold text-red" : undefined}>{ec.expiresOn ? fmtDate(ec.expiresOn) : "No expiry"}</td>
                  <td>
                    {ec.status !== "active" ? (
                      <Badge tone="muted">{ec.status === "revoked" ? "Revoked" : "Suspended"}</Badge>
                    ) : expired ? (
                      <Badge tone="danger">Expired</Badge>
                    ) : ec.level === "trainee" ? (
                      <Badge tone="warning">Trainee</Badge>
                    ) : (
                      <Badge tone="success">Valid</Badge>
                    )}
                  </td>
                  <td>
                    {ec.evidenceFileId ? (
                      <a className="link" href={`/api/files/${ec.evidenceFileId}`}>
                        Evidence
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {verify && ec.status === "active" && (
                      <Disclosure label="Revoke">
                        <ActionForm action={revokeCompetencyAction} submitLabel="Revoke competency" submitVariant="danger" confirm={`Revoke ${c.code} for ${name}? They will no longer pass the competency gate for operations that require it.`}>
                          <input type="hidden" name="employeeId" value={id} />
                          <input type="hidden" name="employeeCompetencyId" value={ec.id} />
                          <TextField label="Reason" name="reason" required />
                        </ActionForm>
                      </Disclosure>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
          {verify && e.isActive && (
            <div className="mt-3">
              {isSelf ? (
                <p className="text-[13px] text-steel">You cannot verify your own competencies — another verifier must record them.</p>
              ) : (
                <Disclosure label="Record verified competency">
                  <ActionForm action={grantCompetencyAction} submitLabel="Record competency" resetOnSuccess>
                    <input type="hidden" name="employeeId" value={id} />
                    <FormGrid cols={3}>
                      <SelectField
                        label="Competency"
                        name="competencyId"
                        required
                        placeholder="Select a competency"
                        options={compList.filter((x) => x.c.isActive).map((x) => ({ value: x.c.id, label: `${x.c.code} — ${x.c.name}${x.c.requiresExpiry ? ` (valid ${x.c.validityMonths ?? 12} months)` : ""}` }))}
                      />
                      <SelectField label="Level" name="level" options={LEVELS} defaultValue="competent" />
                      <TextField label="Expiry date" name="expiresOn" type="date" hint="Leave blank to use the competency's standard validity (if it expires)." />
                    </FormGrid>
                    <TextArea label="Notes" name="notes" rows={2} placeholder="How competence was assessed, e.g. observed setup of 3 jobs" />
                    <FileField label="Evidence (optional)" name="evidence" />
                    <p className="text-[12px] text-steel">Recording a competency replaces any existing active record for the same competency. You are recorded as the verifier.</p>
                  </ActionForm>
                </Disclosure>
              )}
            </div>
          )}
        </Section>
      )}

      {tab === "training" && (
        <Section title="Training records">
          <Table head={["Training", "Provider", "Completed", "Expires", "Certificate", "Notes"]} empty="No training recorded.">
            {training.map((t) => (
              <tr key={t.id}>
                <td className="font-medium">{t.title}</td>
                <td>{t.provider ?? "—"}</td>
                <td>{fmtDate(t.completedOn)}</td>
                <td className={t.expiresOn && t.expiresOn < today ? "font-semibold text-red" : undefined}>
                  {t.expiresOn ? fmtDate(t.expiresOn) : "—"}
                  {t.expiresOn && t.expiresOn < today ? " — expired" : ""}
                </td>
                <td>
                  {t.fileId ? (
                    <a className="link" href={`/api/files/${t.fileId}`}>
                      View
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="max-w-[360px] whitespace-pre-wrap text-steel">{t.notes ?? ""}</td>
              </tr>
            ))}
          </Table>
          {manage && (
            <div className="mt-3">
              <Disclosure label="Add training record">
                <ActionForm action={addTrainingAction} submitLabel="Add record" resetOnSuccess>
                  <input type="hidden" name="employeeId" value={id} />
                  <FormGrid cols={2}>
                    <TextField label="Training" name="title" required placeholder="e.g. Abrasive wheels" />
                    <TextField label="Provider" name="provider" />
                    <TextField label="Completed on" name="completedOn" type="date" required />
                    <TextField label="Expires on" name="expiresOn" type="date" />
                  </FormGrid>
                  <TextArea label="Notes" name="notes" rows={2} />
                  <FileField label="Certificate (optional)" name="file" />
                </ActionForm>
              </Disclosure>
            </div>
          )}
        </Section>
      )}

      {tab === "work" && (
        <>
          <Section title="Current assignments">
            <Table head={["Priority", "Job / op", "Operation", "Part", "Machine", "Role", "Status", "Due"]} empty="No open operations assigned.">
              {assignments.map(({ a, op, job, partNumber, type, machine }) => (
                <tr key={a.id}>
                  <td>
                    <StatusBadge map={PRIORITY} status={String(job.priority)} />
                  </td>
                  <td className="whitespace-nowrap">
                    <Ref href={`/jobs/${job.id}?tab=route`}>{`${job.jobNumber} / ${op.opNumber}`}</Ref>
                  </td>
                  <td>
                    {op.title}
                    <span className="block text-[12px] text-steel">{type}</span>
                  </td>
                  <td className="plate">{partNumber}</td>
                  <td className="plate">{machine ?? "—"}</td>
                  <td className="capitalize">{a.role}</td>
                  <td>
                    <StatusBadge map={OP_STATUS} status={op.status} />
                  </td>
                  <td className={job.requiredDate && job.requiredDate < today ? "font-semibold text-red" : undefined}>{fmtDate(job.requiredDate)}</td>
                </tr>
              ))}
            </Table>
          </Section>
          <Section title="Recent time entries" actions={<span className="text-[12px] text-steel">Last 50 — recorded manually by the operator</span>}>
            <Table head={["Started", "Ended", "Duration", "Type", "Job / op", "Machine", "Good", "Rejected", "Scrapped"]} empty="No time recorded.">
              {time.map(({ t, op, job, machine }) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(t.startedAt)}</td>
                  <td className="whitespace-nowrap">{t.endedAt ? fmtTime(t.endedAt) : <Badge tone="progress">Running</Badge>}</td>
                  <td>{fmtMinutes(((t.endedAt ?? new Date()).getTime() - t.startedAt.getTime()) / 60_000)}</td>
                  <td>{KIND_LABEL[t.kind] ?? t.kind}</td>
                  <td className="whitespace-nowrap">
                    <Ref href={`/jobs/${job.id}?tab=route`} size="sm">{`${job.jobNumber} / ${op.opNumber}`}</Ref>
                  </td>
                  <td className="plate">{machine ?? "—"}</td>
                  <td>{fmtQty(t.qtyGood)}</td>
                  <td>{fmtQty(t.qtyRejected)}</td>
                  <td>{fmtQty(t.qtyScrapped)}</td>
                </tr>
              ))}
            </Table>
          </Section>
        </>
      )}

      {tab === "details" && (
        <>
          <Section title="Details">
            <KeyValues
              items={[
                { label: "Email", value: e.email },
                { label: "Phone", value: e.phone },
                { label: "Working calendar", value: calendar?.name ?? "Default" },
                { label: "Badge code", value: e.badgeCode },
                { label: "Start date", value: e.startDate ? fmtDate(e.startDate) : null },
                { label: "Left", value: e.leftDate ? fmtDate(e.leftDate) : null },
                { label: "Notes", value: e.notes, wide: true },
              ]}
            />
          </Section>
          {manage && (
            <div className="flex flex-wrap items-start gap-3">
              <Disclosure label="Edit details">
                <EmployeeForm action={updateEmployeeAction} employee={e as never} supervisors={supervisors} calendars={calendars.map((c) => ({ value: c.id, label: c.name }))} submitLabel="Save changes" />
              </Disclosure>
              <Disclosure label={e.isActive ? "Deactivate employee" : "Reactivate employee"}>
                <ActionForm
                  action={setEmployeeActiveAction}
                  submitLabel={e.isActive ? "Deactivate" : "Reactivate"}
                  submitVariant={e.isActive ? "danger" : "primary"}
                  confirm={e.isActive ? `Deactivate ${name}? Their assignments on operations that have not started are ended. History is kept.` : undefined}
                >
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="active" value={e.isActive ? "false" : "true"} />
                  <TextField label="Reason" name="reason" required placeholder={e.isActive ? "e.g. Left the company" : "e.g. Returned from leave"} />
                </ActionForm>
              </Disclosure>
            </div>
          )}
        </>
      )}
    </>
  );
}
