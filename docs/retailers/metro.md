# Metro Peru ingestion proof

Current adapter guidance. The original October 3–5 investigation, live samples and acceptance history are preserved in [engineering history](../history/engineering-notes-2026-10-05.md). Public endpoint shape is validated by the adapter; historical observations are not a promise of current source inventory.

## Public source and access

The [Metro homepage](https://www.metro.pe/) declares `vtex.render-server` (VTEX IO). Its [dairy category](https://www.metro.pe/lacteos) embeds public GraphQL hydration state in `__STATE__`, including the selected category facet `1001436`. HTML also contains website JSON-LD; parsing the complete storefront is unnecessary. The anonymous endpoint `https://www.metro.pe/api/catalog_system/pub/products/search` returned JSON, HTTP 206 and a `resources` header (`0-19/860` for the investigated dairy page). It belongs to the documented [VTEX Legacy Search API](https://developers.vtex.com/docs/api-reference/search-api).

Native Node fetch is sufficient. No dependencies, browser scraper, cookies, credentials, selected address or protection bypass were needed. Requests identify CompraFino, execute sequentially and stop on HTTP errors or redirects without retries or alternative access techniques.

Investigation was small: homepage, dairy category HTML, twenty dairy products and four five-product searches (`leche`, `pollo`, `pollo entero fresco`, `leche gloria pack`). Broad full-text searches returned unrelated appliances and prepared food; production ingestion therefore uses only the observed dairy category `fq=C:/1001436/` and anonymous sales channel `sc=1`. Weighted examples come from investigation fixtures, not an additional production category. This is a bounded proof, not a full catalog crawler.

## Identity and external validation

SKU `items[].itemId` is the external listing identity; parent `productId` is retained separately. IDs repeated across the two runs; long-term stability needs monitoring. Each SKU uses its own `name`, first image and seller `1` offer. The captured seller-1 name was `CENCOSUD RETAIL PERU S.A.`. Other sellers such as `wongiononfood` were observed in appliance results; only seller `1` is selected, even if another seller comes first. Missing seller-1 offers are skipped; duplicate seller-1 offers fail as ambiguous.

Zod validates external JSON before normalization, and the existing core listing boundary validates normalized data before generic persistence. Product `link` must resolve to Metro's HTTPS origin and `/slug/p` path; query/hash tracking is removed. Source links and SKU image URLs are preserved rather than reconstructed from titles. Source `categoryId` remains a retailer category code. Missing optional category, image and package fields are allowed. No retailer-specific persistence or schema change is required: Metro already exists in the first migration's seeds and was verified in live PostgreSQL.

## Prices and promotions

Seller-1 `commertialOffer.Price` is the ordinary anonymous current price in channel 1. `ListPrice` is retained only when strictly greater than that price. Equal, lower, zero or missing reference values become undefined/SQL null. `PriceWithoutDiscount` is observed but not substituted for either price. PEN is an explicit Peru-storefront assumption; the catalog has no currency field. Prices use the existing exact decimal parser: 21.50 → 2150 cents, 24.95 → 2495 cents. Invalid precision, available zero prices and nonzero taxes fail closed. Even a lower reference amount must be a valid decimal.

The dairy sample exposes `PromotionTeasers` with an October Metro-card 5% discount, `Conditions.Parameters` containing `PaymentMethodId` and `RestrictionsBins`, `Conditions.MinimumQuantity=0`, and `Effects.Parameters` containing `PercentualDiscount=5`. The alternate `Teasers` representation duplicates this information using backing-field names. This is separate eligibility/effect metadata, not an ordinary reduced price. The captured six-pack therefore normalizes to **2150**, with reference **2460**, without applying the additional 5%. Installment values and campaign labels also do not determine current price.

No active loyalty-specific price, nonzero minimum-quantity deal, second-unit discount or unconditional 2x1 was established by these samples. Absence in this bounded investigation does not establish their absence across Metro. Sanitized fixtures retain representative public teaser conditions/effects and `PriceWithoutDiscount`, but remove price tokens, cart links and payment/session payloads. Teasers are not persisted: the existing schema has no small source-metadata field, and this milestone does not introduce a promotion domain.

## Units, packages and availability

`measurementUnit` maps `un → UN`, `kg → KG`. `unitMultiplier` is positive; the sampled UN offers use 1, and other UN multipliers fail for price-basis review. A captured fresh San Fernando chicken uses `kg`, multiplier 1.9, ordinary 7.70 and reference 9.90. Its normalized price is **770 cents/kg**, not a computed 1463-cent chicken total. KG multiplier is retained as raw package text (`unitMultiplier: 1.9 kg`).

Optional `Envase`, `Formato`, `Tamaño` and `Pack-Unitario` arrays supply labelled package text. Empty entries and literal placeholders equal to the specification name are removed (the six-pack's `Envase: Envase` and `Tamaño: Tamaño` are meaningless). Valid values remain raw, e.g. `Envase: Lata; Formato: Envasado; Tamaño: Individual; Pack-Unitario: Pack`. `Formato: Líquido` is a source presentation descriptor, not a standardized physical quantity. Titles retain pack counts/weights; the adapter does not extract them or infer quantities from inconsistent prose. Missing package metadata remains missing even with a descriptive title.

`IsAvailable` plus positive `AvailableQuantity` establishes anonymous offer availability only. Usable listings have `available=true`; unavailable or zero-quantity placeholders are skipped. No unavailable product was captured; tests label unavailable mutations as synthetic. Skipping does not mark a previously persisted listing unavailable, and bounded runs never deactivate unseen products. Quantities such as 99999 are not audited warehouse inventory.

No address/store was selected. Channel 1 offers do not prove location-independent prices, address-specific delivery or equivalence to physical-store prices. Additional location/channel modeling is deferred rather than guessed.

## Commands and bounds

```sh
pnpm scrape:metro -- --dry-run --limit=20
pnpm scrape:metro -- --limit=50
```

Default 20 usable unique SKUs, maximum 500; one dairy category, at most 25 sequential pages / 500 source products, twenty products per request, one-second pauses and 30-second request timeout. Inclusive `_from`/`_to` offsets advance from the actual returned end plus one. `resources` must match requested bounds and parsed product count. Fetching stops immediately when the usable unique listing limit is reached or the source ends. No fourth request was made for either 50-listing run.

`discovered` and ingestion-run `listingsFetched` count source products in complete fetched pages; normalized/persisted counts represent usable unique seller-1 SKUs. Unavailable offers, multiple SKUs or duplicates may make counts differ. Hard bounds can return fewer listings than requested. Dry-run prints five samples, requires no database and writes nothing; live validation explicitly cleared `DATABASE_URL`. Persisted mode rejects a missing database URL before retailer requests. Generic run lifecycle, atomic persistence, price-state history and concurrency behavior are reused unchanged. As with the other adapters, failures before fetch completion do not retain partial discovered counts, and run records are separate from the listing transaction.

The manual `.github/workflows/ingest-metro.yml` uses `workflow_dispatch`, default limit 20, concurrency serialization and the existing `DATABASE_URL` secret. Reviewed migrations must already be applied. It never migrates, schedules or adds retailer requests to CI. `/dev/ingestion` already reads mixed-retailer runs/listings and requires no change; its production 404 remains covered by Chromium.

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
