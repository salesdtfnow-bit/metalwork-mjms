# Backup, Restore and Disaster Recovery

## What must be protected
1. **The PostgreSQL database.** It holds every record, the append-only audit trail and the approvals.
2. **Stored files.** These are customer drawings, programs, certificates and issued PDFs, kept in private Vercel Blob (production) or `./storage` (local). The `files` table holds a SHA-256 for every file, so integrity can be verified after a restore.
3. **Configuration.** These are the environment variables, kept in Vercel. Record them in your password manager, never in git.

## Layers of protection (production)
| Layer | Mechanism | RPO / RTO (typical) |
|---|---|---|
| Point-in-time recovery | **Neon** keeps a restore window (plan-dependent, e.g. 7–30 days). You can branch or restore to any second in it from the Neon console. | RPO seconds; RTO minutes |
| Logical dump | `pg_dump` of `DATABASE_URL_UNPOOLED`, run daily from a trusted machine or CI and stored off-site, encrypted | RPO 24 h |
| Application backup | `npm run backup`: portable JSON of all business tables, with a manifest and a SHA-256 over the content. `npm run restore` restores it in foreign-key order and verifies row counts and the audit hash chain. | RPO 24 h |
| Files | Blob storage is durable; additionally copy blobs off-site (e.g. a weekly `vercel blob` export script or provider-level replication) | RPO 7 days for the off-site copy |

## Commands

### pg_dump / pg_restore (primary logical backup)
```bash
pg_dump --format=custom --no-owner --file=mjms-$(date +%F).dump "$DATABASE_URL_UNPOOLED"
# restore into a NEW empty database:
pg_restore --no-owner --dbname="$NEW_DATABASE_URL" mjms-YYYY-MM-DD.dump
```
`pg_restore` restores the triggers as well. Restore into an empty database; never restore over live data.

### Application backup (portable, verified)
```bash
DATABASE_URL_UNPOOLED=postgres://... npm run backup                 # → backups/mjms-<timestamp>.json (+ .sha256)
# restore: create an empty database, apply migrations, then:
DATABASE_URL_UNPOOLED=postgres://NEW... npm run db:migrate
DATABASE_URL_UNPOOLED=postgres://NEW... RESTORE_FILE=backups/mjms-....json npm run restore
```
The restore script:
- refuses a tampered file (checksum mismatch) and a non-empty target;
- loads tables in foreign-key order, deferring the columns that form reference cycles;
- resets sequences;
- verifies that every table's row count matches the manifest;
- recomputes the audit hash chain (`verifyRestore`).

Sessions, reset tokens and submission keys are deliberately excluded, so users sign in again after a restore.

## Tested procedure (Scenario J)
`tests/scenarios/scenario-j-backup.test.ts` runs a production flow, then backs up and restores into a fresh database. It then asserts that:
- the restored traceability record for the job is identical (quotation, lots and heat numbers, production runs, gaps);
- the audit hash chain verifies;
- the audit trail is still append-only;
- new audit events continue the chain;
- a tampered backup and a non-empty target are refused.

## Disaster recovery runbook
1. **Declare the incident.** Note the time of the last known good state and stop write traffic: set the Vercel deployment protection, or pause the project.
2. **Database.** In Neon, create a branch restored to the chosen point in time, or restore the latest dump or backup into a new database. Run `npm run db:migrate` against it if needed (idempotent).
3. **Verify.** Run `npm run restore`'s verification, or in the app open *Admin → Audit trail → Verify hash chain*, then spot-check recent jobs.
4. **Switch.** Update `DATABASE_URL` / `DATABASE_URL_UNPOOLED` in Vercel to the restored database and redeploy.
5. **Files.** Check that the blob store is reachable. For a sample of recent files, compare SHA-256 values (the `verifyFileIntegrity` helper).
6. **Reconcile external systems.** Open *Materials → BoxHero* and review queued or failed stock movements (the outbox reconciles before re-sending). Review the email outbox under *Admin → Integrations*.
7. **Record the incident** and any lost window. Re-enter the paper records captured during the outage (travellers are printed with QR codes for this purpose).

## Retention
Records are never deleted through the application. Retention periods are configured under *Admin → Configuration → Retention* and used for review and archival decisions. Any deletion after retention expires is a controlled, documented database operation performed outside the app, and must take customer contract requirements into account.
