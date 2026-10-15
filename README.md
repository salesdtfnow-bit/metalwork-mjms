# MJMS — Manufacturing Job Management System

MJMS is a web application for a CNC machining and metalwork workshop. It covers the whole chain:

**enquiry → quotation → customer PO → job → material purchasing and BoxHero stock → CNC programs → routed operations on machines → operator records → inspection → non-conformance → final quality release → dispatch → traceability**

It combines job management with MES-style shop-floor execution, production planning, document and program revision control, quality management, and end-to-end traceability. It is built to support an ISO 9001-aligned quality system. See [`docs/ISO9001_EVIDENCE_MAP.md`](docs/ISO9001_EVIDENCE_MAP.md), and note that the software alone does not make an organisation compliant.

> Status: functional system with automated acceptance tests for the ten required scenarios. See [`docs/FEATURE_STATUS.md`](docs/FEATURE_STATUS.md) for exactly what is implemented, what is partial, and what depends on external services.

## Quick start (local, no database install needed)

```bash
npm install
npm run db:reset:local      # creates ./.data/pglite (embedded PostgreSQL 17) and applies migrations
npm run db:seed:demo        # optional: fictitious demo workshop + accounts
npm run dev                 # http://localhost:3000
```

- **Demo accounts.** After seeding, each of these accounts uses the password in `DEMO_PASSWORD` (default `Workshop-Demo-2026!`, demo only):

  | Account | Role |
  |---|---|
  | `admin@demo.test` | Administrator |
  | `manager@demo.test` | Management |
  | `sales@demo.test` | Sales |
  | `purchasing@demo.test` | Purchasing |
  | `planner@demo.test` | Production manager |
  | `programmer@demo.test` | CNC programmer |
  | `operator1@demo.test`, `operator2@demo.test`, `operator3@demo.test` | Operator |
  | `inspector@demo.test` | Quality inspector |
  | `quality@demo.test` | Quality manager |
  | `dispatch@demo.test` | Dispatch |
  | `auditor@demo.test` | Read-only auditor |

- **Real use.** Create an administrator with:
  ```bash
  ADMIN_EMAIL=you@company.co.uk ADMIN_PASSWORD='a long passphrase' npm run admin:create
  ```
- **One process at a time.** PGlite is single-process. Stop `npm run dev` before running seed or migration scripts locally.

## Tests

```bash
npm test          # unit + integration + acceptance scenarios A–J (in-memory PostgreSQL, real migrations)
npm run typecheck
```

## Architecture (summary)

| Layer | Technology |
|---|---|
| UI | Next.js 16 App Router, React 19, Tailwind CSS 4. Server-rendered per request; Cache Components are deliberately off. |
| Business logic | `src/server/services/*`. Every write validates input (zod), checks permissions, runs in a transaction and appends to the audit trail. |
| Database | PostgreSQL with Drizzle ORM and versioned SQL migrations in `drizzle/`. Production uses Neon; local development and tests use PGlite. |
| Auth | Scrypt password hashes, DB-backed sessions with hashed tokens, idle and absolute expiry, lockout, single-use reset tokens, password re-entry for signatures. |
| Files | Private storage (local disk or private Vercel Blob), SHA-256 checksums, authorised and logged downloads. |
| Integrations | BoxHero REST adapter (simulated, api or manual mode) behind an outbox with reconcile-before-retry. Resend email (outbound and inbound) behind a provider interface. |
| Background work | Email and stock outboxes processed after each action and by authenticated Vercel Cron routes. |
| Audit | Append-only `audit_events` (database trigger) with a SHA-256 hash chain, verifiable from the admin screen. |

The full design is in [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Architecture, assumptions, risks, phases |
| [docs/CHECKLIST.md](docs/CHECKLIST.md) | Development checklist |
| [docs/FEATURE_STATUS.md](docs/FEATURE_STATUS.md) | Implemented / partial / externally dependent features |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Installation, environment, Vercel and Neon deployment |
| [docs/BACKUP_AND_RESTORE.md](docs/BACKUP_AND_RESTORE.md) | Backup, restore, disaster recovery |
| [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) | Users, roles, configuration, integrations, retention |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Guides for operators, planners, programmers, inspectors and others |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | BoxHero and email integration details |
| [docs/KPI_DEFINITIONS.md](docs/KPI_DEFINITIONS.md) | Exact KPI formulas |
| [docs/SECURITY.md](docs/SECURITY.md) | Security controls and review |
| [docs/ISO9001_EVIDENCE_MAP.md](docs/ISO9001_EVIDENCE_MAP.md) | ISO 9001 clause → feature/record mapping, organisational responsibilities |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Code conventions for contributors |

## Safety notes

- MJMS **never transmits programs to machine controllers** and does not control machinery. Machine status is shown as **manually reported** unless a future, separately validated telemetry integration supplies it.
- Never commit real customer drawings, credentials or production data. `.env*`, `/storage`, `/.data` and `/backups` are git-ignored.
