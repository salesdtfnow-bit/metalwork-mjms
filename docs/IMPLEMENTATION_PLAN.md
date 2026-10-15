# MJMS — Implementation Plan & Architecture

**Product:** Manufacturing Job Management System (MJMS) for a metalworking and CNC machining workshop. It combines job management with MES-style production execution, production planning, document control, quality management and traceability.

**Status of this document:** this is the living plan. Progress is tracked in [`CHECKLIST.md`](CHECKLIST.md). What is actually implemented and verified is recorded in [`FEATURE_STATUS.md`](FEATURE_STATUS.md).

---

## 1. Starting point (inspection, 2026-10-15)

| Item | Finding |
|---|---|
| Repository | None. The target Google Drive folder was empty. |
| Location | Code lives at `C:\Users\User\dev\metalwork-mjms`. Google Drive sync cannot cope with the size of `node_modules`. The repo is private on GitHub. |
| Tooling | Node 24, npm 11, git and the GitHub CLI (not authenticated) are installed. Docker is installed but not running. There is no local PostgreSQL. |
| Hosting | Vercel (via the Vercel MCP and CLI). The database is Neon Postgres from the Vercel Marketplace. Files go to private Vercel Blob. |
| Email | Resend. No verified domain yet, so the console/outbox provider is used until one is configured. |
| BoxHero | No API token yet. The adapter uses a **simulated** mode until one is configured (see §6). |

## 2. Architecture

```
Browser (desktop / shop-floor tablet)
   │  HTML + React Server Components, Server Actions, JSON route handlers
   ▼
Next.js 16 App Router (Node runtime, one deployable)
   ├─ src/app/(app)/…        UI per module (server components + small client islands)
   ├─ src/app/api/…          files, PDFs, REST v1, webhooks, cron
   ├─ src/server/services/…  ALL business rules (validation, permissions, gates, audit)
   ├─ src/server/integrations/{boxhero,email}   adapters behind interfaces
   ├─ src/server/storage/…   local FS (dev) | private Vercel Blob (prod)
   └─ src/server/pdf/…       pdf-lib documents (quote, traveller, delivery note, CoC, traceability)
   ▼
PostgreSQL (Neon in production; embedded PGlite for local dev and tests)
   └─ Drizzle ORM, versioned SQL migrations, append-only audit trigger
```

**Key decisions**

1. **Single modular monolith.** There are no microservices. Module boundaries are enforced as service files with explicit inputs. UI and API layers only call services. They never touch tables directly for writes.
2. **Business rules live on the server, in `src/server/services`.** Every mutating service function does the following, in order:
   1. Takes an `actor` (the authenticated user and their permissions).
   2. Validates input with zod.
   3. Checks permissions.
   4. Runs inside a DB transaction.
   5. Writes an audit event in the same transaction.

   UI validation is a convenience only.
3. **PostgreSQL + Drizzle ORM.**
   - Migrations are generated SQL files in `drizzle/` and committed.
   - Local development and the automated tests use **PGlite**, which is real Postgres 17 compiled to WASM. No Docker or local Postgres install is needed, and tests exercise real SQL constraints and triggers.
   - Production uses `pg` Pool with `attachDatabasePool` on Vercel Fluid compute, which is the current Vercel/Neon recommendation.
4. **Authentication** follows the session approach recommended by the Lucia project and the Copenhagen Book:
   - Passwords are hashed with scrypt (Node `crypto`).
   - Sessions are stored in the DB as random 256-bit tokens. Only the SHA-256 hash is stored.
   - The session cookie is httpOnly, Secure and SameSite=Lax.
   - Sessions have both an idle timeout and an absolute timeout.
   - Accounts lock out after repeated failed logins.
   - Password reset tokens are hashed, single-use and expire after 1 hour.
   - Deactivating an account revokes all its sessions.
   - We control the code fully, and no third-party auth service holds workshop data.
5. **RBAC.**
   - Permissions are a fixed catalogue in code (`src/server/auth/permissions.ts`).
   - Roles are DB rows. Admins can create roles and assign any catalogue permission.
   - 11 system roles are seeded.
   - Navigation is filtered by permission, and every service re-checks permissions.
