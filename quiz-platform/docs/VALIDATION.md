# Verification record — October 18, 2026, version 0.3.0

- `npm test`: 12 tests passed, including signed proxy bodies, stable completion retry IDs, encrypted contacts, finalized submissions, outbox behavior, historical import conflicts, exact-link deduplication, CSV unknown-consent handling, preserved anonymous repeated rows, no fabricated completion times, per-question elapsed time, interface behavior and DST boundaries.
- `npm run build`: passed without runtime secrets.
- Shopify Theme Check: the updated native quiz section passed. The other four unchanged theme files passed in the earlier validation.
- Full local PostgreSQL-compatible import: 23,293 source rows and 4,427 exact response links imported. Combined reporting reconciles to 18,856 rows, 13,308 completions and 6,897 welcome interactions/observed starts after known test exclusions. No Klaviyo outbox jobs were created.
- Offline dashboard: all-time total 13,308; September 2026 America/New_York combined total 258 and direct CSV total 252. Source filtering, completed/all-answer population selection, and empty native source work. The reference snapshot remains fixed while dates change.
- Proposed native routine and color resolution matches 4,441 supplied results; one other row is the legacy default result. No unexplained mismatch found.
- Historical report sources are kept separate from deployment source files. No real customer events, emails, subscriptions, or store changes were made.

Not yet verified: production Vercel/database deployment, Shopify app-proxy configuration, real Klaviyo delivery and email rendering, fallback/unobserved quiz rules, and real Shopify order attribution. Direct history before October 18, 2025 remains unavailable except for Klaviyo completions. The PDF's revenue/funnel values are a fixed vendor reference, not a dynamic historical order dataset.
