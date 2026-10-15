import { requirePageCtx } from "@/server/auth/next";
import { getSettings } from "@/server/services/settings";
import { fmtDateTime } from "@/lib/format";
import { Notice, Panel, Section } from "@/components/ui";
import { ActionForm, CheckboxField, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { updateSettingsAction } from "../actions";

export const metadata = { title: "Company settings" };

export default async function SettingsPage() {
  const ctx = await requirePageCtx("admin.settings");
  const s = await getSettings(ctx.db);
  return (
    <Panel className="max-w-5xl p-4">
      <p className="mb-3 text-[12px] text-steel">Last changed {fmtDateTime(s.updatedAt)}. Changes are audited with before and after values.</p>
      <ActionForm action={updateSettingsAction} submitLabel="Save settings">
        <Section title="Company">
          <FormGrid cols={3}>
            <TextField label="Company name" name="companyName" required defaultValue={s.companyName} className="sm:col-span-2" />
            <TextField label="Phone" name="phone" defaultValue={s.phone} />
            <TextField label="Email" name="email" type="email" defaultValue={s.email} />
            <TextField label="Website" name="website" defaultValue={s.website} />
            <TextField label="VAT number" name="vatNumber" defaultValue={s.vatNumber} />
            <TextField label="Company number" name="companyNumber" defaultValue={s.companyNumber} />
          </FormGrid>
          <div className="mt-3">
            <TextArea label="Address (printed on quotations, delivery notes and CoCs)" name="addressLines" rows={3} defaultValue={s.addressLines} />
          </div>
        </Section>

        <Section title="Regional & commercial">
          <FormGrid cols={4}>
            <TextField label="Timezone" name="timezone" required defaultValue={s.timezone} hint="IANA name, e.g. Europe/London" />
            <TextField label="Currency" name="currency" required defaultValue={s.currency} hint="3-letter ISO code, e.g. GBP" />
            <TextField label="Default tax rate (%)" name="defaultTaxRate" required defaultValue={s.defaultTaxRate} inputMode="decimal" />
            <TextField label="Quote validity (days)" name="quoteValidityDays" required defaultValue={s.quoteValidityDays} inputMode="numeric" />
          </FormGrid>
          <div className="mt-3">
            <TextArea label="Default quotation terms" name="defaultQuoteTerms" rows={4} defaultValue={s.defaultQuoteTerms} />
          </div>
          <p className="mt-1 text-[12px] text-steel">Dates in the interface are shown in the server&apos;s configured display timezone (NEXT_PUBLIC_COMPANY_TZ); keep it the same as this setting.</p>
        </Section>

        <Section title="Records & quality controls">
          <FormGrid cols={3}>
            <TextField label="Default record retention (years)" name="retentionYears" required defaultValue={s.retentionYears} inputMode="numeric" hint="Documentation of policy only — records are never deleted automatically." />
          </FormGrid>
          <div className="mt-3 space-y-3">
            <div>
              <CheckboxField label="Allow self-inspection" name="allowSelfInspection" defaultChecked={s.allowSelfInspection} hint="Lets an operator sign off inspections on their own operation." />
              <Notice tone="warning">
                Enabling self-inspection removes the independent check between production and inspection. Only enable it if your quality system and customers explicitly allow it.
              </Notice>
            </div>
            <div>
              <CheckboxField label="Require independent approval" name="requireIndependentApproval" defaultChecked={s.requireIndependentApproval} hint="The approver of a document or CNC program revision must not be its author." />
              <Notice tone="warning">Turning this off allows people to approve their own documents and programs — segregation of duties expected by ISO 9001 / AS9100 auditors is lost.</Notice>
            </div>
          </div>
        </Section>

        <Section title="BoxHero inventory integration">
          <FormGrid cols={3}>
            <SelectField
              label="Mode"
              name="boxheroMode"
              required
              defaultValue={s.boxheroMode}
              options={[
                { value: "simulated", label: "Simulated (no external calls)" },
                { value: "api", label: "Live API" },
                { value: "manual", label: "Manual confirmation" },
              ]}
            />
          </FormGrid>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-steel">
            <li>
              <strong className="text-ink-2">Simulated</strong> — stock movements are recorded against a built-in simulated inventory. Use for training and demonstrations; nothing is sent to BoxHero.
            </li>
            <li>
              <strong className="text-ink-2">Live API</strong> — stock-in / stock-out transactions are sent to BoxHero through the outbox with retries and idempotency. Requires the API token.
            </li>
            <li>
              <strong className="text-ink-2">Manual</strong> — movements are queued and a user records the BoxHero reference by hand after making the change in BoxHero.
            </li>
          </ul>
          <Notice tone="info">
            The BoxHero API token is never stored in the database or shown here. Set it only as the server environment variable <code className="plate">BOXHERO_API_TOKEN</code>. If the server sets <code className="plate">BOXHERO_MODE</code>, that value overrides this setting. In live API mode without a token, movements fail visibly rather than silently succeeding.
            {process.env.BOXHERO_MODE && <> Currently overridden by the environment: <strong>{process.env.BOXHERO_MODE}</strong>.</>}
          </Notice>
        </Section>
      </ActionForm>
    </Panel>
  );
}
