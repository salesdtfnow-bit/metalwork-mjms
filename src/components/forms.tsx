"use client";

import { createContext, useActionState, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, cx, type ButtonSize, type ButtonVariant } from "./ui";
import type { ActionResult } from "@/server/boundary";

type FormAction = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

const ErrorsCtx = createContext<Record<string, string> | undefined>(undefined);
const useFieldError = (name: string) => useContext(ErrorsCtx)?.[name];

/**
 * Form bound to a server action. Shows a result banner, field errors and gate failures.
 * `confirm` adds a confirmation dialog before submitting (destructive/irreversible actions).
 */
export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  submitVariant = "primary",
  submitSize = "md",
  confirm,
  resetOnSuccess = false,
  className,
  inline = false,
  hideSubmit = false,
}: {
  action: FormAction;
  children?: ReactNode;
  submitLabel?: string;
  submitVariant?: ButtonVariant;
  submitSize?: ButtonSize;
  confirm?: string;
  resetOnSuccess?: boolean;
  className?: string;
  inline?: boolean;
  hideSubmit?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  // A client-generated key protects against duplicate submissions (double-click / retry).
  const [submissionKey, setSubmissionKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (state?.ok) {
      if (resetOnSuccess) formRef.current?.reset();
      setSubmissionKey(crypto.randomUUID());
    }
  }, [state, resetOnSuccess]);

  return (
    <ErrorsCtx.Provider value={state && !state.ok ? state.fieldErrors : undefined}>
      <form ref={formRef} action={formAction} className={cx(inline ? "flex flex-wrap items-end gap-2" : "space-y-3", className)} noValidate={false}>
        <input type="hidden" name="_key" value={submissionKey} />
        {state && <ResultBanner state={state} />}
        {children}
        {!hideSubmit &&
          (confirm ? (
            <>
              <button type="button" className={buttonClass(submitVariant, submitSize)} onClick={() => dialogRef.current?.showModal()}>
                {submitLabel}
              </button>
              <dialog ref={dialogRef} className="m-auto w-[min(440px,92vw)] rounded-md border border-line p-0 backdrop:bg-ink/40">
                <div className="p-4">
                  <p className="font-semibold text-ink">Confirm</p>
                  <p className="mt-1 text-[13.5px] text-steel">{confirm}</p>
                </div>
                <div className="flex justify-end gap-2 border-t border-line bg-paper px-4 py-3">
                  <button type="button" className={buttonClass("secondary")} onClick={() => dialogRef.current?.close()}>
                    Go back
                  </button>
                  <button
                    type="button"
                    className={buttonClass(submitVariant)}
                    onClick={() => {
                      dialogRef.current?.close();
                      formRef.current?.requestSubmit();
                    }}
                  >
                    {submitLabel}
                  </button>
                </div>
              </dialog>
            </>
          ) : (
            <SubmitButton variant={submitVariant} size={submitSize}>
              {submitLabel}
            </SubmitButton>
          ))}
      </form>
    </ErrorsCtx.Provider>
  );
}

