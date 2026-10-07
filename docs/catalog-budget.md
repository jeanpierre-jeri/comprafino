# Catalog operating budget

`pnpm catalog:budget` is a read-only developer CLI using root `DATABASE_URL`, current retailer/source configuration, workflow files and optional [recorded refresh evidence](catalog-refresh-measurement.json). It makes no retailer, GitHub or billing API calls and performs no writes.

## Current limits and reporting

Category scope/observation totals and request estimates derive from `refreshCoverage` in `packages/scrapers/src/refresh-adapters.ts`. Page maxima are retailer/category acquisition bounds, not source counts. The workflow cadence is read from the checked-in cron configuration. Targeted lookup uses `listingRefreshPolicy.limit`; discovery uses its independent query/run/day budgets and configured retailer identities. The retained catalog guard and complete-reader overflow sentinel come from `catalogPolicy` in core. UI result limits remain separate.

Fresh DB metrics include retained listings, normalized rows, history, candidate work, storage and selected targeted backlog. None of these volatile counts is hardcoded as the current catalog in this guide. The guard remains 2,000 retained listings; bounded acquisition can add new identities through rotation or demand. Ingestion updates known listings at capacity and admits new identities in source order up to the remaining slots under the shared admission lock. Excess identities are skipped without writes; category ingestion output and discovery summaries report `skippedByCapacity`. Capacity skips alone do not fail a run. No automatic deletion or cap increase occurs. Observe remaining capacity before further source work.

## Measurement provenance

The CLI validates external evidence and reports source-scope and catalog-size agreement explicitly. Missing provenance/date, a failed/unverified run or a mismatch produces `historical-non-comparable`, and current duration projections are null. Matching evidence is still a dated local measurement, with no promise of current workflow latency. Checkout/install/queue overhead and discovery duration remain unmeasured; billing is not inferred. A matching source count alone cannot establish comparability if individual scopes changed.

The earlier October 4 budget (16 sources) is [historical evidence](history/catalog-budget-audit.json), not a current source budget. The [October 5 coverage audit](history/catalog-coverage-audit.json) records expanded/repeated refresh attribution. All original budget tables, scenario assumptions and measurement caveats remain in [engineering history](history/engineering-notes-2026-10-05.md#original-docscatalog-budgetmd).

## Growth and decisions

Price history appends on accepted state change, not on every refresh. Daily observation coverage records accepted usable quotes separately on Peru calendar days; discovery admission uses a UTC daily budget. Do not equate these clocks or infer monthly transitions from bootstrap-heavy seven-day evidence.

Candidate scenarios use a quadratic estimate under unchanged brand/retailer composition; listing/normalization storage is approximately linear, while total database size includes fixed overhead and separate history/index growth. Projections beyond the guard are illustrations, not permission to expand. Stable price-change rates, workflow durations and current query timings must be measured before capacity or infrastructure decisions.

## Reviewed expansion to 2,000 listings

The October 6, 2026 Peru capacity review increases `catalogPolicy.retainedListingCap` from 1,000 to **2,000**, creating 1,000 potential admission slots at the measured baseline. The derived complete-reader sentinel becomes 2,001. Admission, normalization, matching, generic search and basket snapshots share that policy; source request budgets, UI result limits, freshness and identity safety remain separate. No schema migration or automatic deletion is needed. Deploy the updated readers and every category/discovery/targeted writer together before admitting rows above the old cap; an older reader/writer can still refuse the expanded scope or apply the old bound.

The read-only baseline contained 1,000 listings, 1,000 normalizations, 1,235 history states and 10,153 matching candidates. PostgreSQL reported 12,214,272 database bytes; listing/normalization relations together used 1,327,104 bytes including indexes. These are dated observations, not billing quotas or future totals. A same-composition quadratic estimate at 2,000 is about 40,612 candidates (4 times baseline); listing and normalization storage is approximately twice baseline under the same composition. The expansion follows the requested coverage increase while preserving a finite operational bound.

[Recorded capacity measurements](catalog-capacity-review.json) preserve the original current search and 1,500-listing measurements and add a separately dated 2,000-listing in-memory matching scenario evaluated with read-only PostgreSQL similarity queries. It is one local sequential sample including HTTP latency, not production p95; synthetic duplicated composition does not guarantee future candidate counts or future-size SQL/search/write latency. Isolated PostgreSQL regressions exercise full-cap normalization/matching, searchable demanded products beyond 1,000, concurrent last-slot admission, continued known-listing refresh and reader overflow at the configured sentinel. Monitor `pnpm catalog:budget` as rows grow and review further expansion before saturation; no stable monthly cost or workflow-duration guarantee follows from this test.
