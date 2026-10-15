/**
 * Domain errors thrown by services. The UI/API layers map these to user-facing messages
 * and HTTP status codes. Never leak raw database errors to users.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: "validation" | "forbidden" | "not_found" | "conflict" | "gate" | "unauthenticated" | "integration",
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const forbidden = (msg = "You do not have permission to perform this action.") => new AppError(msg, "forbidden");
export const notFound = (what = "Record") => new AppError(`${what} not found.`, "not_found");
export const conflict = (msg: string, details?: Record<string, unknown>) => new AppError(msg, "conflict", details);
export const invalid = (msg: string, details?: Record<string, unknown>) => new AppError(msg, "validation", details);

/** A production/quality gate blocked the action. `failures` lists each failing gate. */
export class GateError extends AppError {
  constructor(public readonly failures: { gate: string; message: string }[]) {
    super(`Blocked by ${failures.length} gate(s): ${failures.map((f) => f.message).join(" · ")}`, "gate", { failures });
    this.name = "GateError";
  }
}

/** Walks the `cause` chain (Drizzle wraps driver errors) and returns the innermost Postgres error. */
export function pgError(err: unknown): { code?: string; message: string; constraint?: string } | undefined {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    const e = cur as { code?: unknown; message?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) {
      return { code: e.code, message: String(e.message), constraint: e.constraint as string | undefined };
    }
    cur = e.cause;
  }
  return undefined;
}

export function isUniqueViolation(err: unknown, constraint?: string) {
  const pe = pgError(err);
  return pe?.code === "23505" && (!constraint || pe.constraint === constraint || pe.message.includes(constraint));
}

/** Converts any error into a safe message for display. */
export function userMessage(err: unknown): string {
  if (err instanceof AppError) return err.message;
  const pe = pgError(err);
  if (pe?.code === "23505") return "A record with the same unique reference already exists.";
  if (pe?.code === "23503") return "This record is linked to other records and cannot be changed this way.";
  if (pe?.code === "42501") return "This record is protected and cannot be modified.";
  return "An unexpected error occurred. The problem has been logged.";
}
