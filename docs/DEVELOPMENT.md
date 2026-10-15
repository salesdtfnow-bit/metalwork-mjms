# MJMS Developer Guide

## Stack
- Next.js 16 (App Router, Node runtime). **Cache Components are off**, so every page renders per request.
- TypeScript (strict) and Tailwind CSS 4. Tokens are in `src/app/globals.css`.
- Drizzle ORM. PostgreSQL in production; PGlite (embedded Postgres 17) for local development and tests.
- Vitest. The tests use in-memory PGlite with the real migrations applied.

## Layout
```
src/app/(auth)/…            sign-in, password reset (public)
src/app/(app)/<module>/…    authenticated UI, one folder per module
src/app/api/…               file download, PDFs, REST v1, webhooks, cron, health
src/components/ui.tsx       server-safe UI primitives (TitleBlock, Table, Badge, Tabs, …)
src/components/forms.tsx    client form kit (ActionForm, fields, SignatureBlock, Disclosure)
src/server/services/*.ts    ALL business logic (permissions, validation, audit, gates)
src/server/action.ts        server-action wrapper: action(name, zodSchema, handler, {revalidate})
src/server/forms.ts         zod helpers for FormData: f.str(), f.optStr(), f.dec(), f.uuid(), f.bool() …
src/lib/status.ts           status vocabularies with labels and tones
src/lib/format.ts           fmtDate, fmtDateTime, fmtMoney, fmtQty, fmtMinutes (company timezone)
```

## Rules
1. **Pages never write to the database.** Mutations go through a server action. The action calls a service, and the service checks permissions, validates input, opens a transaction and writes the audit event.
2. **Read in pages with service functions.** Call `requirePageCtx("perm.view")` first.
3. **Commercial data.** Check `can(ctx.actor, "…view_commercial")` before showing prices or values.
4. **Show actions only to users who can perform them.** Hide the control when the user lacks the permission. The server enforces the rule regardless.
5. **No fake controls.** If something isn't implemented, render `<NotYet>` with an honest explanation.
6. **Signed actions** (releases, approvals, dispositions, gate exceptions) must include `<SignatureBlock meaning="…" />`. The action passes `password` to the service.
7. **Destructive or irreversible actions** use `ActionForm confirm="…"`.
8. **Formatting.** Dates use `fmtDate`/`fmtDateTime`. Quantities use `fmtQty`. Money uses `fmtMoney`. Never call `toLocaleString` directly.
9. **Status display.** Always use `<StatusBadge map={JOB_STATUS} status={…} />`, which shows a colour and a text label.
10. **Files** are linked as `/api/files/<fileId>` (authorised and logged). PDFs are at `/api/pdf/<kind>/<id>`.

## Page pattern (see `src/app/(app)/customers/`)
```tsx
// page.tsx (server component)
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageCtx("module.view");
  const { id } = await params;
  const tab = (await searchParams).tab ?? "overview";
  const data = await getThing(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "not_found") notFound(); throw e; });
  return (<>
    <TitleBlock kind="Thing" refNo={data.ref} title={data.title} status={<StatusBadge map={…} status={…} />} cells={[…]} actions={…} />
    <Tabs base={`/module/${id}`} current={tab} tabs={[…]} />
    {tab === "overview" && <Section title="…">…</Section>}
  </>);
}
```
```ts
// actions.ts
"use server";
export const doThingAction = action("thing.do", z.object({ id: f.uuid(), reason: f.str() }), async (ctx, i) => {
  await doThing(ctx, i.id, i.reason);
  return "Thing done.";            // shown as a success message
}, { revalidate: (i) => `/module/${i.id}` });
```
```tsx
// in the page (ActionForm is a client component; actions are passed as props)
<ActionForm action={doThingAction} submitLabel="Do thing" confirm="This cannot be undone.">
  <input type="hidden" name="id" value={id} />
  <TextArea label="Reason" name="reason" required />
</ActionForm>
```

## Commands
```bash
npm run dev              # http://localhost:3000 (PGlite at ./.data/pglite)
npm test                 # all unit, integration and scenario tests
npm run typecheck
npm run db:generate      # after editing src/server/db/schema/* → new SQL migration
npm run db:reset:local && npm run db:seed:demo
```
PGlite allows **one process at a time**. Stop `npm run dev` before running seed or migration scripts against the local database.
