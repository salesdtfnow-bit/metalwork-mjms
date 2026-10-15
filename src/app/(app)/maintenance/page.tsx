import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { calibrationDue, listMaintenancePlans, listWorkOrders } from "@/server/services/maintenance";
import { employeeOptions, inactiveMaintenancePlans, machineOptions, maintenanceProviders } from "@/server/services/ui/workshop";
import { addDaysISO, daysBetween, fmtDate, fmtDateTime, fmtQty, todayISO } from "@/lib/format";
import { MWO_STATUS, PRIORITY } from "@/lib/status";
import { Badge, LinkButton, PageHeader, Ref, Section, StatusBadge, Table, Tabs, cx } from "@/components/ui";
import { ActionForm, Disclosure, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { INSTRUMENT_STATUS, kindLabel } from "./_components/vocab";
import { savePlanAction, setPlanActiveAction } from "./actions";

export const metadata = { title: "Maintenance" };

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ tab?: string; scope?: string }> }) {
  const ctx = await requirePageCtx("maintenance.view");
  const sp = await searchParams;
  const tab = sp.tab ?? "work_orders";
  const manage = can(ctx.actor, "maintenance.manage");
  const today = todayISO();

  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Machine work orders, preventive maintenance plans and measuring-instrument calibration due. Work orders that lock a machine block it from being scheduled or started."
        actions={manage && <LinkButton href="/maintenance/new" variant="primary">Raise work order</LinkButton>}
      />
      <Tabs
        base="/maintenance"
        current={tab}
        tabs={[
          { key: "work_orders", label: "Work orders" },
          { key: "plans", label: "Plans" },
          { key: "calibration", label: "Calibration due" },
        ]}
      />

      {tab === "work_orders" && <WorkOrders ctx={ctx} scope={sp.scope === "all" ? "all" : "open"} today={today} />}
      {tab === "plans" && <Plans ctx={ctx} manage={manage} today={today} />}
      {tab === "calibration" && <Calibration ctx={ctx} today={today} />}
    </>
  );
}

type PageCtx = Awaited<ReturnType<typeof requirePageCtx>>;

