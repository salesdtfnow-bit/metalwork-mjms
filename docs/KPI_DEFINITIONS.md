# KPI Definitions

All KPIs are computed in `src/server/services/reports.ts` and `src/server/services/machines.ts` for a selected period (default: last 30 days). Times are evaluated in the company timezone.

| KPI | Formula | Notes |
|---|---|---|
| **Open orders** | Count of jobs not `completed` or `cancelled` | |
| **Order value** | Σ (line qty × unit price) over open jobs | Visible only with `reports.management` |
| **WIP value** | Σ ((line qty − dispatched qty) × unit price) over open jobs | Commercial view only |
| **Quotation pipeline** | Σ total of quotation revisions that are `sent` / `awaiting_response` and still within validity | |
| **Jobs in progress** | Jobs in production-phase statuses (in setup, awaiting first-off, in production, partially completed, awaiting inspection, rework required, subcontracted, non-conformance) | |
| **Late jobs** | Open jobs whose required date is before today and that are not dispatched | |
| **At risk (7 days)** | Open jobs due within 7 days that are not ready for dispatch. The planning view also flags jobs whose planned finish is after the required date, or that have unscheduled machine work within 5 days of it | |
| **On-time delivery (OTD) %** | Consignments dispatched in the period with dispatch date ≤ job required date ÷ all consignments dispatched in the period | Per consignment, so partial deliveries each count |
| **Scrap rate %** | Σ scrapped ÷ Σ (good + rejected + scrapped) on operations with time recorded in the period | |
| **Reject rate %** | Σ rejected ÷ Σ (good + rejected + scrapped) | |
| **Rework rate %** | Σ good qty on rework operations ÷ Σ good qty on all operations in the period | |
| **First-pass yield %** | First-off, in-process and final inspections passed ÷ those inspections completed in the period | |
| **Throughput** | Σ good quantity in the period | |
| **Machine utilisation %** | Recorded setup + production (+ rework) time on the machine ÷ **available time** | Available time = the machine's working-calendar shift minutes in the period, up to now, minus planned-maintenance downtime. Hours outside shifts are **not** counted as available. With no calendar assigned, the default is Mon–Fri 07:00–15:30. |
| **Machine load % (planning)** | Planned minutes of scheduled operations in the window ÷ available calendar minutes in the window | Planned, not actual |
| **Operator workload** | Σ remaining estimated minutes (setup if not done + remaining qty × cycle) of open assigned operations | |
| **Overdue inspections** | Inspections open for more than 24 hours | |
| **Material awaiting release** | Lots `awaiting_inspection` or `quarantined` | |

Machine time is recorded **manually** by operators (start and stop). It is not machine telemetry.