function ResultBanner({ state }: { state: ActionResult }) {
  if (state.ok) {
    return state.message ? (
      <p role="status" className="rounded-sm border border-green/40 bg-green-50 px-3 py-1.5 text-[13px] text-green">
        {state.message}
      </p>
    ) : null;
  }
  return (
    <div role="alert" className="w-full rounded-sm border border-red/40 bg-red-50 px-3 py-2 text-[13px] text-red">
      <p className="font-medium">{state.error}</p>
      {state.gates && state.gates.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {state.gates.map((g, i) => (
            <li key={i}>
              <span className="font-semibold">{gateLabel(g.gate)}:</span> {g.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const GATE_LABELS: Record<string, string> = {
  dependencies: "Previous operations",
  material: "Material",
  program: "CNC program",
  drawing: "Drawing",
  operator: "Operator",
  machine: "Machine",
  hold: "Hold",
  first_off: "First-off",
  review: "Revision review",
  route: "Route",
};
export const gateLabel = (g: string) => GATE_LABELS[g] ?? g;

export function SubmitButton({ children, variant = "primary", size = "md", className }: { children: ReactNode; variant?: ButtonVariant; size?: ButtonSize; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass(variant, size, className)}>
      {pending ? "Working…" : children}
    </button>
  );
}

function FieldShell({ label, name, hint, required, children, className, id }: { label: string; name: string; hint?: ReactNode; required?: boolean; children: ReactNode; className?: string; id: string }) {
  const err = useFieldError(name);
  return (
    <div className={cx("min-w-0", className)}>
      <label htmlFor={id} className="mb-1 block text-[12.5px] font-medium text-ink-2">
        {label}
        {required && (
          <span className="text-red" aria-hidden>
            {" "}
            *
          </span>
        )}
      </label>
      {children}
      {err ? (
        <p id={`${id}-err`} className="mt-1 text-[12px] text-red">
          {err}
        </p>
      ) : hint ? (
        <p className="mt-1 text-[12px] text-steel">{hint}</p>
      ) : null}
    </div>
  );
}

type Common = { label: string; name: string; hint?: ReactNode; required?: boolean; className?: string; disabled?: boolean };

export function TextField({ type = "text", defaultValue, placeholder, inputMode, step, min, max, autoComplete, autoFocus, ...c }: Common & {
  type?: string;
  defaultValue?: string | number | null;
  placeholder?: string;
  inputMode?: "decimal" | "numeric" | "text" | "email" | "search";
  step?: string;
  min?: string | number;
  max?: string | number;
  autoComplete?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  const err = useFieldError(c.name);
  return (
    <FieldShell {...c} id={id}>
      <input
        id={id}
        name={c.name}
        type={type}
        defaultValue={defaultValue ?? undefined}
        placeholder={placeholder}
        required={c.required}
        disabled={c.disabled}
        inputMode={inputMode}
        step={step}
        min={min}
        max={max}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        aria-invalid={err ? true : undefined}
        aria-describedby={err ? `${id}-err` : undefined}
        className="field-input"
      />
    </FieldShell>
  );
}

export function NumberField(props: Common & { defaultValue?: string | number | null; placeholder?: string; step?: string; unit?: string }) {
  return <TextField {...props} type="text" inputMode="decimal" label={props.unit ? `${props.label} (${props.unit})` : props.label} />;
}

export function TextArea({ defaultValue, rows = 3, placeholder, ...c }: Common & { defaultValue?: string | null; rows?: number; placeholder?: string }) {
  const id = useId();
  const err = useFieldError(c.name);
  return (
    <FieldShell {...c} id={id}>
      <textarea
        id={id}
        name={c.name}
        rows={rows}
        defaultValue={defaultValue ?? undefined}
        placeholder={placeholder}
        required={c.required}
        disabled={c.disabled}
        aria-invalid={err ? true : undefined}
        className="field-input"
      />
    </FieldShell>
  );
}

export function SelectField({ options, defaultValue, placeholder, ...c }: Common & { options: { value: string; label: string }[]; defaultValue?: string | null; placeholder?: string }) {
  const id = useId();
  const err = useFieldError(c.name);
  return (
    <FieldShell {...c} id={id}>
      <select id={id} name={c.name} defaultValue={defaultValue ?? ""} required={c.required} disabled={c.disabled} aria-invalid={err ? true : undefined} className="field-input">
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function CheckboxField({ label, name, defaultChecked, hint, value = "on" }: { label: string; name: string; defaultChecked?: boolean; hint?: string; value?: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <input id={id} type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className="mt-0.5 h-4 w-4 accent-dykem" />
      <label htmlFor={id} className="text-[13.5px] text-ink">
        {label}
        {hint && <span className="block text-[12px] text-steel">{hint}</span>}
      </label>
    </div>
  );
}

export function FileField({ multiple, accept, ...c }: Common & { multiple?: boolean; accept?: string }) {
  const id = useId();
  return (
    <FieldShell {...c} id={id}>
      <input id={id} type="file" name={c.name} multiple={multiple} accept={accept} required={c.required} className="block w-full text-[13px] file:mr-3 file:rounded-sm file:border file:border-line file:bg-sheet file:px-3 file:py-1.5 file:text-[13px] file:font-medium hover:file:bg-line-2" />
    </FieldShell>
  );
}

/** Electronic approval block: states the meaning of the signature and requires the user's password. */
export function SignatureBlock({ meaning, name = "password" }: { meaning: string; name?: string }) {
  const id = useId();
  const err = useFieldError(name);
  return (
    <fieldset className="rounded-sm border border-ink/30 bg-paper p-3">
      <legend className="px-1 text-[12.5px] font-semibold text-ink">Electronic approval</legend>
      <p className="text-[13px] text-ink-2">{meaning}</p>
      <label htmlFor={id} className="mt-2 block text-[12.5px] font-medium text-ink-2">
        Re-enter your password to sign
      </label>
      <input id={id} name={name} type="password" required autoComplete="current-password" aria-invalid={err ? true : undefined} className="field-input mt-1 max-w-xs" />
      {err && <p className="mt-1 text-[12px] text-red">{err}</p>}
    </fieldset>
  );
}

export function FormGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 | 4 }) {
  return <div className={cx("grid gap-3", cols === 1 ? "" : cols === 2 ? "sm:grid-cols-2" : cols === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4")}>{children}</div>;
}

/** Collapsible inline panel for secondary forms (keeps record pages uncluttered). */
export function Disclosure({ label, children, defaultOpen = false, variant = "secondary" }: { label: string; children: ReactNode; defaultOpen?: boolean; variant?: ButtonVariant }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={buttonClass(variant, "sm")}>
        {open ? "Close" : label}
      </button>
      {open && <div className="mt-3 rounded-md border border-line bg-sheet p-3">{children}</div>}
    </div>
  );
}
