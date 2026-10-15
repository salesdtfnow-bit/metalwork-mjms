import Link from "next/link";
import { evaluateGates, OVERRIDABLE } from "@/server/services/gates";
import { listEmployees } from "@/server/services/employees";
import { attachableDocuments, operationGateExceptions, programMachineCompat } from "@/server/services/ui/jobs";
import { can, canAny, type Ctx } from "@/server/context";
import { d } from "@/lib/decimal";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { OP_STATUS } from "@/lib/status";
import { Badge, KeyValues, Panel, StatusBadge, Table } from "@/components/ui";
import { ActionForm, CheckboxField, Disclosure, FormGrid, SelectField, SignatureBlock, TextArea, TextField } from "@/components/forms";
import {
  assignOperatorAction,
  attachOperationDocumentAction,
  cancelOperationAction,
  clearReviewAction,
  recordGateExceptionAction,
  repeatOperationAction,
  revokeGateExceptionAction,
  setDependenciesAction,
  splitOperationAction,
  unassignOperatorAction,
  updateOperationAction,
} from "../actions";
import { DOC_PURPOSE, GATE_EXCEPTION_STATUS, gateName, STARTED_OP } from "./maps";
import type { JobData } from "./types";
import type { Opt, RouteOptions, RouteRow } from "./RouteTab";

type Props = {
  ctx: Ctx;
  job: JobData["job"];
  line: JobData["lines"][number]["line"];
  row: RouteRow;
  route: RouteRow[];
  options: RouteOptions;
  programs: (Opt & { programId: string })[];
};