async function WorkOrders({ ctx, scope, today }: { ctx: PageCtx; scope: "open" | "all"; today: string }) {
  const rows = await listWorkOrders(ctx, { open: scope === "open" });
  return (
    <>
      <div className="mb-3 flex gap-1 text-[13px]" role="group" aria-label="Scope">
        <Link href="/maintenance?tab=work_orders&scope=open" aria-current={scope === "open" ? "true" : undefined} className={cx("rounded-sm border px-2.5 py-1", scope === "open" ? "border-dykem bg-dykem text-white" : "border-line bg-sheet")}>
          Open
        </Link>
        <Link href="/maintenance?tab=work_orders&scope=all" aria-current={scope === "all" ? "true" : undefined} className={cx("rounded-sm border px-2.5 py-1", scope === "all" ? "border-dykem bg-dykem text-white" : "border-line bg-sheet")}>
          All
        </Link>
      </div>
      <Table head={["Work order", "Machine", "Kind", "Title", "Priority", "Status", "Scheduled", "Provider", "Reported"]} empty={scope === "open" ? "No open work orders." : "No work orders yet."}>
        {rows.map(({ wo, machine, machineName, provider, reportedBy }) => {
          const late = wo.status === "scheduled" && wo.scheduledEnd && wo.scheduledEnd.toISOString().slice(0, 10) < today;
          return (
            <tr key={wo.id}>
              <td>
                <Ref href={`/maintenance/${wo.id}`} size="sm">
                  {wo.ref}
                </Ref>
              </td>
              <td>
                <span className="plate text-[12.5px]">{machine}</span>
                <span className="block max-w-[160px] truncate text-[11.5px] text-steel">{machineName}</span>
              </td>
              <td>{wo.kind === "breakdown" ? <Badge tone="danger">Breakdown</Badge> : kindLabel(wo.kind)}</td>
              <td className="max-w-[280px] truncate font-medium">{wo.title}</td>
              <td>
                <StatusBadge map={PRIORITY} status={String(wo.priority)} />
              </td>
              <td>
                <StatusBadge map={MWO_STATUS} status={wo.status} />
                {wo.locksMachine && !["completed", "cancelled"].includes(wo.status) && <span className="ml-1 text-[11.5px] text-steel">locks machine</span>}
              </td>
              <td className={cx("whitespace-nowrap text-[12.5px]", late && "font-semibold text-red")}>{wo.scheduledStart ? `${fmtDateTime(wo.scheduledStart)} – ${fmtDateTime(wo.scheduledEnd)}` : "—"}</td>
              <td>{provider ?? "In-house"}</td>
              <td className="whitespace-nowrap text-[12.5px] text-steel">
                {fmtDate(wo.reportedAt)}
                {reportedBy && <span className="block">{reportedBy}</span>}
              </td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}

async function Plans({ ctx, manage, today }: { ctx: PageCtx; manage: boolean; today: string }) {
  const [rows, inactive] = await Promise.all([listMaintenancePlans(ctx), inactiveMaintenancePlans(ctx)]);
  const [machines, employees, providers] = manage ? await Promise.all([machineOptions(ctx), employeeOptions(ctx), maintenanceProviders(ctx)]) : [[], [], []];
  return (
    <Section title="Preventive maintenance plans" actions={<span className="text-[12px] text-steel">Preventive work orders are raised automatically 7 days before a plan falls due.</span>}>
      <Table head={["Machine", "Plan", "Interval", "Est. hours", "Last done", "Next due", ""]} empty="No active maintenance plans.">
        {rows.map(({ p, machine }) => {
          const overdue = !!p.nextDueOn && p.nextDueOn < today;
          const soon = !overdue && !!p.nextDueOn && p.nextDueOn <= addDaysISO(today, 7);
          return (
            <tr key={p.id}>
              <td className="plate text-[12.5px]">{machine}</td>
              <td>
                <span className="font-medium">{p.title}</span>
                {p.checklist && <span className="block max-w-[360px] truncate text-[12px] text-steel">{p.checklist}</span>}
              </td>
              <td>Every {p.intervalDays} days</td>
              <td>{p.estimatedHours ? fmtQty(p.estimatedHours, "h") : "—"}</td>
              <td>{fmtDate(p.lastDoneOn)}</td>
              <td className={cx("whitespace-nowrap", overdue && "font-semibold text-red", soon && "text-[#7a4d06]")}>
                {fmtDate(p.nextDueOn)}
                {overdue && <span className="block text-[11.5px]">Overdue by {daysBetween(p.nextDueOn!, today)} d</span>}
                {soon && <span className="block text-[11.5px]">Due soon</span>}
              </td>
              <td>
                {manage && (
                  <div className="flex flex-col gap-1.5">
                    <Disclosure label="Edit" variant="ghost">
                      <PlanForm machines={machines} employees={employees} providers={providers} plan={p} />
                    </Disclosure>
                    <PlanActiveForm id={p.id} active={false} />
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </Table>
      {manage && (
        <div className="mt-3">
          <Disclosure label="New plan">
            <PlanForm machines={machines} employees={employees} providers={providers} />
          </Disclosure>
        </div>
      )}
      {inactive.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-1.5 text-[13px] font-semibold text-ink">Deactivated plans ({inactive.length})</h3>
          <Table head={["Machine", "Plan", "Interval", "Last done", ""]}>
            {inactive.map(({ p, machine }) => (
              <tr key={p.id} className="text-steel">
                <td className="plate text-[12.5px]">{machine}</td>
                <td>
                  {p.title} <Badge tone="muted">Inactive</Badge>
                </td>
                <td>Every {p.intervalDays} days</td>
                <td>{fmtDate(p.lastDoneOn)}</td>
                <td>{manage && <PlanActiveForm id={p.id} active />}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </Section>
  );
}

/** Deactivate (active=false) or reactivate (active=true) a plan, with a reason. */
function PlanActiveForm({ id, active }: { id: string; active: boolean }) {
  return (
    <Disclosure label={active ? "Reactivate" : "Deactivate"} variant="ghost">
      <ActionForm
        action={setPlanActiveAction}
        submitLabel={active ? "Reactivate plan" : "Deactivate plan"}
        submitVariant={active ? "primary" : "danger"}
        submitSize="sm"
        confirm={active ? undefined : "No further preventive work orders will be raised from this plan until it is reactivated. Existing work orders are not changed."}
      >
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="active" value={active ? "true" : "false"} />
        <TextArea label="Reason" name="reason" required rows={2} />
      </ActionForm>
    </Disclosure>
  );
}

function PlanForm({
  machines,
  employees,
  providers,
  plan,
}: {
  machines: { id: string; code: string; name: string }[];
  employees: { id: string; no: string; firstName: string; lastName: string }[];
  providers: { id: string; name: string }[];
  plan?: { id: string; machineId: string; title: string; intervalDays: number; checklist: string | null; estimatedHours: string | null; responsibleEmployeeId: string | null; serviceProviderId: string | null; lastDoneOn: string | null };
}) {
  return (
    <ActionForm action={savePlanAction} submitLabel={plan ? "Save plan" : "Create plan"} resetOnSuccess={!plan}>
      {plan && <input type="hidden" name="id" value={plan.id} />}
      <FormGrid cols={3}>
        <SelectField label="Machine" name="machineId" required options={machines.map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` }))} defaultValue={plan?.machineId} placeholder="Select…" />
        <TextField label="Title" name="title" required defaultValue={plan?.title} placeholder="e.g. Quarterly spindle & way-lube service" className="sm:col-span-2" />
        <TextField label="Interval (days)" name="intervalDays" required inputMode="numeric" defaultValue={plan?.intervalDays} />
        <TextField label="Estimated hours" name="estimatedHours" inputMode="decimal" defaultValue={plan?.estimatedHours} />
        <TextField label="Last done on" name="lastDoneOn" type="date" defaultValue={plan?.lastDoneOn} hint="Next due = last done + interval (or today + interval)." />
        <SelectField label="Responsible" name="responsibleEmployeeId" options={employees.map((e) => ({ value: e.id, label: `${e.firstName} ${e.lastName} (${e.no})` }))} defaultValue={plan?.responsibleEmployeeId} placeholder="—" />
        <SelectField label="Service provider" name="serviceProviderId" options={providers.map((p) => ({ value: p.id, label: p.name }))} defaultValue={plan?.serviceProviderId} placeholder="In-house" />
      </FormGrid>
      <TextArea label="Checklist" name="checklist" rows={3} defaultValue={plan?.checklist} />
    </ActionForm>
  );
}

async function Calibration({ ctx, today }: { ctx: PageCtx; today: string }) {
  const rows = await calibrationDue(ctx, 30);
  return (
    <Section title="Measuring instruments due for calibration (next 30 days or overdue)" actions={<Link href="/quality/instruments" className="link text-[12.5px]">All instruments</Link>}>
      <Table head={["Asset", "Description", "Type", "Location", "Status", "Last calibrated", "Due"]} empty="No instruments due for calibration in the next 30 days.">
        {rows.map((i) => {
          const overdue = !!i.calibrationDueOn && i.calibrationDueOn < today;
          return (
            <tr key={i.id}>
              <td>
                <Link href={`/quality/instruments/${i.id}`} className="plate text-dykem hover:underline">
                  {i.assetNo}
                </Link>
              </td>
              <td className="font-medium">{i.description}</td>
              <td className="capitalize">{i.instrumentType.replace(/_/g, " ")}</td>
              <td>{i.location ?? "—"}</td>
              <td>
                <StatusBadge map={INSTRUMENT_STATUS} status={i.status} />
              </td>
              <td>{fmtDate(i.lastCalibratedOn)}</td>
              <td className={cx("whitespace-nowrap", overdue && "font-semibold text-red")}>
                {fmtDate(i.calibrationDueOn)}
                {overdue && <span className="block text-[11.5px]">Overdue — do not use for acceptance</span>}
              </td>
            </tr>
          );
        })}
      </Table>
      <p className="mt-1 text-[12px] text-steel">Calibration is recorded by quality on the instrument record.</p>
    </Section>
  );
}
