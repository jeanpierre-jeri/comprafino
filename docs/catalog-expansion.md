# Resumable catalog acquisition

This implementation raises retained capacity to **50,000 retailer listings**, adds durable category-page progress, and replaces scheduled sample acquisition with resumable public-category traversal. A listing is one store's offering; it is not necessarily a distinct cross-store product. Capacity is an admission guard, not a claim that 50,000 products have already been acquired. Repository changes do not establish deployment or production migration status.

## Acquisition and coverage

`pnpm acquire:catalog` discovers public categories and advances up to 100 pages per retailer per invocation. `--pages=1..1000` changes that work budget; `--retailer=tottus|plaza-vea|metro|makro` selects one store. The default covers all four stores. Page budgets govern work per invocation, rather than permanently retaining only the first twenty items in a category.

Tottus categories come exclusively from the public homepage's explicit `__NEXT_DATA__` navigation. VTEX categories come from the public tree and retain the full numeric category path. Grocery, beverages, household cleaning, personal care, baby and pet departments are included; general marketplace departments such as technology, clothing and furniture are excluded. Makro shares a taxonomy with Plaza Vea, but uses public sales channel 9. Tree membership does not establish Makro inventory. Each product page must pass its retailer's existing seller, price, unit and availability parser before persistence.

Some Tottus categories redirect to a single product. Acquisition permits one redirect to an exact public product/variant path on the same Tottus origin, with no credentials, query or fragment. The product hydration must match both URL identities and pass the existing targeted seller/price/availability validation. Missing quote units are skipped, as on category pages. All other redirects are rejected; a second redirect is never followed.

Acquisition uses sequential requests, one-second pauses, thirty-second timeouts and no immediate retries. HTTP 401, 403 or 429 stops acquisition for that retailer; the same invocation excludes that retailer from targeted lookups. Discovery and targeted batches also stop subsequent work for a retailer after an access restriction; other retailers continue. Other category failures preserve their cursor and defer that source for six hours, while allowing other categories/stores to continue. No alternate endpoints, authentication bypass, stealth or browser automation are introduced.

`catalog_sources` stores each category URL/key, cursor, lease and observation/cycle counts. Workers claim pages with `FOR UPDATE SKIP LOCKED` and a five-minute lease. Accepted listings commit through the existing shared identity writer before progress advances. A crash between those commits replays the page safely; older lease tokens cannot advance a newly claimed page. Source-to-listing membership supports refresh demand without assuming that one listing belongs to only one category. Changed public category URLs reset their cursor and revoke the old lease.

Each completed traversal restarts from page one on its next eligible cycle. A category recently requested by a search waits four hours; ordinary categories wait twenty hours. Incomplete cycles remain eligible and continue in subsequent executions, with oldest-attempt ordering across categories. First traversals prioritize staple-category paths, including the confirmed missing families; this priority governs acquisition order and never establishes product identity or stock. These intervals are eligibility targets, not guarantees: backlog, failures, provider pagination ceilings, source changes and GitHub scheduling delays can extend them. A first traversal can require multiple invocations.

At capacity, existing identities still refresh. Omitted new identities are counted in page/cycle metadata and retried on later complete traversals. A capacity skip makes the acquisition command report failure/attention, but does not stop refreshing known listings on subsequent pages. Raising capacity later allows those identities to be admitted on their next traversal; no historical row is deleted automatically.

The checked-in refresh workflow runs acquisition every two hours, at minute 17 of odd UTC hours, followed by targeted refresh and derivation. Its maximum remains 120 minutes. The default category work budget is 400 pages across four retailers per run; source-registry requests and up to 500 targeted requests are additional. A large, slow traversal can resume after the workflow timeout rather than starting over.

## Search and demand

Public requests continue to read PostgreSQL only. They do not wait for retailer calls or perform matching. Search computes per-store coverage before retailer/unit filters and pagination. Stores with fewer than three eligible options create discovery demand even if other stores already have results. Requested stores are retained in `discovery_queries.requested_retailers`; legacy empty arrays mean all registered stores. Discovery calls only the requested subset while still validating that every registered adapter is present.

Discovery retains up to twenty usable offerings per requested retailer from one public search page. Its scheduled budget is 240 queries per UTC day, twenty per invocation, with CLI invocation bounds of 1–60. The existing 24-hour query cooldown and explicit manual-mode accounting remain. The workflow is configured every two hours at minute 43 of even UTC hours. Acquisition and discovery still share a concurrency group; schedules can queue or be delayed. Acquisition spelling tolerance now accepts accent variants, while exact product identity, quantities and variant safeguards remain separate.

Search also records category-refresh demand for acquired listing paths after the response. Independent options are paginated thirty per page and exact groups twenty per page. First-page unit-dimension diversity is retained; later pages exclude those selected first-page options so each independent result appears once. Changing filters resets the page. Basket evaluation also scopes its single PostgreSQL snapshot to requested exact identities and the supported substitution families, while retaining the complete-current-catalog overflow guard and authoritative core compatibility checks. `search_identity` and its PostgreSQL full-text GIN index prefilter lexical candidates; the original lexical checks, authoritative family classifier, positive-price/freshness gates and exact identity rules remain in force.

