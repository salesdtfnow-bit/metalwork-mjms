# Integrations

## 1. BoxHero (stock system of record)

### What BoxHero offers
Checked against the official documentation at https://www.boxhero.io/docs on 2026-10-15.

| Capability | BoxHero | How MJMS uses it |
|---|---|---|
| REST API | Base `https://rest.boxhero-app.com/v1`, Bearer token per team, 5 req/s and 300 req/min per team, cursor pagination | `src/server/integrations/boxhero/api.ts`: throttle, timeout, `Retry-After` handling |
| Team mode | Items, locations and transactions require **Location mode** | `testConnection()` reports a team in the wrong mode |
| Items | `GET /items`, `GET /items/{id}`. **No text search.** | Paginated catalogue sync into `boxhero_items`; search runs locally |
| Locations | `GET /locations` | Cached in `boxhero_locations` |
| Transactions | `POST /transactions` (in, out, adjust, move), `memo` up to 2000 chars. **No idempotency key.** | Outbox with our marker `[MJMS:<key>]` in the memo |
| Webhooks | `txs/*` and `item/*` topics. **Not signed.** | `/api/webhooks/boxhero/<secret>`: secret path, payload re-fetched through the API |
| Excel import/export | Yes (UI) | Documented manual fallback |
| Plan | API plan requirement is not stated publicly. Business plan likely required; confirm with BoxHero | — |

### Modes (Admin → Company settings, or the `BOXHERO_MODE` environment variable)
- **simulated** (default). An in-database stand-in. The UI is clearly labelled "SIMULATED — no real stock changes". Used for the demo and the tests.
- **api.** Calls the real BoxHero API. Requires `BOXHERO_API_TOKEN`. If the token is missing, the adapter reports a visible failure; it never fails silently.
- **manual.** Every movement is queued as *pending*. A person performs it in BoxHero and records the transaction reference (*Materials → BoxHero → Confirm manually*).

### Guaranteeing no duplicate stock movements
1. **Same business event, same key.** The stock movement is written to `stock_sync_transactions` in the **same database transaction** as the business event (receipt, issue, return, adjustment). Its idempotency key is derived from the source record, e.g. `material_transaction:<uuid>:out`. A unique index makes double queuing impossible.
2. **Duplicate form submissions are ignored.** Every form carries a one-time submission key, and material events have a unique `idempotency_key`.
3. **No concurrent double send.** The processor claims a row with a conditional update before sending it.
4. **Reconcile before any retry.** After an uncertain outcome (timeout, network error, 5xx), the row becomes `needs_reconciliation`. Before any retry, the processor lists recent BoxHero transactions and looks for our marker in the memo. If it finds one, the row is confirmed **without re-sending**. Scenario I tests the "committed but timed out" case.
5. **Definite failures stop for a person.** A 4xx (other than 429) sets the row to `failed`. The UI then offers *Retry* (which still reconciles first), *Confirm manually* or *Cancel*, and each of these is audited.
6. **Failures are visible.** They appear on *Materials → BoxHero* and *Admin → Integrations*, and trigger a daily notification to users with `boxhero.reconcile`.

### Setup
1. In BoxHero, switch the team to Location mode. Then go to *Settings → Integrations* and create an API token.
2. Set `BOXHERO_API_TOKEN` in the Vercel environment (never in code). Set mode **api**.
3. Go to *Materials → BoxHero → Sync item catalogue now*. Link BoxHero items to material specifications.
4. Optional webhook:
   1. Set `BOXHERO_WEBHOOK_SECRET` to at least 24 random characters.
   2. Register `https://<app>/api/webhooks/boxhero/<secret>` in BoxHero for `item/*` and `txs/new`.

### Material stages (what is distinguished)
Ordered (PO line) → Received (lot with heat number) → Recorded in BoxHero (stock-in confirmed) → Inspected, certificate verified → **Released** (signed) → Allocated to job → Issued (BoxHero stock-out) → Consumed / Remnant (optional BoxHero stock-in to an offcut item) / Returned (BoxHero stock-in) / Scrapped.

### Replacing BoxHero
Implement `InventoryAdapter` (`src/server/integrations/boxhero/types.ts`) and return it from `getInventoryAdapter()`. Manufacturing code depends only on the interface.

## 2. Email

### Outbound (Resend)
- The `EmailProvider` interface is in `src/server/integrations/email/provider.ts`. Without `RESEND_API_KEY` + `EMAIL_FROM`, the **console** provider logs messages instead of sending them.
- Emails are queued in `email_outbox` (in the business transaction). They are sent right after the request, and retried with backoff by cron. Each send passes Resend's `idempotencyKey` (the outbox key), so retries cannot send twice.
- Used for password reset links, quotations emailed to customers (PDF attached), and opt-in notification emails.
- Setup:
  1. Verify a sending domain in Resend.
  2. Set `RESEND_API_KEY` and `EMAIL_FROM="Name <address@verified-domain>"`.

### Inbound (enquiries by email)
Two provider-independent paths. Both store emails as **unassigned**. An authorised user then links each email to an enquiry or creates an enquiry from it. MJMS never treats an email as an acceptance by itself.
1. **.eml upload** (*Enquiries → Email inbox → Import .eml*). Works without configuration, e.g. for emails saved from Outlook.
2. **Resend Inbound.**
   1. Point an MX record, or use the `@<id>.resend.app` address.
   2. Add a webhook for `email.received` to `https://<app>/api/webhooks/resend`.
   3. Set `RESEND_WEBHOOK_SECRET`.

   The Svix signature is verified, then the full message and attachments are fetched through the Resend API. Ingestion is idempotent per message id.

**Microsoft 365 / Graph** is not implemented, because it needs an Azure app registration and tenant consent. To add it, implement `ParsedEmail` production from Graph `messages` plus a subscription webhook, and call `ingestEmail()`. Until then, use `.eml` upload or forward a mailbox to the Resend inbound address.

## 3. Machine connectivity
Not implemented, by design. MJMS stores CNC programs as controlled documents only. Any future DNC or telemetry link needs a separate assessment covering machine safety, network security, controller compatibility and validation. Telemetry would write `source = 'telemetry'` status events. Today every status shown is labelled as manually reported.
