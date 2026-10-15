# Administration Guide

Administration is under **Administration** in the sidebar. Each tab requires its own permission (`admin.users`, `admin.roles`, `admin.settings`, `admin.config`, `audit.view`, `integrations.view`).

## 1. First-time setup checklist
1. **Company settings.**
   - Name, address, VAT and company number (these appear on PDFs).
   - Timezone, currency, default VAT rate, quotation validity and default terms.
   - Retention years.
   - Segregation options. Keep **"Require independent approval" ON** and **"Allow self-inspection" OFF** unless your QMS justifies otherwise.
2. **Work calendars.** Define shifts (e.g. Mon–Fri 07:00–15:30) and holidays. Assign a calendar to every machine. Utilisation and scheduling depend on it.
3. **Machine types** (with custom fields), then **machines** (Machines → Register machine). Tick the operation types each machine can perform; scheduling and gates check this.
4. **Operation types.** Review the defaults (saw, mill, turn, …). Set whether each type needs a machine and whether it requires a CNC program or a first-off by default.
5. **Competency catalogue.** One competency per process or machine family that needs authorisation, with an expiry period where applicable.
6. **Employees** (Operators). Record each employee, grant **verified** competencies (the verifier cannot verify themselves), and add training records.
7. **Users.** Create an account per person and link operators to their employee record. *Shop-floor actions are refused for an operator whose account has no linked employee.*
8. **Suppliers.** Set the approved status, scope and expiry. Purchase and subcontract orders can only be raised to approved or conditional suppliers in the right category.
9. **Customers**, with delivery addresses and customer-specific requirements. Mandatory requirements are added to every final-release checklist for that customer.
10. **Measuring instruments**, with calibration records. Overdue instruments cannot be used to record results.
11. **Release checklist templates.** The standard items checked at every final release.
12. **Integrations.** BoxHero and email (see `INTEGRATIONS.md`).

## 2. Users and roles
- **Create user.** Give a temporary password; the user must change it at first sign-in.
- **Deactivate** (reason required). This revokes all sessions immediately. Historical records keep the user's name, and accounts are never deleted.
- **Reset password** forces a change at next sign-in.
- **Roles.** Eleven system roles are seeded. Edit their permissions in the matrix, or create custom roles. The *System administrator* role always holds every permission. Changing a role signs out everyone who holds it, so new permissions take effect immediately.
- **Principle of least privilege.** Give operators only *Machine operator*. Give auditors *Read-only auditor*. Commercial data (prices, payment terms) needs `customers.view_commercial` / `jobs.view_commercial`.

## 3. Status transitions and gates
- *Configuration → Job status transitions* lists which manual status changes are allowed and which permission each needs. You can disable or add transitions, or require a reason.
- **Some things cannot be configured away**:
  - Production-phase statuses (in setup, in production, awaiting first-off, …) are derived automatically from shop-floor records.
  - These **gates are enforced in code**: route released, material released and issued, CNC program current and released, drawing released, operator qualified, machine available and not under maintenance lock-out, no holds, first-off approved, final release before dispatch.
- **Gate exceptions** (*Jobs → Route → Record gate exception*) let a user with `production.override_gate` bypass the dependency, material, operator, first-off or drawing gate for one operation. This needs a justification and their password, and is fully audited. Program, machine and hold gates cannot be bypassed.

## 4. Audit trail
- **Append-only.** *Administration → Audit trail* shows every business event: who, when, what, before/after values, reason, and linked approval or exception. Denied attempts and security events (failed sign-ins, lockouts, password resets) are included.
- **Verify hash chain.** This recomputes the SHA-256 chain. A failure means records were altered outside the application. Investigate it as a security incident.
- **API access.** `GET /api/v1/audit` is available to holders of `audit.view`.

## 5. Integrations
- **BoxHero.**
  - Mode is *simulated*, *api* or *manual*. The API token is set only in the environment (`BOXHERO_API_TOKEN`).
  - Monitor *Materials → BoxHero* for failed or uncertain movements. Use *Retry* (it reconciles before re-sending), *Confirm manually* (enter the BoxHero reference) or *Cancel* (only if the source record was reversed).
- **Email.** Without Resend configured, emails are logged and not sent. The email outbox shows attempts and errors.
- **Cron.** Daily tasks expire quotations, raise preventive maintenance, send overdue, at-risk and calibration alerts, and retry the outboxes.

## 6. Data import
*Administration → Data import* accepts CSV files for customers, suppliers and material specifications. Each row is validated with the same rules as the forms, and the result report lists created, duplicate and error rows. Import is additive and never overwrites.

## 7. Retention and archiving
Retention periods per record type are kept under *Configuration → Retention*. Defaults are 10 years for production and quality records; align them with your customer contracts, since aerospace and medical customers often require longer. The application never deletes quality or traceability records. Deleting anything after expiry is a deliberate, documented database operation and is not available in the UI.

## 8. Backups
See `BACKUP_AND_RESTORE.md`. At minimum:
- keep Neon point-in-time recovery enabled;
- take a weekly `npm run backup` and/or `pg_dump`, stored off-site and encrypted;
- **test a restore every quarter** using the documented procedure.
