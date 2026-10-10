# Catalog operations

## Refresh coverage and ownership

`pnpm acquire:catalog` is the scheduled resumable category processor. It discovers public grocery/household category paths, advances durable page cursors, refreshes eligible known listings, then runs incremental normalization/matching. The retained admission guard is 50,000 retailer listings. Work budgets apply per invocation and pending pages/derivation continue later. See [catalog expansion](catalog-expansion.md) for leases, scope, failure isolation, capacity skips and coordinated rollout.

`pnpm refresh:catalog` remains the legacy fixed-category manual command. Its `refreshCoverage` configuration and sample request budget are not the scheduled acquisition scope. All category/discovery/targeted writes share the existing retailer locks and preserve ordinary prices, tri-state availability and derived-identity safety.

## Scheduling and concurrency

The `Catalog refresh` workflow runs resumable acquisition at `17 1,3,5,7,9,11,13,15,17,19,21,23 * * *` (every two hours; minute 17 of even Peru hours). Discovery runs at `43 0,2,4,6,8,10,12,14,16,18,20,22 * * *` (minute 43 of odd Peru hours), twenty queries per run and 240 per UTC day. Both share `comprafino-catalog-refresh` with `cancel-in-progress: false`. This serializes workflow runs; timing is not guaranteed, and arbitrary local processes remain separately guarded by database locks/leases.

Retailer ingestion workflows are manual. Operational workflows require a `DATABASE_URL` repository secret, use Node 24/pinned pnpm/frozen installation, and never apply migrations automatically. Refresh/discovery timeouts are 120/60 minutes respectively. Cron is intended cadence, not an exact freshness guarantee; verify actual Actions outcomes when diagnosing missed observations.

## Failure and observation behavior

Retailer failures preserve previous committed data and allow other retailers to proceed; the overall command exits nonzero. Targeted refresh can still supply accepted observations after category failures. If no acquisition succeeds, derivation is skipped unless a partially failed stage may have committed writes. Normalization failure/stale rows prevents matching. Stages are individually transactional, not one transaction spanning the whole pipeline.

Run creation/finish is separate from listing commits; interruption may leave `running`. A database outage cannot reliably record its own failure. Safe structured summaries and CLI/Actions status are the fallback; no credentials/raw connection errors are printed. Explicit unavailable/absence/failure outcomes do not advance price freshness or usable coverage. See [availability](availability.md) and [listing refresh](listing-refresh.md).

## Health versus listing freshness

`freshnessHours` in core classifies latest successful retailer attempt age: healthy through 18h, delayed through 30h, stale thereafter, unknown without success. Latest attempt status and latest success are independent. A manual bounded run can advance retailer health without observing every category/listing.

`listingRefreshPolicy` independently defines purchase freshness (36h), historical visibility (72h), targeted age (6h), cooldown (4h) and request maximum (500). These are separate policies. Public stale prices cannot win current purchase comparisons; historical pages retain disclosed evidence. `/dev/ingestion` displays read-only attempts/successes and returns 404 in production.

## Catalog health monitoring

`pnpm health:catalog` reports per-retailer successful refresh age, latest failures, fresh searchable offer counts and retained capacity without writes or retailer requests. A new six-hour scheduled workflow and post-acquisition refresh/discovery steps expose failures through Actions annotations and summaries. Capacity skips come only from explicit acquisition markers; standalone runs report them as unmeasured. See [monitoring policy and notification setup](catalog-health.md) and [dated account rollout observations](history/account-rollout-2026-10-06.md). Publication and account notification delivery are not implied by local implementation.

## Commands and repair

```sh
# DATABASE_URL in root .env; existing reviewed migrations applied
pnpm acquire:catalog -- --pages=100
pnpm acquire:catalog -- --dry-run
pnpm derive:catalog -- --limit=50000
pnpm derive:catalog -- --dry-run
pnpm refresh:listings -- --dry-run --limit=50
pnpm discover:catalog -- --dry-run --limit=3
pnpm coverage:report
pnpm health:catalog
pnpm audit:catalog-coverage
pnpm audit:availability
pnpm audit:quantity-quality
pnpm audit:observation-coverage
pnpm catalog:budget
# Explicit legacy reconciliation when needed:
pnpm normalize:catalog -- --limit=50000
pnpm derive:catalog -- --limit=50000
```

Retailer commands support bounded allowlisted `--category`, `--limit` and database-free `--dry-run`; see [retailer guides](../packages/scrapers/README.md). Discovery/targeted dry-runs read the database but make no retailer requests or writes. A failed source/schema response requires inspection, not retries or access-control bypass.

## Migration and rollout

Makro requires `0011_real_quasar.sql` before updated refresh/discovery code runs; it expands the retailer constraint and seeds the fourth store. No application database is migrated by this implementation. Makro adds seven sources and up to 220 observations; current budgets derive from configuration, and prior timing evidence is no longer comparable. See [Makro](retailers/makro.md).

Fresh environments apply the full existing journal using `pnpm db:migrate`. Generate migrations only for reviewed schema changes. Deploy category/discovery/targeted ingestion and every raw/derived identity writer together with corresponding readers. Older writers do not gain evidence preservation, capacity locking, current-benefit verification or automatic identity invalidation merely from additive columns. Reconcile normalization and matching after raw identity changes; normalization alone cannot reauthorize an exact association.

## Evidence and artifacts

Current budget reporting qualifies local refresh measurements against current source identity and catalog size. Historical timing/test/catalog counts are [dated evidence](history/README.md), not current operational limits or deployment acceptance. Quotas, monthly transition growth and actual workflow overhead require fresh measurement.

`pnpm benchmark:basket:local` writes a timestamped report under ignored `.artifacts/`; `--output=<path>` selects a repository-relative or absolute destination. Existing files are never replaced. Reviewed baseline updates require an intentionally new destination and review. Read-only audit CLIs print JSON to stdout; choose an explicit new output file when retaining it. Avoid redirecting routine output into historical evidence. See [local testing](local-testing.md).

## Safe diagnostics and demand lifecycle

Core `safeDiagnostic` formats fixed `stage`, `operation`, optional `retailer`, `reason` and `message`, plus an allowlisted SQLSTATE when present. Source timeout, request/validation, DB read/write and normalization/matching failures stay distinguishable. There is no logging dependency or telemetry service. Web/scraper sinks log these objects; they never copy arbitrary error messages, connection strings, request labels/queries, source payloads, stacks or driver detail. Retryability is omitted because no new retry decision exists.

Category ingestion records the safe diagnostic JSON in the existing run error field. Exception wrappers retain original causes in memory for genuine failure propagation, never in persisted JSON. Refresh retailer/derivation summaries and discovery/targeted results retain their failing stage; admission/completion DB failures stay fatal. Public messages/status and last-known-good/failure isolation, cooldown/retry and availability policies remain unchanged. DB outages still require Actions/server logs; no remote error persistence is promised.

Discovery admission retains at most 3,000 distinct rows. Normal scheduled discovery performs one oldest-first cleanup batch of at most 100 rows inactive for more than 30 days and outside cooldown; processing rows stay protected. The cleanup log reports removed count and the operation, without query text. Expiration removes the demand text/count and detaches query attribution while preserving acquired listings/history/source. Dry-run writes nothing. See [discovery lifecycle and rationale](discovery.md#normalization-and-demand). Shopping evaluation processes the submitted list transiently and never persists it. Authenticated list persistence is handled separately by the [sync API](shopping-list-persistence.md#api-contracts).
