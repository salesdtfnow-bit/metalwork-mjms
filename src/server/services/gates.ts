import { and, eq, gte, inArray, isNull, ne, or } from "drizzle-orm";
import {
  cncProgramMachines,
  cncProgramRevisions,
  cncPrograms,
  documentRevisions,
  gateExceptions,
  holds,
  jobs,
  machineCapabilities,
  machines,
  materialAllocations,
  materialLots,
  materialTransactions,
  operationAssignments,
  operationChecks,
  operationDependencies,
  operations,
} from "../db/schema";
import { audit } from "../audit";
import { mutate, requirePermission, type Ctx } from "../context";
import { invalid } from "../errors";
import { nextRef, REF } from "../refs";
import { signApproval } from "./approvals";
import { hasValidCompetency } from "./employees";
import { activeMaintenanceLocks } from "./machines";

export type Gate = "dependencies" | "material" | "program" | "drawing" | "operator" | "machine" | "hold" | "first_off" | "review" | "route" | "checks";
export type GateResult = { gate: Gate; ok: boolean; message: string; overriddenBy?: string };

export const OVERRIDABLE: Gate[] = ["dependencies", "material", "operator", "first_off", "drawing"];

/**
 * Evaluates every start gate for an operation. `phase` = setup | production.
 * Gate exceptions (approved, unexpired) turn an overridable failure into a pass, recorded as such.
 */
