"use client";

import { useState } from "react";
import { ActionForm, CheckboxField, FileField, SubmitButton, TextArea, TextField } from "@/components/forms";
import { cx } from "@/components/ui";
import { respondAction } from "./actions";

type Decision = "accept" | "changes" | "reject";

const OPTIONS: { value: Decision; label: string; hint: string }[] = [
  { value: "accept", label: "Accept", hint: "Place the order on these terms" },
  { value: "changes", label: "Ask for changes", hint: "Quantity, price, lead time or drawing" },
  { value: "reject", label: "Decline", hint: "We won't be going ahead" },
];

export function ResponseForm({ token, customerName, quoteLabel, total }: { token: string; customerName: string; quoteLabel: string; total: string }) {
  const [decision, setDecision] = useState<Decision>("accept");
  return (
    <ActionForm action={respondAction} hideSubmit className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-ink-2">Your response</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {OPTIONS.map((o) => (
            <label
              key={o.value}
              className={cx(
                "flex cursor-pointer flex-col rounded-sm border px-3 py-2.5 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-dykem",
                decision === o.value ? "border-dykem bg-dykem-50" : "border-line bg-white hover:border-steel",
              )}
            >
              <span className="flex items-center gap-2">
                <input type="radio" name="decision" value={o.value} checked={decision === o.value} onChange={() => setDecision(o.value)} className="accent-dykem" />
                <span className="font-semibold text-ink">{o.label}</span>
              </span>
              <span className="mt-0.5 pl-6 text-[12.5px] text-steel">{o.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Your full name" name="name" required autoComplete="name" />
        {decision === "accept" && <TextField label="Position" name="position" required autoComplete="organization-title" hint="e.g. Purchasing Manager" />}
        {decision === "accept" && <TextField label="Email" name="email" type="email" required autoComplete="email" hint="The signed order acceptance is sent here." />}
        {decision === "accept" && <TextField label="Your PO number" name="poReference" hint="Optional — or attach your PO below." />}
      </div>

      {decision === "accept" && <FileField label="Attach your purchase order" name="poFile" accept=".pdf,.png,.jpg,.jpeg,.eml,.msg,.doc,.docx,.xlsx" hint="Optional. PDF or image, up to 4 MB." />}

      <TextArea
        label={decision === "changes" ? "What would you like changed?" : decision === "reject" ? "Reason (optional — it helps us quote better next time)" : "Comments (optional)"}
        name="comment"
        rows={decision === "changes" ? 4 : 2}
        required={decision === "changes"}
      />

      {decision === "accept" && (
        <div className="rounded-sm border border-line bg-paper p-3">
          <CheckboxField
            name="confirm"
            label={`I am authorised to place this order on behalf of ${customerName}, and I accept ${quoteLabel} (total ${total}) on the terms shown.`}
          />
          <p className="mt-2 pl-6 text-[12px] text-steel">
            Your name, the time and your IP address are recorded with your acceptance. This is an electronic acceptance, not a qualified electronic signature.
          </p>
        </div>
      )}

      <SubmitButton size="lg" variant={decision === "reject" ? "danger" : "primary"}>
        {decision === "accept" ? "Accept quotation" : decision === "changes" ? "Send change request" : "Decline quotation"}
      </SubmitButton>
    </ActionForm>
  );
}
