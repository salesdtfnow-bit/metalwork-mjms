import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageCtx } from "@/server/auth/next";
import { can, canAny } from "@/server/context";
import { AppError } from "@/server/errors";
import { getWorkOrder } from "@/server/services/maintenance";
import { workOrderExtras } from "@/server/services/ui/workshop";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { MACHINE_STATUS, MWO_STATUS, PRIORITY } from "@/lib/status";
import { Badge, KeyValues, Notice, Section, StatusBadge, TitleBlock } from "@/components/ui";
import { ActionForm, CheckboxField, Disclosure, FileField, FormGrid, TextArea, TextField } from "@/components/forms";
import { kindLabel } from "../_components/vocab";
import { cancelWorkOrderAction, completeWorkOrderAction, startWorkOrderAction } from "../actions";

export const metadata = { title: "Maintenance work order" };

export default async function WorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageCtx("maintenance.view");
  const { id } = await params;
  const { wo, machine } = await getWorkOrder(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const extras = await workOrderExtras(ctx, wo);
  const manage = can(ctx.actor, "maintenance.manage");
  const showCost = canAny(ctx.actor, "maintenance.manage", "purchasing.view", "jobs.view_commercial");
  const open = !["completed", "cancelled"].includes(wo.status);

  return (
    <>
      <TitleBlock
        kind={`${kindLabel(wo.kind)} work order`}
        refNo={wo.ref}
        title={wo.title}
        status={
          <>
            <StatusBadge map={MWO_STATUS} status={wo.status} />
            <StatusBadge map={PRIORITY} status={String(wo.priority)} />
            {wo.kind === "breakdown" && <Badge tone="danger">Breakdown</Badge>}
            {wo.locksMachine && open && <Badge tone="hold">Locks machine</Badge>}
          </>
        }
        cells={[
          {
            label: "Machine",
            value: (
              <Link href={`/machines/${machine.id}`} className="link">
                {machine.code} — {machine.name}
              </Link>
            ),
          },
          { label: "Machine status", value: <StatusBadge map={MACHINE_STATUS} status={machine.currentStatus} /> },
          { label: "Scheduled start", value: fmtDateTime(wo.scheduledStart) },
          { label: "Scheduled end", value: fmtDateTime(wo.scheduledEnd) },
          { label: "Provider", value: extras.provider?.name ?? "In-house" },
          { label: "Reported", value: `${fmtDate(wo.reportedAt)}${extras.reportedBy ? ` · ${extras.reportedBy}` : ""}` },
        ]}
        actions={
          manage &&
          ["open", "scheduled"].includes(wo.status) && (
            <ActionForm
              action={startWorkOrderAction}
              submitLabel="Start work"
              submitSize="sm"
              confirm={wo.locksMachine ? `Starting sets ${machine.code} to Maintenance. It cannot be scheduled or started until this work order is completed and the machine returned to service.` : "Start this work order now?"}
            >
              <input type="hidden" name="id" value={wo.id} />
            </ActionForm>
          )
        }
      />

      {wo.status === "in_progress" && wo.locksMachine && (
        <Notice tone="warning">
          {machine.code} is locked for maintenance while this work order is in progress. Production cannot start operations on it.
        </Notice>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div>
          <Section title="Details">
            <KeyValues
              items={[
                { label: "Kind", value: kindLabel(wo.kind) },
                { label: "Maintenance plan", value: extras.plan ? `${extras.plan.title} (every ${extras.plan.intervalDays} days)` : null },
                { label: "Locks machine", value: wo.locksMachine ? "Yes" : "No" },
                { label: "Description", value: wo.description, wide: true },
                { label: "Started", value: fmtDateTime(wo.startedAt) },
                { label: "Completed", value: wo.completedAt ? `${fmtDateTime(wo.completedAt)}${extras.completedBy ? ` · ${extras.completedBy}` : ""}` : null },
                { label: "Cost", value: showCost ? fmtMoney(wo.cost) : "Restricted" },
                { label: "Findings / work done", value: wo.findings, wide: true },
                {
                  label: "Service report",
                  value: extras.report ? (
                    <a className="link" href={`/api/files/${extras.report.id}`}>
                      {extras.report.name}
                    </a>
                  ) : null,
                },
              ]}
            />
          </Section>
          {extras.plan?.checklist && (
            <Section title="Plan checklist">
              <p className="whitespace-pre-wrap rounded-md border border-line bg-sheet p-3 text-[13.5px]">{extras.plan.checklist}</p>
            </Section>
          )}
        </div>

        {manage && open && (
          <Section title="Complete work order">
            <div className="rounded-md border border-line bg-sheet p-3">
              <ActionForm action={completeWorkOrderAction} submitLabel="Complete work order" confirm="Completing closes the work order. If 'Return to service' is ticked the machine becomes available for scheduling and production.">
                <input type="hidden" name="id" value={wo.id} />
                <TextArea label="Work done / findings" name="findings" required rows={4} />
                <FormGrid>
                  <TextField label="Cost" name="cost" inputMode="decimal" hint="Parts and labour, if known." />
                </FormGrid>
                <FileField label="Service report" name="report" hint="Optional — e.g. engineer's job sheet (PDF)." />
                <CheckboxField label="Return machine to service" name="returnToService" defaultChecked hint={`Sets ${machine.code} to Available.`} />
              </ActionForm>
            </div>
            <div className="mt-4">
              <Disclosure label="Cancel work order" variant="ghost">
                <ActionForm
                  action={cancelWorkOrderAction}
                  submitLabel="Cancel work order"
                  submitVariant="danger"
                  confirm={
                    wo.status === "in_progress" && wo.locksMachine
                      ? `The work order is cancelled and ${machine.code} is set back to Available. Only do this if the work is genuinely not needed.`
                      : "The work order is cancelled. This cannot be undone — raise a new work order if the work is needed later."
                  }
                >
                  <input type="hidden" name="id" value={wo.id} />
                  <TextArea label="Reason" name="reason" required rows={2} />
                </ActionForm>
              </Disclosure>
            </div>
          </Section>
        )}
      </div>
    </>
  );
}
