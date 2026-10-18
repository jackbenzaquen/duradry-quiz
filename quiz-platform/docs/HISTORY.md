# Historical data import

The supplied archive now contains both the recovered Klaviyo history and the user's October 18 Octane CSV, plus a structured transcription of the dashboard PDF. See `RECONCILIATION.md` for counts, matching, time assumptions and limitations.

## Import the prepared bundle

Set `DATABASE_URL` securely, then run from the project root:

```bash
node tools/migrate.mjs
node tools/import-history-bundle.mjs /PRIVATE/PATH/quiz-history
node tools/import-history-bundle.mjs /PRIVATE/PATH/quiz-history --apply
```

The second command is a dry-run. The final command imports original Klaviyo records, normalized Octane records, exact response matches and the fixed reference snapshot. It sends no events or subscriptions to Klaviyo. Running it again skips existing unchanged records. Changed source records with the same IDs require explicit review.

**Do not register a blanket Octane coverage window for this CSV.** Exact result links already remove the known overlap while preserving unmatched Klaviyo completions. A blanket date exclusion could hide valid records.

## Prepare another legacy response CSV

This is the format in the supplied file: a `Timestamp` column, question-title columns, `Shareable quiz results URL`, and `Results page`. It differs from the newer API export schema. To normalize it against the preserved Klaviyo raw pages:

```bash
node tools/prepare-legacy-csv.mjs /PRIVATE/PATH/responses.csv /PRIVATE/PATH/quiz-history UTC
```

Use a fresh working copy of the history directory when preparing another export. This command writes reviewed normalized rows and exact links there; it does not modify original CSV or raw API pages. The final argument explicitly declares the timestamp timezone. UTC is supported for the supplied file by the matched completion timestamps; verify the timezone for a differently formatted future export.

Rows with result links use those stable response IDs. Rows without them receive content fingerprints plus occurrence numbers, preserving repeated anonymous rows. `N/A` consent is null, not false and not subscribed. A calculation marker without a result is not counted as proof of completion. Completion presence is stored separately from exact completion time, so timing is not fabricated.

## What is still missing

The direct CSV begins October 18, 2025. Earlier completion records are preserved via Klaviyo, but earlier unfinished sessions are not available. The PDF is a fixed report, not a daily revenue or funnel dataset. It cannot support changing historical revenue or question drop-off date ranges. Export earlier responses and time-bucketed/order analytics if those are needed.

The included `export-octane.mjs` and general `import-history.mjs --mapping ...` tools remain available for the newer API response schema. The API exporter requires a securely configured Octane key and actual API quiz ID. It has not been run against this account. Keep profile exports and aggregate analytics separate from session rows; they are not extra completions.

## Preservation

Raw API pages and the original CSV remain in the private archive with checksums. Dedicated contact fields are excluded from normalized analytical rows, though free text can still contain personal information. The standalone dashboard replaces profile identifiers with random-salted hashes. Neither the history archive nor the standalone dashboard belongs in a public repository or web directory.

Exact links suppress duplicate Klaviyo events only in **Combined history**. Individual source selections retain their original records. The known ambiguous identity is excluded from the combined identified-people count. The snapshot's original values and denominator discrepancies are retained rather than “corrected” to fit a chosen formula.