/** Expanded panel for the selected operation: gates, assignments, documents and every routing action. */
export async function OperationPanel({ ctx, job, line, row, route, options, programs }: Props) {
  const { op, type, plan, machine, program, programRev, competency } = row;
  const open = !["completed", "cancelled"].includes(job.status);
  const manage = can(ctx.actor, "routing.manage") && open;
  const assign = can(ctx.actor, "production.assign") && open;
  const supervise = can(ctx.actor, "production.supervise") && open;
  const override = can(ctx.actor, "production.override_gate") && open;
  const docsPerm = canAny(ctx.actor, "routing.manage", "programs.create") && open;
  const started = STARTED_OP.includes(op.status);
  const closed = ["complete", "cancelled"].includes(op.status);
  const released = line.routeStatus === "released";

  const [gates, exceptions, employees, docs, compat] = await Promise.all([
    evaluateGates(ctx, op.id, { phase: "setup", employeeId: null }),
    operationGateExceptions(ctx, op.id),
    assign && !closed ? listEmployees(ctx) : Promise.resolve([]),
    docsPerm || supervise ? attachableDocuments(ctx, job.id) : Promise.resolve([]),
    programMachineCompat(ctx, programs.map((p) => p.programId)),
  ]);

  const machineCode = (id: string) => options.machines.find((m) => m.value === id)?.label.split(" — ")[0] ?? "?";
  const programOptions = (forMachine: string | null) =>
    programs.map((p) => {
      const machinesFor = compat.filter((c) => c.programId === p.programId).map((c) => c.machineId);
      const note = !machinesFor.length ? "" : forMachine && !machinesFor.includes(forMachine) ? ` (not approved for this machine)` : ` (${machinesFor.map(machineCode).join(", ")})`;
      return { value: p.value, label: `${p.label}${note}` };
    });
  const currentPinned = op.programRevisionId && !programs.some((p) => p.value === op.programRevisionId) && program && programRev ? [{ value: op.programRevisionId, label: `${program.programNumber} rev ${programRev.revision} — pinned, no longer current released` }] : [];
  const planOptions = op.inspectionPlanId && plan && !options.plans.some((p) => p.value === op.inspectionPlanId) ? [{ value: plan.id, label: `${plan.code} v${plan.version} — ${plan.name} (${plan.status})` }, ...options.plans] : options.plans;
  const drawingRevs = docs.filter((x) => x.doc.docType === "drawing" && (x.doc.partId === line.partId || !x.doc.partId));
  const others = route.filter((r) => r.op.id !== op.id && r.op.status !== "cancelled");
  const hidden = (
    <>
      <input type="hidden" name="jobId" value={job.id} />
      <input type="hidden" name="opId" value={op.id} />
    </>
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-semibold">
            Operation <span className="plate">{op.opNumber}</span> — {op.title}
          </h3>
          <StatusBadge map={OP_STATUS} status={op.status} />
          {op.reviewRequired && <Badge tone="danger">Review required</Badge>}
        </div>

        <Panel className="p-3">
          <h4 className="mb-1 text-[13px] font-semibold">Start gates (setup)</h4>
          <p className="mb-2 text-[12px] text-steel">Evaluated now, as they would be when an operator starts setup. The operator gate is checked against whoever starts the operation.</p>
          <ul className="divide-y divide-line-2">
            {gates.map((g) => {
              const operatorPending = g.gate === "operator";
              return (
                <li key={g.gate} className="flex items-start gap-2 py-1.5 text-[13px]">
                  <span className="w-[150px] shrink-0 font-medium">{gateName(g.gate)}</span>
                  <span className="shrink-0">{operatorPending ? <Badge tone="muted">At start</Badge> : g.ok ? <Badge tone={g.overriddenBy ? "warning" : "success"}>{g.overriddenBy ? "Passed by exception" : "Pass"}</Badge> : <Badge tone="danger">Blocked</Badge>}</span>
                  <span className="text-steel">{operatorPending ? (row.assignments.length ? `Assigned: ${row.assignments.map((a) => `${a.e.firstName} ${a.e.lastName}`).join(", ")}.` : "No operator assigned yet.") : g.message}</span>
                </li>
              );
            })}
          </ul>
        </Panel>

        {exceptions.length > 0 && (
          <div>
            <h4 className="mb-1 text-[13px] font-semibold">Gate exceptions</h4>
            <Table head={["Ref", "Gate", "Status", "Reason", "Authorised", "Valid until", ""]}>
              {exceptions.map(({ e, by }) => (
                <tr key={e.id}>
                  <td className="plate text-[13px]">{e.ref}</td>
                  <td>{gateName(e.gate)}</td>
                  <td>
                    <StatusBadge map={GATE_EXCEPTION_STATUS} status={e.status} />
                  </td>
                  <td className="max-w-[260px] whitespace-pre-wrap text-steel">{e.reason}</td>
                  <td className="whitespace-nowrap">
                    {by ?? "—"}
                    <div className="text-[12px] text-steel">{fmtDateTime(e.createdAt)}</div>
                  </td>
                  <td className="whitespace-nowrap">{e.validUntil ? fmtDateTime(e.validUntil) : "No expiry"}</td>
                  <td>
                    {override && e.status === "approved" && (
                      <Disclosure label="Revoke" variant="ghost">
                        <ActionForm action={revokeGateExceptionAction} submitLabel="Revoke exception" submitVariant="danger" submitSize="sm">
                          <input type="hidden" name="jobId" value={job.id} />
                          <input type="hidden" name="exceptionId" value={e.id} />
                          <TextField label="Reason" name="reason" required />
                        </ActionForm>
                      </Disclosure>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        )}

        <KeyValues
          cols={3}
          items={[
            { label: "Operation type", value: type.name },
            { label: "Machine", value: machine ? `${machine.code} — ${machine.name}` : null },
            { label: "Required competency", value: competency ? `${competency.code} — ${competency.name}` : null },
            { label: "Inspection plan", value: plan ? `${plan.code} v${plan.version} — ${plan.name}` : null },
            { label: "Setup status", value: op.setupStatus.replace(/_/g, " ") },
            { label: "Requires", value: [op.requiresMaterial && "material", op.requiresProgram && "CNC program", op.requiresFirstOff && "first-off"].filter(Boolean).join(", ") || "Nothing extra" },
            { label: "Actual start", value: fmtDateTime(op.actualStart) },
            { label: "Actual end", value: fmtDateTime(op.actualEnd) },
            { label: "Signed off", value: op.signedOffAt ? fmtDateTime(op.signedOffAt) : null },
            { label: "Instructions", value: op.instructions, wide: true },
            { label: "Tooling", value: op.toolingRequirements },
            { label: "Fixtures", value: op.fixtureRequirements },
          ]}
        />

        <div>
          <h4 className="mb-1 text-[13px] font-semibold">Documents issued to this operation</h4>
          <Table head={["Document", "Revision", "Purpose", "Issued"]} empty="No documents issued.">
            {row.documents.map((x) => (
              <tr key={x.od.id}>
                <td>
                  <Link href={`/documents/${x.doc.id}`} className="link">
                    {x.doc.docNumber}
                  </Link>{" "}
                  <span className="text-steel">{x.doc.title}</span>
                </td>
                <td>
                  {x.rev.revision}
                  {x.rev.status !== "released" && (
                    <Badge tone="danger" className="ml-1.5">
                      {x.rev.status}
                    </Badge>
                  )}
                </td>
                <td className="capitalize">{x.od.purpose.replace(/_/g, " ")}</td>
                <td className="whitespace-nowrap text-steel">{fmtDateTime(x.od.pinnedAt)}</td>
              </tr>
            ))}
          </Table>
        </div>

        <div>
          <h4 className="mb-1 text-[13px] font-semibold">Assignments</h4>
          <Table head={["Employee", "Role", "Assigned", ""]} empty="Nobody assigned.">
            {row.assignments.map((a) => (
              <tr key={a.a.id}>
                <td>{`${a.e.firstName} ${a.e.lastName}`}</td>
                <td className="capitalize">{a.a.role}</td>
                <td className="whitespace-nowrap text-steel">{fmtDateTime(a.a.assignedAt)}</td>
                <td>
                  {assign && (
                    <ActionForm action={unassignOperatorAction} submitLabel="Remove" submitVariant="ghost" submitSize="sm" inline>
                      <input type="hidden" name="jobId" value={job.id} />
                      <input type="hidden" name="assignmentId" value={a.a.id} />
                      <input name="reason" required placeholder="Reason" aria-label="Reason for removing" className="field-input h-7 w-40 py-0.5 text-[12.5px]" />
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      </div>

      <div className="space-y-2">
        {!manage && !assign && !supervise && !override && <p className="text-[13px] text-steel">You can view this operation. Changes need routing, assignment or supervision permissions.</p>}

        {manage && !closed && (
          <Disclosure label="Edit operation">
            <ActionForm action={updateOperationAction} submitLabel="Save operation">
              {hidden}
              <input type="hidden" name="currentProgramRevisionId" value={op.programRevisionId ?? ""} />
              <FormGrid cols={2}>
                {!started && <SelectField label="Operation type" name="operationTypeId" defaultValue={op.operationTypeId} options={options.types} />}
                <TextField label="Title" name="title" required defaultValue={op.title} className={started ? "sm:col-span-2" : undefined} />
                <SelectField label="Machine" name="machineId" defaultValue={op.machineId} placeholder="No specific machine" options={options.machines} />
                <SelectField label="Machine group" name="machineGroupId" defaultValue={op.machineGroupId} placeholder="None" options={options.groups} />
                <TextField label="Setup estimate (min)" name="setupMinutesEst" required inputMode="decimal" defaultValue={d(op.setupMinutesEst).toString()} />
                <TextField label="Cycle estimate per part (min)" name="cycleMinutesEst" required inputMode="decimal" defaultValue={d(op.cycleMinutesEst).toString()} />
                <TextField label="Planned quantity" name="plannedQty" inputMode="decimal" defaultValue={d(op.plannedQty).toString()} />
                {started ? (
                  <div className="text-[12.5px] text-steel">
                    <input type="hidden" name="programRevisionId" value={op.programRevisionId ?? ""} />
                    <span className="block font-medium text-ink-2">CNC program revision</span>
                    {program && programRev ? `${program.programNumber} rev ${programRev.revision}` : "None"} — the program of a started operation changes through the revision review only.
                  </div>
                ) : (
                  <SelectField label="CNC program revision" name="programRevisionId" defaultValue={op.programRevisionId} placeholder="None" options={[...currentPinned, ...programOptions(op.machineId)]} />
                )}
                <SelectField label="Inspection plan" name="inspectionPlanId" defaultValue={op.inspectionPlanId} placeholder="None" options={planOptions} />
                <SelectField label="Required competency" name="requiredCompetencyId" defaultValue={op.requiredCompetencyId} placeholder="None" options={options.competencies} />
              </FormGrid>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                <CheckboxField label="Requires material" name="requiresMaterial" defaultChecked={op.requiresMaterial} />
                <CheckboxField label="Requires CNC program" name="requiresProgram" defaultChecked={op.requiresProgram} />
                <CheckboxField label="Requires first-off" name="requiresFirstOff" defaultChecked={op.requiresFirstOff} hint={op.firstOffStatus === "approved" ? "First-off already approved." : undefined} />
                <CheckboxField label="Allow parallel running" name="allowParallel" defaultChecked={op.allowParallel} />
              </div>
              <TextArea label="Instructions" name="instructions" defaultValue={op.instructions} rows={3} />
              <FormGrid cols={2}>
                <TextArea label="Tooling requirements" name="toolingRequirements" defaultValue={op.toolingRequirements} rows={2} />
                <TextArea label="Fixture requirements" name="fixtureRequirements" defaultValue={op.fixtureRequirements} rows={2} />
              </FormGrid>
              <TextArea
                label="Reason for change"
                name="reason"
                rows={2}
                required={released || started}
                hint={released || started ? "Required: the route is released or the operation has started." : "Optional; recorded in the history."}
              />
            </ActionForm>
          </Disclosure>
        )}

        {assign && !closed && (
          <Disclosure label="Assign operator">
            <ActionForm action={assignOperatorAction} submitLabel="Assign" resetOnSuccess>
              {hidden}
              <SelectField
                label="Employee"
                name="employeeId"
                required
                placeholder="Select employee"
                options={employees.map((e) => {
                  if (!op.requiredCompetencyId) return { value: e.id, label: e.name };
                  const held = e.competencies.find((c) => c.c.id === op.requiredCompetencyId);
                  const hint = !held ? "not qualified" : held.expired ? "competency expired" : held.ec.level === "trainee" ? "trainee only" : "qualified";
                  return { value: e.id, label: `${e.name} — ${hint}` };
                })}
                hint={competency ? `Requires "${competency.name}". Unqualified operators can only be assigned under an authorised operator gate exception.` : undefined}
              />
              <SelectField
                label="Role"
                name="role"
                defaultValue="operator"
                options={[
                  { value: "operator", label: "Operator" },
                  { value: "setter", label: "Setter" },
                  { value: "inspector", label: "Inspector" },
                ]}
              />
            </ActionForm>
          </Disclosure>
        )}

        {manage && !started && op.status !== "cancelled" && (
          <Disclosure label="Dependencies">
            <ActionForm action={setDependenciesAction} submitLabel="Save dependencies">
              {hidden}
              <fieldset>
                <legend className="mb-1 text-[12.5px] font-medium text-ink-2">Must finish before operation {op.opNumber} can start</legend>
                {others.length ? (
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {others.map((o) => (
                      <CheckboxField
                        key={o.op.id}
                        name="dependsOn"
                        value={o.op.id}
                        defaultChecked={row.dependsOnIds.includes(o.op.id)}
                        label={`${o.op.jobLineId === op.jobLineId ? "" : "Other line · "}${o.op.opNumber} ${o.op.title}`}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] text-steel">No other operations on this job.</p>
                )}
              </fieldset>
              <p className="text-[12px] text-steel">With nothing ticked the operation can run in parallel.</p>
              <TextField label="Reason" name="reason" />
            </ActionForm>
          </Disclosure>
        )}

        {docsPerm && !closed && (
          <Disclosure label="Attach document">
            {docs.length ? (
              <ActionForm action={attachOperationDocumentAction} submitLabel="Issue to operation" resetOnSuccess>
                {hidden}
                <SelectField
                  label="Released document revision"
                  name="documentRevisionId"
                  required
                  placeholder="Select document"
                  options={docs.map((x) => ({ value: x.rev.id, label: `${x.doc.docNumber} rev ${x.rev.revision} — ${x.doc.title} (${x.doc.docType.replace(/_/g, " ")})` }))}
                  hint="Only released revisions linked to this part or customer are listed."
                />
                <SelectField label="Purpose" name="purpose" defaultValue="work_instruction" options={DOC_PURPOSE} />
              </ActionForm>
            ) : (
              <p className="text-[13px] text-steel">No released documents are linked to this part or customer.</p>
            )}
          </Disclosure>
        )}

        {manage && !started && op.status !== "cancelled" && (
          <Disclosure label="Split into batches">
            <ActionForm action={splitOperationAction} submitLabel="Split operation">
              {hidden}
              <TextField label="Quantities" name="quantities" required placeholder="e.g. 20, 30" hint={`Comma-separated; must add up to ${fmtQty(op.plannedQty)}. Each part becomes a batch (${op.opNumber}A, ${op.opNumber}B, …).`} />
              <TextArea label="Reason" name="reason" required rows={2} />
            </ActionForm>
          </Disclosure>
        )}

        {manage && op.status !== "cancelled" && (
          <Disclosure label="Repeat operation">
            <ActionForm action={repeatOperationAction} submitLabel="Add repeat">
              {hidden}
              <p className="text-[13px] text-steel">Adds a copy of this operation after it (e.g. a second pass), depending on this one.</p>
              <TextArea label="Reason" name="reason" required rows={2} />
            </ActionForm>
          </Disclosure>
        )}

        {manage && !closed && (!started || op.status === "paused") && d(op.qtyGood).isZero() && (
          <Disclosure label="Cancel operation" variant="ghost">
            <ActionForm action={cancelOperationAction} submitLabel="Cancel operation" submitVariant="danger" confirm={`Cancel operation ${op.opNumber}? Operations that depend on it will no longer wait for it.`}>
              {hidden}
              <TextArea label="Reason" name="reason" required rows={2} />
            </ActionForm>
          </Disclosure>
        )}

        {supervise && op.reviewRequired && (
          <Disclosure label="Clear review" defaultOpen>
            <ActionForm action={clearReviewAction} submitLabel="Clear review">
              {hidden}
              <p className="text-[13px] text-ink-2">Review reason: {op.reviewReason ?? "—"}</p>
              <SelectField label="Switch to program revision" name="programRevisionId" placeholder="Keep pinned revision" options={programOptions(op.machineId)} hint="The pinned revision can only be kept if it is still the current released revision." />
              <SelectField
                label="Switch to drawing revision"
                name="drawingRevisionId"
                placeholder="Keep pinned drawing"
                options={drawingRevs.map((x) => ({ value: x.rev.id, label: `${x.doc.docNumber} rev ${x.rev.revision} — ${x.doc.title}` }))}
              />
              <TextArea label="Review decision" name="reason" required rows={2} placeholder="e.g. Rev C only changes the chamfer note; op 20 unaffected" />
            </ActionForm>
          </Disclosure>
        )}

        {override && !closed && (
          <Disclosure label="Record gate exception" variant="ghost">
            <ActionForm action={recordGateExceptionAction} submitLabel="Sign exception" submitVariant="danger">
              {hidden}
              <SelectField label="Gate" name="gate" required placeholder="Select gate" options={OVERRIDABLE.map((g) => ({ value: g, label: gateName(g) }))} hint="Program, machine and hold gates can never be overridden." />
              <TextArea label="Justification" name="reason" required rows={3} hint="At least 10 characters. State why it is safe to proceed." />
              <TextField label="Valid for (hours)" name="validHours" inputMode="numeric" hint="Blank = until revoked." />
              <SignatureBlock meaning={`I authorise an exception to bypass the selected gate for ${job.jobNumber} operation ${op.opNumber}, and accept responsibility for this decision.`} />
            </ActionForm>
          </Disclosure>
        )}
      </div>
    </div>
  );
}
