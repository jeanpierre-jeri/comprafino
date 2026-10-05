# Catalog operations

## Refresh coverage and ownership

`pnpm refresh:catalog` runs configured category adapters sequentially, then eligible targeted known-listing lookups, then complete normalization and matching. `refreshCoverage` in `packages/scrapers/src/refresh-adapters.ts` defines each retailer/category limit. Scheduled retailer totals derive from this configuration; `pnpm catalog:budget` derives source counts, observation caps and page/request bounds. Tottus uses validated meat/dairy scopes; Plaza Vea/Metro use dairy and six staples, with a narrow Metro eggs scope. No arbitrary URL/category input or broad crawl exists.

All categories for one retailer fetch before its atomic write. Bounded rotation can add new identities while absent sample rows remain retained. The 1,000-listing admission/read guard fails rather than silently truncating downstream derivation. Review capacity before any expansion.

## Scheduling and concurrency

The `Catalog refresh` workflow (`.github/workflows/refresh-catalog.yml`) supports manual dispatch and cron `17 11,23 * * *`: **06:17/18:17 Peru**. `Catalog discovery` (`discover-catalog.yml`) runs `43 0,6,12,18 * * *`: **19:43/01:43/07:43/13:43 Peru**. Both use `comprafino-catalog-refresh` with `cancel-in-progress: false`. This serializes their workflow runs; it does not serialize arbitrary manual/local processes or guarantee execution of every queued trigger.

Retailer ingestion workflows are manual. Operational workflows require a `DATABASE_URL` repository secret, use Node 24/pinned pnpm/frozen installation, and never apply migrations automatically. Refresh/discovery timeouts are 120/60 minutes respectively. Cron is intended cadence, not an exact freshness guarantee; verify actual Actions outcomes when diagnosing missed observations.

## Failure and observation behavior

Retailer failures preserve previous committed data and allow other retailers to proceed; the overall command exits nonzero. Targeted refresh can still supply accepted observations after category failures. If no acquisition succeeds, derivation is skipped unless a partially failed stage may have committed writes. Normalization failure/stale rows prevents matching. Stages are individually transactional, not one transaction spanning the whole pipeline.

Run creation/finish is separate from listing commits; interruption may leave `running`. A database outage cannot reliably record its own failure. Safe structured summaries and CLI/Actions status are the fallback; no credentials/raw connection errors are printed. Explicit unavailable/absence/failure outcomes do not advance price freshness or usable coverage. See [availability](availability.md) and [listing refresh](listing-refresh.md).

## Health versus listing freshness

`freshnessHours` in core classifies latest successful retailer attempt age: healthy through 18h, delayed through 30h, stale thereafter, unknown without success. Latest attempt status and latest success are independent. A manual bounded run can advance retailer health without observing every category/listing.

`listingRefreshPolicy` independently defines purchase freshness (36h), historical visibility (72h), targeted age (24h), cooldown (12h) and request maximum (100). These are separate policies. Public stale prices cannot win current purchase comparisons; historical pages retain disclosed evidence. `/dev/ingestion` displays read-only attempts/successes and returns 404 in production.

## Commands and repair

```sh
# DATABASE_URL in root .env; existing reviewed migrations applied
pnpm refresh:catalog
pnpm refresh:catalog -- --dry-run
pnpm refresh:listings -- --dry-run --limit=50
pnpm discover:catalog -- --dry-run --limit=3
pnpm coverage:report
pnpm audit:catalog-coverage
pnpm audit:availability
pnpm audit:quantity-quality
pnpm audit:observation-coverage
pnpm catalog:budget
# After checking source identity changes and complete scope:
pnpm normalize:catalog -- --limit=1000
pnpm match:catalog -- --dry-run --limit=1000
pnpm match:catalog -- --limit=1000
```

Retailer commands support bounded allowlisted `--category`, `--limit` and database-free `--dry-run`; see [retailer guides](../packages/scrapers/README.md). Discovery/targeted dry-runs read the database but make no retailer requests or writes. A failed source/schema response requires inspection, not retries or access-control bypass.

## Migration and rollout

Fresh environments apply the full existing journal using `pnpm db:migrate`. Generate migrations only for reviewed schema changes. Deploy category/discovery/targeted ingestion and every raw/derived identity writer together with corresponding readers. Older writers do not gain evidence preservation, capacity locking, current-benefit verification or automatic identity invalidation merely from additive columns. Reconcile normalization and matching after raw identity changes; normalization alone cannot reauthorize an exact association.

## Evidence and artifacts

Current budget reporting qualifies local refresh measurements against current source identity and catalog size. Historical timing/test/catalog counts are [dated evidence](history/README.md), not current operational limits or deployment acceptance. Quotas, monthly transition growth and actual workflow overhead require fresh measurement.

`pnpm benchmark:basket:local` writes a timestamped report under ignored `.artifacts/`; `--output=<path>` selects a repository-relative or absolute destination. Existing files are never replaced. Reviewed baseline updates require an intentionally new destination and review. Read-only audit CLIs print JSON to stdout; choose an explicit new output file when retaining it. Avoid redirecting routine output into historical evidence. See [local testing](local-testing.md).

## Safe diagnostics and demand lifecycle

Core `safeDiagnostic` formats fixed `stage`, `operation`, optional `retailer`, `reason` and `message`, plus an allowlisted SQLSTATE when present. Source timeout, request/validation, DB read/write and normalization/matching failures stay distinguishable. There is no logging dependency or telemetry service. Web/scraper sinks log these objects; they never copy arbitrary error messages, connection strings, request labels/queries, source payloads, stacks or driver detail. Retryability is omitted because no new retry decision exists.

Category ingestion records the safe diagnostic JSON in the existing run error field. Exception wrappers retain original causes in memory for genuine failure propagation, never in persisted JSON. Refresh retailer/derivation summaries and discovery/targeted results retain their failing stage; admission/completion DB failures stay fatal. Public messages/status and last-known-good/failure isolation, cooldown/retry and availability policies remain unchanged. DB outages still require Actions/server logs; no remote error persistence is promised.

Discovery admission retains at most 3,000 distinct rows. Normal scheduled discovery performs one oldest-first cleanup batch of at most 100 rows inactive for more than 30 days and outside cooldown; processing rows stay protected. The cleanup log reports removed count and the operation, without query text. Expiration removes the demand text/count and detaches query attribution while preserving acquired listings/history/source. Dry-run writes nothing. See [discovery lifecycle and rationale](discovery.md#normalization-and-demand). Shopping evaluation transmits browser-local list data transiently and never persists the shopping list.
