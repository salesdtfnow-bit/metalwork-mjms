# Installation and Deployment

## Requirements
- Node.js ≥ 22 (developed on 24), npm.
- Production: a Vercel project, PostgreSQL 15+ (Neon recommended, via the Vercel Marketplace) and a **private** Vercel Blob store.
- Optional: Resend (email), BoxHero (Business plan with API access; team in Location mode).

## Local installation
```bash
git clone https://github.com/<owner>/metalwork-mjms.git && cd metalwork-mjms
npm install
cp .env.example .env.local          # optional; defaults work without changes
npm run db:reset:local              # embedded PostgreSQL (PGlite) in ./.data/pglite
ADMIN_EMAIL=you@company.co.uk ADMIN_PASSWORD='long passphrase' npm run admin:create
npm run dev
```
To run locally against a real PostgreSQL, set `DATABASE_URL` and `DATABASE_URL_UNPOOLED`, then run `npm run db:migrate`.

## Production on Vercel (recommended)
1. **Project.** Import the GitHub repository into Vercel (framework: Next.js). `vercel.json` sets `buildCommand: npm run vercel-build`, which applies migrations and then builds.
2. **Database.** In the Vercel project go to *Storage → Marketplace → Neon (Postgres) → Create* and connect it to the project. Vercel injects `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct, used for migrations).
3. **Files.** Go to *Storage → Blob → Create store*, choose **Private** access, and connect it to the project. Vercel injects `BLOB_READ_WRITE_TOKEN` / `BLOB_STORE_ID`.
4. **Environment variables** (*Settings → Environment Variables*):
   - `APP_BASE_URL=https://<your-domain>`
   - `CRON_SECRET=<32+ random chars>`
   - Email: `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET` (inbound).
   - BoxHero: `BOXHERO_MODE=api`, `BOXHERO_API_TOKEN`, `BOXHERO_WEBHOOK_SECRET`.
   - `NEXT_PUBLIC_COMPANY_TZ=Europe/London` (if not UK, also set the company timezone in Admin → Settings).
5. **Deploy.** The first build runs the migrations and seeds the base data (roles, defaults).
6. **First administrator.** From a trusted machine with `DATABASE_URL_UNPOOLED` set, run `npm run admin:create` with `ADMIN_EMAIL` and `ADMIN_PASSWORD`. The account must change its password at first sign-in.
7. **Cron.** `vercel.json` schedules `/api/cron/daily` (05:00 UTC) and `/api/cron/boxhero-sync` (05:30 UTC). On the Hobby plan, crons run at most once a day. Outboxes are also processed immediately after each user action, so the daily cron is a safety net. On Pro, add `{ "path": "/api/cron/outbox", "schedule": "*/10 * * * *" }`.
8. **Security.** Enable Vercel deployment protection for preview deployments. Add a firewall rate-limit rule on `/login` and `/api/*`.

### Demo environment
Set `DEMO_MODE=true` (shows the banner). Then seed once from a trusted machine:
```bash
DATABASE_URL=$DATABASE_URL_UNPOOLED DEMO_PASSWORD='…' npm run db:seed:demo
```
The seed refuses to run against a database that already contains non-demo data.

## Updating
Push to `main`. Vercel builds, runs `scripts/migrate.ts` (forward-only, versioned SQL migrations in `drizzle/`) and deploys. Schema changes are made by editing `src/server/db/schema/*` and running `npm run db:generate`. Commit the generated SQL with the change.

## Monitoring
- `GET /api/health` returns 200 when the app can reach the database. Point an uptime monitor at it.
- Vercel → *Logs / Observability*: server errors are logged as `[service] unexpected error` (stack traces stay server-side; users see a safe message).
- Integration failures appear in *Admin → Integrations* and *Materials → BoxHero*, and generate notifications.

## Other hosting
Any Node 22+ host that can run `next start` works (Docker, VM):
1. Set `DATABASE_URL`.
2. Choose local storage: set `MJMS_STORAGE=local` and `STORAGE_DIR` on a persistent, backed-up volume.
3. Run `npm run db:migrate && npm run build && npm start`.
4. Schedule `curl -H "Authorization: Bearer $CRON_SECRET" https://host/api/cron/daily` daily and `/api/cron/outbox` every few minutes.
