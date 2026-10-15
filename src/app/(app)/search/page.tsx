import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/next";
import { globalSearch, resolveCode, type SearchHit } from "@/server/services/search";
import { Empty, PageHeader, Section } from "@/components/ui";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireCtx();
  const q = (await searchParams).q?.trim() ?? "";
  if (q) {
    // Exact code (scanned barcode / typed reference) → straight to the record.
    const dest = await resolveCode(ctx, q);
    if (dest) redirect(dest);
  }
  const hits = q ? await globalSearch(ctx, q) : [];
  const groups = new Map<string, SearchHit[]>();
  for (const h of hits) groups.set(h.kind, [...(groups.get(h.kind) ?? []), h]);

  return (
    <>
      <PageHeader title="Search" description="Search across the records you have access to. Scanning or typing an exact reference opens the record directly." />
      <form className="mb-5 flex flex-wrap items-center gap-2" role="search">
        <label htmlFor="search-q" className="sr-only">
          Search
        </label>
        <input id="search-q" name="q" type="search" defaultValue={q} autoFocus placeholder="Job, quotation, PO, heat no., drawing, program, machine, person…" className="field-input h-10 max-w-xl flex-1 text-[15px]" />
        <button className="h-10 rounded-sm border border-dykem bg-dykem px-4 text-[14px] font-medium text-white hover:bg-dykem-2">Search</button>
      </form>

      {!q && (
        <Empty title="Type something to search">
          <SearchTips />
        </Empty>
      )}

      {q && q.length < 2 && <Empty title="Enter at least two characters" />}

      {q.length >= 2 && hits.length === 0 && (
        <Empty title={`No results for “${q}”`}>
          <SearchTips />
        </Empty>
      )}

      {hits.length > 0 && (
        <>
          <p className="mb-3 text-[13px] text-steel">
            {hits.length} result(s) for “{q}”. Results are limited per record type — refine the search if you don&apos;t see what you need.
          </p>
          <div className="grid gap-x-6 lg:grid-cols-2">
            {[...groups.entries()].map(([kind, list]) => (
              <Section key={kind} title={`${kind} (${list.length})`}>
                <ul className="divide-y divide-line rounded-md border border-line bg-sheet">
                  {list.map((h) => (
                    <li key={h.href}>
                      <Link href={h.href} className="flex items-baseline justify-between gap-3 px-3 py-2 hover:bg-line-2/40">
                        <span className="min-w-0 truncate text-[13.5px] text-dykem">{h.label}</span>
                        {h.sub && <span className="shrink-0 text-[12px] capitalize text-steel">{h.sub.replace(/_/g, " ")}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Section>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function SearchTips() {
  return (
    <ul className="mx-auto mt-2 max-w-md list-disc pl-5 text-left">
      <li>Exact references open the record directly: job numbers, quotation and enquiry refs, PO numbers, lot numbers, NCRs, inspections, delivery notes, program and document numbers, machine codes.</li>
      <li>Partial text matches titles, descriptions, names and part numbers.</li>
      <li>
        To follow a heat/cast number, serial or batch through production use{" "}
        <Link href="/traceability" className="link">
          Traceability
        </Link>
        .
      </li>
      <li>You only see record types your role can open.</li>
    </ul>
  );
}
