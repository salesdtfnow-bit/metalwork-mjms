# Development Checklist

Legend: `[x]` done and verified (tests or a manual check recorded) · `[~]` partial (see notes) · `[ ]` not started.
Verification evidence for each phase is in the git history and `tests/`.

## Phase 1 — Foundation
- [ ] Project setup (Next 16, TS, Tailwind 4, Drizzle, PGlite/pg, Vitest)
- [ ] Database schema and first versioned migration
- [ ] Append-only audit trigger and hash chain
- [ ] Reference-number counters
- [ ] Authentication: login, logout, session expiry, lockout, password reset, deactivation
- [ ] RBAC: permission catalogue, system roles, custom roles, permission-filtered navigation
- [ ] App shell and navigation, demo banner
- [ ] Customers and suppliers (contacts, addresses, requirements, supplier approval)
- [ ] File storage (local and private Blob), authorised download, access log
- [ ] Controlled documents and revisions (draft → review → approve → release → supersede)
- [ ] Global search foundation
- [ ] Admin: users, roles, company settings, operation types, status transitions

## Phase 2 — Enquiries, quotations, orders
- [ ] Enquiry intake, lines, attachments, status history
- [ ] Email import (.eml upload, Resend inbound webhook) and link to enquiry
- [ ] Quotation costing engine (decimal-safe) and unit tests
- [ ] Quotation revisions (immutable once sent), statuses, review and approval
- [ ] Quotation PDF
- [ ] Customer acceptance recording and verification (evidence required)
- [ ] Customer PO registration and verification
- [ ] Convert accepted quote + PO into job (job lines, pinned drawing revisions)

## Phase 3 — Manufacturing and CNC
- [ ] Job traveller (screen and PDF with QR)
- [ ] Routing: operations, ordering, dependencies, parallel, split, repeat, copy route
- [ ] Operation types (configurable)
- [ ] Machines, types, custom fields, capabilities, calendars
- [ ] Employees, competencies, training, expiry
- [ ] CNC program library, revisions, approval/release, segregation of duties, access log
- [ ] Revision-change impact flags (drawing and program)
- [ ] Production gates and gate exceptions
- [ ] Shop-floor operator dashboard and operation workflow (15 steps)
- [ ] Machine dashboard and queues, manual status labelled as manual
- [ ] Job status machine with configurable transitions

## Phase 4 — Materials and BoxHero
- [ ] BoxHero adapter interface, HTTP client (rate-limit aware), simulated adapter
- [ ] Item and location catalogue sync, local search, link items to material specs
- [ ] Material specs, purchase requests, purchase orders
- [ ] Receipts (partial), lots and heat numbers, certificates
- [ ] Incoming inspection, quarantine, release (separate steps)
- [ ] Allocation, issue, consumption, remnant, return (each a distinct event)
- [ ] Stock outbox, idempotency, reconcile-before-retry, integration status page

## Phase 5 — Quality
- [ ] Inspection plans and characteristics
- [ ] Inspection recording with tolerance evaluation (missing ≠ pass)
- [ ] Instrument calibration checks at recording time
- [ ] First-off gate
- [ ] Final inspection
- [ ] NCR: containment, holds, disposition approval, rework ops, reinspection
- [ ] Corrective actions (CAPA) with effectiveness verification
- [ ] Final quality release checklist (system and template and customer items) with re-auth approval
- [ ] Certificate of Conformity PDF

## Phase 6 — Scheduling and workshop operations
- [ ] Planning dashboard (KPIs and lists)
- [ ] Machine timeline with drag-and-drop and validation
- [ ] Schedule change log with reasons
- [ ] Operator workloads
- [ ] Downtime recording and reasons
- [ ] Tooling: assets, life tracking, availability check
- [ ] Maintenance plans and work orders, machine lock-out
- [ ] Calibration records and affected-results review
- [ ] Subcontract orders, send, return, incoming inspection, acceptance

## Phase 7 — Dispatch, reporting, deployment
- [ ] Dispatch with controls (no quarantined/rejected/unreleased qty), partial dispatches
- [ ] Delivery note and packing list PDFs, POD upload
- [ ] Traceability: forward and backward, job report PDF
- [ ] Role dashboards (management, production, quality, purchasing, operator, machine)
- [ ] Reports with filters, CSV export, KPI definitions
- [ ] Notifications (in-app, email via outbox), preferences
- [ ] Data import tools (CSV customers/suppliers/machines/materials)
- [ ] Backup and restore scripts, restore test (Scenario J)
- [ ] Security review (headers, authz, uploads, rate limits)
- [ ] Vercel deployment (Neon, Blob, cron), demo seed
- [ ] Documentation set (README, admin guide, user guide, deployment, backup, ISO map, feature status)

## Acceptance scenarios (automated)
- [ ] A Standard production job (enquiry → traceability)
- [ ] B Material traceability (forward and backward by heat number)
- [ ] C Multiple operators
- [ ] D Drawing and CNC program revisions
- [ ] E Non-conformance
- [ ] F Production gating
- [ ] G Dispatch controls
- [ ] H Permissions via direct API
- [ ] I BoxHero failure, duplicates, retries
- [ ] J Backup and restore
