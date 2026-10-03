# Metro Peru ingestion proof

Investigated and verified on October 3, 2026 through legitimate anonymous public requests. Milestone 1C is complete in the current task baseline; its pipeline is committed at `20acec9`. The historical agent validation notes below record the worker-port restriction encountered during that milestone.

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

## Live verification

Five real normalized dry-run samples, all PEN, UN and anonymously available. URLs/images were present and used HTTPS; all twenty source-page observations had unique SKU IDs and sensible cents/reference semantics.

| External SKU | Parent product | Title                                                      | Current cents | Reference cents | Package text                                              |
| ------------ | -------------- | ---------------------------------------------------------- | ------------- | --------------- | --------------------------------------------------------- |
| 39233309     | 994699         | Sixpack Leche Reconstituida Gloria Lata 390g               | 2150          | 2460            | Formato: Líquido; Pack-Unitario: Pack                     |
| 39274018     | 1035113        | Tripack Leche UHT Sin Lactosa Gloria Zero Lacto Caja 946ml | 1620          | 1850            | —                                                         |
| 39256390     | 1016805        | Sixpack Leche Light Laive Sin Lactosa Botella 390g         | 2350          | 2590            | —                                                         |
| 39236537     | 997912         | Sixpack Leche Reconstituida Gloria Light Lata 390g         | 2310          | 2580            | Formato: Líquido; Tamaño: Individual; Pack-Unitario: Pack |
| 39170436     | 572685         | Sixpack Leche para Diluir Laive Sin Lactosa Botella 390g   | 2270          | 2495            | —                                                         |

Metro initially had zero listings; Tottus and Plaza Vea each had fifty. Two consecutive exact `pnpm scrape:metro -- --limit=50` runs succeeded:

| Run                                               | Source products | Persisted listings | New price states |
| ------------------------------------------------- | --------------- | ------------------ | ---------------- |
| First (`1c05ec55-6135-4eb5-bdc3-7a17894e9318`)    | 60              | 50                 | 50               |
| Repeated (`db58144b-9ba6-4f95-a702-2123a781173a`) | 60              | 50                 | 0                |

Read-only PostgreSQL checks confirmed both successful run records, fifty Metro listings with fifty unique external IDs, fifty total history states and exactly fifty open states. All fifty stored rows passed current/reference cents, currency and URL checks. This establishes unchanged-run idempotency for this sample; no natural price change occurred between runs. Tottus/Plaza Vea persisted listing counts stayed fifty, and no persisted regression ingestion was performed.

## Three-retailer architecture assessment

| Concern             | Tottus                                 | Plaza Vea                                       | Metro                                                   |
| ------------------- | -------------------------------------- | ----------------------------------------------- | ------------------------------------------------------- |
| Source              | HTML `__NEXT_DATA__` hydration         | Public VTEX catalog JSON                        | VTEX IO storefront; public VTEX catalog JSON            |
| Listing / parent ID | `skuId` / `productId`                  | `itemId` / `productId`                          | `itemId` / `productId`                                  |
| Pagination          | `?page=N`, count/perPage               | Inclusive offsets + `resources`                 | Inclusive offsets + `resources`, observed independently |
| Current / reference | `internetPrice` / higher `normalPrice` | Seller-1 `Price` / higher `ListPrice`           | Seller-1 `Price` / higher `ListPrice`                   |
| Conditional prices  | Excludes CMR price                     | Excludes card/quantity teasers                  | Excludes Metro-card percentage teaser                   |
| Package / unit      | `measurements.format`, KG/UN           | Source presentation, kg/un, KG multiplier       | Labelled specifications, kg/un, KG multiplier           |
| Availability        | Unknown from delivery labels           | Anonymous available offers; unavailable skipped | Anonymous available offers; unavailable skipped         |

The small `RetailerAdapter` contract still fits. All three validate retailer/SKU identity, separate parent identity, exact cents, meaningful price states, source unit and optional source metadata through one normalized listing boundary and persistence path. Fetching/pagination, category selection, seller choice, conditional-price fields and package labels remain retailer-specific. Price-context uncertainty remains explicit; no source establishes universal address-independent pricing.

No abstraction rename, expanded adapter contract, source metadata field or schema change is justified. The existing normalized `priceUnit` already distinguishes quote basis from package text; retaining KG multiplier as raw text matches Plaza Vea and avoids speculative quantity modeling. Metro and Plaza Vea have similar VTEX mechanics, but their category/package/context choices remain isolated rather than adding a configurable scraping framework.

Review found that Tottus parsed `normalPrice` without enforcing the strictly-higher reference invariant. A small correction now omits equal/lower/zero references, with five source-boundary regression cases; ordinary/card selection and existing fixtures remain unchanged. No history is rewritten and no persisted Tottus run was made. A later fresh Tottus ingestion can legitimately create a state when an old invalid reference becomes null.

The ingestion foundation is stable enough to stop adding retailers and move next to catalog normalization after local validation closes this milestone. That work has not begun. Canonical products, matching, promotions, consumer UI and schedules remain out of scope.

## Validation and limitations

Seventeen Metro fixture/adapter tests cover identity, prices/card exclusion, reference invariants, exact cents, weighted products/multiplier, package placeholders, optional fields, SKU variants/sellers, unavailable cases, validation failures, limits, deduplication, pagination/exhaustion/request caps and generic store lifecycle. Five Tottus reference-price regression cases close the consistency gap. Generic PostgreSQL guarantees are reused rather than duplicated.

Format check, type-aware lint, strict typecheck and all 77 unit tests pass. The existing three PostgreSQL integration tests passed with an explicit one-off `TEST_DATABASE_URL` opt-in to the configured connection, creating/dropping only a fresh isolated schema. The suite's environment policy is unchanged. Live twenty-listing dry-runs passed for Tottus (48 source rows), Plaza Vea (20 source products) and Metro (20 source products).

`pnpm build` restored the existing matching Turbo build cache. Both Chromium smoke tests then passed against that production artifact with local-server permission. A fresh `pnpm build --force` was also attempted using the unchanged default Next.js 16.3.8 Turbopack build and elevated execution; it failed at the known CSS-worker port binding restriction (`Operation not permitted`). No webpack fallback or build-config modification was introduced. Fresh local build and subsequent E2E confirmation remain required before commit. The failed fresh build can leave incomplete `.next` output; rebuild locally before starting the app/E2E.

Remaining limitations: one bounded production category; anonymous channel/location context; incomplete/unstructured package metadata; no persisted promotion details; unavailable offers skipped; long-term source/ID stability unproven; strict source drift requires review; existing partial-progress/run-reconciliation limitations. These validation notes describe the historical Milestone 1C agent run. Metro is now committed in the completed Milestone 1 baseline; current catalog validation is documented separately.

## Milestone 2 source metadata follow-up

Catalog normalization now preserves the validated source `brand` string separately from titles. VTEX adapters also retain the positive source sale-unit multiplier as structured metadata; Tottus retains its observed package description/pricing basis. Existing legacy rows remain null in the new columns until ordinary fresh ingestion supplies the values. No guessed brand backfill, retailer refetch or price-history rewrite was performed for the normalization audit. Quantity/count derivation remains a separate core-driven command, not an automatic ingestion hook. See [catalog normalization](../catalog-normalization.md) for trust rules, coverage and ambiguity handling.
