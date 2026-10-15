import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requirePageCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { AppError } from "@/server/errors";
import { myWork, operationWorkspace } from "@/server/services/production";
import { downtimeReasonsList } from "@/server/services/machines";
import { NCR_CATEGORIES } from "@/server/services/ncr";
import { openDowntime } from "@/server/services/ui/shopfloor";
import { d } from "@/lib/decimal";
import { fmtDateTime, fmtMinutes, fmtQty, fmtTime } from "@/lib/format";
import { INSPECTION_STATUS, LOT_STATUS, OP_STATUS, REVISION_STATUS } from "@/lib/status";
import { Badge, buttonClass, LinkButton, Notice, StatusBadge, Table, cx } from "@/components/ui";
import { ActionForm, CheckboxField, Disclosure, NumberField, SelectField, TextArea, TextField } from "@/components/forms";
import { BIG_BADGE, BIG_FIELDS, Callout, DueDate, gateName, PriorityBadge, Step, type StepState } from "../../_components/parts";
import {
  addEventAction,
  confirmDrawingAction,
  confirmInstructionsAction,
  confirmMaterialAction,
  confirmProgramAction,
  endDowntimeAction,
  finishSetupAction,
  holdOperationAction,
  raiseOpNcrAction,
  signOffAction,
  startDowntimeAction,
  startProductionAction,
  startSetupAction,
  stopProductionAction,
  submitInspectionAction,
} from "../../actions";

