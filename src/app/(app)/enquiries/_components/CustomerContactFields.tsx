"use client";

import { useState } from "react";
import { SelectField } from "@/components/forms";

type Customer = { id: string; code: string; name: string };
type Contact = { id: string; customerId: string | null; name: string; email: string | null; jobTitle: string | null };

/**
 * Customer + contact pickers. The contact list follows the chosen customer.
 * Shared by the new-enquiry and new-quotation forms.
 */
export function CustomerContactFields({
  customers,
  contacts,
  defaultCustomerId,
  defaultContactId,
  lockCustomer = false,
}: {
  customers: Customer[];
  contacts: Contact[];
  defaultCustomerId?: string | null;
  defaultContactId?: string | null;
  lockCustomer?: boolean;
}) {
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? "");
  const options = contacts.filter((c) => c.customerId === customerId);
  return (
    <div
      className="contents"
      onChange={(e) => {
        const t = e.target as unknown as HTMLSelectElement;
        if (t.name === "customerId") setCustomerId(t.value);
      }}
    >
      {lockCustomer && defaultCustomerId ? (
        <div>
          <input type="hidden" name="customerId" value={defaultCustomerId} />
          <p className="mb-1 block text-[12.5px] font-medium text-ink-2">Customer</p>
          <p className="py-1.5 text-[13.5px] font-medium text-ink">
            {customers.find((c) => c.id === defaultCustomerId)?.name ?? "—"}
          </p>
        </div>
      ) : (
        <SelectField
          label="Customer"
          name="customerId"
          required
          placeholder="Select a customer"
          defaultValue={defaultCustomerId}
          options={customers.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))}
        />
      )}
      <SelectField
        key={customerId}
        label="Contact"
        name="contactId"
        placeholder={customerId ? (options.length ? "No specific contact" : "No contacts recorded") : "Select a customer first"}
        defaultValue={options.some((o) => o.id === defaultContactId) ? defaultContactId : ""}
        options={options.map((c) => ({ value: c.id, label: `${c.name}${c.jobTitle ? ` — ${c.jobTitle}` : ""}${c.email ? ` <${c.email}>` : ""}` }))}
        disabled={!customerId || !options.length}
      />
    </div>
  );
}