Canonical eligibility and final family/filter checks are still evaluated against trusted evidence. A canonical page can conservatively lead to an additional empty page when all its candidates are excluded by those checks; there is no exhaustive count of canonical groups exposed by this pagination. Arbitrary product families and new exact-equivalence semantics have not been added.

## Incremental derivation and freshness

An accepted raw identity change invalidates automatic confidence and marks its existing normalization fingerprint dirty in the shared writer used by category, discovery and targeted ingestion. Price-only observations do not enqueue normalization or matching. `normalizeChangedCatalog` persists up to 500 records per transaction and processes only missing, dirty or obsolete-version normalizations. `normalize:catalog` remains available for an explicit full reconciliation; its persistence also uses 500-row batches.

Incremental matching expands exact brand/quantity/package blocks and every previous canonical group before writing. Prior groups connect changed keys, so a changed brand/quantity cannot cut an old group in half. Candidate generation retains the existing automatic equivalence scorer's required complete dimensions and token identity. SQL similarity evaluation uses 500-pair batches. Human-review candidate generation remains available through the existing bounded audit path.

Successful blocks receive fingerprint/version checkpoints under retailer locks and snapshot guards. Unassociated rows without required automatic identity evidence are checkpointed in bulk without creating equivalences. Manual decisions remain protected; stale/protected blocks are deferred rather than overwritten. A block above 5,000 members is refused without truncation and needs operator review. These per-operation bounds protect work units independently of global retained capacity.

Scheduled acquisition normalizes up to 10,000 changed records and matches up to 250 blocks per invocation; remaining work is reported and processed in later runs. Targeted refresh now admits up to 500 requests, starts eligibility at six hours and retains a four-hour cooldown. Its SQL candidate pool is bounded independently to 5,000 eligible identities, rather than reading every catalog row in the scheduled selector. Ordinary purchase freshness remains 36 hours and historical visibility 72 hours; older prices are never made current merely by raising those windows.

## Migration, rollout and commands

Review [0013_catalog_expansion.sql](../packages/db/migrations/0013_catalog_expansion.sql) before applying it. It adds category progress/membership, matching checkpoints, requested-store demand and search metadata/indexes; widens discovery counter constraints; and backfills only derived search text. It does not rewrite ordinary prices/history or delete existing catalog/account data. Foreign keys, source cursor defaults and shared writer/read contracts have been exercised in owned test schemas.

Coordinate the migration and deployment of all readers and category/discovery/targeted writers before admitting data above the old 2,000-row guard. Old scheduled commands and readers do not acquire the new behavior merely because the additive schema exists. Build/startup never migrates automatically.

```sh
# After reviewing migration and arranging coordinated rollout:
pnpm db:migrate
# Reconcile existing fingerprints if any legacy writer left stale derived inputs:
pnpm normalize:catalog -- --limit=50000
pnpm derive:catalog -- --limit=50000

# Read-only: no retailer calls or writes:
pnpm acquire:catalog -- --dry-run
pnpm derive:catalog -- --dry-run

# Resume bounded category work; no arbitrary URL input:
pnpm acquire:catalog -- --pages=100
pnpm acquire:catalog -- --retailer=tottus --pages=100
pnpm discover:catalog -- --limit=20
pnpm health:catalog
pnpm audit:catalog-coverage
pnpm catalog:budget
```

`derive:catalog` performs no retailer requests. Its `--limit` bounds changed normalizations and caps matching at 1,000 blocks; dry-run reports queue counts without writes. Full `match:catalog` remains a bounded review/reconciliation path for scopes up to 5,000; use incremental derivation for larger catalogs. All commands use root `.env`/`DATABASE_URL`, with platform variables taking precedence. No new service or dependency is required.

Acquisition output reports registered categories, completed/failed pages, capacity skips and safe per-category diagnostics. Category summaries distinguish never-completed/in-progress/due/failed/capacity-limited cycles and timestamps. Pending normalization/matching counts distinguish successful acquisition from completed derivation. Historical operating-budget measurements are not comparable to the new source traversal; current budget output labels legacy sample bounds separately from the resumable acquisition budget.

## Verification boundaries

Unit tests cover accent/quantity boundaries, missing-store demand, automatic-candidate equivalence, per-page failures/restrictions and pagination uniqueness. Owned PostgreSQL tests cover leases/replays, category demand, previous-group expansion, price-only no-op derivation, indexed numeric-unit searches, paginated offers and admission/derivation at 50,000 records. Those are local correctness/scale tests, not a claim about production throughput, complete source inventory or future request costs.

Chromium verification uses the repository's controlled fixture harness after a production build. No application `DATABASE_URL` fallback is allowed in tests. See [local testing](local-testing.md).
