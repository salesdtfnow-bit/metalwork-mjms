import Link from "next/link";
import { jobRoute, operationTypesList } from "@/server/services/routing";
import { listMachines, machineGroupsList } from "@/server/services/machines";
import { listCompetencies } from "@/server/services/employees";
import { listPlans } from "@/server/services/inspections";
import { releasedProgramsFor } from "@/server/services/programs";
import { copyRouteSources } from "@/server/services/ui/jobs";
import { can, canAny } from "@/server/context";
import { fmtDate, fmtDateTime, fmtMinutes, fmtQty } from "@/lib/format";
import { OP_STATUS, REVISION_STATUS } from "@/lib/status";
import { Badge, buttonClass, cx, Empty, Notice, Section, StatusBadge, Table } from "@/components/ui";
import { ActionForm, CheckboxField, Disclosure, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { addOperationAction, copyRouteAction, releaseRouteAction, reorderOperationsAction } from "../actions";
import { FIRST_OFF_STATUS, ROUTE_STATUS, STARTED_OP } from "./maps";
import { OperationPanel } from "./OperationPanel";
import { TERMINAL_JOB, type TabProps } from "./types";

export type RouteRow = Awaited<ReturnType<typeof jobRoute>>[number];
export type Opt = { value: string; label: string };
export type RouteOptions = {
  types: Opt[];
  machines: Opt[];
  groups: Opt[];
  competencies: Opt[];
  plans: Opt[];
  /** Released program revisions per part id. */
  programs: Map<string, (Opt & { programId: string })[]>;
};

const TRI = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];
const HEAD = ["Op", "Operation", "Machine", "Program", "Competency", "First-off", "Assigned", "After", "Status", "Planned", "Setup / cycle", "Plan / good / rej / scrap", "Review", ""];