export async function evaluateGates(ctx: Ctx, opId: string, opts: { phase: "setup" | "production"; employeeId: string | null; machineId?: string | null }): Promise<GateResult[]> {
  const [row] = await ctx.db.select({ op: operations, job: jobs }).from(operations).innerJoin(jobs, eq(jobs.id, operations.jobId)).where(eq(operations.id, opId)).limit(1);
  const { op, job } = row;
  const out: GateResult[] = [];
  const machineId = opts.machineId ?? op.machineId;

  // Route released
  const { jobLines } = await import("../db/schema");
  const [line] = await ctx.db.select().from(jobLines).where(eq(jobLines.id, op.jobLineId));
  out.push({ gate: "route", ok: line.routeStatus === "released" && !!job.authorisedAt && !["on_hold", "cancelled", "completed"].includes(job.status), message: line.routeStatus !== "released" ? "Route is not released." : !job.authorisedAt ? "Job is not authorised for production." : ["on_hold", "cancelled", "completed"].includes(job.status) ? `Job is ${job.status.replace("_", " ")}.` : "Route released, job authorised." });

  // Dependencies
  const deps = await ctx.db.select({ s: operations.status, n: operations.opNumber }).from(operationDependencies).innerJoin(operations, eq(operations.id, operationDependencies.dependsOnId)).where(eq(operationDependencies.operationId, opId));
  const open = deps.filter((x) => !["complete", "cancelled"].includes(x.s));
  out.push({ gate: "dependencies", ok: open.length === 0, message: open.length ? `Previous operation(s) not complete: ${open.map((x) => x.n).join(", ")}.` : "Prerequisites complete." });

  // Material
  if (op.requiresMaterial) {
    const released = await ctx.db
      .select({ lot: materialLots })
      .from(materialAllocations)
      .innerJoin(materialLots, eq(materialLots.id, materialAllocations.lotId))
      .where(and(eq(materialAllocations.jobId, job.id), ne(materialAllocations.status, "cancelled"), eq(materialLots.status, "released")));
    const issued = await ctx.db.select({ id: materialTransactions.id }).from(materialTransactions).where(and(eq(materialTransactions.jobId, job.id), eq(materialTransactions.kind, "issue"))).limit(1);
    out.push({
      gate: "material",
      ok: released.length > 0 && issued.length > 0,
      message: !released.length ? "No released material lot is allocated to this job." : !issued.length ? "Material has not been issued to production." : `Released material issued (${released.map((r) => r.lot.lotNo).join(", ")}).`,
    });
  }

  // Program
  if (op.requiresProgram) {
    if (!op.programRevisionId) out.push({ gate: "program", ok: false, message: "No CNC program revision is assigned." });
    else {
      const [r] = await ctx.db.select({ rev: cncProgramRevisions, p: cncPrograms }).from(cncProgramRevisions).innerJoin(cncPrograms, eq(cncPrograms.id, cncProgramRevisions.programId)).where(eq(cncProgramRevisions.id, op.programRevisionId));
      const current = r.rev.status === "released" && r.p.currentReleasedRevisionId === r.rev.id;
      let compatible = true;
      if (machineId) {
        const compat = await ctx.db.select().from(cncProgramMachines).where(eq(cncProgramMachines.programId, r.p.id));
        compatible = !compat.length || compat.some((c) => c.machineId === machineId);
      }
      out.push({
        gate: "program",
        ok: current && compatible,
        message: !current ? `Program ${r.p.programNumber} rev ${r.rev.revision} is ${r.rev.status} — not the current released revision.` : !compatible ? `Program ${r.p.programNumber} is not approved for this machine.` : `Program ${r.p.programNumber} rev ${r.rev.revision} released.`,
      });
    }
  }

  // Drawing
  if (op.drawingRevisionId) {
    const [dr] = await ctx.db.select().from(documentRevisions).where(eq(documentRevisions.id, op.drawingRevisionId));
    out.push({ gate: "drawing", ok: dr?.status === "released", message: dr?.status === "released" ? `Drawing rev ${dr.revision} released.` : `Drawing rev ${dr?.revision} is ${dr?.status} — not released for production.` });
  }

  // Revision review flag
  out.push({ gate: "review", ok: !op.reviewRequired, message: op.reviewRequired ? `Review required: ${op.reviewReason}` : "No pending revision review." });

  // Operator (assignment + competency)
  if (opts.employeeId) {
    const assigned = await ctx.db.select().from(operationAssignments).where(and(eq(operationAssignments.operationId, opId), eq(operationAssignments.employeeId, opts.employeeId), eq(operationAssignments.isActive, true))).limit(1);
    let ok = assigned.length > 0;
    let message = ok ? "Operator assigned." : "You are not assigned to this operation.";
    if (ok && op.requiredCompetencyId) {
      const comp = await hasValidCompetency(ctx, opts.employeeId, op.requiredCompetencyId);
      if (!comp) {
        ok = false;
        message = "You do not hold a valid competency for this operation.";
      } else message = "Operator assigned and qualified.";
    }
    out.push({ gate: "operator", ok, message });
  } else {
    out.push({ gate: "operator", ok: false, message: "Your user account is not linked to an employee record." });
  }

  // Machine
  if (machineId) {
    const [m] = await ctx.db.select().from(machines).where(eq(machines.id, machineId));
    const caps = await ctx.db.select().from(machineCapabilities).where(eq(machineCapabilities.machineId, machineId));
    const capable = !caps.length || caps.some((c) => c.operationTypeId === op.operationTypeId);
    const locks = await activeMaintenanceLocks(ctx, [machineId]);
    const busy = m?.allowsConcurrent
      ? []
      : await ctx.db.select({ n: operations.opNumber, j: operations.jobId }).from(operations).where(and(eq(operations.machineId, machineId), ne(operations.id, opId), inArray(operations.status, ["in_setup", "awaiting_first_off", "in_production"])));
    const ok = !!m?.isActive && capable && !locks.length && !busy.length;
    out.push({
      gate: "machine",
      ok,
      message: !m?.isActive ? "Machine is inactive." : !capable ? `${m.code} is not configured for this operation type.` : locks.length ? `${m.code} is locked for maintenance (${locks[0].ref}).` : busy.length ? `${m.code} is already running another operation.` : `${m.code} available.`,
    });
  } else {
    const { operationTypes } = await import("../db/schema");
    const [t] = await ctx.db.select().from(operationTypes).where(eq(operationTypes.id, op.operationTypeId));
    if (t.requiresMachine) out.push({ gate: "machine", ok: false, message: "No machine assigned." });
  }

  // Holds (operation, job, batch, allocated lots)
  const lotIds = (await ctx.db.select({ id: materialAllocations.lotId }).from(materialAllocations).where(and(eq(materialAllocations.jobId, job.id), ne(materialAllocations.status, "cancelled")))).map((x) => x.id);
  const activeHolds = await ctx.db
    .select()
    .from(holds)
    .where(
      and(
        isNull(holds.releasedAt),
        or(eq(holds.operationId, opId), and(eq(holds.jobId, job.id), eq(holds.targetType, "job")), op.batchId ? eq(holds.batchId, op.batchId) : undefined, lotIds.length ? inArray(holds.lotId, lotIds) : undefined),
      ),
    );
  out.push({ gate: "hold", ok: activeHolds.length === 0 && op.status !== "on_hold", message: activeHolds.length ? `Active hold: ${activeHolds[0].reason}` : op.status === "on_hold" ? "Operation is on hold." : "No active holds." });

  if (opts.phase === "production") {
    if (op.requiresFirstOff) out.push({ gate: "first_off", ok: op.firstOffStatus === "approved", message: op.firstOffStatus === "approved" ? "First-off approved." : `First-off ${op.firstOffStatus.replace("_", " ")} — production cannot start.` });
    if (opts.employeeId) {
      const checks = await ctx.db.select().from(operationChecks).where(and(eq(operationChecks.operationId, opId), eq(operationChecks.employeeId, opts.employeeId)));
      const need = ["drawing_reviewed", "instructions_read", ...(op.requiresProgram ? ["program_confirmed"] : []), ...(op.requiresMaterial ? ["material_confirmed"] : [])];
      const missing = need.filter((k) => !checks.some((c) => c.kind === k && (k !== "program_confirmed" || c.programRevisionId === op.programRevisionId) && (k !== "drawing_reviewed" || !op.drawingRevisionId || c.drawingRevisionId === op.drawingRevisionId)));
      out.push({ gate: "checks", ok: missing.length === 0, message: missing.length ? `Confirm before starting: ${missing.map((m) => m.replace("_", " ")).join(", ")}.` : "Pre-start confirmations recorded." });
    }
  }

  // Apply approved exceptions
  const excs = await ctx.db
    .select()
    .from(gateExceptions)
    .where(and(eq(gateExceptions.operationId, opId), eq(gateExceptions.status, "approved"), or(isNull(gateExceptions.validUntil), gte(gateExceptions.validUntil, new Date()))));
  for (const r of out) {
    if (r.ok) continue;
    const e = excs.find((x) => x.gate === r.gate);
    if (e && OVERRIDABLE.includes(r.gate)) {
      r.ok = true;
      r.overriddenBy = e.ref;
      r.message = `${r.message} — passed by authorised exception ${e.ref}.`;
    }
  }
  return out;
}

