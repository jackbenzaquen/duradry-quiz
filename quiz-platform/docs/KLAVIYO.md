# Klaviyo integration and launch migration

## New data contract

| Item | New value |
|---|---|
| Completion metric | `Duradry Quiz Completed` |
| Unique event ID | `duradry-quiz:<session UUID>` |
| Event properties | `quiz_id`, `quiz_version`, `session_id`, `source`, `result_key`, `result_url`, `email_marketing_consent`, `answer_gift`, `answer_brand`, `answer_dry`, `answer_age`, `answer_odor`, `answer_gender` |
| Latest profile properties | `dd_quiz_last_completed_at`, `dd_quiz_id`, `dd_quiz_version`, `dd_quiz_first_name`, `dd_quiz_result`, `dd_quiz_results_url`, and `dd_quiz_<question key>` |
| Contact matching | Email; profile response ID also links native reporting identities to Klaviyo history where available |

Array answers remain arrays. Text answers remain strings. The event contains the answer snapshot from that completion; the profile contains the newest completed answers. Use the event for result-specific messages, avoiding a later quiz overwriting the recommendation in an already queued email.

The code does not overwrite core first name or existing marketing consent as part of a profile update. A separate, explicit opt-in action is available only when enabled and a list is configured. A checkbox left unchecked is not an unsubscribe instruction. Subscription acceptance and double opt-in depend on the configured Klaviyo list.

## Existing live dependency observed

- Metric: `Octane: quiz completed` (`YgExU7`).
- Live flow: `OctaneAI Quiz retargeting | NEW July26` (`TXTJAP`).
- Five-minute delay followed by the live email “We Found Your Perfect Match.”
- Template `RysNtH` references `event.Octane_results_page` and person properties `Octane_results_page` / `Octane_first_name`.

The new metric does not trigger that old flow. Before launch, clone/rebuild the flow as a draft using `Duradry Quiz Completed`, preserve and review its purchase exclusions, replace result links with `{{ event.result_url|default:'' }}`, and use `{{ person.dd_quiz_first_name|default:'' }}` for the greeting. Update both HTML and text versions, including lookup-form references. Preview all six result destinations with representative arrays and empty optional fields. No flow has been modified or activated by this work.

A native result-page compatibility value is retained in browser session storage under `octaneQuizResults` only so existing Shopify result pages can continue reading the first name. It does not call Octane.

## Delivery and history

Completions commit to Postgres before the browser redirects. The worker retries delivery and checkpoints profile, event and optional subscription steps independently. Events use stable IDs, so retrying an accepted event does not intentionally create a second completion. A successful API acceptance does not prove the profile has received a marketing message.

Historical imports write to the reporting database only. They do not re-subscribe contacts, overwrite newer Klaviyo profile answers, or re-trigger historical email flows. `.invalid` and `@example.com` test contacts never enter the live outbox.

Source: [Klaviyo Events API](https://developers.klaviyo.com/en/reference/events_api_overview).
