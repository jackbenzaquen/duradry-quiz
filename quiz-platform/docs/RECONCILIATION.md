# Octane export reconciliation — October 18, 2026

## Preserved sources

| Source | Coverage | Records |
|---|---|---:|
| Klaviyo completion event export | August 15, 2024–October 17, 2026 | 13,303 events |
| User-supplied Octane response CSV | October 18, 2025–October 18, 2026, timestamps without zone markers | 9,990 rows |
| User-supplied Octane dashboard PDF | Fixed “Last 30 days” view; chart labels September 18–October 18, 2026, plus separate all-time cards | 5 pages |

The CSV includes 4,442 rows with results and 6,907 with welcome interactions. It is a roughly one-year export, not all-time history. It has no per-question view/timing data, order IDs, order values, or refund records. `N/A` marketing consent remains unknown.

## Exact overlap and final totals

4,426 CSV rows have an exact shareable-result URL match to 4,427 Klaviyo events. One result URL appears under two Klaviyo profile IDs at the same timestamp. The combined view counts that CSV response once and leaves its person identity unknown. Both original events remain preserved.

10 clearly identified test rows are excluded from reporting: six `.invalid` addresses, two `@example.com` addresses, and two localhost result URLs. Twenty-three extra identical rows are retained because anonymous rows have no stable vendor session identifier; identical content alone cannot establish that two visits are duplicates.

**Combined all-available view, including the partial final day: 18,856 recorded rows, 13,308 completions, and 6,897 welcome interactions/observed starts.** The observed 64.3% completion rate applies only to rows with start evidence. It does not divide all 13,308 completions by 6,897 starts, and it is not Octane's unique-person completion rate.

Dates use CSV recorded-session time, native first-event time, or Klaviyo completion time for unmatched old records. CSV timestamps are treated as UTC based on 4,426 exact matches: corresponding Klaviyo completion events occur a minimum of 22 seconds and median of 59 seconds later. This is an evidence-supported timezone inference, not a timezone declared in the CSV. Exact start timestamps and completion duration are not invented.

In America/New_York, September 2026 shows 258 combined completions and 252 CSV result rows. Klaviyo-only September remains 257. These differ because combined history changes matched records to their earlier CSV session cohort and retains unmatched completions. Select a source to inspect its original counting basis.

## Verified answer labels

The CSV supplies visible question choices for matched responses. The same internal Klaviyo value can mean different things on different questions:

| Question | Legacy Klaviyo value | Visible CSV choice |
|---|---|---|
| Sweat | Underarms | Underarms |
| Sweat | Chest & Abs | Body |
| Sweat | Back | Privates |
| Sweat | Groin | Hands/Feet |
| Odor | Underarms | Underarms |
| Odor | Chest & Abs | Body |
| Odor | Groin | Privates |
| Odor | Feet | Feet |

Matched responses use CSV labels. Older unmatched data remains marked as legacy instead of applying this version-specific mapping to every historical record. There are two result-label/redirect disagreements; the direct CSV result label is used for those combined records and the original event remains intact.

## Routing validation

The proposed routine **and gift-color routing** reproduces 4,441 of 4,442 recorded result rows. The remaining row says “Default results page.” No unexplained routine/color mismatch was found. This is strong historical support for the draft rules, not proof of every unobserved conditional branch or historical configuration.

## What the PDF adds

The PDF preserves a dated reference with 266 unique starts, 179 unique completions, 67.29% completion, 43 orders, and a rounded $2,211 revenue headline. Result revenues total $2,211.26. Its email step shows 241 views and 192 responses, a reported 20.3% drop-off. Its entry step shows 39.6% drop-off.

Several displayed rates use different denominators. Email conversion 59.86% matches 176 / 294 welcome responses, not 176 / 266 unique starts. Order conversion per completion reconciles to 43 / 179 = 24.02%. The displayed order conversion per start of 17.67% does not reconcile to 43 / 266 = 16.17%; keep it labeled as reported until the vendor definition is confirmed.

The snapshot is visibly separated from the dynamic report and never changes when its date filters change. Revenue is not redistributed across days, inferred from CSV rows, or combined with future order revenue. Its timezone, ISO currency, and attribution window are not supplied by the screenshot.
