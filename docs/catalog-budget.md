# Catalog operating budget

`pnpm catalog:budget` is a read-only developer CLI using root `DATABASE_URL`, current retailer/source configuration, workflow files and optional [recorded refresh evidence](catalog-refresh-measurement.json). It makes no retailer, GitHub or billing API calls and performs no writes.

## Current limits and reporting

The CLI separates scheduled resumable acquisition from the legacy manual sample. Scheduled page bounds derive from [catalogPolicy](../packages/core/src/catalog-policy.ts), while registered sources/pending work come from the configured database. Legacy sample totals and request estimates derive from `refreshCoverage` in `packages/scrapers/src/refresh-adapters.ts`; they do not describe scheduled category coverage. Page maxima are work bounds, not source counts. The workflow cadence is read from the checked-in cron configuration. Targeted lookup uses `listingRefreshPolicy.limit`; discovery uses its independent query/run/day budgets and configured retailer identities. The retained catalog guard and complete-reader overflow sentinel come from `catalogPolicy` in core. UI result limits remain separate.

Fresh DB metrics include retained listings, normalized rows, history, candidate work, storage and selected targeted backlog. None of these volatile counts is hardcoded as the current catalog in this guide. The guard is now 50,000 retained listings; bounded acquisition can add new identities through rotation or demand. Ingestion updates known listings at capacity and admits new identities in source order up to the remaining slots under the shared admission lock. Excess identities are skipped without writes; category ingestion output and discovery summaries report `skippedByCapacity`. Scheduled acquisition/discovery treats capacity skips as errors; retained known identities can still refresh. The lower-level admission result records skips without turning them into rejected existing-identity updates. See [failure semantics](catalog-expansion.md#operational-warning-policy). No automatic deletion or cap increase occurs. Observe remaining capacity before further source work.

## Measurement provenance

The CLI validates external evidence and reports source-scope and catalog-size agreement explicitly. Missing provenance/date, a failed/unverified run or a mismatch produces `historical-non-comparable`, and current duration projections are null. Matching evidence is still a dated local measurement, with no promise of current workflow latency. Checkout/install/queue overhead and discovery duration remain unmeasured; billing is not inferred. A matching source count alone cannot establish comparability if individual scopes changed.

The earlier October 4 budget (16 sources) is [historical evidence](history/catalog-budget-audit.json), not a current source budget. The [October 5 coverage audit](history/catalog-coverage-audit.json) records expanded/repeated refresh attribution. All original budget tables, scenario assumptions and measurement caveats remain in [engineering history](history/engineering-notes-2026-10-05.md#original-docscatalog-budgetmd).

## Growth and decisions

Price history appends on accepted state change, not on every refresh. Daily observation coverage records accepted usable quotes separately on Peru calendar days; discovery admission uses a UTC daily budget. Do not equate these clocks or infer monthly transitions from bootstrap-heavy seven-day evidence.

Candidate scenarios use a quadratic estimate under unchanged brand/retailer composition; listing/normalization storage is approximately linear, while total database size includes fixed overhead and separate history/index growth. Projections beyond the guard are illustrations, not permission to expand. Stable price-change rates, workflow durations and current query timings must be measured before capacity or infrastructure decisions.

## Reviewed expansion to 2,000 listings

**Historical review, superseded by the current policy above.** On October 6, 2026 Peru, the capacity review increased `catalogPolicy.retainedListingCap` from 1,000 to **2,000**, with 1,000 potential admission slots at that measured baseline and a 2,001 sentinel. The following measurements describe that review, not today's capacity or permission for a new rollout. That review kept admission/readers on one bound and required coordinated rollout of readers and writers. It did not change source budgets, UI limits, freshness or identity safety, and required no schema migration or automatic deletion. Its rollout instructions are not authorization for current operational actions.

The read-only baseline contained 1,000 listings, 1,000 normalizations, 1,235 history states and 10,153 matching candidates. PostgreSQL reported 12,214,272 database bytes; listing/normalization relations together used 1,327,104 bytes including indexes. These are dated observations, not billing quotas or future totals. A same-composition quadratic estimate at 2,000 is about 40,612 candidates (4 times baseline); listing and normalization storage is approximately twice baseline under the same composition. That expansion preserved a finite operational bound; these estimates are not current acquired coverage.

[Recorded capacity measurements](catalog-capacity-review.json) preserve the original current search and 1,500-listing measurements and add a separately dated 2,000-listing in-memory matching scenario evaluated with read-only PostgreSQL similarity queries. It is one local sequential sample including HTTP latency, not production p95; synthetic duplicated composition does not guarantee future candidate counts or future-size SQL/search/write latency. The review's isolated PostgreSQL regressions exercised full-cap normalization/matching, searchable demanded products beyond 1,000, concurrent last-slot admission, continued known-listing refresh and reader overflow at its configured sentinel. Monitor `pnpm catalog:budget` as rows grow and review further expansion before saturation; no stable monthly cost or workflow-duration guarantee follows from this test.

## Current resumable budget

The resumable processor supersedes the fixed sample budget for scheduled acquisition. `catalog:budget` reports that legacy sample scope separately, plus the configured page budget and durable source summaries. Candidate counts are SQL dimension-block upper bounds rather than materialized catalog-wide pairs. Historical whole-catalog/quadratic timings are not current incremental throughput measurements. See [catalog expansion](catalog-expansion.md).
