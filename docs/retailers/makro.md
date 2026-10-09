# Makro Peru ingestion

Makro is a separate retailer (`makro`) even though the storefront shares VTEX assets and SKU numbers with Plaza Vea. Persisted identity remains `(retailer, externalId)`; common SKU numbers do not establish a cross-retailer match. The existing complete normalization, pack compatibility and automatic identity invalidation rules apply unchanged.

## Public source and verified scope

The [public homepage](https://www.makro.plazavea.com.pe/) declares `jssalesChannel = '9'`. Its public `/files/vtex-search-core.min.js` uses the Legacy Search endpoint and the Makro sales channel. The adapter reads `https://www.makro.plazavea.com.pe/api/catalog_system/pub/products/search` with `sc=9` for categories, full-text search and exact SKU lookups. Channel 1 is unavailable for this storefront; there is no alternate-channel probing or authenticated API use.

On October 8, 2026, a bounded read-only investigation checked the public category tree, twenty-product category pages, a `pollo` search including weighted products and an exact SKU lookup. An initial unencoded three-product category request returned HTTP 500 and ended that run. Subsequent validation used the adapter's URLSearchParams encoding and twenty-product page format. Failures stop each adapter operation without retries, redirects or access-control bypass. No cookies, address, credentials, browser automation or new dependencies are required.

The verified category paths are:

| Category     | VTEX path      |
| ------------ | -------------- |
| dairy        | `845`          |
| sugar-brown  | `431/434/444`  |
| sugar-white  | `431/434/1625` |
| pasta        | `431/436/454`  |
| flour        | `493/346/349`  |
| oats         | `478/479/1639` |
| toilet-paper | `399/1627/402` |

Flour and oats are mixed source categories: product nouns and the existing conservative family/substitution rules remain necessary. Makro does not add the Metro-only narrow eggs source. Full-text search may return suggestions unrelated to the query; discovery retains only relevant title/brand terms before bounded persistence. No full-catalog crawl or address-specific coverage is implemented.

## Ordinary prices, packages and availability

Makro and Plaza Vea share `plaza-storefront.ts`, preserving the established source validation and ordinary-price behavior. Select only seller `1` (observed name `Makro Plazavea`); skip marketplace-only and unavailable category/search offers. External values pass through Zod and the core listing boundary. Available zero prices, invalid money precision, unknown units, nonzero tax and ambiguous sellers fail closed.

`commertialOffer.Price` is the anonymous ordinary channel-9 quote. Only a strictly higher `ListPrice` becomes a reference price. Money remains exact integer PEN cents. The captured six-pack of Leche Light GLORIA 390g has ordinary `Price=23.30`; quantity attributes of 3/6 and a payment-conditioned teaser discount do not change its stored 2330 cents. `CantidadBiPrecioMK`, `CantidadTriPrecioMK`, promotion names and `PromotionTeasers` cannot establish an unconditional payable amount. Quantity/payment discounts are intentionally excluded from conditional offers, ordinary comparisons and history until their complete eligibility and price basis are verified.

SKU identity uses `items[].itemId`; parent product ID is separate. SKU titles, source brand, sale multiplier, package text and the first image are retained. URLs must belong to `https://www.makro.plazavea.com.pe` with a `/slug/p` path; tracking queries/fragments are stripped. Images reuse the existing trusted `plazavea.vteximg.com.br` host.

`un` quotes are per sale package and require multiplier 1. Packs of six units and sacks of 50 kg are not single physical items; core derives content only from supported explicit evidence. `kg` quotes stay per kilogram: captured chicken at S/ 11.50/kg and multiplier 1.9 does not become an S/ 11.50 whole-chicken price. Unsupported or ambiguous packaging remains conservative rather than receiving a guessed quantity.

Positive `IsAvailable` and `AvailableQuantity` indicate anonymous seller/channel availability, not deliverability to a selected address or audited warehouse inventory. Skipped category products do not mark unseen listings unavailable. Exact SKU refresh distinguishes missing, explicitly unavailable and failed/unknown seller evidence using the existing tri-state persistence rules; only usable observations advance ordinary price freshness.

## Commands and bounds

Apply the reviewed migration `0011_real_quasar.sql` before persisted use: it expands the retailer constraint and inserts Makro without modifying existing listings/history. It is not applied automatically by build, startup or workflows.

```sh
pnpm scrape:makro -- --dry-run --limit=20
pnpm scrape:makro -- --dry-run --category=sugar-brown --limit=20
pnpm scrape:makro -- --category=dairy --limit=50
pnpm refresh:listings -- --retailer=makro --dry-run --limit=20
```

Ingestion dry-run requires no database. Persisted mode requires explicit application `DATABASE_URL` and applied migrations. Category ingestion defaults to dairy and twenty normalized listings; dairy allows 1–500 usable listings with at most 25 sequential pages / 500 source products. Each staple allows 1–20 usable listings and at most two pages / forty source products. Pages contain at most twenty source products; inclusive `resources` ranges are checked against returned row counts, including short terminal pages. Sequential requests pause one second and time out after thirty seconds; no retries occur. `discovered` counts products while `normalized` counts unique usable SKUs.

Scheduled refresh adds Makro dairy (100) and six staples (20 each), up to 220 usable observations, using one atomic retailer write after all categories succeed. Discovery attempts all four registered retailers, one twenty-product page / ten usable SKUs per retailer, retaining the existing thirty-query daily cap (at most 120 retailer search calls per UTC day). Targeted refresh shares the global 100-request cap. Catalog retained capacity remains 2000, so new identities may be skipped at capacity without evicting existing data.

The existing basket UI continues to offer one/two/three-store plans, now choosing among four retailers. This does not add a four-store plan. Makro appears in supermarket filters, offer links and ordinary price-history series. Actual public offers require successful persisted ingestion and normalization/matching where applicable; implementation alone does not seed a live catalog or deploy the site.

## Verification

The implemented adapter was also checked against the live source without database access: dairy 20/20, sugar-brown 19/12, sugar-white 13/8, pasta 20/20, flour 20/20, oats 20/20 and toilet-paper 20/20 (source products / usable unique SKUs). A bounded `leche gloria` search returned three usable SKUs and an exact lookup observed SKU `11390020`. Counts are dated sample evidence, not inventory or future coverage guarantees.

`packages/scrapers/src/fixtures/makro.json` contains sanitized captured source values without price tokens, cart links or session data. Unit tests cover retailer separation, ordinary versus teaser prices, references, weighted quotes, units, availability, channel-9 requests, bounds and atomic scheduled writes. `packages/db/src/makro.integration.test.ts` applies checked-in migrations only inside an owned random schema and verifies same-SKU provenance, idempotent history and immediate derived-identity invalidation after a pack change. The controlled Chromium history fixture includes all four retailer series. See [local testing](../local-testing.md) for explicit test configuration.