6. **Cache Components are disabled.** Every screen shows live, per-user, safety-relevant data, so all routes render dynamically per request. This prevents stale manufacturing data from being served from a cache.
7. **Decimal-safe maths.**
   - All quantities and money are Postgres `numeric`. Drizzle returns them as strings.
   - Arithmetic uses `decimal.js`.
   - The money and quantity helpers live in `src/lib/decimal.ts`.
8. **Time.** Timestamps are stored as `timestamptz` (UTC). They are displayed in the company timezone (company settings, default `Europe/London`) through `src/lib/format.ts`.
9. **Identifiers.** Every table has a UUID primary key. Human-readable references come from a transactional counter table:
   - `ENQ-26-0001`, `QUO-26-0001`, `SO-26-0001`, `JOB-26-0001`
   - `PO-26-0001`, `GRN-26-0001`, `LOT-26-0001`
   - `INS-26-0001`, `NCR-26-0001`, `CA-26-0001`, `MWO-26-0001`, `SCO-26-0001`, `DN-26-0001`
10. **Files.**
    - Files are immutable. The `files` row stores a SHA-256 checksum.
    - Files are stored outside the web root (`./storage`) or in **private** Vercel Blob.
    - They are served only by `/api/files/[id]`, which checks permissions and logs the access.
11. **Reliable background work uses the outbox pattern.**
    - Outbound email (`email_outbox`) and BoxHero stock transactions (`stock_sync_transactions`) are written in the same transaction as the business event.
    - They are then sent immediately after the commit, and retried by an authenticated cron route (`/api/cron/*`, protected by `CRON_SECRET`).
    - Vercel cron is best-effort, so all processors are idempotent.
12. **Audit trail.**
    - The `audit_events` table is append-only. A database trigger rejects `UPDATE`/`DELETE`/`TRUNCATE`.
    - Each event carries a SHA-256 hash chain (`prev_hash` → `hash`), so tampering is detectable. `/admin/audit` verifies the chain.
13. **Statuses and transitions.**
    - Allowed transitions are stored in `status_transitions`, together with the permission each one requires. Admins can configure these.
    - **Gates are enforced in code** (material release, program release, operator competency, first-off, final release, dispatch). They apply whatever the configuration says.
    - A gate can only be passed by an *approved gate exception*. The exception needs a specific permission, a reason and password re-authentication, and it is audited.
14. **No machine control.** Program files are documents only. Nothing is transmitted to machine controllers. Machine status is labelled **"manual (reported)"** unless a future telemetry integration writes `source = 'telemetry'`.

## 3. Module map (code boundaries)

| Module | Service file(s) | Main tables |
|---|---|---|
| Auth & RBAC | `auth/*`, `services/users.ts` | users, sessions, roles, role_permissions, user_roles, password_reset_tokens |
| Audit & approvals | `audit.ts`, `services/approvals.ts` | audit_events, approvals, gate_exceptions |
| Customers & suppliers | `services/parties.ts` | customers, suppliers, contacts, addresses, customer_requirements |
| Documents | `services/documents.ts`, `storage/*` | files, file_access_log, controlled_documents, document_revisions |
| Enquiries | `services/enquiries.ts`, `integrations/email/*` | enquiries, enquiry_lines, enquiry_attachments, inbound_emails |
| Quotations | `services/quotations.ts`, `lib/costing.ts` | quotations, quotation_revisions, quotation_lines, quotation_line_operations |
| Orders & jobs | `services/orders.ts`, `services/jobs.ts` | customer_orders, jobs, job_lines, batches, serials |
| Routing & production | `services/routing.ts`, `services/production.ts`, `services/gates.ts` | operations, operation_dependencies, operation_assignments, operation_documents, operation_checks, time_entries, operation_events |
| Machines | `services/machines.ts` | machines, machine_types, machine_capabilities, machine_status_events, downtime_events, work_calendars |
| Operators | `services/employees.ts` | employees, competencies, employee_competencies, training_records |
| CNC programs | `services/programs.ts` | cnc_programs, cnc_program_revisions, cnc_program_machines |
| Materials & BoxHero | `services/materials.ts`, `services/purchasing.ts`, `integrations/boxhero/*` | material_specs, purchase_orders(+lines), material_receipts, material_lots, material_certificates, material_allocations, material_transactions, boxhero_items, stock_sync_transactions |
| Quality | `services/inspections.ts`, `services/ncr.ts`, `services/release.ts`, `services/calibration.ts` | inspection_plans, inspection_characteristics, inspections, inspection_results, measuring_instruments, calibration_records, ncrs, corrective_actions, holds, final_releases |
| Planning | `services/planning.ts` | operations (planned fields), schedule_changes |
| Tooling | `services/tooling.ts` | tools, tool_usage_events, operation_tools |
| Maintenance | `services/maintenance.ts` | maintenance_plans, maintenance_work_orders |
| Subcontracting | `services/subcontract.ts` | subcontract_orders |
| Dispatch | `services/dispatch.ts` | dispatches, dispatch_lines |
| Reporting | `services/reports.ts`, `services/traceability.ts`, `services/search.ts` | (read models) |
| Notifications | `services/notifications.ts` | notifications, notification_preferences, email_outbox |

