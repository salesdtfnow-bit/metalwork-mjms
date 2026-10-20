# Feature Status

Status as of 2026-10-15.

Key:
- ✅ **Implemented and verified.** Automated tests and/or a manual check in the running app.
- 🟡 **Implemented, partially verified.** The code is complete; its UI has been exercised less.
- 🔌 **Externally dependent.** Implemented, but needs an external account or configuration to work for real.
- ⬜ **Not implemented.** Shown honestly in the UI where relevant.

**Evidence.**
- **Automated tests.** `npm test` runs 38 tests, including acceptance scenarios A–J (`tests/scenarios/*`), against real PostgreSQL (PGlite) with the production migrations applied.
- **Page render check.** `npm run smoke:prepare && npm run smoke:crawl` loaded every page and record view, for **each of the 11 demo roles**, against the production build. Result: 1,408 page loads with 0 errors. Restricted pages were refused per role, e.g. 99 for the operator and 0 for the administrator.
- **Live deployment.** `metalwork-mjms.vercel.app`: the demo database was reset and the first administrator created by the go-live build (`tests/smoke/provisioning.test.ts` covers the same path); `/api/health` returns 200; no runtime errors.
- **Manual browser checks.** Login, the customer pages, the jobs list and route, the operator dashboard and workspace (stop production → NCR prompt → sign-off → next operation), the management dashboard, traceability, and the traveller and traceability PDFs.
- **🟡 items.** "Partially verified" means the code and pages exist and render, but their interactive flows have had less hands-on clicking than the core path.

## Foundation
| Feature | Status | Evidence / notes |
|---|---|---|
| Schema (≈100 tables), versioned migrations, FK constraints, indexes | ✅ | `drizzle/`, migration smoke test |
| Append-only audit trail (DB trigger) + SHA-256 hash chain + verification | ✅ | Migration test, Scenario J, Admin → Audit |
| Authentication (scrypt, DB sessions, idle/absolute expiry, lockout, reset, deactivation) | ✅ | `tests/foundation/auth-audit.test.ts` |
| RBAC: permission catalogue, 11 system roles, custom roles, navigation filtered by permission | ✅ | Auth tests, Scenario H |
| Denied attempts audited | ✅ | Auth tests, Scenario H |
| Duplicate-submission protection on every form | ✅ | `submission_keys`, action wrapper |
| Customers and suppliers (contacts, addresses, requirements, approval status) | ✅ | Commercial tests, UI checked in browser |
| Private file storage, checksums, authorised and logged downloads | ✅ | Scenario D (operator denied superseded files) |
| Controlled documents (draft → review → signed release → supersede) | ✅ | Scenario D |
| Global search and barcode/QR resolution | 🟡 | Service implemented. Camera scanning needs a browser with `BarcodeDetector` (Chrome/Edge/Android) |

## Commercial
| Feature | Status | Notes |
|---|---|---|
| Enquiries, lines, attachments (customer originals preserved), history | ✅ | |
| Email import via `.eml` upload | ✅ | Commercial test with attachments + idempotency |
| Resend inbound webhook (Svix-verified, fetches full email) | 🔌 | Needs `RESEND_API_KEY` + `RESEND_WEBHOOK_SECRET` + inbound address |
| Microsoft 365 / Graph mailbox import | ⬜ | Documented adapter path in INTEGRATIONS.md |
| Quotation costing engine (decimal-safe) | ✅ | `tests/unit/costing.test.ts` |
| Quotation revisions, review (signed, independent), send (lock + PDF), follow-up, acceptance recorded then verified by a second person | ✅ | Commercial tests |
| Customer online acceptance via secure link (accept / ask for changes / decline), staff countersignature, signed order acceptance PDF | ✅ | `tests/scenarios/customer-acceptance.test.ts`; checked in browser (customer page, countersign, PDF). Needs the site reachable by customers (see DEPLOYMENT.md) |
| Quotation PDF | ✅ | PDF bytes verified in tests |
| Emailing quotations to customers | 🔌 | Queued in the outbox; sent when Resend is configured |
| Customer PO registration + signed contract review + conversion to job | ✅ | |

