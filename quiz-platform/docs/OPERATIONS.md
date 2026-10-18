# Operations

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
