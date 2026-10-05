# Durable ordinary-price observation coverage — Milestone 14

## Why a separate model

`price_history` records state changes (ordinary cents, reference cents, currency or sale unit). Reobserving an unchanged quote advances listing freshness but does not append another state. State intervals, ingestion-run success and today's `last_seen_at` cannot reconstruct which past days actually included a successful observation of a specific listing. Coverage therefore has its own minimal daily rollup, without fake daily prices or unchanged history rows.

Reviewed generated migration `0006_light_blink.sql` creates `listing_observation_days`:

| Column              | Meaning                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `listing_id`        | Existing listing FK, cascading only when that listing is deleted |
| `observation_date`  | Local calendar date in `America/Lima`                            |
| `first_observed_at` | First accepted usable observation that day, timestamptz          |
| `last_observed_at`  | Latest accepted usable observation that day, timestamptz         |
| `observation_count` | Count of accepted usable observations, positive integer          |

The composite primary key `(listing_id, observation_date)` both enforces uniqueness and serves listing/date-range reads. Timestamp checks require ordered endpoints on that exact local date. There is no surrogate UUID, daily price, availability snapshot or additional index. Actual intraday price changes remain in `price_history`.

## Day and success semantics

All coverage days use the IANA timezone `America/Lima`, including SQL bucketing, constraints, core logic, health reporting and public continuity. Calendar-key arithmetic is separate from instant arithmetic. No seasonal UTC-offset assumption is used for bucketing; timezone rules determine the day. History selectors retain their existing rolling 7/30/90 × 24-hour windows, rendered in Peru time. A partial boundary day can contribute only within that window.

Coverage means a validated listing reached shared persistence with **positive ordinary PEN cents**, supported sale unit and availability not explicitly false. Unknown Tottus delivery availability is allowed: this proves a usable ordinary quote, not stock at a shopper's address. Reliable targeted unavailability is already a distinct negative outcome; it does not advance price freshness or this price-focused rollup. No unavailable-stock coverage model is added.

Failed requests, invalid parsing, absent products, empty batches, malformed price data, zero placeholders and unavailable outcomes create no coverage. A valid observation committed before a later unrelated stage/run failure remains evidence: run status cannot erase a real successful listing observation. Rolled-back persistence creates no evidence.

Counts follow the repository's strictly newer accepted-observation contract. Equal timestamp replays and older observations cannot overwrite states, synchronize benefits or increment coverage. Concurrent distinct timestamps serialize under the retailer lock; if the newest is accepted first, older work is discarded. Counts measure accepted successful observations, not every HTTP request or fetched payload.

## Shared ingestion and idempotency

Category, discovery and targeted successful observations all use `persistenceStatements` / `persistListingsDetailed`. A data-modifying CTE consumes only the listing upsert's accepted `RETURNING` rows, then upserts the daily rollup inside the same transaction as offers and price-state transitions. Same-day newer observations increment the existing row and advance its latest timestamp; first time remains fixed. Next-day observations create another row. A failed final history insert rolls the coverage change back too.

No retailer-specific observation writer, additional schedule, dependency or job exists. Existing source limits and conservative request behavior remain. Deploy all ingestion writers/readers with this migration; older ingestion versions will not collect coverage even when refreshing listing freshness. Migration is applied explicitly, never at app startup.

No historical backfill is performed. The first recorded local date is the start of real prospective evidence; old successful jobs do not manufacture listing/day rows.

## Continuity and gaps

One accepted usable observation per local day suffices. Twice-daily scheduling does not require two observations/day, and discovery/targeted products use the same rule.

Consecutive covered dates form a verified period bounded by the first day's actual first observation and last day's actual latest observation. Missing calendar dates break periods. Missing/unsupported ordinary state intervals split chart paths too. A day with two observations can support an intraday segment; a single isolated instant remains a point. There is no extrapolation past latest verification, smoothing or connection across missing days. Daily continuity means observations on consecutive days; it does **not** prove the price never changed between requests.

Pre-coverage state starts stay disconnected event markers. State intervals remain available in the details and observed min/max metrics. Missing coverage is unknown evidence, not proof that the retailer failed or the product disappeared. Today's day remains open; a missing observation this morning is not a completed-day failure.

## Safe descriptive insights

Insights are retailer-specific and selected-range consistent. Last change compares adjacent, contiguous usable ordinary-price states, using the immediate predecessor even outside the range. It reports previous/new cents, absolute/signed difference, direction, actual observation timestamp and integer rounded percentage when the prior amount is positive. Absolute PEN change is primary. Reference-only changes, CMR changes and freshness updates never count.

A verified unchanged streak is anchored to an observation **today**, has at least two covered local dates and stops at the first missing day, unsupported state interval, different ordinary amount, price-change day or range boundary. The change day is excluded conservatively. The first-ever price-state day may count when its observations support that state; a reference-only state split does not stop the streak. Included dates can be partial calendar days; this is an observed-day count, not a guarantee of X full 24-hour periods at one price. Without today's evidence, no current streak is shown.

Min/max use actual usable ordinary states intersecting the selected rolling window, including a carry-in state. Open states contribute only through actual last verification. Change count counts adjacent ordinary amount changes whose newer state starts in range; repeated observations are never transitions. No CMR series, recommendation, savings claim, price score, prediction, alert or AI is added.

## Operations and budget

`pnpm audit:observation-coverage` is a read-only JSON developer audit using root `DATABASE_URL`. `/dev/ingestion` also shows total day rows, first coverage date, mean observations per covered listing/day, today's known/public coverage and retailer expected/observed/missing counts. Public here means the approximate exact-association priority signal, which can include stale/unavailable retained members; it is not current purchase eligibility. Unmatched generic offers remain in known counts. See [eligibility vocabulary](eligibility.md). The audit samples up to twenty missing closed days from the last seven days after each public listing's first durable evidence. It does not invent gaps before that start or assert past public eligibility. It reports table/index allocation and 30-day row projections.

Live allocated sizes and actual full-refresh rows are recorded in the validation report. Small initial table allocation and same-day updates include fixed page overhead/dead tuples; bytes-per-row projections are approximate, not quotas or billing claims. No premature partitioning, retention job or monitoring infrastructure is introduced.

## Limits and later work

The rollup retains first/latest/count, not every scrape timestamp or daily price. It cannot answer exactly which intermediate observation saw which quote beyond recorded state transitions. Historical queries ending inside an already completed rollup exclude rows whose latest timestamp is later than that end; the rollup cannot reconstruct an earlier intraday count. Normal public queries end now.