## Manufacturing
| Feature | Status | Notes |
|---|---|---|
| Routing: operations, dependencies (cycle-checked), parallel, split, repeat, reorder, copy route | ✅ | Service tests (A, C, E) |
| Machines, types with custom fields, capabilities, calendars, manual status (labelled manual) | ✅ | |
| Machine dashboard: queue, history, downtime, utilisation from calendar time | 🟡 | |
| Operators: competencies with expiry, verification (not self), training records | ✅ | Scenario A/C |
| Competency enforcement at assignment and at start | ✅ | Scenario A/F |
| CNC program library: revisions, verification, signed approval (≠ programmer) and release, supersede, impact flags, access log | ✅ | Scenario D |
| Production gates (route, dependencies, material, program, drawing, review, operator, machine, hold, first-off, pre-start checks) | ✅ | Scenario F |
| Gate exceptions (signed, limited to overridable gates) | ✅ | Service + UI |
| Operator workflow (all 15 steps) | ✅ | Scenarios A, C, E |
| Job status machine (configurable transitions + code gates + automatic production-phase status) | ✅ | Scenario A, H |
| Job traveller PDF with QR codes | 🟡 | |
| Direct machine connectivity / DNC / telemetry | ⬜ | Out of scope by design (safety) |

## Materials and BoxHero
| Feature | Status | Notes |
|---|---|---|
| Material specs, POs to approved suppliers, independent PO approval | ✅ | |
| Receipt (partial), lots with heat numbers, certificates (heat number matched), inspection, quarantine, **signed release** as a separate step | ✅ | Scenario A/B |
| Allocation, issue, consumption, remnant, return, scrap, adjustment (signed) | ✅ | |
| Stock outbox, idempotency, reconcile-before-retry, manual confirm, failure visibility | ✅ | Scenario I |
| BoxHero simulated mode | ✅ | |
| BoxHero real API mode | 🔌 | Implemented against the documented API. Not yet run against a live account (no token available). Needs a Business plan + Location mode |
| BoxHero webhooks | 🔌 | Secret-path endpoint; needs `BOXHERO_WEBHOOK_SECRET` |

## Quality
| Feature | Status | Notes |
|---|---|---|
| Inspection plans (versioned, signed approval) and characteristics | ✅ | |
| Results with server-side tolerance evaluation (missing ≠ pass), instrument calibration check | ✅ | Scenario A/E |
| First-off gate (independent inspector, signed) | ✅ | Scenario A/F |
| Final inspection and accepted quantities | ✅ | |
| NCR: containment holds, signed disposition, concession for use-as-is/repair, rework ops, reinspection, closure | ✅ | Scenario E |
| CAPA with independent effectiveness verification | 🟡 | |
| Final release: system evidence checks + checklist (templates + customer), independent signed approval, CoC PDF | ✅ | Scenario A/G |
| Calibration records, out-of-tolerance result flagging | 🟡 | |

## Workshop, dispatch, reporting
| Feature | Status | Notes |
|---|---|---|
| Scheduling with validation (capability, overlaps, maintenance, dependencies, program compatibility) and change log | 🟡 | Service validated; drag-and-drop board in the UI |
| Planning dashboard, workloads, at-risk detection | 🟡 | |
| Tooling (life tracking, availability, BoxHero ownership flag) | 🟡 | |
| Maintenance plans, work orders, breakdowns, machine lock-out | 🟡 | Lock-out enforced by the machine gate |
| Subcontracting (approved subcontractors; return inspection required before acceptance) | 🟡 | |
| Dispatch controls (released, accepted, non-held qty only; partial deliveries), delivery note, packing list, POD | ✅ | Scenario G |
| Traceability forward/backward + PDF | ✅ | Scenario A/B/J |
| Dashboards (management, production, quality, purchasing, operator, machine) and KPIs with documented definitions | 🟡 | |
| Reports + CSV export (formula-injection safe) | 🟡 | |
| In-app notifications (deduplicated) + preferences | ✅ | |
| Email notifications | 🔌 | Opt-in per user; needs Resend |
| CSV data import (customers, suppliers, material specs) | 🟡 | |
| Backup and restore (verified, tamper-checked) | ✅ | Scenario J |
| Production deployment | ✅ | Live on Vercel + Neon for Simmonds Engineering Ltd. Demo data removed and first administrator created by the guarded go-live build (2026-10-15); `/api/health` 200. Behind Vercel Authentication. Blob uploads: confirm by uploading a file |

## Known limitations
1. Server uploads on Vercel are limited to about 4.5 MB per request. Very large CAD/STEP files need direct-to-Blob client uploads, which are not implemented. Locally the limit is 50 MB.
2. Scheduling is validated manual or drag-and-drop placement. There is no automatic optimisation (the architecture allows adding it).
3. No MFA yet (see SECURITY.md recommendations).
4. Multi-currency is stored per quotation and order, with no exchange-rate conversion in KPIs (values are summed as entered).
5. The Hobby-plan Vercel cron runs daily. Outboxes are processed after each action anyway; on Pro, add a 10-minute outbox cron.