export async function RouteTab({ ctx, data, selectedOpId }: TabProps & { selectedOpId: string | null }) {
  const { job: j, lines } = data;
  const open = !TERMINAL_JOB.includes(j.status);
  const manage = can(ctx.actor, "routing.manage") && open;
  const releasePerm = can(ctx.actor, "routing.release") && open;
  const supervise = can(ctx.actor, "production.supervise");
  const partIds = [...new Set(lines.map((l) => l.line.partId))];

  const [route, types, machines, groups, comps, plans, programLists, copySources] = await Promise.all([
    jobRoute(ctx, j.id),
    manage ? operationTypesList(ctx) : Promise.resolve([]),
    manage && can(ctx.actor, "machines.view") ? listMachines(ctx) : Promise.resolve([]),
    manage ? machineGroupsList(ctx) : Promise.resolve([]),
    manage ? listCompetencies(ctx) : Promise.resolve([]),
    manage && canAny(ctx.actor, "quality.view", "quality.plans") ? listPlans(ctx) : Promise.resolve([]),
    manage || supervise ? Promise.all(partIds.map((partId) => releasedProgramsFor(ctx, { partId }))) : Promise.resolve([]),
    manage ? copyRouteSources(ctx, j.id) : Promise.resolve([]),
  ]);

  const options: RouteOptions = {
    types: types.map((t) => ({ value: t.id, label: t.name })),
    machines: machines.map((m) => ({ value: m.m.id, label: `${m.m.code} — ${m.m.name}${m.maintenanceLock ? " (maintenance lock)" : ""}` })),
    groups: groups.map((g) => ({ value: g.id, label: `${g.code} — ${g.name}` })),
    competencies: comps.filter((c) => c.c.isActive).map((c) => ({ value: c.c.id, label: `${c.c.code} — ${c.c.name}` })),
    plans: plans
      .filter((p) => p.status === "approved" && ["first_off", "in_process"].includes(p.stage))
      .map((p) => ({ value: p.id, label: `${p.code} v${p.version} — ${p.name} (${p.stage === "first_off" ? "first-off" : "in-process"}, ${p.characteristics} char.)` })),
    programs: new Map(partIds.map((partId, i) => [partId, (programLists[i] ?? []).map((r) => ({ value: r.rev.id, programId: r.p.id, label: `${r.p.programNumber} rev ${r.rev.revision} — ${r.p.name}` }))])),
  };
  const typeHints = new Map(types.map((t) => [t.id, t]));

  return (
    <>
      {!j.authorisedAt && open && <Notice tone="warning">This job is not authorised. Routes can be prepared, but no operation can start until the job is authorised.</Notice>}
      {lines.map(({ line: l }) => {
        const ops = route.filter((r) => r.op.jobLineId === l.id).sort((a, b) => a.op.sequence - b.op.sequence);
        const ids = ops.map((o) => o.op.id);
        const sources = copySources.find((c) => c.lineId === l.id)?.sources ?? [];
        const released = l.routeStatus === "released";
        const programs = options.programs.get(l.partId) ?? [];
        return (
          <Section
            key={l.id}
            id={`line-${l.id}`}
            title={
              <span className="flex flex-wrap items-center gap-2">
                <span>
                  Line {l.lineNo} — <span className="plate">{l.partNumber}</span> {l.description}
                </span>
                <StatusBadge map={ROUTE_STATUS} status={l.routeStatus} />
                {l.drawingReviewRequired && <Badge tone="danger">Drawing review required</Badge>}
                <span className="text-[12px] font-normal text-steel">Qty {fmtQty(l.quantity)}</span>
              </span>
            }
            actions={
              <>
                {released && l.routeReleasedAt && <span className="text-[12px] text-steel">Released {fmtDate(l.routeReleasedAt)}</span>}
                {releasePerm && !released && ops.some((o) => o.op.status !== "cancelled") && (
                  <ActionForm action={releaseRouteAction} submitLabel="Release route" submitSize="sm" confirm={`Release the route for line ${l.lineNo} to production? Later changes need a recorded reason.`}>
                    <input type="hidden" name="jobId" value={j.id} />
                    <input type="hidden" name="jobLineId" value={l.id} />
                  </ActionForm>
                )}
              </>
            }
          >
            {ops.length === 0 ? (
              <Empty title="No operations yet">
                {manage ? "Add the first operation below, or copy the route from an earlier job for this part." : "The route for this line has not been prepared."}
              </Empty>
            ) : (
              <Table head={HEAD}>
                {ops.map((r, i) => {
                  const { op, type, machine, program, programRev, competency } = r;
                  const selected = op.id === selectedOpId;
                  const programCurrent = !!programRev && programRev.status === "released" && program?.currentReleasedRevisionId === programRev.id;
                  const movable = (k: number) => k >= 0 && k < ops.length && !STARTED_OP.includes(ops[k].op.status);
                  const swap = (a: number, b: number) => {
                    const next = [...ids];
                    [next[a], next[b]] = [next[b], next[a]];
                    return next.join(",");
                  };
                  return [
                    <tr key={op.id} id={`op-${op.id}`} className={cx(selected && "[&>td]:bg-dykem-50/60", op.status === "cancelled" && "text-steel line-through decoration-steel-2/60")}>
                      <td className="whitespace-nowrap">
                        <span className="plate text-[14px]">{op.opNumber}</span>
                      </td>
                      <td className="min-w-[180px]">
                        <div className="font-medium">{op.title}</div>
                        <div className="text-[12px] text-steel">
                          {type.name}
                          {op.isRework && " · rework"}
                          {op.repeatOfId && " · repeat"}
                          {op.splitFromId && " · split"}
                        </div>
                      </td>
                      <td className="whitespace-nowrap">{machine ? <span title={machine.name}>{machine.code}</span> : op.machineGroupId ? <span className="text-steel">Group</span> : type.requiresMachine ? <span className="text-red">Not set</span> : "—"}</td>
                      <td className="whitespace-nowrap">
                        {program && programRev ? (
                          <div className={cx(!programCurrent && "font-semibold text-red")}>
                            {program.programNumber} rev {programRev.revision}
                            {!programCurrent && (
                              <div className="mt-0.5">
                                <StatusBadge map={REVISION_STATUS} status={programRev.status === "released" ? "superseded" : programRev.status} />
                              </div>
                            )}
                          </div>
                        ) : op.requiresProgram ? (
                          <span className="text-red">Required — not assigned</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="whitespace-nowrap">{competency ? <span title={competency.name}>{competency.code}</span> : "—"}</td>
                      <td>{op.requiresFirstOff ? <StatusBadge map={FIRST_OFF_STATUS} status={op.firstOffStatus} /> : <span className="text-steel">—</span>}</td>
                      <td className="min-w-[110px]">{r.assignments.length ? r.assignments.map((a) => <div key={a.a.id}>{`${a.e.firstName} ${a.e.lastName}`}{a.a.role !== "operator" && <span className="text-[12px] text-steel"> ({a.a.role})</span>}</div>) : <span className="text-steel">—</span>}</td>
                      <td className="whitespace-nowrap">{r.dependsOn.length ? r.dependsOn.join(", ") : <span className="text-steel">{op.allowParallel ? "Parallel" : "—"}</span>}</td>
                      <td>
                        <StatusBadge map={OP_STATUS} status={op.status} />
                      </td>
                      <td className="whitespace-nowrap text-[12.5px]">
                        {op.plannedStart ? (
                          <>
                            <div>{fmtDateTime(op.plannedStart)}</div>
                            <div className="text-steel">to {fmtDateTime(op.plannedEnd)}</div>
                          </>
                        ) : (
                          <span className="text-steel">Not scheduled</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-[12.5px]">
                        {fmtMinutes(op.setupMinutesEst)} / {fmtMinutes(op.cycleMinutesEst)}
                      </td>
                      <td className="whitespace-nowrap tabular-nums">
                        {fmtQty(op.plannedQty)} / {fmtQty(op.qtyGood)} / <span className={cx(Number(op.qtyRejected) > 0 && "text-red")}>{fmtQty(op.qtyRejected)}</span> / {fmtQty(op.qtyScrapped)}
                      </td>
                      <td className="min-w-[120px]">
                        {op.reviewRequired ? (
                          <>
                            <Badge tone="danger">Review required</Badge>
                            {op.reviewReason && <div className="mt-0.5 text-[12px] text-red">{op.reviewReason}</div>}
                          </>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {manage && movable(i) && movable(i - 1) && (
                            <ActionForm action={reorderOperationsAction} submitLabel="Up" submitVariant="ghost" submitSize="sm" inline>
                              <input type="hidden" name="jobId" value={j.id} />
                              <input type="hidden" name="jobLineId" value={l.id} />
                              <input type="hidden" name="order" value={swap(i, i - 1)} />
                            </ActionForm>
                          )}
                          {manage && movable(i) && movable(i + 1) && (
                            <ActionForm action={reorderOperationsAction} submitLabel="Down" submitVariant="ghost" submitSize="sm" inline>
                              <input type="hidden" name="jobId" value={j.id} />
                              <input type="hidden" name="jobLineId" value={l.id} />
                              <input type="hidden" name="order" value={swap(i, i + 1)} />
                            </ActionForm>
                          )}
                          <Link
                            href={selected ? `/jobs/${j.id}?tab=route#line-${l.id}` : `/jobs/${j.id}?tab=route&op=${op.id}#op-${op.id}`}
                            className={buttonClass(selected ? "primary" : "secondary", "sm")}
                            aria-expanded={selected}
                          >
                            {selected ? "Close" : "Manage"}
                          </Link>
                        </div>
                      </td>
                    </tr>,
                    selected ? (
                      <tr key={`${op.id}-panel`}>
                        <td colSpan={HEAD.length} className="bg-paper p-3">
                          <OperationPanel ctx={ctx} job={j} line={l} row={r} route={route} options={options} programs={programs} />
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
              </Table>
            )}

            {manage && (
              <div className="mt-3 flex flex-wrap items-start gap-2">
                <Disclosure label="Add operation">
                  <ActionForm action={addOperationAction} submitLabel="Add operation" resetOnSuccess>
                    <input type="hidden" name="jobId" value={j.id} />
                    <input type="hidden" name="jobLineId" value={l.id} />
                    <FormGrid cols={3}>
                      <SelectField label="Operation type" name="operationTypeId" required placeholder="Select type" options={options.types} />
                      <TextField label="Title" name="title" required placeholder="e.g. Mill complete, op 1 datum face" className="sm:col-span-2" />
                      <SelectField label="Machine" name="machineId" placeholder="No specific machine" options={options.machines} hint={options.machines.length ? undefined : "Machine list needs the machines view permission."} />
                      <SelectField label="Machine group" name="machineGroupId" placeholder="None" options={options.groups} />
                      <TextField label="Planned quantity" name="plannedQty" inputMode="decimal" placeholder={fmtQty(l.quantity)} hint="Blank = line quantity." />
                      <TextField label="Setup estimate (min)" name="setupMinutesEst" required inputMode="decimal" defaultValue="0" />
                      <TextField label="Cycle estimate per part (min)" name="cycleMinutesEst" required inputMode="decimal" defaultValue="0" />
                      <SelectField label="CNC program revision" name="programRevisionId" placeholder="None yet" options={programs} hint={programs.length ? "Current released revisions for this part." : "No released program for this part yet."} />
                      <SelectField label="Inspection plan" name="inspectionPlanId" placeholder="None" options={options.plans} hint="Approved first-off and in-process plans. Required before release when first-off is required." />
                      <SelectField label="Required competency" name="requiredCompetencyId" placeholder="Operation type default" options={options.competencies} />
                      <SelectField label="Requires material" name="requiresMaterial" placeholder="Use default (first operation only)" options={TRI} />
                      <SelectField label="Requires CNC program" name="requiresProgram" placeholder="Use operation type default" options={TRI} />
                      <SelectField label="Requires first-off" name="requiresFirstOff" placeholder="Use operation type default" options={TRI} />
                      <SelectField
                        label="Depends on"
                        name="dependsOn"
                        defaultValue="previous"
                        options={[
                          { value: "previous", label: ops.length ? `Previous operation (${ops[ops.length - 1].op.opNumber})` : "Previous operation" },
                          { value: "none", label: "None — can start independently" },
                        ]}
                      />
                    </FormGrid>
                    <CheckboxField label="Allow parallel running" name="allowParallel" hint="The operation may run alongside others on the line." />
                    <FormGrid cols={3}>
                      <TextArea label="Instructions" name="instructions" rows={2} />
                      <TextArea label="Tooling requirements" name="toolingRequirements" rows={2} />
                      <TextArea label="Fixture requirements" name="fixtureRequirements" rows={2} />
                    </FormGrid>
                    {released && <TextArea label="Reason for adding to a released route" name="reason" required rows={2} />}
                    {options.types.length > 0 && (
                      <details className="text-[12px] text-steel">
                        <summary className="cursor-pointer">Operation type defaults</summary>
                        <ul className="mt-1 grid gap-x-4 sm:grid-cols-2">
                          {[...typeHints.values()].map((t) => (
                            <li key={t.id}>
                              {t.name}: {t.requiresMachine ? "machine" : "no machine"}, program {t.requiresProgramDefault ? "yes" : "no"}, first-off {t.requiresFirstOffDefault ? "yes" : "no"}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </ActionForm>
                </Disclosure>
                {ops.length === 0 && sources.length > 0 && (
                  <Disclosure label="Copy route from another job">
                    <ActionForm action={copyRouteAction} submitLabel="Copy route">
                      <input type="hidden" name="jobId" value={j.id} />
                      <input type="hidden" name="jobLineId" value={l.id} />
                      <SelectField
                        label="Copy from"
                        name="sourceLineId"
                        required
                        placeholder="Select an earlier line of this part"
                        options={sources.map((s) => ({ value: s.lineId, label: `${s.jobNumber} line ${s.lineNo} — ${s.ops} operation(s), ${fmtDate(s.createdAt)}` }))}
                        hint="Operations, dependencies and plans are copied. Only current released program revisions carry over."
                      />
                    </ActionForm>
                  </Disclosure>
                )}
              </div>
            )}
          </Section>
        );
      })}
    </>
  );
}
