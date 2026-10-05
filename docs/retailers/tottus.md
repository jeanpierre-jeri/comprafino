# Tottus Peru ingestion proof

Current adapter guidance. The original October 3–5 investigation, live samples and acceptance history are preserved in [engineering history](../history/engineering-notes-2026-10-05.md). Public endpoint shape is validated by the adapter; historical observations are not a promise of current source inventory.

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

## Remaining Tottus limitations

Category/search availability stays **Unknown** because delivery labels do not reliably establish stock; exact product lookups use separate explicit purchase/seller evidence. Prices and delivery options are location-sensitive: ingestion uses the site’s anonymous default context without choosing a location; anonymous/local prices may eventually need explicit location modeling. KG is a pricing basis; UN offerings can still be packages. Package/content normalization is implemented independently in core.

Source layout, seller or unit changes can stop validation and require adapter review. Bounded category coverage is not a complete catalog. Fetch failures before the adapter returns currently record zero rather than partial discovered counts. Run records are outside the listing transaction, so interrupted processes or post-commit run-update failures require reconciliation. Public comparisons, exact matching and scheduled acquisition consume these persisted listings through their separate owners. See [Plaza Vea](plaza-vea.md) and [Metro](metro.md) for their isolated source behavior.

Tottus Milestone 1A ingestion correctness is complete with separate live-idempotency and controlled-transaction evidence. The earlier build-validation gap is resolved locally after correcting pnpm. Plaza Vea Milestone 1B is subsequently verified separately; Metro ingestion was subsequently verified; see the [Metro integration](metro.md).

## Milestone 2 source metadata follow-up

Catalog normalization now preserves the validated source `brand` string separately from titles. VTEX adapters also retain the positive source sale-unit multiplier as structured metadata; Tottus retains its observed package description/pricing basis. Existing legacy rows remain null in the new columns until ordinary fresh ingestion supplies the values. No guessed brand backfill, retailer refetch or price-history rewrite was performed for the normalization audit. Quantity/count derivation remains a separate core-driven command, not an automatic ingestion hook. See [catalog normalization](../catalog-normalization.md) for trust rules, coverage and ambiguity handling.

## Milestone 6 public text search

Native fetch reads the public `/tottus-pe/buscar?Ntt=…&page=1` hydration page, independently of category browsing. `searchProducts(query, limit)` reuses the same parser/listing contract, stable SKU identity, ordinary/reference price interpretation and availability semantics. Discovery fetches exactly one page (at most 48 source products) and retains at most ten unique usable listings, without retries or pagination. Empty usable results are distinguished from request/schema failures. See [discovery](../discovery.md) for phrase encoding, Tottus semantic fallback, controlled live evidence and scheduling; category coverage is unchanged.

## Milestone 7 targeted refresh

[Known listing refresh](../listing-refresh.md) documents the verified exact lookup, shared price mapping, bounded sequential budget, unavailable/missing semantics and live repeat evidence. Category bounds are unchanged. Targeted refresh does not infer category coverage or delete historical data.

## Shared current safeguards

Ordinary quotes must be positive. Concrete Tottus CMR amounts are retained separately; VTEX percentage/payment teasers are not payable prices. Category/search availability and exact SKU/page evidence differ. Unknown stock cannot erase a newer explicit negative; missing seller/schema evidence is a failed lookup rather than fabricated unavailable stock. See [availability](../availability.md), [conditional pricing](../conditional-pricing.md), [normalization](../catalog-normalization.md) and [scheduled source configuration](../operations.md#refresh-coverage-and-ownership).