## 4. Core workflow and gates

```
Enquiry ─► Quotation (rev 1..n, immutable once sent) ─► Acceptance recorded + verified
   ─► Customer PO registered + verified ─► Job (permanent JOB number) + job lines (pinned drawing rev)
   ─► Route: ordered operations (+dependencies, assignments, machines, program rev, docs, inspection plan)
   ─► Material: PR → PO → receipt (lot, heat no.) → BoxHero stock-in → incoming inspection + cert verify → RELEASE
        → allocate to job → issue to production (BoxHero stock-out) → consume / remnant / return
   ─► Production per operation: gates → setup → first-off (gate) → production runs → in-process inspection → sign-off
   ─► Final inspection → Final quality release (checklist, re-authenticated approval)
   ─► Dispatch (only released, accepted, non-held quantity) → delivery note / packing list / CoC → POD
   ─► Job complete (only when dispatched qty, open NCRs, and release state allow)
```

**Operation start gates** (`services/gates.ts`). Each gate is evaluated on the server every time someone tries to start setup or production:

| Gate | Rule |
|---|---|
| `dependencies` | All prerequisite operations are complete. An operation allowed to run in parallel has no dependency rows. |
| `material` | The job has at least one **released** lot allocated, and an issue recorded, whenever the operation requires material. |
| `program` | The pinned program revision is `released`, is the current released revision, and is compatible with the assigned machine. |
| `drawing` | The pinned drawing revision is `released` and not superseded, or it has been reviewed (`review_required = false`). |
| `operator` | The acting operator is assigned to the operation and holds an active, unexpired competency where one is required. |
| `machine` | The assigned machine is active, capable of the operation type, and not under an active maintenance lock-out. |
| `hold` | There is no active hold on the operation, its batch, its job, or any allocated lot. |
| `first_off` | (Production start only) If first-off is required, an approved first-off inspection exists for the current setup. |

## 5. Assumptions (sensible defaults; change in config)

1. The company is UK-based. The defaults are GBP, 20% VAT and the `Europe/London` timezone. All of these are configurable in company settings.
2. The quotation costing model is per line. It covers material + wastage, programming (one-off), setup per batch, cycle time × machine rate per operation, and then extra costs (labour, tooling, consumables, subcontract, finishing, inspection, certification, packaging, delivery, other). A margin % is applied on cost, and there is an optional manual price override with a reason.
3. One manufacturing route exists per job line (part). A job can hold multiple lines. A repeat order copies the route from a previous job line.
4. Operation numbering follows workshop convention (10, 20, 30…). A split operation gets a suffix (`20A`, `20B`).
5. Traceability is configurable per job line: `job` (default), `batch`, or `piece` (serial numbers).
6. A material lot is one received line with one heat number. One certificate can cover several lots.
7. BoxHero is the master for stock quantities and locations. MJMS records references and its own movement events for traceability. It never recalculates stock independently.
8. Tooling defaults to MJMS ownership. Tools can be marked as `boxhero`-owned so that consumables are not duplicated.
9. "Electronic approval" here means an authenticated, password re-verified, audited approval record with a stated meaning. It is **not** claimed to be a legally qualified electronic signature (e.g. eIDAS QES), which would need a separate assessment.
10. Scheduling is manual or assisted (validated drag-and-drop / form). It is not optimised. The calendar logic is in place, so an optimiser can be added later.
11. Barcode/QR support works with keyboard-wedge scanners, which most USB/Bluetooth scanners are. It also uses the camera `BarcodeDetector` API where the browser supports it. Travellers carry QR codes that encode job and operation URLs.

