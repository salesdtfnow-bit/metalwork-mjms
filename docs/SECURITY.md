# Security Controls and Review

Last reviewed: 2026-10-15. This reflects the code at this commit.

## Authentication and sessions
- **Passwords.** Hashed with scrypt (N=2¹⁵, r=8, p=1, 16-byte salt) and verified in constant time. Verification runs even for unknown emails, so timing does not reveal which accounts exist.
- **Password policy.** At least 10 characters, a common-password denylist, no use of the email's local part, and enough variety.
- **Lockout.** 5 failed sign-ins lock the account for 15 minutes. Failed, locked and successful sign-ins are audited.
- **Sessions.** A 256-bit random token is stored in an httpOnly, SameSite=Lax cookie (`__Host-`, Secure in production). The database holds only the **SHA-256** of the token. Sessions expire after 12 hours idle and 7 days absolute (both configurable). Logout, password changes, role changes and account deactivation revoke sessions.
- **Password reset.** Single-use, hashed, 1-hour tokens. The response is identical whether or not the account exists.
- **Signatures.** Critical approvals (release, first-off, NCR disposition, gate exceptions and others) require the user to re-enter their password. They are stored in the append-only `approvals` table with the signer, time, decision and stated meaning. These are authenticated approval records, **not** qualified electronic signatures.

## Authorisation
- **Permission catalogue.** Defined in code (`src/server/auth/permissions.ts`). Roles in the database hold catalogue keys only.
- **Server-side checks.** Every service checks permissions on the server. UI hiding is only a convenience. Scenario H tests direct API calls.
- **Denials are audited.** Recorded at the request boundary (`runService`) after any rollback.
- **Segregation of duties.** Enforced in code:
  - document and program approver ≠ author (configurable);
  - quotation reviewer ≠ preparer;
  - acceptance verifier ≠ recorder;
  - PO approver ≠ creator;
  - inspector and final releaser ≠ the person who worked on the parts (unless self-inspection is explicitly enabled);
  - CAPA verifier ≠ owner.
- **Commercial redaction.** Payment terms, credit limits and prices are redacted in service responses for roles without the commercial permissions.

## Data protection
- **Files** are stored outside the web root or in **private** Blob. They are served only by `/api/files/[id]` after `authorizeFileAccess`, which:
  - maps the file to every referencing record and requires the matching view permission;
  - lets operators open only the **current released** program and drawing revisions;
  - logs every view, download and denial in `file_access_log` (append-only).
- **Upload validation.** Executable and script extensions are blocked; there is a size limit; filenames are sanitised; MIME types are derived from the extension. Only PDF, images and plain text are served inline, under `Content-Security-Policy: sandbox` and `nosniff`. Everything else downloads as an attachment.
- **Integrity triggers.** Database triggers make `audit_events` and `approvals` append-only, prevent deleting or modifying file identity, and prevent replacing the file of non-draft document or program revisions.
- **Audit hash chain.** Each audit event stores `hash = sha256(prev_hash | canonical event)`. Verify it under *Admin → Audit trail*.

## Web security
- **Headers** (`next.config.ts`): CSP (`default-src 'self'`, `frame-ancestors 'none'`, no third-party scripts), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`, a restrictive `Permissions-Policy` (camera allowed for self, for scanning), and HSTS in production.
- **CSRF.** Server Actions have built-in origin checking, and JSON API mutations reject cross-site `Origin`. Cookies are SameSite=Lax.
- **Injection.** All SQL goes through Drizzle's parameterisation. The only raw SQL is fixed statements and the backup tool's internal table names, which come from `information_schema`, not user input.
- **XSS.** React escaping throughout. Inbound email HTML is **never** rendered; only the text body is shown.
- **Open redirects.** Post-login `next` targets and scanned QR codes must be same-origin relative paths (`//` and `/\` are rejected).
- **Duplicate submissions.** Every form carries a one-time key (`submission_keys`). Material events and stock movements have unique idempotency keys.
- **Exports.** CSV export neutralises spreadsheet formula injection.
- **Public customer page (`/q/<token>`).** This is the only page reachable without signing in.
  - **The link token is the credential.** It is 256 bits of randomness; only its SHA-256 is stored, and the plaintext exists only in the email and the sending confirmation.
  - **What it can reach.** One quotation revision, its issued PDF, and later its signed order acceptance. Unknown, malformed and expired links all get the same "not valid" page.
  - **When it stops working.** Responses stop at the end of the validity date. A newer revision, or **Replace customer link**, revokes the link immediately. Read-only viewing ends 90 days after expiry.
  - **No double responses.** A response claims the link atomically, so double-clicks or simultaneous responses cannot record two outcomes.
  - **What is recorded.** Downloads are written to the file access log with the IP address. The acceptance records the signatory's name, position, email, IP address, browser and the SHA-256 of the PDF they were shown.
  - **Leak protection.** The page sends `Referrer-Policy: no-referrer` and `noindex`.
  - **Legal standing.** Click-to-accept is an electronic acceptance, not a qualified electronic signature, and the confirmation PDF says so.

## Integrations
- **Secrets** come only from environment variables: BoxHero token, Resend key, webhook secrets, cron secret. `.env*` is git-ignored.
- **Resend webhooks** are Svix-verified.
- **BoxHero webhooks** are unsigned upstream, so they use a secret path, and the payload is re-fetched through the API before being trusted.
- **Cron routes** require `Authorization: Bearer $CRON_SECRET`, compared in constant time.

## Known limitations / recommendations before production
1. **Login throttling is per account.** Add IP-based rate limiting at the edge (Vercel Firewall rule on `/login` and `/api/*`).
2. **No MFA.** Recommended for administrators and the quality manager. Candidate approaches: WebAuthn passkeys, or a TOTP step on login.
3. **Dev-tooling advisories.** `npm audit` reports advisories in the ESLint toolchain (`braces` via `eslint-config-next`). These are dev-only and not shipped to production. Track upstream fixes.
4. **Malware scanning.** Uploaded files are not scanned for malware. Consider an AV scan step if customer files arrive from untrusted sources.
5. **Database credentials.** Restrict them to the deployment. A database superuser can disable triggers; the audit hash chain makes this *detectable*, not impossible.
6. **Penetration testing.** Commission an independent test before go-live.