/**
 * Records an authorised gate exception (signed, reason required). Only overridable gates;
 * program, machine and hold gates can never be bypassed this way.
 */
export async function recordGateException(ctx: Ctx, input: { operationId: string; gate: Gate; reason: string; password: string; validHours?: number }) {
  requirePermission(ctx, "production.override_gate");
  if (!OVERRIDABLE.includes(input.gate)) throw invalid(`The "${input.gate}" gate cannot be overridden. Resolve the cause instead.`);
  if (!input.reason?.trim() || input.reason.trim().length < 10) throw invalid("Give a full justification (at least 10 characters).", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const [op] = await tx.db.select().from(operations).where(eq(operations.id, input.operationId)).limit(1);
    if (!op) throw invalid("Operation not found.");
    const [job] = await tx.db.select().from(jobs).where(eq(jobs.id, op.jobId));
    if (["complete", "cancelled"].includes(op.status) || ["completed", "cancelled"].includes(job.status)) throw invalid("The operation or job is closed.");
    const ref = await nextRef(tx.db, REF.gateException);
    const [exc] = await tx.db
      .insert(gateExceptions)
      .values({ ref, gate: input.gate, jobId: op.jobId, operationId: op.id, reason: input.reason, requestedBy: ctx.actor.userId, approvedBy: ctx.actor.userId, validUntil: input.validHours ? new Date(Date.now() + input.validHours * 3_600_000) : null })
      .returning();
    const approval = await signApproval(tx, {
      kind: "gate_exception",
      entityType: "gate_exception",
      entityId: exc.id,
      decision: "approved",
      meaning: `I authorise exception ${ref} to bypass the "${input.gate}" gate for ${job.jobNumber} operation ${op.opNumber}, and accept responsibility for this decision.`,
      comment: input.reason,
      password: input.password,
    });
    await tx.db.update(gateExceptions).set({ approvalId: approval.id }).where(eq(gateExceptions.id, exc.id));
    await audit(tx, { action: "gate.exception", entityType: "operation", entityId: op.id, entityRef: `${job.jobNumber}/${op.opNumber}`, jobId: op.jobId, operationId: op.id, exceptionId: exc.id, approvalId: approval.id, reason: input.reason, after: { gate: input.gate, ref } });
    return exc;
  });
}

export async function revokeGateException(ctx: Ctx, exceptionId: string, reason: string) {
  requirePermission(ctx, "production.override_gate");
  if (!reason?.trim()) throw invalid("A reason is required.", { field: "reason" });
  return mutate(ctx, async (tx) => {
    const [e] = await tx.db.update(gateExceptions).set({ status: "revoked", revokedAt: new Date() }).where(and(eq(gateExceptions.id, exceptionId), eq(gateExceptions.status, "approved"))).returning();
    if (!e) throw invalid("Exception not found.");
    await audit(tx, { action: "gate.exception_revoke", entityType: "operation", entityId: e.operationId, jobId: e.jobId, operationId: e.operationId, exceptionId, reason });
  });
}
