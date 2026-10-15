"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/forms";
import { Badge } from "@/components/ui";
import type { ActionResult } from "@/server/boundary";
import type { ImportReport } from "@/server/services/imports";

type FormAction = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

/** CSV upload form that renders the per-row import report returned by the action. */
export function ImportForm({ action, kind, label }: { action: FormAction; kind: string; label: string }) {
  const [state, formAction] = useActionState(action, null);
  const report = state?.ok ? (state.data as ImportReport | undefined) : undefined;

  return (
    <div>
      <form
        action={formAction}
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          // Fresh duplicate-submission key for every submit (see server/action.ts).
          const k = e.currentTarget.elements.namedItem("_key");
          if (k instanceof HTMLInputElement) k.value = crypto.randomUUID();
        }}
      >
        <input type="hidden" name="_key" defaultValue="" />
        <input type="hidden" name="kind" value={kind} />
        <label className="text-[12.5px] font-medium text-ink-2">
          <span className="mb-1 block">{label}</span>
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="block text-[13px] file:mr-3 file:rounded-sm file:border file:border-line file:bg-sheet file:px-3 file:py-1.5 file:text-[13px] file:font-medium hover:file:bg-line-2"
          />
        </label>
        <SubmitButton>Import</SubmitButton>
      </form>
      {state && !state.ok && (
        <div role="alert" className="mt-2 rounded-sm border border-red/40 bg-red-50 px-3 py-2 text-[13px] text-red">
          <p className="font-medium">{state.error}</p>
          {state.fieldErrors && Object.values(state.fieldErrors).filter((m) => m !== state.error).map((m, i) => <p key={i}>{m}</p>)}
        </div>
      )}
      {state?.ok && state.message && (
        <p role="status" className="mt-2 rounded-sm border border-green/40 bg-green-50 px-3 py-1.5 text-[13px] text-green">
          {state.message}
        </p>
      )}
      {report && report.rows.length > 0 && (
        <div className="mt-2 max-h-[420px] overflow-auto rounded-md border border-line bg-sheet">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Row</th>
                <th scope="col">Code</th>
                <th scope="col">Result</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.row}>
                  <td>{r.row}</td>
                  <td className="plate">{r.ref || "—"}</td>
                  <td>
                    {r.outcome === "created" ? <Badge tone="success">Created</Badge> : r.outcome === "skipped" ? <Badge tone="muted">Skipped</Badge> : <Badge tone="danger">Error</Badge>}
                  </td>
                  <td className="text-steel">{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
