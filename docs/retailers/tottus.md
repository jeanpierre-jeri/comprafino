# Tottus Peru ingestion proof

Investigated on October 3, 2026 using normal public HTTP requests with an identifying CompraFino User-Agent, without credentials, cookies or protection bypasses. The public [Carnes category](https://www.tottus.com.pe/tottus-pe/lista/CATG16076/Carnes) returns HTML with a `__NEXT_DATA__` JSON script containing `props.pageProps.results` and pagination. `?page=2` was verified to advance the page. A public [leche search](https://www.tottus.com.pe/tottus-pe/buscar?Ntt=leche) provided packaged/multi-unit examples; search ingestion is not implemented.

## Access choice

Native Node fetch reads the public category page and extracts only its explicit hydration JSON. This is structured data inside HTML; no separate stable public catalog API was established. No browser rendering, HTML parser or HTTP-client dependency is necessary. Do not rely on deployment-specific build IDs or undocumented backend addresses. If the public source returns an access restriction, the adapter stops without retries or alternate access techniques.

Investigation fetched the homepage, two category pages and one search page, not a full catalog. Prices in cached website views can differ from fresh HTTP responses; timestamps and source-native price types matter.

## Source fields and identity

- `skuId` is the retailer external identity; `(retailer_id, external_id)` is unique. The SKU identifies the priced offering more precisely than its parent `productId`, which is retained separately and appears in source product URLs. IDs repeat across page observations; long-term retailer stability still needs monitoring.
- `displayName`, product `url`, first `mediaUrls` image and `merchantCategoryId` are preserved. Category is a source category code, not a canonical taxonomy. Breadcrumbs were observed but are not persisted.
- `internetPrice` supplies the ordinary current price; `normalPrice` supplies the optional reference price only when strictly higher than the ordinary price; Milestone 1C added this invariant check and five regression cases. `cmrPrice` is conditional and is deliberately excluded from the ordinary current price. No generalized promotion engine is implemented. Badge discounts can refer to card prices, so they are not used to compute discounts.
- PEN decimal strings become exact integer cents. The payload also supports numeric values through explicit decimal parsing. Ambiguous price arrays, missing ordinary price, unexpected currencies and invalid amounts fail validation.
- `measurements.format` is preserved as raw package text, without inferring counts or weights. `measurements.unit` is retained as `KG` or `UN`: a KG amount is a per-kilogram quote, not a total package price. UN can still describe a packaged offering such as 500 g; it does not mean a single physical item. Package/count/weight normalization belongs to the later catalog-normalization milestone.
- Delivery-label objects do not establish stock, so availability is unknown. No trustworthy unavailable example was observed; tests do not fabricate one as a captured source example. Optional-metadata omissions are tested with explicitly synthetic mutations of real fixtures.

## Bounds and commands

```sh
pnpm scrape:tottus -- --dry-run --limit=20
pnpm db:generate
# Review packages/db/migrations/*.sql before applying:
pnpm db:migrate
pnpm scrape:tottus -- --limit=50
```

Dry-run needs no `DATABASE_URL` and never writes to PostgreSQL. Persisted mode requires it and fails instead of falling back. Node loads optional root `.env`; platform environment values take precedence. Default 20 listings, hard cap 500, maximum 12 pages in one category, concurrency one, one-second pause between pages and 30-second request timeout. No full-catalog mode or schedule exists. A limit bounds normalized/persisted listings; each source page can deliver more rows, including sponsored duplicates. On successful fetching, the run's fetched count is rows discovered across fetched pages; a fetch failure before the adapter returns currently records zero rather than partial progress; persisted count is inserts/fresh updates; changed count is new price states including initial observations. The verified `--limit=50` live runs fetched 96 rows because complete pages are parsed/countable before deduplication and the normalized limit is applied. A page that brings the unique count to 50 ends fetching; there is no extra request after the limit. Pagination/order can change and bounded samples do not establish complete catalog coverage.

## Persistence and history

The generated first migration creates `retailers`, `retailer_listings`, `price_history` and `ingestion_runs`, and seeds Tottus, Plaza Vea and Metro. Unique listing identity prevents duplication. One atomic Neon HTTP transaction locks the retailer row, upserts fresh listings, closes mismatching open price states and creates missing open states. A partial unique index ensures one open state per listing; start timestamps are unique per listing. Nullable reference prices use SQL `IS DISTINCT FROM`. Money, currency, price unit and timestamp constraints are enforced in PostgreSQL. A regular-price or KG/UN change is meaningful, as is a current-price change. Availability/title updates alone do not add history.

Equal/older observations do not overwrite newer values. Last-seen advances for unchanged fresh data; first-seen stays fixed. All ingestion writers must acquire the same retailer lock at the default READ COMMITTED isolation level. This serializes listing/history batches for that retailer even across processes; it is not a guarantee for arbitrary SQL writers ignoring the lock. The unique indexes independently reject duplicate listing identities and multiple current states. Bounded samples never deactivate absent products. Run start/finish are separate from listing commits: process termination can leave a running record, and a failure after listing commit can require reconciliation. Stored errors are intentionally concise and credential-free.

## Inspection and workflow

During `pnpm dev`, `/dev/ingestion` shows ten latest runs and thirty recent listings. Set `DATABASE_URL` in `apps/web/.env.local`; without it the page explains setup. Connection/missing-schema failures show a safe message. The route returns 404 whenever `NODE_ENV=production`, including production previews. It has no editing or authentication.

The workflow `.github/workflows/ingest-tottus.yml` is `workflow_dispatch` only, serializes manual runs, validates a 1–500 limit through the CLI and uses the GitHub Actions secret `DATABASE_URL`. Apply reviewed migrations beforehand; the workflow never changes schema or creates cloud resources.

## Verification evidence

### Real live Tottus + Neon

The earlier bounded public dry-run passed (49 discovered rows, 20 unique normalized listings). Public `__NEXT_DATA__` product normalization, ordinary/reference prices, SKU/product identifiers, source units and URLs were inspected. Sanitized captured fixtures exclude advertising tokens and unrelated page data.

The developer applied the migration and ran two consecutive live persisted `--limit=50` ingestions:

| Run                  | Fetched | Persisted | New price states |
| -------------------- | ------- | --------- | ---------------- |
| First                | 96      | 50        | 50               |
| Immediately repeated | 96      | 50        | 0                |

Read-only Neon verification on October 3, 2026 confirmed both successful run records, 50 retailer listings, 50 history states and exactly 50 current states. PostgreSQL catalogs confirm retailer primary key/identity check, all three foreign keys, unique retailer/SKU identity, the partial unique current-state index, unique history start timestamps, money/currency/unit/time checks and inspection indexes match the checked-in migration. No application schema modification or additional live crawl was needed. The developer also verified `/dev/ingestion` displaying those live results.

### Controlled PostgreSQL integration tests

`pnpm test:integration` passed all three Vitest tests against Neon in a fresh isolated schema created from the existing migration. These are synthetic observations, not observed live price changes:

- Initial 1290/1490 creates one current state. A fresh unchanged 1290/1490 advances freshness without a new state. Changing to 1090/1490 closes the old state at the new observation and opens exactly one current state. Equal/older replays leave it unchanged.
- An isolated test-only history check rejects the final insert after listing upsert and history close. The real persistence batch rolls back the existing listing/history exactly and leaves no new listing from the same failed batch.
- Two simultaneous initial writes create one listing/state. Two simultaneous different timestamped prices preserve the newest observation, one current state and strictly contiguous history intervals, regardless of which writer acquires the retailer lock first. Stale intermediate observations are ignored.

Tests require an explicitly exported `TEST_DATABASE_URL`; absent configuration reports a skipped suite. They never load `.env`, fall back to `DATABASE_URL`, truncate tables or drop a database. Prefer a dedicated Neon test branch/database. The suite creates a random `comprafino_test_…` schema, applies migration statements there with foreign keys qualified to that schema, and sets a transaction-local search path without public fallback before the unchanged Drizzle/Neon batch. Teardown drops only that suite’s schema. The controlled verification here explicitly used the configured Neon connection with this schema isolation; live listings and retailer locks were untouched. Abrupt termination can leave an isolated test schema requiring manual review/cleanup. The test role needs permission to create schemas.

```sh
# Export TEST_DATABASE_URL securely for a dedicated Neon database/branch first.
pnpm test:integration
```

This command bypasses Turbo caching and is separate from credential-free `pnpm test`.

### Repository and developer-page validation

Formatting, type-aware lint, strict typechecking and 36 unit tests passed. The isolated PostgreSQL suite passed three tests. The production webpack build and both Chromium smoke tests passed, including `/dev/ingestion` returning 404 in production. The existing developer server was rechecked: HTTP 200, both live run counts, listing prices and Unknown availability. The missing-configuration branch returned HTTP 200 with setup instructions in a temporary development copy of the unchanged route using a minimal layout; the shared stylesheet was omitted only in that temporary copy. The active developer server was preserved.

The initial normal build checks encountered a Turbopack CSS-worker/port restriction and a pnpm launcher issue. These were environment/tooling problems, not an established project configuration defect. The developer subsequently corrected the local pnpm installation and verified normal `pnpm build` with Next.js 16.3.8 Turbopack, including compilation, TypeScript, page-data collection and static generation. The local build-validation gap is resolved; the default Next.js configuration remains unchanged, with no webpack fallback added.

## Remaining Tottus limitations

Availability stays **Unknown** because delivery labels do not reliably establish stock. Prices and delivery options are location-sensitive: ingestion uses the site’s anonymous default context without choosing a location; anonymous/local prices may eventually need explicit location modeling. KG is a pricing basis; UN offerings can still be packages. Package/unit normalization will expand in Milestone 2 and is not implemented here.

Source layout, seller or unit changes can stop validation and require adapter review. Bounded category coverage is not a complete catalog. Fetch failures before the adapter returns currently record zero rather than partial discovered counts. Run records are outside the listing transaction, so interrupted processes or post-commit run-update failures require reconciliation. No consumer comparison UI, canonical matching, promotion engine, scheduled ingestion or Metro adapter exists. Plaza Vea was subsequently implemented in Milestone 1B; see the [Plaza Vea integration](plaza-vea.md).

Tottus Milestone 1A ingestion correctness is complete with separate live-idempotency and controlled-transaction evidence. The earlier build-validation gap is resolved locally after correcting pnpm. Plaza Vea Milestone 1B is subsequently verified separately; Metro ingestion was subsequently verified; see the [Metro integration](metro.md).

## Milestone 2 source metadata follow-up

Catalog normalization now preserves the validated source `brand` string separately from titles. VTEX adapters also retain the positive source sale-unit multiplier as structured metadata; Tottus retains its observed package description/pricing basis. Existing legacy rows remain null in the new columns until ordinary fresh ingestion supplies the values. No guessed brand backfill, retailer refetch or price-history rewrite was performed for the normalization audit. Quantity/count derivation remains a separate core-driven command, not an automatic ingestion hook. See [catalog normalization](../catalog-normalization.md) for trust rules, coverage and ambiguity handling.

## Milestone 3 independent-audit dairy expansion

Public Peru navigation exposes `https://www.tottus.com.pe/tottus-pe/lista/CATG16061/Lacteos`. The existing adapter now accepts the single allowlisted `--category=dairy` option, preserving its default meat path and bounded sequential hydration requests. `pnpm scrape:tottus -- --category=dairy --dry-run --limit=20` verified the source; `--limit=100` persisted 100 new dairy listings from 147 source rows. Existing quote/card/reference/history semantics are unchanged.

A captured Braedt cheese row omitted `measurements.unit` entirely. Such rows are validated as missing source evidence and skipped, with no guessed UN/KG price basis; explicit unknown unit values remain errors. Discovered counts still include every raw source row. A sanitized dairy fixture and regression tests verify this behavior. The expanded audit retains all prior meat listings without using weighted meat as the automatic benchmark. See [independent matching audit](../catalog-matching-audit.md) for counts, conservative precision and pending fresh local validation.

## Milestone 6 public text search

Native fetch reads the public `/tottus-pe/buscar?Ntt=…&page=1` hydration page, independently of category browsing. `searchProducts(query, limit)` reuses the same parser/listing contract, stable SKU identity, ordinary/reference price interpretation and availability semantics. Discovery fetches exactly one page (at most 48 source products) and retains at most ten unique usable listings, without retries or pagination. Empty usable results are distinguished from request/schema failures. See [discovery](../discovery.md) for phrase encoding, Tottus semantic fallback, controlled live evidence and scheduling; category coverage is unchanged.

## Milestone 7 targeted refresh

[Known listing refresh](../listing-refresh.md) documents the verified exact lookup, shared price mapping, bounded sequential budget, unavailable/missing semantics and live repeat evidence. Category bounds are unchanged. Targeted refresh does not infer category coverage or delete historical data.
