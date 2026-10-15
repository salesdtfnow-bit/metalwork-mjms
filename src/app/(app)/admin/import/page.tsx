import { requirePageCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { CUSTOMER_COLUMNS, MATERIAL_SPEC_COLUMNS, MAX_IMPORT_ROWS, SUPPLIER_COLUMNS } from "@/server/services/imports";
import { Notice, Panel, Section } from "@/components/ui";
import { ImportForm } from "../_components/ImportForm";
import { importCsvAction } from "../actions";

export const metadata = { title: "Data import" };

function Columns({ cols, required, notes }: { cols: readonly string[]; required: string[]; notes?: React.ReactNode }) {
  return (
    <div className="mb-3 text-[13px]">
      <p className="text-steel">Header row (column order does not matter; matching ignores case, spaces and underscores):</p>
      <pre className="mt-1 overflow-x-auto rounded-sm bg-paper p-2 text-[12px]">{cols.join(",")}</pre>
      <p className="mt-1 text-steel">
        Required: <strong className="text-ink-2">{required.join(", ")}</strong>. Other columns are optional and may be omitted.
      </p>
      {notes && <div className="mt-1 text-steel">{notes}</div>}
    </div>
  );
}

export default async function ImportPage() {
  const ctx = await requirePageCtx("admin.settings");
  const a = ctx.actor;
  return (
    <>
      <Notice tone="info">
        Upload a UTF-8 CSV file (RFC 4180: comma-separated, values containing commas, quotes or line breaks in double quotes). Each row is validated with the same rules as the on-screen forms and created through the normal service, so every record is audited. Rows whose code already exists are <strong>skipped, never overwritten</strong>. Up to {MAX_IMPORT_ROWS.toString()} rows per file.
      </Notice>

      <Section title="Customers">
        <Panel className="p-4">
          <Columns
            cols={CUSTOMER_COLUMNS}
            required={["code", "name"]}
            notes="code: 2–20 characters (stored upper-case). currency: 3-letter code, default GBP. Commercial fields (accountRef, paymentTerms, creditLimit) are imported as given."
          />
          {can(a, "customers.manage") ? <ImportForm action={importCsvAction} kind="customers" label="Customers CSV" /> : <Notice tone="warning">Requires the “Create and edit customers” permission.</Notice>}
        </Panel>
      </Section>

      <Section title="Suppliers">
        <Panel className="p-4">
          <Columns
            cols={SUPPLIER_COLUMNS}
            required={["code", "name"]}
            notes="categories: separate several with ; — allowed values material, subcontract, tooling, calibration, maintenance, carrier, other. Imported suppliers start with approval status “pending”; approval is a separate quality decision on the supplier record."
          />
          {can(a, "suppliers.manage") ? <ImportForm action={importCsvAction} kind="suppliers" label="Suppliers CSV" /> : <Notice tone="warning">Requires the “Create and edit suppliers” permission.</Notice>}
        </Panel>
      </Section>

      <Section title="Material specifications">
        <Panel className="p-4">
          <Columns
            cols={MATERIAL_SPEC_COLUMNS}
            required={["code", "grade", "form"]}
            notes="form: bar, plate, sheet, tube, billet, casting, forging, extrusion or other. certRequirement: none, 2.1, 2.2, 3.1 or 3.2 (default 3.1). uom default mm. BoxHero item links are made afterwards on the materials screen."
          />
          {can(a, "materials.manage_specs") ? <ImportForm action={importCsvAction} kind="material_specs" label="Material specifications CSV" /> : <Notice tone="warning">Requires the “Manage material specifications” permission.</Notice>}
        </Panel>
      </Section>
    </>
  );
}
