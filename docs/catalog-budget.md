# Catalog operating budget

`pnpm catalog:budget` is a read-only developer CLI using root `DATABASE_URL`, current retailer/source configuration, workflow files and optional [recorded refresh evidence](catalog-refresh-measurement.json). It makes no retailer, GitHub or billing API calls and performs no writes.

## Current limits and reporting

Category scope/observation totals and request estimates derive from `refreshCoverage` in `packages/scrapers/src/refresh-adapters.ts`. Page maxima are retailer/category acquisition bounds, not source counts. The workflow cadence is read from the checked-in cron configuration. Targeted lookup uses `listingRefreshPolicy.limit`; discovery uses its independent query/run/day budgets and configured retailer identities. The retained catalog guard and complete-reader overflow sentinel come from `catalogPolicy` in core. UI result limits remain separate.

Fresh DB metrics include retained listings, normalized rows, history, candidate work, storage and selected targeted backlog. None of these volatile counts is hardcoded as the current catalog in this guide. The guard remains 1,000 retained listings; bounded acquisition can add new identities through rotation or demand. Observe remaining capacity before further source work.

## Measurement provenance

The CLI validates external evidence and reports source-scope and catalog-size agreement explicitly. Missing provenance/date, a failed/unverified run or a mismatch produces `historical-non-comparable`, and current duration projections are null. Matching evidence is still a dated local measurement, with no promise of current workflow latency. Checkout/install/queue overhead and discovery duration remain unmeasured; billing is not inferred. A matching source count alone cannot establish comparability if individual scopes changed.

The earlier October 4 budget (16 sources) is [historical evidence](history/catalog-budget-audit.json), not a current source budget. The [October 5 coverage audit](history/catalog-coverage-audit.json) records expanded/repeated refresh attribution. All original budget tables, scenario assumptions and measurement caveats remain in [engineering history](history/engineering-notes-2026-10-05.md#original-docscatalog-budgetmd).

## Growth and decisions

Price history appends on accepted state change, not on every refresh. Daily observation coverage records accepted usable quotes separately on Peru calendar days; discovery admission uses a UTC daily budget. Do not equate these clocks or infer monthly transitions from bootstrap-heavy seven-day evidence.

Candidate scenarios use a quadratic estimate under unchanged brand/retailer composition; listing/normalization storage is approximately linear, while total database size includes fixed overhead and separate history/index growth. Projections beyond the guard are illustrations, not permission to expand. Stable price-change rates, workflow durations and current query timings must be measured before capacity or infrastructure decisions.