export const metadata = { title: "Operation" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND_LABEL: Record<string, string> = { setup: "Setup", production: "Production", rework: "Rework", inspection: "Inspection" };
const EVENT_LABEL: Record<string, string> = {
  note: "Note",
  issue: "Issue",
  assist_request: "Assistance request",
  hold: "Hold",
  resume: "Resumed",
  review_cleared: "Review cleared",
  split: "Split",
  reassigned: "Reassigned",
};
const DOC_PURPOSE: Record<string, string> = { drawing: "Drawing", setup_sheet: "Setup sheet", work_instruction: "Work instruction", reference: "Reference" };
const STAGE_LABEL: Record<string, string> = { first_off: "First-off", in_process: "In-process", final: "Final", receiving: "Receiving" };
const NCR_CATEGORY_LABEL: Record<string, string> = {
  dimension: "Dimension out of tolerance",
  wrong_material: "Wrong material",
  wrong_revision: "Wrong drawing / program revision",
  surface: "Surface finish / damage",
  tooling: "Tooling problem",
  machine: "Machine problem",
  supplier: "Supplier issue",
  documentation: "Documentation error",
  customer_complaint: "Customer complaint",
  other: "Other",
};

type StepDef = { key: string; title: string; state: StepState; summary?: ReactNode; body?: ReactNode };

export default async function OperationWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageCtx("production.execute", "production.view_all");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  let ws: Awaited<ReturnType<typeof operationWorkspace>>;
  try {
    ws = await operationWorkspace(ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    if (e instanceof AppError && e.code === "forbidden") {
      return (
        <div className="mx-auto max-w-3xl text-[16px]">
          <BackLink />
          <Notice tone="warning" title="This operation is not assigned to you">
            {e.message} You can only open operations on your own work list. If you should be working on it, ask your supervisor to assign it to you.
          </Notice>
        </div>
      );
    }
    throw e;
  }

  const { op, job, line, type, machine, program, drawing, documents, tools, lots, checks, entries, events, inspections, assignments, gates, myOpenEntry } = ws;
  const me = ctx.actor.employeeId;
  const assigned = assignments.some((a) => a.e.id === me);
  const closed = op.status === "complete" || op.status === "cancelled";
  const canAct = can(ctx.actor, "production.execute") && assigned && !closed;
  const canNcr = can(ctx.actor, "ncr.raise") && !closed;

  const [reasons, downtime, next] = await Promise.all([
    machine && canAct ? downtimeReasonsList(ctx) : Promise.resolve([]),
    machine ? openDowntime(ctx, machine.id) : Promise.resolve(null),
    op.status === "complete" && assigned ? myWork(ctx).then((w) => w.next).catch(() => null) : Promise.resolve(null),
  ]);

  // ── Derived state ──
  const latest = <T extends { at: Date }>(xs: T[]) => [...xs].sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  const drawingCheck = latest(checks.filter((c) => c.kind === "drawing_reviewed" && (!op.drawingRevisionId || c.drawingRevisionId === op.drawingRevisionId)));
  const instrCheck = latest(checks.filter((c) => c.kind === "instructions_read"));
  const materialCheck = latest(checks.filter((c) => c.kind === "material_confirmed"));
  const programCheck = latest(checks.filter((c) => c.kind === "program_confirmed" && c.programRevisionId === op.programRevisionId));
  const confirmedLot = materialCheck ? lots.find((l) => l.lot.id === materialCheck.materialLotId)?.lot : undefined;

  const openOnOp = entries.filter((e) => !e.t.endedAt);
  const othersOpen = openOnOp.filter((e) => e.t.employeeId !== me);
  const mySetup = myOpenEntry?.kind === "setup";
  const myRun = !!myOpenEntry && (myOpenEntry.kind === "production" || myOpenEntry.kind === "rework");
  const idle = op.status === "paused" || op.status === "ready";
  const accounted = d(op.qtyGood).plus(d(op.qtyRejected)).plus(d(op.qtyScrapped));
  const planned = d(op.plannedQty);
  const shortfall = !type.isInspection && accounted.lessThan(planned);
  const badQty = d(op.qtyRejected).plus(d(op.qtyScrapped));
  const setupMinutes = entries.filter((e) => e.t.kind === "setup").reduce((a, e) => a + ((e.t.endedAt ?? new Date()).getTime() - e.t.startedAt.getTime()) / 60_000, 0);
  const firstOffInsp = inspections.find((i) => i.stage === "first_off" && (i.status === "open" || i.status === "in_progress")) ?? inspections.find((i) => i.stage === "first_off");
  const inProc = inspections.filter((i) => i.stage !== "first_off");
  const lastInProc = inProc[0];
  const firstOffOk = !op.requiresFirstOff || op.firstOffStatus === "approved";
  const failedGates = gates.filter((g) => !g.ok);
  const hidden = <input type="hidden" name="opId" value={op.id} />;
  const who = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;

  // ── Steps ──
  const steps: StepDef[] = [];

  // 1. Drawing
  {
    const fileLink = drawing && drawing.rev.status === "released" && (
      <a href={`/api/files/${drawing.rev.fileId}`} target="_blank" rel="noopener" className={buttonClass("secondary", "lg")}>
        Open drawing {drawing.doc.docNumber} rev {drawing.rev.revision}
      </a>
    );
    if (!drawing) {
      steps.push({
        key: "drawing",
        title: "Review the drawing",
        state: drawingCheck ? "done" : "todo",
        summary: (
          <>
            No drawing is pinned to this operation. Review the work instructions and attached documents instead.
            {drawingCheck && <span className="block text-steel">Confirmed at {fmtDateTime(drawingCheck.at)}.</span>}
          </>
        ),
        body: canAct && !drawingCheck && (
          <ActionForm action={confirmDrawingAction} submitLabel="I have reviewed the job documents" submitSize="lg">
            {hidden}
          </ActionForm>
        ),
      });
    } else if (drawing.rev.status !== "released") {
      steps.push({
        key: "drawing",
        title: "Review the drawing",
        state: "blocked",
        summary: (
          <>
            <DocLine doc={drawing.doc.docNumber} title={drawing.doc.title} rev={drawing.rev.revision} status={drawing.rev.status} />
            <div className="mt-2">
              <Callout tone="danger" title="Do not use — contact your supervisor">
                Drawing {drawing.doc.docNumber} rev {drawing.rev.revision} is {REVISION_STATUS[drawing.rev.status as keyof typeof REVISION_STATUS]?.label.toLowerCase() ?? drawing.rev.status} and is not released for production.
              </Callout>
            </div>
          </>
        ),
      });
    } else {
      steps.push({
        key: "drawing",
        title: "Review the drawing",
        state: drawingCheck ? "done" : "todo",
        summary: (
          <>
            <DocLine doc={drawing.doc.docNumber} title={drawing.doc.title} rev={drawing.rev.revision} status={drawing.rev.status} />
            {drawingCheck && <span className="block text-steel">You confirmed this revision at {fmtDateTime(drawingCheck.at)}.</span>}
          </>
        ),
        body: (
          <div className="flex flex-wrap items-start gap-3">
            {fileLink}
            {canAct && !drawingCheck && (
              <ActionForm action={confirmDrawingAction} submitLabel={`I have reviewed drawing rev ${drawing.rev.revision}`} submitSize="lg">
                {hidden}
              </ActionForm>
            )}
          </div>
        ),
      });
    }
  }

  // 2. Work instructions
  steps.push({
    key: "instructions",
    title: "Read the work instructions",
    state: instrCheck ? "done" : "todo",
    summary: (
      <>
        {op.instructions ? (
          <div className="whitespace-pre-wrap rounded-sm border border-line bg-paper px-3 py-2.5 text-[16.5px] leading-relaxed text-ink">{op.instructions}</div>
        ) : (
          <p className="text-steel">No written instructions for this operation.</p>
        )}
        {documents.length > 0 && (
          <ul className="mt-3 space-y-2">
            {documents.map(({ od, rev, doc }) => (
              <li key={od.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-[14px] text-steel">{DOC_PURPOSE[od.purpose] ?? od.purpose}</span>
                {rev.status === "released" ? (
                  <a href={`/api/files/${rev.fileId}`} className="link font-semibold">
                    {doc.docNumber} rev {rev.revision} — {doc.title}
                  </a>
                ) : (
                  <span>
                    {doc.docNumber} rev {rev.revision} — {doc.title} <span className="font-semibold text-red">(not released — do not use)</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {instrCheck && <span className="mt-2 block text-steel">Confirmed at {fmtDateTime(instrCheck.at)}.</span>}
      </>
    ),
    body: canAct && !instrCheck && (
      <ActionForm action={confirmInstructionsAction} submitLabel="I have read the work instructions" submitSize="lg">
        {hidden}
      </ActionForm>
    ),
  });

  // 3. Material
  if (op.requiresMaterial) {
    const released = lots.filter((l) => l.lot.status === "released");
    steps.push({
      key: "material",
      title: "Confirm material and batch",
      state: materialCheck ? "done" : released.length ? "todo" : "blocked",
      summary: (
        <>
          {materialCheck && (
            <p>
              Using lot <span className="plate text-[17px]">{confirmedLot?.lotNo ?? "—"}</span>
              {confirmedLot && <> · heat {confirmedLot.heatNumber}</>} — confirmed at {fmtDateTime(materialCheck.at)}.
            </p>
          )}
          {lots.length > 0 ? (
            <ul className="mt-2 divide-y divide-line-2 rounded-sm border border-line">
              {lots.map(({ a, lot }) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>
                    <span className="plate text-[17px]">{lot.lotNo}</span> <span className="text-steel">· heat {lot.heatNumber}</span>
                    {lot.dimensions && <span className="text-steel"> · {lot.dimensions}</span>}
                    <span className="text-steel"> · {fmtQty(a.quantity, lot.uom)} allocated</span>
                  </span>
                  <StatusBadge map={LOT_STATUS} status={lot.status} className={BIG_BADGE} />
                </li>
              ))}
            </ul>
          ) : null}
          {!released.length && (
            <div className="mt-2">
              <Callout tone="danger" title="No released material for this job">
                Do not use unreleased, quarantined or unallocated material. Contact stores or your supervisor.
              </Callout>
            </div>
          )}
        </>
      ),
      body:
        canAct && released.length > 0 ? (
          materialCheck ? (
            <Disclosure label="Change material lot">
              <MaterialForm opId={op.id} lots={lots} />
            </Disclosure>
          ) : (
            <MaterialForm opId={op.id} lots={lots} />
          )
        ) : null,
    });
  }

  // 4. CNC program
  if (op.requiresProgram) {
    if (!program) {
      steps.push({
        key: "program",
        title: "Confirm the CNC program",
        state: "blocked",
        summary: <Callout tone="danger" title="No program issued">No CNC program revision has been issued for this operation. Contact your supervisor or the programmer.</Callout>,
      });
    } else {
      steps.push({
        key: "program",
        title: "Confirm the CNC program",
        state: !program.usable ? "blocked" : programCheck ? "done" : "todo",
        summary: (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
              <Fact label="Program" value={<span className="plate text-[19px]">{program.p.programNumber}</span>} />
              <Fact label="Revision" value={<span className="plate text-[19px]">{program.rev.revision}</span>} />
              <Fact label="Checksum (first 12)" value={<span className="plate text-[17px] tracking-wider">{program.rev.checksum ? program.rev.checksum.slice(0, 12) : "—"}</span>} />
              <Fact label="Status" value={program.usable ? <Badge tone="success" className={BIG_BADGE}>Released — usable</Badge> : <Badge tone="danger" className={BIG_BADGE}>Not usable</Badge>} />
            </dl>
            <p className="mt-1 text-[14px] text-steel">{program.p.name}</p>
            {!program.usable && (
              <div className="mt-2">
                <Callout tone="danger" title="Do not use this program — stop and contact your supervisor">
                  Program {program.p.programNumber} rev {program.rev.revision} is {REVISION_STATUS[program.rev.status as keyof typeof REVISION_STATUS]?.label.toLowerCase() ?? program.rev.status} and is not the current released revision.
                </Callout>
              </div>
            )}
            {programCheck && <span className="mt-2 block text-steel">You confirmed this revision at {fmtDateTime(programCheck.at)}.</span>}
          </>
        ),
        body: program.usable && (
          <div className="space-y-3">
            <a href={`/api/files/${program.rev.fileId}`} className={buttonClass("secondary", "lg")}>
              Download program file ({program.f.originalName})
            </a>
            {canAct && !programCheck && (
              <ActionForm action={confirmProgramAction} submitLabel={`Confirm program rev ${program.rev.revision}`} submitSize="lg">
                {hidden}
                <input type="hidden" name="programRevisionId" value={program.rev.id} />
                <div className={cx(BIG_FIELDS, "max-w-md")}>
                  <TextField label="Checksum on the machine (optional)" name="checksumPrefix" autoComplete="off" hint="Type the first characters of the checksum shown on the control to verify you loaded the released file." />
                </div>
              </ActionForm>
            )}
          </div>
        ),
      });
    }
  }

  // 5. Setup
  {
    const rejected = op.firstOffStatus === "rejected";
    let state: StepState;
    let summary: ReactNode;
    let body: ReactNode = null;
    if (rejected && !openOnOp.some((e) => e.t.kind === "setup")) {
      state = "todo";
      summary = <Callout tone="danger" title="First-off rejected">Correct the setup and run setup again. A new first-off inspection will be requested when you finish.</Callout>;
      body = canAct && <StartSetup opId={op.id} />;
    } else if (op.setupStatus === "complete") {
      state = "done";
      summary = <>Setup complete{setupMinutes > 0 ? ` — ${fmtMinutes(setupMinutes)} recorded` : ""}.</>;
    } else if (op.status === "in_setup") {
      state = "active";
      summary = mySetup ? (
        <>You started setup at {fmtTime(myOpenEntry!.startedAt)}. Your setup time is being recorded.</>
      ) : (
        <>Setup in progress{othersOpen.length ? ` by ${othersOpen.map((o) => who(o.e)).join(", ")} since ${fmtTime(othersOpen[0].t.startedAt)}` : ""}.</>
      );
      if (canAct && mySetup) {
        body = (
          <ActionForm action={finishSetupAction} submitLabel="Finish setup" submitSize="xl">
            {hidden}
            <div className={BIG_FIELDS}>
              <TextArea label="Setup notes (optional)" name="notes" rows={2} placeholder="Offsets, fixtures, anything the next setter should know" />
            </div>
            {op.requiresFirstOff && <p className="text-[15px] text-steel">Finishing setup requests the first-off inspection from QC.</p>}
          </ActionForm>
        );
      }
    } else {
      state = "todo";
      summary = op.status === "pending" ? "Previous operations or readiness checks are not complete yet — see Start checks." : "Set up the machine, fixtures and tooling. Your setup time is recorded from when you press start.";
      body = canAct && ["ready", "pending", "paused"].includes(op.status) && <StartSetup opId={op.id} />;
    }
    steps.push({ key: "setup", title: "Set up", state, summary, body });
  }

  // 6. First-off
  if (op.requiresFirstOff) {
    const fs = op.firstOffStatus;
    steps.push({
      key: "first-off",
      title: "First-off approval",
      state: fs === "approved" ? "done" : fs === "requested" ? "waiting" : fs === "rejected" ? "blocked" : "todo",
      summary:
        fs === "approved" ? (
          <>First-off approved by quality{firstOffInsp ? ` (${firstOffInsp.ref})` : ""}.</>
        ) : fs === "requested" ? (
          <Callout tone="warning" title="Production is blocked until QC approves the first-off part">
            {firstOffInsp ? (
              <>
                Inspection <span className="plate">{firstOffInsp.ref}</span> is {INSPECTION_STATUS[firstOffInsp.status as keyof typeof INSPECTION_STATUS]?.label.toLowerCase() ?? firstOffInsp.status} (requested {fmtTime(firstOffInsp.requestedAt)}).{" "}
              </>
            ) : null}
            Keep the first-off part at the machine, clearly identified, until quality has checked it.
          </Callout>
        ) : fs === "rejected" ? (
          <Callout tone="danger" title="First-off rejected — do not run production">Re-do the setup (step above). A new first-off inspection is requested when you finish setup.</Callout>
        ) : (
          "When you finish setup, a first-off inspection is requested automatically. Production cannot start until it is approved."
        ),
    });
  }

  // 7. Production
  {
    let state: StepState;
    let summary: ReactNode;
    let body: ReactNode = null;
    const qtyLine = (
      <span>
        <span className="font-semibold">{fmtQty(op.qtyGood)}</span> good of {fmtQty(op.plannedQty)} planned
        {badQty.greaterThan(0) && (
          <>
            {" "}
            · {fmtQty(op.qtyRejected)} rejected · {fmtQty(op.qtyScrapped)} scrapped
          </>
        )}
      </span>
    );
    const startBtn = (variant: "primary" | "secondary", label: string) =>
      canAct && (
        <ActionForm action={startProductionAction} submitLabel={label} submitSize={variant === "primary" ? "xl" : "lg"} submitVariant={variant}>
          {hidden}
          {materialCheck?.materialLotId && <input type="hidden" name="materialLotId" value={materialCheck.materialLotId} />}
        </ActionForm>
      );
    if (myRun) {
      state = "active";
      summary = (
        <>
          Running since {fmtTime(myOpenEntry!.startedAt)}. So far: {qtyLine}.
        </>
      );
      body = canAct && (
        <ActionForm action={stopProductionAction} submitLabel="Stop and record quantities" submitSize="xl">
          {hidden}
          <div className={cx(BIG_FIELDS, "grid gap-3 sm:grid-cols-3")}>
            <NumberField label="Good parts this run" name="qtyGood" required placeholder="0" />
            <NumberField label="Rejected" name="qtyRejected" placeholder="0" />
            <NumberField label="Scrapped" name="qtyScrapped" placeholder="0" />
          </div>
          <div className={BIG_FIELDS}>
            <TextArea label="Notes (optional)" name="notes" rows={2} />
          </div>
        </ActionForm>
      );
    } else if (op.status === "in_production") {
      state = "active";
      summary = (
        <>
          Production running{othersOpen.length ? ` — ${othersOpen.map((o) => who(o.e)).join(", ")}` : ""}. {qtyLine}.
        </>
      );
    } else if (op.status === "on_hold") {
      state = "blocked";
      summary = <>The operation is on hold. Do not continue until a supervisor releases it. {qtyLine}.</>;
    } else if (op.setupStatus === "complete" && firstOffOk && idle) {
      if (!shortfall && accounted.greaterThan(0)) {
        state = "done";
        summary = <>All planned parts accounted for: {qtyLine}.</>;
        body = startBtn("secondary", "Start another run");
      } else {
        state = "todo";
        summary = (
          <>
            {qtyLine}.{confirmedLot && <> Material lot {confirmedLot.lotNo} will be recorded against the run.</>}
          </>
        );
        body = startBtn("primary", accounted.greaterThan(0) ? "Continue production" : "Start production");
      }
    } else if (op.status === "complete") {
      state = "done";
      summary = qtyLine;
    } else {
      state = "todo";
      summary = op.setupStatus === "complete" && !firstOffOk ? "Blocked until the first-off is approved." : op.status === "awaiting_inspection" ? <>Awaiting inspection. {qtyLine}.</> : "Available once setup is complete.";
    }
    const ncrHint = badQty.greaterThan(0) && canNcr && (
      <div className="space-y-2">
        <Callout tone="warning" title="Rejected or scrapped parts recorded">
          {fmtQty(op.qtyRejected)} rejected and {fmtQty(op.qtyScrapped)} scrapped. Raise a non-conformance so quality can decide what happens to them.
        </Callout>
        <Disclosure label="Raise a non-conformance (NCR)">
          <NcrForm op={op} jobId={job.id} defaultQty={badQty.toString()} />
        </Disclosure>
      </div>
    );
    steps.push({
      key: "production",
      title: "Run production",
      state,
      summary,
      body: (body || ncrHint) && (
        <>
          {body}
          {ncrHint}
        </>
      ),
    });
  }

  // 8. Inspection
  {
    let state: StepState;
    let summary: ReactNode;
    if (op.status === "awaiting_inspection") {
      state = "waiting";
      summary = (
        <Callout tone="warning" title="Waiting for inspection">
          {lastInProc ? (
            <>
              Inspection <span className="plate">{lastInProc.ref}</span> requested at {fmtTime(lastInProc.requestedAt)}.{" "}
            </>
          ) : null}
          You can sign off once quality has passed it.
        </Callout>
      );
    } else if (lastInProc?.status === "passed") {
      state = "done";
      summary = (
        <>
          Inspection <span className="plate">{lastInProc.ref}</span> passed.
        </>
      );
    } else if (lastInProc?.status === "failed") {
      state = "blocked";
      summary = (
        <Callout tone="danger" title={`Inspection ${lastInProc.ref} failed`}>
          Quality will decide what happens next (non-conformance). Do not continue without instruction from your supervisor.
        </Callout>
      );
    } else {
      state = op.inspectionPlanId ? "todo" : "optional";
      summary = op.inspectionPlanId ? "An inspection plan applies to this operation. Submit when your quantity is complete." : "Submit for an in-process inspection only if your instructions or supervisor require one.";
    }
    const canSubmit = canAct && idle && openOnOp.length === 0 && state !== "done" && state !== "blocked";
    steps.push({
      key: "inspection",
      title: "Submit for inspection",
      state,
      summary,
      body: canSubmit && (
        <ActionForm action={submitInspectionAction} submitLabel="Submit for inspection" submitSize="lg" submitVariant={state === "optional" ? "secondary" : "primary"} confirm="Submit this operation to quality for inspection? You cannot record more production while it is awaiting inspection.">
          {hidden}
        </ActionForm>
      ),
    });
  }

  // 9. Sign off
  {
    let state: StepState;
    let summary: ReactNode;
    let body: ReactNode = null;
    if (op.status === "complete") {
      state = "done";
      summary = (
        <>
          Signed off at {fmtDateTime(op.signedOffAt)}.{op.signOffNote && <span className="mt-1 block whitespace-pre-wrap text-steel">{op.signOffNote}</span>}
        </>
      );
    } else {
      state = "todo";
      const ready = idle && openOnOp.length === 0;
      summary = (
        <>
          {fmtQty(accounted.toString())} of {fmtQty(op.plannedQty)} accounted for ({fmtQty(op.qtyGood)} good, {fmtQty(op.qtyRejected)} rejected, {fmtQty(op.qtyScrapped)} scrapped).
          {!ready && (
            <span className="mt-1 block text-steel">
              {openOnOp.length ? "Stop all running time on this operation before signing off." : op.status === "awaiting_inspection" ? "Wait for the inspection result before signing off." : "Available once production is stopped and quantities are recorded."}
            </span>
          )}
        </>
      );
      if (canAct && ready) {
        body = (
          <ActionForm
            action={signOffAction}
            submitLabel="Sign off operation"
            submitSize="xl"
            confirm="Signing off confirms the recorded quantities are correct and this operation is complete. You cannot reopen it yourself."
          >
            {hidden}
            {shortfall && (
              <Callout tone="warning" title={`Only ${fmtQty(accounted.toString())} of ${fmtQty(op.plannedQty)} accounted for`}>
                Record the remaining parts in a production run, or explain the shortfall below.
              </Callout>
            )}
            <div className={cx(BIG_FIELDS, "grid gap-3 md:grid-cols-2")}>
              {shortfall && <TextArea label="Shortfall reason" name="shortfallReason" rows={2} placeholder="e.g. 2 blanks short from stores — agreed with supervisor" />}
              <TextArea label="Sign-off note (optional)" name="note" rows={2} />
            </div>
          </ActionForm>
        );
      }
    }
    steps.push({ key: "sign-off", title: "Sign off", state, summary, body });
  }

  // The first actionable step becomes "Next", unless an earlier step is running, waiting or blocked.
  let focus: StepDef | undefined;
  for (const s of steps) {
    if (s.state === "active" || s.state === "waiting" || s.state === "blocked") {
      focus = s;
      break;
    }
    if (s.state === "todo") {
      s.state = "current";
      focus = s;
      break;
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] text-[16px]">
      <BackLink />

      {/* ── Title block ── */}
      <header className="mb-4 border-2 border-ink/80 bg-sheet">
        <div className="flex flex-wrap items-stretch">
          <div className="flex min-w-[240px] flex-col justify-center border-r-2 border-ink/80 px-5 py-4">
            <div className="text-[13px] font-medium text-steel">Job / operation</div>
            <div className="plate text-[40px] leading-none text-ink">
              {job.jobNumber}
              <span className="text-steel-2"> / </span>
              {op.opNumber}
            </div>
          </div>
          <div className="flex min-w-[280px] flex-1 flex-col justify-center px-5 py-4">
            <h1 className="text-[22px] font-semibold leading-snug text-ink">{op.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge map={OP_STATUS} status={op.status} className={BIG_BADGE} />
              <PriorityBadge priority={job.priority} big />
              {op.isRework && <Badge tone="danger" className={BIG_BADGE}>Rework</Badge>}
              <span className="text-[15px] text-steel">{type.name}</span>
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-2 border-t-2 border-ink/80 sm:grid-cols-3 lg:grid-cols-6">
          <Cell label="Part" value={<span className="plate text-[19px]">{line.partNumber}</span>} sub={line.description} />
          <Cell label="Machine" value={<span className="plate text-[19px]">{machine?.code ?? "—"}</span>} sub={machine?.name} />
          <Cell label="Planned qty" value={<span className="plate text-[22px]">{fmtQty(op.plannedQty)}</span>} />
          <Cell label="Good" value={<span className="plate text-[22px]">{fmtQty(op.qtyGood)}</span>} />
          <Cell label="Rejected / scrapped" value={<span className={cx("plate text-[22px]", badQty.greaterThan(0) && "text-red")}>{fmtQty(op.qtyRejected)} / {fmtQty(op.qtyScrapped)}</span>} />
          <Cell label="Due" value={<DueDate date={job.requiredDate} className="text-[17px]" />} />
        </dl>
      </header>

      {op.reviewRequired && (
        <Notice tone="danger" title="Stop — revision review pending">
          {op.reviewReason} Do not continue until your supervisor has reviewed this operation.
        </Notice>
      )}
      {!assigned && can(ctx.actor, "production.view_all") && (
        <Notice tone="info" title="Viewing as supervisor">You are not assigned to this operation, so actions are hidden. Operators record their own work here.</Notice>
      )}
      {!me && <Notice tone="warning">Your sign-in is not linked to an employee record, so you cannot record work.</Notice>}

      {op.status === "complete" ? (
        <div className="mb-5 rounded-md border-2 border-green bg-green-50 px-5 py-4">
          <p className="text-[20px] font-semibold text-green">Operation complete</p>
          {next ? (
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <p className="text-[16px] text-ink">
                Next on your list: <span className="plate text-[19px]">{next.job.jobNumber}</span> op <span className="plate text-[19px]">{next.op.opNumber}</span> — {next.op.title}
              </p>
              <LinkButton href={`/shopfloor/op/${next.op.id}`} variant="primary" size="xl">
                Open next operation
              </LinkButton>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <p className="text-[16px] text-ink">There is no further operation ready for you.</p>
              <LinkButton href="/shopfloor" size="lg">
                Back to my work
              </LinkButton>
            </div>
          )}
        </div>
      ) : (
        focus && (
          <a href={`#step-${focus.key}`} className={cx("mb-5 flex items-center justify-between gap-3 rounded-md px-5 py-3 text-[17px] font-semibold", focus.state === "current" ? "bg-dykem text-white" : focus.state === "waiting" ? "bg-amber-50 text-[#6b4405] ring-2 ring-amber" : focus.state === "blocked" ? "bg-red-50 text-red ring-2 ring-red" : "bg-violet-50 text-violet ring-2 ring-violet")}>
            <span>
              {focus.state === "current" ? "Next: " : focus.state === "waiting" ? "Waiting: " : focus.state === "blocked" ? "Stopped: " : "In progress: "}
              {focus.title}
            </span>
            <span aria-hidden>↓</span>
          </a>
        )
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* ── Workflow ── */}
        <section aria-labelledby="steps-h">
          <h2 id="steps-h" className="sr-only">
            Steps
          </h2>
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <Step key={s.key} id={`step-${s.key}`} n={i + 1} title={s.title} state={s.state} summary={s.summary}>
                {s.body || null}
              </Step>
            ))}
          </ol>
        </section>

        {/* ── Side panels ── */}
        <aside className="space-y-4">
          <SidePanel title="Start checks" sub={gates.length ? (failedGates.length ? `${failedGates.length} not met` : "All met") : undefined}>
            {gates.length === 0 ? (
              <p className="text-[15px] text-steel">Checks are shown for operators linked to an employee record.</p>
            ) : (
              <ul className="space-y-2">
                {gates.map((g) => (
                  <li key={g.gate} className="flex gap-2.5">
                    <span aria-hidden className={cx("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-white", g.ok ? "bg-green" : "bg-red")}>
                      {g.ok ? "✓" : "✕"}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold text-ink">
                        {gateName(g.gate)}
                        <span className="sr-only">{g.ok ? " — met" : " — not met"}</span>
                      </span>
                      <span className={cx("block text-[14.5px]", g.ok ? "text-steel" : "text-red")}>{g.message}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SidePanel>

          {canAct && (
            <SidePanel title="Need help?">
              <ActionForm action={addEventAction} submitLabel="Send" submitSize="lg" resetOnSuccess>
                {hidden}
                <div className={BIG_FIELDS}>
                  <SelectField
                    label="What do you need?"
                    name="kind"
                    defaultValue="assist_request"
                    options={[
                      { value: "assist_request", label: "Request assistance (notifies supervisor)" },
                      { value: "issue", label: "Report an issue (notifies supervisor)" },
                      { value: "note", label: "Add a note to the record" },
                    ]}
                  />
                  <div className="mt-3">
                    <TextArea label="Message" name="message" rows={3} required />
                  </div>
                </div>
              </ActionForm>
            </SidePanel>
          )}

          {machine && (canAct || downtime) && (
            <SidePanel title={`Machine downtime — ${machine.code}`}>
              {downtime ? (
                <div className="space-y-3">
                  <Callout tone="warning" title={`Down since ${fmtTime(downtime.d.startedAt)}`}>
                    {downtime.reason}
                    {downtime.d.notes ? ` — ${downtime.d.notes}` : ""}
                  </Callout>
                  {canAct && (
                    <ActionForm action={endDowntimeAction} submitLabel="End downtime" submitSize="lg">
                      {hidden}
                      <input type="hidden" name="machineId" value={machine.id} />
                      <input type="hidden" name="downtimeId" value={downtime.d.id} />
                      <div className={BIG_FIELDS}>
                        <TextField label="What was done (optional)" name="notes" />
                      </div>
                    </ActionForm>
                  )}
                </div>
              ) : (
                <ActionForm action={startDowntimeAction} submitLabel="Start downtime" submitSize="lg" submitVariant="secondary">
                  {hidden}
                  <input type="hidden" name="machineId" value={machine.id} />
                  <div className={cx(BIG_FIELDS, "space-y-3")}>
                    <SelectField label="Reason" name="reasonId" required placeholder="Select a reason" options={reasons.map((r) => ({ value: r.id, label: r.category === "planned" ? `${r.name} (planned)` : r.name }))} />
                    <TextField label="Notes (optional)" name="notes" />
                  </div>
                  <p className="text-[13.5px] text-steel">The machine status is reported manually from this terminal.</p>
                </ActionForm>
              )}
            </SidePanel>
          )}

          {(canAct || canNcr) && (
            <SidePanel title="Stop the job">
              <div className="space-y-3">
                {canAct && op.status !== "on_hold" && (
                  <Disclosure label="Place operation on hold" variant="secondary">
                    <ActionForm action={holdOperationAction} submitLabel="Place on hold" submitVariant="danger" submitSize="lg" confirm="Placing the operation on hold stops any running time. A supervisor must release the hold before work continues.">
                      {hidden}
                      <div className={BIG_FIELDS}>
                        <TextArea label="Reason" name="reason" rows={2} required placeholder="e.g. Suspect tool wear — bore oversize on last part" />
                      </div>
                    </ActionForm>
                  </Disclosure>
                )}
                {canNcr && (
                  <Disclosure label="Report a non-conformance" variant="secondary">
                    <NcrForm op={op} jobId={job.id} defaultQty={badQty.greaterThan(0) ? badQty.toString() : ""} />
                  </Disclosure>
                )}
              </div>
            </SidePanel>
          )}

          {(tools.length > 0 || op.toolingRequirements || op.fixtureRequirements) && (
            <SidePanel title="Tools and fixtures">
              {tools.length > 0 && (
                <ul className="space-y-1.5">
                  {tools.map(({ ot, t }) => (
                    <li key={ot.id} className="text-[15px]">
                      <span className="plate text-[16px]">{t.assetNo}</span> {t.description}
                      {t.status !== "available" && t.status !== "in_use" && <span className="font-semibold text-red"> ({t.status.replace(/_/g, " ")})</span>}
                      {ot.notes && <span className="block text-[14px] text-steel">{ot.notes}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {op.toolingRequirements && <p className="mt-2 whitespace-pre-wrap text-[15px]"><span className="font-semibold">Tooling: </span>{op.toolingRequirements}</p>}
              {op.fixtureRequirements && <p className="mt-2 whitespace-pre-wrap text-[15px]"><span className="font-semibold">Fixtures: </span>{op.fixtureRequirements}</p>}
            </SidePanel>
          )}

          <SidePanel title="Assigned">
            {assignments.length ? (
              <ul className="space-y-1 text-[15px]">
                {assignments.map(({ a, e }) => (
                  <li key={a.id}>
                    {who(e)} <span className="text-steel">· {a.role}</span>
                    {e.id === me && <span className="text-steel"> (you)</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[15px] text-steel">No one is assigned.</p>
            )}
          </SidePanel>
        </aside>
      </div>

      {/* ── Records ── */}
      <section className="mt-8 space-y-6">
        <div>
          <h2 className="mb-2 border-b border-line pb-1.5 text-[18px] font-semibold text-ink">Time recorded on this operation</h2>
          <Table head={["Operator", "Type", "Started", "Ended", "Duration", "Good", "Rejected", "Scrapped", "Notes"]} empty="No time recorded yet.">
            {entries.map(({ t, e }) => (
              <tr key={t.id} className="text-[15px]">
                <td>{who(e)}</td>
                <td>{KIND_LABEL[t.kind] ?? t.kind}</td>
                <td className="whitespace-nowrap">{fmtDateTime(t.startedAt)}</td>
                <td className="whitespace-nowrap">{t.endedAt ? fmtTime(t.endedAt) : <span className="font-semibold text-violet">Running</span>}</td>
                <td className="whitespace-nowrap">{fmtMinutes(((t.endedAt ?? new Date()).getTime() - t.startedAt.getTime()) / 60_000)}</td>
                <td>{fmtQty(t.qtyGood)}</td>
                <td>{fmtQty(t.qtyRejected)}</td>
                <td>{fmtQty(t.qtyScrapped)}</td>
                <td className="max-w-[320px] whitespace-pre-wrap text-steel">{t.notes ?? ""}</td>
              </tr>
            ))}
          </Table>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="mb-2 border-b border-line pb-1.5 text-[18px] font-semibold text-ink">Notes, issues and holds</h2>
            <Table head={["When", "Type", "Message", "By"]} empty="Nothing recorded.">
              {events.map(({ ev, user }) => (
                <tr key={ev.id} className="text-[15px]">
                  <td className="whitespace-nowrap">{fmtDateTime(ev.at)}</td>
                  <td>
                    {EVENT_LABEL[ev.kind] ?? ev.kind}
                    {ev.resolvedAt && <span className="block text-[13px] text-green">Resolved</span>}
                  </td>
                  <td className="whitespace-pre-wrap">{ev.message}</td>
                  <td>{user ?? "—"}</td>
                </tr>
              ))}
            </Table>
          </div>
          <div>
            <h2 className="mb-2 border-b border-line pb-1.5 text-[18px] font-semibold text-ink">Inspections</h2>
            <Table head={["Ref", "Stage", "Status", "Requested", "Completed"]} empty="No inspections for this operation.">
              {inspections.map((i) => (
                <tr key={i.id} className="text-[15px]">
                  <td className="plate">{i.ref}</td>
                  <td>{STAGE_LABEL[i.stage] ?? i.stage}</td>
                  <td>
                    <StatusBadge map={INSPECTION_STATUS} status={i.status} />
                  </td>
                  <td className="whitespace-nowrap">{fmtDateTime(i.requestedAt)}</td>
                  <td className="whitespace-nowrap">{fmtDateTime(i.completedAt)}</td>
                </tr>
              ))}
            </Table>
          </div>
        </div>
      </section>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/shopfloor" className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-[16px] font-medium text-dykem hover:underline">
      <span aria-hidden>←</span> My work
    </Link>
  );
}

function Cell({ label, value, sub }: { label: string; value: ReactNode; sub?: string | null }) {
  return (
    <div className="border-line px-5 py-3 [&:not(:last-child)]:border-r max-lg:[&:nth-child(n+3)]:border-t">
      <dt className="text-[13px] text-steel">{label}</dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
      {sub && <dd className="truncate text-[13.5px] text-steel">{sub}</dd>}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-[13px] text-steel">{label}</dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
    </div>
  );
}

function DocLine({ doc, title, rev, status }: { doc: string; title: string; rev: string; status: string }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="plate text-[19px] text-ink">{doc}</span>
      <span>rev</span>
      <span className="plate text-[19px] text-ink">{rev}</span>
      <StatusBadge map={REVISION_STATUS} status={status} className={BIG_BADGE} />
      <span className="text-steel">{title}</span>
    </p>
  );
}

function SidePanel({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-line bg-sheet p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
        {sub && <span className="text-[13.5px] font-medium text-steel">{sub}</span>}
      </div>
      {children}
    </section>
  );
}

function StartSetup({ opId }: { opId: string }) {
  return (
    <ActionForm action={startSetupAction} submitLabel="Start setup" submitSize="xl">
      <input type="hidden" name="opId" value={opId} />
    </ActionForm>
  );
}

function MaterialForm({ opId, lots }: { opId: string; lots: { a: { id: string }; lot: { id: string; lotNo: string; heatNumber: string; status: string } }[] }) {
  const released = lots.filter((l) => l.lot.status === "released");
  return (
    <ActionForm action={confirmMaterialAction} submitLabel="Confirm material" submitSize="lg">
      <input type="hidden" name="opId" value={opId} />
      <div className={cx(BIG_FIELDS, "grid gap-3 md:grid-cols-2")}>
        <div>
          <label htmlFor="sf-lot" className="mb-1 block font-medium text-ink-2">
            Select the lot you are using
          </label>
          <select id="sf-lot" name="materialLotId" defaultValue={released.length === 1 ? released[0].lot.id : ""} className="field-input">
            <option value="">Select a lot…</option>
            {lots.map(({ a, lot }) => (
              <option key={a.id} value={lot.id} disabled={lot.status !== "released"}>
                {lot.lotNo} — heat {lot.heatNumber}
                {lot.status !== "released" ? ` (${LOT_STATUS[lot.status as keyof typeof LOT_STATUS]?.label ?? lot.status} — not usable)` : ""}
              </option>
            ))}
          </select>
        </div>
        <TextField label="…or scan the lot label" name="lotNo" autoComplete="off" placeholder="Lot number" hint="A scanned lot number takes priority over the selection." />
      </div>
    </ActionForm>
  );
}

function NcrForm({ op, jobId, defaultQty }: { op: { id: string; jobLineId: string; batchId: string | null }; jobId: string; defaultQty: string }) {
  return (
    <ActionForm action={raiseOpNcrAction} submitLabel="Raise NCR" submitSize="lg" resetOnSuccess>
      <input type="hidden" name="opId" value={op.id} />
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="jobLineId" value={op.jobLineId} />
      {op.batchId && <input type="hidden" name="batchId" value={op.batchId} />}
      <div className={cx(BIG_FIELDS, "space-y-3")}>
        <SelectField label="What is wrong?" name="category" required placeholder="Select a category" options={NCR_CATEGORIES.map((c) => ({ value: c, label: NCR_CATEGORY_LABEL[c] ?? c }))} />
        <NumberField label="Quantity affected" name="qtyAffected" required defaultValue={defaultQty} />
        <TextArea label="Describe the problem" name="description" rows={3} required placeholder="What you found, on which parts, and what you have done with them" />
      </div>
      <CheckboxField label="Place this operation on hold" name="holdOperation" defaultChecked hint="Recommended: stops further work until quality has reviewed." />
    </ActionForm>
  );
}
