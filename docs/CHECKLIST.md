# Development Checklist

_Updated 2026-10-15. `[~]` items are implemented but have a stated limitation or external dependency (see FEATURE_STATUS.md):_
- _Global search / scanning: camera scan needs a BarcodeDetector-capable browser._
- _Security: per-account lockout only (add edge IP rate limiting); no MFA yet._
- _Drag-and-drop board: verified via service tests and page render, limited manual browser testing._
- _CSV import: customers, suppliers, material specs (no machines import)._
- _Email: Resend inbound and BoxHero API mode not exercised against live accounts (none available)._

Legend: `[x]` done and verified (tests or a manual check recorded) · `[~]` partial (see notes) · `[ ]` not started.
Verification evidence for each phase is in the git history and `tests/`.

## Phase 1 — Foundation
- [x] Project setup (Next 16, TS, Tailwind 4, Drizzle, PGlite/pg, Vitest)
- [x] Database schema and first versioned migration
- [x] Append-only audit trigger and hash chain
- [x] Reference-number counters
- [x] Authentication: login, logout, session expiry, lockout, password reset, deactivation
- [x] RBAC: permission catalogue, system roles, custom roles, permission-filtered navigation
- [x] App shell and navigation, demo banner
- [x] Customers and suppliers (contacts, addresses, requirements, supplier approval)
- [x] File storage (local and private Blob), authorised download, access log
- [x] Controlled documents and revisions (draft → review → approve → release → supersede)
- [~] Global search foundation
- [x] Admin: users, roles, company settings, operation types, status transitions

## Phase 2 — Enquiries, quotations, orders
- [x] Enquiry intake, lines, attachments, status history
- [~] Email import (.eml upload, Resend inbound webhook) and link to enquiry
- [x] Quotation costing engine (decimal-safe) and unit tests
- [x] Quotation revisions (immutable once sent), statuses, review and approval
- [x] Quotation PDF
- [x] Customer acceptance recording and verification (evidence required)
- [x] Customer PO registration and verification
- [x] Convert accepted quote + PO into job (job lines, pinned drawing revisions)

## Phase 3 — Manufacturing and CNC
- [x] Job traveller (screen and PDF with QR)
- [x] Routing: operations, ordering, dependencies, parallel, split, repeat, copy route
- [x] Operation types (configurable)
- [x] Machines, types, custom fields, capabilities, calendars
- [x] Employees, competencies, training, expiry
- [x] CNC program library, revisions, approval/release, segregation of duties, access log
- [x] Revision-change impact flags (drawing and program)
- [x] Production gates and gate exceptions
- [x] Shop-floor operator dashboard and operation workflow (15 steps)
- [x] Machine dashboard and queues, manual status labelled as manual
- [x] Job status machine with configurable transitions

## Phase 4 — Materials and BoxHero
- [~] BoxHero adapter interface, HTTP client (rate-limit aware), simulated adapter
- [x] Item and location catalogue sync, local search, link items to material specs
- [x] Material specs, purchase requests, purchase orders
- [x] Receipts (partial), lots and heat numbers, certificates
- [x] Incoming inspection, quarantine, release (separate steps)
- [x] Allocation, issue, consumption, remnant, return (each a distinct event)
- [x] Stock outbox, idempotency, reconcile-before-retry, integration status page

## Phase 5 — Quality
- [x] Inspection plans and characteristics
- [x] Inspection recording with tolerance evaluation (missing ≠ pass)
- [x] Instrument calibration checks at recording time
- [x] First-off gate
- [x] Final inspection
- [x] NCR: containment, holds, disposition approval, rework ops, reinspection
- [x] Corrective actions (CAPA) with effectiveness verification
- [x] Final quality release checklist (system and template and customer items) with re-auth approval
- [x] Certificate of Conformity PDF

## Phase 6 — Scheduling and workshop operations
- [x] Planning dashboard (KPIs and lists)
- [~] Machine timeline with drag-and-drop and validation
- [x] Schedule change log with reasons
- [x] Operator workloads
- [x] Downtime recording and reasons
- [x] Tooling: assets, life tracking, availability check
- [x] Maintenance plans and work orders, machine lock-out
- [x] Calibration records and affected-results review
- [x] Subcontract orders, send, return, incoming inspection, acceptance

## Phase 7 — Dispatch, reporting, deployment
- [x] Dispatch with controls (no quarantined/rejected/unreleased qty), partial dispatches
- [x] Delivery note and packing list PDFs, POD upload
- [x] Traceability: forward and backward, job report PDF
- [x] Role dashboards (management, production, quality, purchasing, operator, machine)
- [x] Reports with filters, CSV export, KPI definitions
- [x] Notifications (in-app, email via outbox), preferences
- [~] Data import tools (CSV customers/suppliers/machines/materials)
- [x] Backup and restore scripts, restore test (Scenario J)
- [~] Security review (headers, authz, uploads, rate limits)
- [x] Vercel deployment (Neon, Blob, cron), demo seed
- [x] Documentation set (README, admin guide, user guide, deployment, backup, ISO map, feature status)

## Acceptance scenarios (automated)
- [x] A Standard production job (enquiry → traceability)
- [x] B Material traceability (forward and backward by heat number)
- [x] C Multiple operators
- [x] D Drawing and CNC program revisions
- [x] E Non-conformance
- [x] F Production gating
- [x] G Dispatch controls
- [x] H Permissions via direct API
- [x] I BoxHero failure, duplicates, retries
- [x] J Backup and restore
