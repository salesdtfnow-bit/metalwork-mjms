import { requirePageCtx } from "@/server/auth/next";
import { canAny } from "@/server/context";
import { listMaterialSpecs, searchBoxheroItems } from "@/server/services/materials";
import { jobOptions, supplierOptions } from "@/server/services/ui/materials";
import { fmtQty } from "@/lib/format";
import { Notice, PageHeader, Panel } from "@/components/ui";
import { ActionForm, FormGrid, SelectField, TextArea, TextField } from "@/components/forms";
import { CERT_REQ_OPTIONS, FORM_OPTIONS } from "../../materials/_components/labels";
import { supplierLabel } from "../_components/supplier";
import { createPurchaseOrderAction } from "../actions";

export const metadata = { title: "New purchase order" };

const ROWS = 8;

export default async function NewPurchaseOrderPage() {
  const ctx = await requirePageCtx("purchasing.manage");
  const seeItems = canAny(ctx.actor, "boxhero.view", "materials.view");
  const [suppliers, jobs, specs, items] = await Promise.all([supplierOptions(ctx), jobOptions(ctx, { authorisedOnly: true }), listMaterialSpecs(ctx), seeItems ? searchBoxheroItems(ctx, "") : Promise.resolve([])]);
  const usable = suppliers.filter((s) => s.usable);
  const unusable = suppliers.length - usable.length;

  const itemMap = new Map<string, string>();
  for (const s of specs) for (const { item, link } of s.items) itemMap.set(item.id, `${item.name}${item.sku ? ` (${item.sku})` : ""} — linked to ${s.code}${link.dimensions ? ` · ${link.dimensions}` : ""}`);
  for (const i of items) if (!itemMap.has(i.id)) itemMap.set(i.id, `${i.name}${i.sku ? ` (${i.sku})` : ""} — ${fmtQty(i.quantityTotal)} cached`);
  const itemOptions = [...itemMap.entries()].map(([value, label]) => ({ value, label }));
  const jobOpts = jobs.map((j) => ({ value: j.id, label: `${j.jobNumber} — ${j.title} (${j.customer})` }));
  const specOpts = specs.filter((s) => s.isActive).map((s) => ({ value: s.id, label: `${s.code} — ${s.grade}` }));

  return (
    <>
      <PageHeader
        title="New purchase order"
        description="The order is created as a draft. A different person must approve it before it can be sent. Receiving the goods later does not make the material usable — lots still need inspection, certificate verification and release."
      />
      {unusable > 0 && (
        <Notice tone="info">
          {unusable} active supplier(s) are not listed because they are not approved, conditionally approved or their approval has expired.
        </Notice>
      )}
      <Panel className="max-w-[1400px] p-4">
        <ActionForm action={createPurchaseOrderAction} submitLabel="Create draft purchase order">
          <FormGrid cols={4}>
            <SelectField label="Supplier" name="supplierId" required placeholder="Select an approved supplier…" options={usable.map((s) => ({ value: s.id, label: supplierLabel(s) }))} className="sm:col-span-2" />
            <SelectField
              label="Kind"
              name="kind"
              required
              defaultValue="material"
              options={[
                { value: "material", label: "Material" },
                { value: "subcontract", label: "Subcontract" },
                { value: "tooling", label: "Tooling" },
                { value: "service", label: "Service" },
              ]}
            />
            <TextField label="Required date" name="requiredDate" type="date" hint="Default for lines without their own date." />
            <TextField label="Supplier reference" name="supplierReference" />
            <TextField label="Currency" name="currency" defaultValue="GBP" />
          </FormGrid>
          <FormGrid cols={2}>
            <TextArea label="Delivery instructions" name="deliveryInstructions" rows={2} />
            <TextArea label="Notes" name="notes" rows={2} />
          </FormGrid>

          <h2 className="border-b border-line pb-1 pt-2 text-[14.5px] font-semibold text-ink">Lines</h2>
          <p className="text-[12.5px] text-steel">
            Fill in as many lines as you need — empty lines are ignored. If a material spec is chosen, the form and certificate requirement default from the spec when left blank.
            Lines for a job require the job to be authorised.
          </p>
          {Array.from({ length: ROWS }, (_, i) => (
            <fieldset key={i} className="rounded-sm border border-line bg-paper p-3">
              <legend className="px-1 text-[12.5px] font-semibold text-ink">Line {i + 1}</legend>
              <FormGrid cols={4}>
                <TextField label="Description" name="line_desc" required={i === 0} className="sm:col-span-2" placeholder="e.g. 6082-T6 round bar" />
                <SelectField label="Job" name="line_job" options={jobOpts} placeholder="Stock / no job" />
                <SelectField label="Material spec" name="line_spec" options={specOpts} placeholder="—" />
                <SelectField label="BoxHero item" name="line_item" options={itemOptions} placeholder="Not tracked in BoxHero" className="sm:col-span-2" />
                <SelectField label="Form" name="line_form" options={FORM_OPTIONS} placeholder="From spec / —" />
                <TextField label="Dimensions" name="line_dims" placeholder="e.g. Ø50 × 3000" />
                <TextField label="Quantity" name="line_qty" inputMode="decimal" required={i === 0} />
                <TextField label="Unit" name="line_uom" defaultValue="pcs" />
                <TextField label="Unit price" name="line_price" inputMode="decimal" placeholder="0.00" />
                <TextField label="Required date" name="line_date" type="date" />
                <SelectField label="Certificate requirement" name="line_cert" options={CERT_REQ_OPTIONS} placeholder="From spec / —" className="sm:col-span-2" />
              </FormGrid>
            </fieldset>
          ))}
        </ActionForm>
      </Panel>
    </>
  );
}
