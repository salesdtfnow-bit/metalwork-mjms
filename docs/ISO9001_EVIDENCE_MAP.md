# ISO 9001:2015 Support and Evidence Map

> **Important.** MJMS is a tool that *supports* a quality management system. Using it does **not** make an organisation ISO 9001 compliant or certified. The organisation must:
> - define its QMS scope, processes, responsibilities and competence criteria;
> - configure MJMS to match (roles, approvals, checklists, retention);
> - operate it consistently, audit it internally, and review it at management level.
>
> Certification is granted only by an accredited certification body.

| ISO 9001 clause | What MJMS provides (records / controls) | Where | Organisation's remaining responsibility |
|---|---|---|---|
| 4.4 QMS and its processes | Defined, enforced workflow: enquiry → quote → order → job → material → production → inspection → release → dispatch, with explicit statuses and gates | Jobs, status transitions (Admin) | Document process interactions, owners and KPIs; define scope |
| 5.3 Roles, responsibilities, authorities | Role-based permissions, segregation of duties, named owners on jobs, NCRs and CAPA | Admin → Roles & permissions | Approve the role matrix; keep job descriptions aligned |
| 6.1 Risks and opportunities | Jobs-at-risk view, hold and gate mechanisms, NCR trends | Planning, Reports | Maintain a risk register and planning outside MJMS |
| 7.1.5 Monitoring and measuring resources | Instrument register, calibration records (certificates, due dates, as-found results), recording blocked for out-of-calibration instruments, flagging of affected results when found out of tolerance | Quality → Instruments | Define calibration intervals and methods; use accredited providers where required |
| 7.1.6 Organisational knowledge | Controlled work instructions, setup sheets and programs with revision history | Documents, CNC programs | Decide which knowledge is captured |
| 7.2 Competence | Competency catalogue, verified competencies with expiry, training records, assignment and production blocked without a valid competency (or an authorised exception) | Operators | Define competence criteria; evaluate training effectiveness |
| 7.5 Documented information | Controlled documents and revisions (draft → review → signed release → superseded), customer originals preserved, access logs, append-only audit trail, configurable retention, backup and restore | Documents, Admin → Audit, Backup | Define which documents are controlled and their retention; review documents periodically |
| 8.2 Requirements for products | Enquiry capture, quotation review (signed), customer-specific requirements, contract review of the PO against the accepted quotation (signed), acceptance verification | Enquiries, Quotations, Orders, Customers | Define review criteria; handle verbal orders per procedure |
| 8.3 Design and development | *Not in scope*: build-to-print workshop assumed | — | If design is in scope, use a separate design control process |
| 8.4 Externally provided processes, products, services | Approved supplier status with scope and expiry, POs only to approved suppliers, incoming inspection, certificate verification (heat number matched), subcontract orders with return inspection before acceptance, supplier NCRs | Suppliers, Purchasing, Materials, Subcontract | Supplier evaluation and re-evaluation criteria; supplier audits |
| 8.5.1 Control of production | Released routes, released programs and drawings only, first-off gate, recorded setup and production runs, operator pre-start confirmations, machine and maintenance lock-outs | Jobs → Route, Shop floor, Programs | Validate special processes (e.g. welding, heat treatment) |
| 8.5.2 Identification and traceability | Job, line, batch and optional piece-level traceability; lot + heat number + certificate + BoxHero reference; program revision and operator per run; forward (heat → jobs → customers) and backward (piece → materials and processes) trace with a PDF report | Traceability | Physical identification and marking of parts and material |
| 8.5.3 Customer property | Customer-supplied drawings stored as preserved originals | Enquiries, Documents | Procedures for customer-supplied material or tooling |
| 8.5.4 Preservation | Packaging requirements on job and customer, packing list | Jobs, Dispatch | Handling and storage procedures |
| 8.5.6 Control of changes | Revision changes flag affected open operations and jobs for supervisor review (never silently replaced), schedule changes with reasons, gate exceptions signed and audited | Documents, Programs, Planning | Change-control procedure including customer approval of ECNs |
| 8.6 Release of products | Final release checklist (system evidence checks + templates + customer requirements), signed by an independent approver, Certificate of Conformity, dispatch blocked without release | Quality → Releases, Dispatch | Define release criteria and authorised signatories |
| 8.7 Control of nonconforming outputs | NCRs with containment holds, signed dispositions (concession reference required for use-as-is or repair), rework operations, reinspection, controlled closure, quarantine of material | Non-conformances | Customer notification procedure; concession handling |
| 9.1 Monitoring, measurement, analysis | Inspection plans and results with tolerance evaluation (missing ≠ pass), KPIs (OTD, scrap, rework, FPY, utilisation), supplier performance | Quality, Reports | Analysis and management review inputs |
| 9.2 Internal audit | Read-only auditor role, complete audit trail with hash-chain verification | Admin → Audit | Internal audit programme |
| 9.3 Management review | KPI dashboards and reports with CSV export | Dashboard, Reports | Hold and minute management reviews |
| 10.2 Nonconformity and corrective action | CAPA linked to NCRs, root cause, action, effectiveness verification by someone other than the owner | NCR → Corrective actions | Determine the need for action; trend review |

## Electronic records and approvals
Approvals are authenticated (password re-entry), attributable (user and time), carry a stated meaning, and are stored append-only with an audit-trail link. Whether this satisfies a particular customer's or regulator's requirements for electronic signatures (e.g. aerospace or medical customer clauses, eIDAS, 21 CFR Part 11) requires a **separate assessment**. MJMS does not claim legal equivalence to handwritten or qualified electronic signatures.