## 6. Integration design

### BoxHero (confirmed against official docs at boxhero.io/docs, 2026-10-15)
- **REST API.** Base `https://rest.boxhero-app.com/v1`, Bearer token, one team per token. The team **must be in Location mode**. Rate limit is 5 req/s and 300 req/min per team. Pagination is by cursor.
- **No idempotency keys, and no item text search.** Our design handles both:
  - Every stock-changing request is first written to `stock_sync_transactions` with a unique idempotency key (`MJMS:<kind>:<uuid>`), and that key is embedded in the BoxHero transaction `memo`.
  - If a send fails with an *unknown* outcome (timeout or 5xx), the record goes to `needs_reconciliation`. Before it is retried, the processor lists recent BoxHero transactions and looks for our key in `memo`. If it is found, the record is marked confirmed and nothing is sent again.
  - An adjust quantity is a *relative* change.
  - Item search runs against a locally cached catalogue (`boxhero_items`), refreshed by a paginated sync.
- **Webhooks** (`txs/*`, `item/*`) are **unsigned**. Our endpoint uses a secret path token, and it re-fetches the referenced resource through the API before trusting it.
- **Modes.**
  - `simulated`: the default when there is no token. An in-DB fake that is clearly labelled "SIMULATED" in the UI.
  - `api`: needs `BOXHERO_API_TOKEN`.
  - `manual`: staff confirm each movement in BoxHero by hand and type in the reference. CSV/Excel export is available as a fallback.
- **The adapter interface** is `src/server/integrations/boxhero/types.ts`. Any future inventory system implements the same interface.

### Email (Resend)
- `EmailProvider` interface with two implementations: `resend` and `console` (dev, writes to the outbox and the log).
- Sending is idempotent (Resend `idempotencyKey` = outbox id).
- **Inbound:**
  1. Resend `email.received` webhook (Svix-signed, verified with `RESEND_WEBHOOK_SECRET`).
  2. The full message and attachments are fetched via `emails.receiving.get` / `attachments.list`.
  3. The message is stored in `inbound_emails`.
  4. An authorised user links it to an enquiry, or creates one from it.
- `.eml` upload is offered as a provider-independent alternative, for example for emails dragged out of Outlook.
- Microsoft 365 (Graph) is documented as a future adapter.

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Scope is very large | Built in phases. Each phase is tested and committed. Anything unfinished is flagged as such in the UI and in FEATURE_STATUS.md. |
| BoxHero duplicate stock movements | Outbox + idempotency key in memo + reconcile before retry + unique constraints (tested in Scenario I). |
| Serverless body limit (4.5 MB) for CAD/STEP uploads | Large files go directly from the browser to private Blob (client upload with an authenticated token route). Local dev streams to disk. |
| Hosted demo seen as production | Demo banner, `DEMO_MODE=true`, seed data labelled "DEMO". The seed refuses to run against a database that has non-demo data. |
| Audit tampering by a DB superuser | Trigger + hash chain make tampering *detectable*. Organisational controls (DB credential custody, backups) are documented. |
| PGlite vs Neon differences | Same Postgres major version (17), same migrations. CI/tests run on PGlite. A smoke test runs against Neon at deploy. |
| ISO 9001 over-claiming | `ISO9001_EVIDENCE_MAP.md` maps clauses to features and lists the organisation's own responsibilities explicitly. |

## 8. Phases (see CHECKLIST.md for granular tasks)

1. **Foundation.** Schema, migrations, auth, RBAC, layout, customers/suppliers, documents/files, audit, search.
2. **Commercial.** Enquiries (+ email import), quotations (revisions, costing, PDF), customer POs, job creation.
3. **Manufacturing.** Traveller, routing, dependencies, machines, operators, competencies, CNC programs, shop-floor and machine dashboards, production recording, gates.
4. **Materials & BoxHero.** Adapter, PRs/POs, receipts, lots, certs, release, allocation and issue, outbox and reconciliation.
5. **Quality.** Inspection plans, first-off, results, final inspection, NCR, rework, CAPA, final release.
6. **Workshop ops.** Planning board, queues, workloads, downtime, tooling, maintenance, calibration, subcontracting.
7. **Dispatch, reporting and deploy.** Delivery notes, packing lists, CoC, traceability reports, dashboards, notifications, imports, backup/restore, security review, deployment.
