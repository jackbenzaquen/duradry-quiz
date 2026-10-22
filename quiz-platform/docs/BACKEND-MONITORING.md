# Backend monitoring without dashboard login

The existing authenticated Vercel cron runs `/api/health` every five minutes.
After a completed, lock-owning cron check, the handler queries the database and
writes one `Quiz monitoring snapshot ` JSON record to private Vercel runtime logs.
The connected Vercel API reads this evidence using its existing team/project
authorization. No dashboard cookies, public health endpoint, or extra retrievable
API secret is needed. Existing route authentication remains required.

Project: `prj_Sk15vBdHfYQYRTTyY7xCtdKdt723`.
Team: `team_h9JSJwfYTme2VpQzOLKv3GWv`.

Use production runtime logs, a 30-minute lookback, and the exact search
`Quiz monitoring snapshot`. Parse the newest complete JSON object. Require
`schema_version: 1` and a `checked_at` within 15 minutes. A missing, truncated,
stale, or `unavailable` snapshot is a monitoring failure, never an all-clear.
Prefer current-production deployment records; reject future timestamps beyond
normal clock tolerance. Keep the deployment ID and timestamp as provenance.

The snapshot includes database-backed health statuses, source-check timestamps,
queue totals and age, last event/completion/receipt, native activity aggregates,
receipt/order import watermarks and completeness, and imported exact-session
orders grouped by currency. It excludes test-marked sessions and legacy sources
from activity/order totals. Unknown staff sessions may still need exclusion.
It deliberately omits contacts, answers, IDs, raw errors, secrets, and cursors.

Activity and sales use a rolling 24-hour half-open window ending at `checked_at`.
`completions_prior_7d` is the preceding seven days excluding that latest day;
respect `first_activity` before treating this as a mature baseline. Starts and
completions are separate time-window counts, not a cohort conversion rate.
Orders are database-imported records satisfying exact-session attribution,
completed/started session presence and the existing 30-day attribution limit.
They are not proof that every Shopify order has been imported, or a fresh
verification of current cancellation/refund status. Reconcile independently
against current Shopify orders and Klaviyo events. Do not sum currency amounts.
Repeated purchases count separate orders but one converting session per currency.

Continue direct storefront/configuration/asset/result-page checks, downstream
Klaviyo validation, and Shopify marker/order reconciliation. A successful page
fetch is not a synthetic customer submission or checkout. An empty order list
with incomplete/stale imports must not be described as verified zero sales.

If an aggregate query fails, the cron emits `Quiz monitoring snapshot unavailable`;
existing health checks and HTTP behavior remain intact. Investigate the failure
through authorized backend access. Do not weaken authentication or expose
database credentials to regain monitoring.
