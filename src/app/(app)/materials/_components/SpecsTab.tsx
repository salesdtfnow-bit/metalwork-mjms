import type { Ctx } from "@/server/context";
import { can } from "@/server/context";
import { listMaterialSpecs, searchBoxheroItems } from "@/server/services/materials";
import { fmtQty } from "@/lib/format";
import { Badge, Section, Table } from "@/components/ui";
import { ActionForm, Disclosure, FormGrid, SelectField, TextField } from "@/components/forms";
import { linkSpecItemAction } from "../actions";
import { SpecForm } from "./SpecForm";
import { certReqLabel, FAMILY_OPTIONS } from "./labels";

export async function SpecsTab({ ctx, bhq }: { ctx: Ctx; bhq?: string }) {
  const manage = can(ctx.actor, "materials.manage_specs");
  const specs = await listMaterialSpecs(ctx);
  const results = manage && bhq !== undefined ? await searchBoxheroItems(ctx, bhq) : null;

  return (
    <>
      <Section title="Material specifications" actions={manage && <Disclosure label="New specification">{<SpecForm submitLabel="Create specification" />}</Disclosure>}>
        <Table head={["Code", "Grade", "Standard", "Family", "Form", "Certificate requirement", "Linked BoxHero items", ""]} empty="No material specifications yet.">
          {specs.map((s) => (
            <tr key={s.id}>
              <td className="plate text-[13px]">{s.code}</td>
              <td className="font-medium">{s.grade}</td>
              <td>{s.standard ?? "—"}</td>
              <td>{FAMILY_OPTIONS.find((o) => o.value === s.materialFamily)?.label ?? s.materialFamily ?? "—"}</td>
              <td className="capitalize">{s.form}</td>
              <td>{certReqLabel(s.certRequirement)}</td>
              <td>
                {s.items.length === 0 ? (
                  <span className="text-steel">None linked</span>
                ) : (
                  <ul className="space-y-0.5 text-[12.5px]">
                    {s.items.map(({ link, item }) => (
                      <li key={item.id}>
                        <span className="font-medium">{item.name}</span>
                        {item.sku && <span className="text-steel"> · {item.sku}</span>}
                        {link.dimensions && <span className="text-steel"> · {link.dimensions}</span>}
                        {item.deleted && (
                          <Badge tone="danger" className="ml-1">
                            Deleted in BoxHero
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td>
                {!s.isActive && <Badge tone="muted">Inactive</Badge>}
                {manage && (
                  <Disclosure label="Edit" variant="ghost">
                    <SpecForm spec={s} submitLabel="Save specification" />
                  </Disclosure>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Section>

      {manage && (
        <Section title="Link a BoxHero item to a specification">
          <p className="mb-2 max-w-[90ch] text-[13px] text-steel">
            Search the cached BoxHero item catalogue (refresh it from the BoxHero tab), choose the item, then the specification it represents. Linked items are offered when
            raising purchase orders and receiving goods.
          </p>
          <form className="mb-3 flex flex-wrap items-center gap-2" role="search">
            <input type="hidden" name="tab" value="specs" />
            <input name="bhq" defaultValue={bhq} placeholder="Item name, SKU or barcode" className="field-input max-w-xs" aria-label="Search BoxHero items" />
            <button className="rounded-sm border border-line bg-sheet px-3 py-1.5 text-[13px]">Search BoxHero items</button>
          </form>
          {results &&
            (results.length === 0 ? (
              <p className="text-[13px] text-steel">No cached BoxHero items match “{bhq}”.</p>
            ) : (
              <div className="rounded-md border border-line bg-sheet p-3">
                <ActionForm action={linkSpecItemAction} submitLabel="Link item">
                  <FormGrid cols={3}>
                    <SelectField
                      label="BoxHero item"
                      name="boxheroItemId"
                      required
                      placeholder="Select an item…"
                      options={results.map((i) => ({ value: i.id, label: `${i.name}${i.sku ? ` (${i.sku})` : ""} — ${fmtQty(i.quantityTotal)} in stock` }))}
                    />
                    <SelectField label="Specification" name="materialSpecId" required placeholder="Select a specification…" options={specs.map((s) => ({ value: s.id, label: `${s.code} — ${s.grade}` }))} />
                    <TextField label="Dimensions" name="dimensions" placeholder="e.g. Ø50 × 3000 mm" />
                  </FormGrid>
                </ActionForm>
              </div>
            ))}
        </Section>
      )}
    </>
  );
}
