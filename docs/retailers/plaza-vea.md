# Plaza Vea Peru ingestion proof

Current adapter guidance. The original October 3–5 investigation, live samples and acceptance history are preserved in [engineering history](../history/engineering-notes-2026-10-05.md). Public endpoint shape is validated by the adapter; historical observations are not a promise of current source inventory.

## Public source and access

The public homepage uses VTEX. Its `/files/vtex-search-core.min.js` storefront bundle explicitly references `/api/catalog_system/pub/products/search` and inclusive `_from`/`_to` pagination. This is the documented [VTEX Legacy Search API](https://developers.vtex.com/docs/api-reference/search-api), not an authenticated catalog-management API. See also [VTEX search parameters](https://developers.vtex.com/docs/guides/how-search-parameters-work).

Native Node fetch is sufficient: JSON responses return HTTP 206 with a `resources` header such as `0-19/597`. No HTML parser, browser rendering, HTTP client or scraping dependency was added. Requests use no credentials, cookies, selected address or access-protection bypass. HTTP failures and redirects stop ingestion without retries or alternate access techniques.

Investigation was bounded: the homepage, its public search bundle, five `leche` results, twenty dairy/egg category products and five `pollo` search results. The latter demonstrated weighted units, but full-text results included unrelated products. Production ingestion therefore uses the category filter `fq=C:/845/` (Lácteos y Huevos) and explicit public sales channel `sc=1`. It does not crawl the entire catalog. Both samples used the same product/SKU/seller structure; compatibility with all categories is not established.

## Identity and normalization

- SKU `items[].itemId` is the listing external identity. Parent `productId` is retained separately. Identity remains `(retailer, externalId)`; IDs appear stable across repeated observations, but long-term stability needs monitoring.
- Each SKU is independently normalized, using `items[].name` for its title. Only seller `1` (Plaza Vea) is selected; marketplace-only items are skipped. Duplicate seller-1 offers fail validation. Multiple SKUs can share a parent product URL without sharing a listing identity.
- Product `link` is resolved against `https://www.plazavea.com.pe`, restricted to that origin and a `/slug/p` path, and stripped of query/hash tracking. Do not reconstruct URLs from titles or product IDs. Some valid old source slugs describe previous pack sizes (for example 1 L versus a current 946 ml title); the adapter preserves the actual source link and current SKU title.
- The first SKU image is retained when available. `categoryId` is a source category code, not a canonical taxonomy. Missing optional images, package text and category are accepted.
- External JSON is validated with Zod before normalization; the existing core listing boundary validates the resulting observations again. Persisted money remains integer PEN cents. The API does not supply a currency field; PEN is the explicit adapter assumption for this Peru storefront/channel, whose homepage declares `S/`. Other storefronts/channels are unsupported.

## Prices and promotions

For seller `1`, `commertialOffer.Price` is the ordinary current anonymous offer in channel 1. `ListPrice` is preserved as the reference price only when it is strictly greater than `Price`. Equal, lower, zero or missing values normalize to undefined (SQL null on persistence). `PriceWithoutDiscount` was observed but is not used as current price or substituted for `ListPrice`. Source decimals pass through the existing exact cents parser: 21.50 becomes 2150, without floating-point multiplication. Invalid decimals, available zero-price offers and nonzero `Tax` fail closed rather than guessing. Invalid decimal precision in `ListPrice` is still rejected, including amounts below the current price.

`PromotionTeasers` exposes separate eligibility/effects, including payment parameters and a `MinimumQuantity` field (zero in the captured card teasers). Product attributes `CantidadBiPrecioMK` / `CantidadTriPrecioMK` also appeared (3 / 6 for the GLORIA six-pack), but no active quantity-deal price was verified; these attributes are not used to calculate prices. The sampled GLORIA six-pack had `Price=21.50`, `ListPrice=24.60` and an additional `PromotionalPriceTableItemsDiscount=4.10`, with payment-method conditions including Oh!/Agora. Its stored current price is **2150 cents**, not a card-adjusted 1740 cents. The storefront bundle computes `PriceToh` and `PriceAgoraPayToh` separately from `Price`, supporting this interpretation. No teaser discount, installment value, card price or quantity-deal calculation enters the ordinary price. Source campaign labels do not establish eligibility.

The sanitized fixture retains representative `PromotionTeasers`, conditions and effects for later promotions work, and reference source values such as `PriceWithoutDiscount`. Live teaser details are not persisted: this milestone adds no promotion fields or engine. Price tokens, cart links, unrelated scripts and session/payment payloads were removed from fixtures. Online-only prices describe this web context; equivalence with in-store or address-selected prices is not established.

## Units, packages and availability

`measurementUnit` maps `un → UN`, `kg → KG`. `Price` is the quote per source unit: the captured whole chicken offers S/ 6.70/kg with `unitMultiplier=2.2`, not S/ 6.70 for the whole chicken. Weighted multiplier information is preserved as package text (`unitMultiplier: 2.2 kg`), without turning the quote into a package total. Unit-priced samples all had multiplier 1; other UN multipliers and unknown units stop validation for review.

`Presentación unitarios vitrina` supplies raw package text such as `Paquete 6un` or `Caja 946ml`. No counts or weights are inferred. Other specification fields were inconsistent: `Contenido Neto` sometimes disagreed with the title, and `Unidades Por Paquete` sometimes disagreed with the six-pack. Those fields are not used to derive price basis or package quantities. Missing package text stays missing even when the title contains a pack description.

`IsAvailable` plus positive `AvailableQuantity` establishes availability of the anonymous seller/channel offer, so normalized usable listings have `available=true`. This is **not address-specific deliverability**; quantities such as 99999 should not be interpreted as audited warehouse stock. Unavailable/zero-quantity offers and marketplace-only SKUs are skipped. The bounded live investigation captured no unavailable item; unavailable zero-placeholder tests are explicitly synthetic fixture mutations. Skipping an unavailable item does not update a previously stored listing to unavailable. Bounded samples never deactivate unseen listings.

The homepage asks for an address to see supermarket products available in the shopper's zone. No location was selected in this milestone, and no claim of location-independent pricing is made. Address-selected seller, price, shipping and availability coverage remain future work requiring explicit context modeling.

## Bounds and commands

```sh
pnpm scrape:plaza-vea -- --dry-run --limit=20
pnpm scrape:plaza-vea -- --limit=50
```

Default normalized limit: 20; hard maximum: 500. The adapter fetches sequential pages of at most 20 source products, at most 25 pages / 500 source products in the single dairy/eggs category, with a one-second pause between requests and a 30-second timeout per request. There is no full-catalog mode, parallel crawling or schedule.

The `resources` header is validated against requested offsets and returned product count. The next request starts at the previous inclusive range end plus one. Fetching ends immediately once the unique usable SKU limit is reached or the source is exhausted. A complete fetched page is validated/counted before deduplication and limiting. `discovered`/run `listingsFetched` counts **source products**, while normalized/persisted counts are **usable unique seller-1 SKUs**. Skipped products, multiple SKUs and duplicates can make these differ. Hard source/request bounds can return fewer listings than requested; output reports actual counts. The verified 50-listing runs fetched three twenty-product pages (60 source products), with no fourth request.

Dry-run prints five normalized samples and requires no database; this was also verified with an explicitly empty `DATABASE_URL`. Persisted mode rejects a missing URL before any retailer request and reuses generic ingestion run lifecycle and persistence. Fetch failure before the adapter returns still records zero partial fetched progress, matching the existing orchestration limitation.

The manual `.github/workflows/ingest-plaza-vea.yml` uses `workflow_dispatch`, a conservative default, a bounded CLI limit, concurrency serialization and the existing `DATABASE_URL` repository secret. Reviewed migrations must already be applied. It does not migrate or schedule ingestion, and regular CI does not access the retailer. `/dev/ingestion` uses the existing mixed-retailer queries; a retailer column was added to the listings table. It remains development-only.

## Milestone 2 source metadata follow-up

Catalog normalization now preserves the validated source `brand` string separately from titles. VTEX adapters also retain the positive source sale-unit multiplier as structured metadata; Tottus retains its observed package description/pricing basis. Existing legacy rows remain null in the new columns until ordinary fresh ingestion supplies the values. No guessed brand backfill, retailer refetch or price-history rewrite was performed for the normalization audit. Quantity/count derivation remains a separate core-driven command, not an automatic ingestion hook. See [catalog normalization](../catalog-normalization.md) for trust rules, coverage and ambiguity handling.

## Milestone 6 public text search

Native fetch reads the existing public VTEX products/search endpoint with `ft`, `sc=1`, `_from=0`, `_to=19` and URI percent-encoded whitespace, independently of category browsing. `searchProducts(query, limit)` reuses the same parser/listing contract, stable SKU identity, ordinary/reference price interpretation and availability semantics. Discovery fetches exactly one page (at most 20 source products) and retains at most ten unique usable listings, without retries or pagination. Empty usable results are distinguished from request/schema failures. See [discovery](../discovery.md) for phrase encoding, Tottus semantic fallback, controlled live evidence and scheduling; category coverage is unchanged.

## Milestone 7 targeted refresh

[Known listing refresh](../listing-refresh.md) documents the verified exact lookup, shared price mapping, bounded sequential budget, unavailable/missing semantics and live repeat evidence. Category bounds are unchanged. Targeted refresh does not infer category coverage or delete historical data.

## Milestone 9 permanent staple sources

The adapter now accepts the small validated allowlist `dairy`, `sugar-brown`, `sugar-white`, `pasta`, `flour`, `oats`, `toilet-paper`. New sources use full paths from the public tree, at most twenty usable listings/two sequential pages/forty source products, ordinary anonymous seller-1 quotes and the existing source boundary. CLI requests above twenty for these sources fail before network access; dairy retains its prior cap. Terminal VTEX ranges can advertise a full page beyond the smaller total; actual row count is validated against that total. No empty source is treated as successful ingestion. See [staple coverage](../staple-coverage.md) for paths, actual acquisitions, quantity ambiguities and scheduled atomic integration.

## Shared current safeguards

Ordinary quotes must be positive. Concrete Tottus CMR amounts are retained separately; VTEX percentage/payment teasers are not payable prices. Category/search availability and exact SKU/page evidence differ. Unknown stock cannot erase a newer explicit negative; missing seller/schema evidence is a failed lookup rather than fabricated unavailable stock. See [availability](../availability.md), [conditional pricing](../conditional-pricing.md), [normalization](../catalog-normalization.md) and [scheduled source configuration](../operations.md#refresh-coverage-and-ownership).
