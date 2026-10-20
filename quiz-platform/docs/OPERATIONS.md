# Operations

## Automatic health checks and order attribution

`/api/health` runs every five minutes through Vercel Cron. The dashboard shows database/configuration checks, the one-minute sending worker heartbeat, pending/failed jobs, submissions missing a delivery job, confirmed Klaviyo receipts, order-import freshness and the live quiz page. GET is read-only; the dashboard's **Run checks now** button performs an authenticated same-origin POST. Checks do not create profiles, subscribe anyone, create orders or send emails.

The existing Klaviyo private key needs `metrics:read` and `events:read`, in addition to its sending permissions. Missing scopes show an error. The monitor reads **Duradry Quiz Completed** events back from Klaviyo and matches session, quiz, version, result and completion time. A `202 Accepted` from the write endpoint alone is not confirmed receipt. Confirmation is event receipt, not proof that a marketing email was delivered.

Order imports use only the **Placed Order** metric whose integration is **Shopify**. Its `$extra` order metadata contains `note_attributes` (cart attributes) and `line_items[].properties`. The importer requires one unambiguous `dd_quiz_session`, `_dd_quiz_session` or `dd_quiz_session__` value matching a non-test, completed native session with an observed start. Product identity or email similarity alone never establish attribution. The current theme already writes `dd_quiz_session` with analytics consent. No theme update is needed for these reporting changes.

The attribution window is 30 days from quiz start, with the order at or after submission. Repeat orders count separately in revenue but a session counts only once in conversion. Orders and imports are idempotent. Original paid order value includes discounts, shipping and tax, before refunds; this is not refund-adjusted net sales. Test, pending and known-cancelled order snapshots are rejected. Later refunds/cancellations are not reconciled into this original-value metric.

Each event stream saves pagination cursors and a completed-through watermark. A two-day overlap catches delayed delivery and retries safely. Events backdated more than two days after a completed scan require an explicit rescan (clear the relevant `quiz_sync_state` row, not the orders). When a batch exceeds the runtime/page budget it resumes on the next check and displays incomplete coverage. Do not present an incomplete or stale import as a verified zero. Historical Octane order attribution is not reconstructed.

Health conditions: sending heartbeat older than 5 minutes is an error; a queue older than 10 minutes or receipt missing after 15 minutes is a warning; failed jobs, orphan submissions, read-scope errors or check results older than 15 minutes require attention. No real activity for 24 hours raises a traffic-check warning, not a definitive outage. Statuses appear in the dashboard and Vercel logs. Email/Slack notifications are not configured.

Production builds run additive schema migrations, a health pass and a report query using the project's existing environment. Build logs contain aggregate health statuses and no contacts or credentials. Preview builds do not migrate shared production data. To roll back, restore the previous deployment; added tables/columns are backward-compatible.

## Chart definitions

- The funnel ends with **Quiz submitted** and **Order placed** and separates **Octane history · recorded responses** from **Native quiz · tracked views**. In Combined history, a selector appears when both sources are present; the initial view uses the source with more observed starts. The two measurement types are not added together.
- Octane history uses CSV welcome interactions as observed starts. A result page or exactly matched completion counts as **Quiz submitted**, even when an exact completion timestamp is unavailable. Question bars show recorded answers as a percentage of these starts. Blank optional answers do not prove abandonment, so historical per-step drop-off is unavailable. Recommended product IDs and titles do not establish a purchase: **Order placed** remains unavailable because the CSV has no order records.
- The fixed Octane reference snapshot shows vendor-reported starts, submissions and orders separately with its own reporting period. Date filters do not change these totals, and orders must not be presented as unique purchasers or assigned to individual CSV sessions. Completion-only Klaviyo records remain in completed totals but cannot establish a start-to-order denominator.
- The native view selects sessions that began in the chosen date range and excludes missing-start/test sessions. Purchase windows remain open for recent starts; conversion can increase after the selected end date. Per-question drop-off uses the viewers of that question as denominator. An answer, an optional skip, or a later submission counts as continuation. Back clicks/repeated events do not create extra visitors. Conditional questions can legitimately have lower reach.
- The revenue line uses **order creation date** in the selected timezone, even if the quiz started before the selected period. It displays currencies separately. Days before import coverage or after the last covered day are gaps, not fabricated zero revenue.
- `/api/report` schema version 4 adds `conversion_funnels` with source-specific views. `conversion_funnel` is the preferred view and includes `kind` (`native`, `octane_csv`, or completion-only `klaviyo_octane`). It preserves the existing `revenue`, `health`, and aggregate fields. No database migration is required for this correction.

## Routine checks

The report API includes outbox pending/failed/sent counts. A high pending count can indicate missing cron configuration or a key/scope issue. Jobs retry with exponential delays, then stop after ten failures.

After correcting the underlying issue, retry failed jobs explicitly:

```sql
UPDATE quiz_outbox
SET state='pending', attempts=0, available_at=now(), last_error=NULL
WHERE state='failed';
```

The existing profile/event checkpoints are retained. Inspect affected IDs and counts before running a broad retry. Do not delete successful checkpoints just to resend an email.

Request `/api/sync` with an `Authorization: Bearer <ADMIN_API_KEY>` header to run a manual worker pass. Cron uses the separate `CRON_SECRET`. The report API uses `REPORT_API_KEY`, which grants no write access. Never put keys in query strings.

Vercel logs intentionally avoid contact bodies and API error payloads. Database connection failures should be diagnosed through server configuration, not by exposing raw SQL errors to dashboard users. Keep automated database backups and verify restore access before replacing Octane.

## Contacts and deletion

Contacts are AES-256-GCM encrypted; analytical rows exclude the dedicated contact questions. Free text can still contain personal data. Restrict database and report access. A deletion request must remove related quiz events/outbox/orders/session rows and any relevant original archives, plus be handled independently in Klaviyo and Shopify. There is no self-service deletion route in this package. A deployment owner should document the retention policy and deletion procedure before launch.

## Limits and interpretation

- Report API rejects ranges exceeding 100,000 selected/comparison sessions instead of returning a silent partial result.
- Source totals and unknown-consent/missing-result counts should accompany every scheduled report.
- Percentage changes with a zero comparison baseline are unavailable, not infinite growth.
- Multi-select options use question respondents as denominator; shares can exceed 100% in total.
- The source currently supports a single shared dashboard password. The API key must stay in an authenticated connector's secret store if ChatGPT is connected later.
- The dashboard does not currently implement arbitrary multi-question cross-tabs, device/channel breakdowns, campaign attribution or refund-adjusted revenue. Prompts must state these gaps when those analyses are requested.
