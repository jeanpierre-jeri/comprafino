# Tottus Peru ingestion proof

Investigated on October 3, 2026 using normal public HTTP requests with an identifying CompraFino User-Agent, without credentials, cookies or protection bypasses. The public [Carnes category](https://www.tottus.com.pe/tottus-pe/lista/CATG16076/Carnes) returns HTML with a `__NEXT_DATA__` JSON script containing `props.pageProps.results` and pagination. `?page=2` was verified to advance the page. A public [leche search](https://www.tottus.com.pe/tottus-pe/buscar?Ntt=leche) provided packaged/multi-unit examples; search ingestion is not implemented.

## Access choice

Native Node fetch reads the public category page and extracts only its explicit hydration JSON. This is structured data inside HTML; no separate stable public catalog API was established. No browser rendering, HTML parser or HTTP-client dependency is necessary. Do not rely on deployment-specific build IDs or undocumented backend addresses. If the public source returns an access restriction, the adapter stops without retries or alternate access techniques.

Investigation fetched the homepage, two category pages and one search page, not a full catalog. Prices in cached website views can differ from fresh HTTP responses; timestamps and source-native price types matter.

## Source fields and identity

- `skuId` is the retailer external identity; `(retailer_id, external_id)` is unique. The SKU identifies the priced offering more precisely than its parent `productId`, which is retained separately and appears in source product URLs. IDs repeat across page observations; long-term retailer stability still needs monitoring.
- `displayName`, product `url`, first `mediaUrls` image and `merchantCategoryId` are preserved. Category is a source category code, not a canonical taxonomy. Breadcrumbs were observed but are not persisted.
- `internetPrice` supplies the ordinary current price; `normalPrice` supplies the optional reference price. `cmrPrice` is conditional and is deliberately excluded from the ordinary current price. No generalized promotion engine is implemented. Badge discounts can refer to card prices, so they are not used to compute discounts.
- PEN decimal strings become exact integer cents. The payload also supports numeric values through explicit decimal parsing. Ambiguous price arrays, missing ordinary price, unexpected currencies and invalid amounts fail validation.
- `measurements.format` is preserved as raw package text, without inferring counts or weights. `measurements.unit` is retained as `KG` or `UN`: a KG amount is a per-kilogram quote, not a total package price.
- Delivery-label objects do not establish stock, so availability is unknown. No trustworthy unavailable example was observed; tests do not fabricate one as a captured source example. Optional-metadata omissions are tested with explicitly synthetic mutations of real fixtures.

## Bounds and commands

```sh
pnpm scrape:tottus -- --dry-run --limit=20
pnpm db:generate
# Review packages/db/migrations/*.sql before applying:
pnpm db:migrate
pnpm scrape:tottus -- --limit=50
```

Dry-run needs no `DATABASE_URL` and never writes to PostgreSQL. Persisted mode requires it and fails instead of falling back. Node loads optional root `.env`; platform environment values take precedence. Default 20 listings, hard cap 500, maximum 12 pages in one category, concurrency one, one-second pause between pages and 30-second request timeout. No full-catalog mode or schedule exists. A limit bounds normalized/persisted listings; each source page can deliver more rows, including sponsored duplicates. On successful fetching, the run's fetched count is rows discovered across fetched pages; a fetch failure before the adapter returns currently records zero rather than partial progress; persisted count is inserts/fresh updates; changed count is new price states including initial observations. Pagination/order can change and bounded samples do not establish complete catalog coverage.

## Persistence and history

The generated first migration creates `retailers`, `retailer_listings`, `price_history` and `ingestion_runs`, and seeds Tottus, Plaza Vea and Metro. Unique listing identity prevents duplication. One atomic Neon HTTP transaction locks the retailer row, upserts fresh listings, closes mismatching open price states and creates missing open states. A partial unique index ensures one open state per listing; start timestamps are unique per listing. Nullable reference prices use SQL `IS DISTINCT FROM`. Money, currency, price unit and timestamp constraints are enforced in PostgreSQL. A regular-price or KG/UN change is meaningful, as is a current-price change. Availability/title updates alone do not add history.

Equal/older observations do not overwrite newer values. Last-seen advances for unchanged fresh data; first-seen stays fixed. All ingestion writers must acquire the same retailer lock. Bounded samples never deactivate absent products. Run start/finish are separate from listing commits: process termination can leave a running record, and a failure after listing commit can require reconciliation. Stored errors are intentionally concise and credential-free.

## Inspection and workflow

During `pnpm dev`, `/dev/ingestion` shows ten latest runs and thirty recent listings. Set `DATABASE_URL` in `apps/web/.env.local`; without it the page explains setup. Connection/missing-schema failures show a safe message. The route returns 404 whenever `NODE_ENV=production`, including production previews. It has no editing or authentication.

The workflow `.github/workflows/ingest-tottus.yml` is `workflow_dispatch` only, serializes manual runs, validates a 1–500 limit through the CLI and uses the GitHub Actions secret `DATABASE_URL`. Apply reviewed migrations beforehand; the workflow never changes schema or creates cloud resources.

## Verification and remaining work

The live command `pnpm scrape:tottus -- --dry-run --limit=20` passed: 49 discovered rows, 20 unique normalized listings. Five output examples were inspected for prices, identifiers, units and URLs. Small sanitized fixtures cover normal, discounted, weighted and multi-unit products, excluding advertising tokens and unrelated page data. Unit tests cover exact decimal parsing, source/boundary validation, normalization, deduplication, restriction handling, run outcomes, SQL generation and deterministic history/idempotency transitions. Tests require neither Tottus nor PostgreSQL.

No `DATABASE_URL` was configured. No migration or live persisted run has occurred. SQL-generation tests and the pure reference model do not prove PostgreSQL execution, locking or rollback. Before adding Plaza Vea:

1. Review/apply the migration to the developer-provided Neon/PostgreSQL database.
2. Ingest the same bounded sample twice; verify one listing per SKU, advancing freshness and no unchanged history duplicates.
3. Verify a controlled price/reference/unit change closes and opens exactly one state, and stale/replayed observations leave it unchanged.
4. Exercise concurrent writers and forced transactional failure, verifying one current state and rollback.

Prices and delivery options are location-sensitive. The adapter uses the site's anonymous default context, without choosing a location. Source layout, seller or unit changes can stop validation and require adapter review. No consumer UI, canonical matching, promotion logic or other retailer ingestion exists.

Repository validation: formatting, lint, strict typechecking and all 36 unit tests passed. Frozen installation passed. The production build passed with `pnpm build -- --webpack`; both Chromium E2E tests passed against that build, including the developer-route 404. The existing development server returned HTTP 200 and the helpful no-database message. Standard `pnpm build` could not complete because this execution environment denied Turbopack's local worker port (`Operation not permitted`), including an elevated attempt. This is a remaining default-build verification gap; the repository's default build command was preserved.
