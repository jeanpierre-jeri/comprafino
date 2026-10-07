# Conditional pricing

Concrete current benefits are separate from ordinary prices and [ordinary history](price-history.md). Tottus CMR extraction is implemented; unsupported marketing teasers remain excluded. Dated acceptance is preserved in [engineering history](history/engineering-notes-2026-10-05.md#original-docsconditional-pricingmd). Accounts and conditional history remain deferred.

## Ordinary and conditional prices

`currentPriceCents` remains the ordinary anonymous-context quote. Only a strictly higher ordinary reference is retained. A benefit is a separate concrete payable amount requiring an additional condition. It never substitutes for ordinary price-history rows or changes matching/normalization identity.

For a dated October 4, 2026 example, observed Tottus Gloria whole milk six-pack SKU `129087925` has ordinary **S/ 21.90**, reference **S/ 24.60**, and **S/ 20.90 with CMR**. These are three different facts. Prices depend on source/channel/location and do not guarantee availability at a selected address.

## Evidence and retailer support

The [sanitized audit](history/conditional-source-audit.json) contains October 4, 2026 anonymous public observations. Native fetch used the identifying CompraFino user agent, no cookies, credentials or selected location, sequential bounded requests and no access-control bypass. Public sources:

- [Tottus dairy hydration](https://www.tottus.com.pe/tottus-pe/lista/CATG16061/Lacteos?page=1): `props.pageProps.results[].prices[]`. `internetPrice` is ordinary, `normalPrice` is reference, and an uncrossed `cmrPrice` accompanied by `icons=cmr-icon` supplies a concrete CMR amount. Seven products on one page established consistent program identity. The price entry exposes no validity timestamps or offer-specific minimum quantity. `measurements.minUnits=1` describes the sale offering, not a benefit requirement. Second-unit campaign badges/promotions without a payable amount are not interpreted.
- [Plaza Vea public channel-1 catalog](https://www.plazavea.com.pe/api/catalog_system/pub/products/search?ft=leche&sc=1&_from=0&_to=19): seller-1 `commertialOffer.PromotionTeasers` has `Conditions.MinimumQuantity`, `PaymentMethodId`, and `Effects.Parameters` such as `PromotionalPriceTableItemsIds/Discount`. Gloria SKU `11359692` has ordinary S/ 21.50, reference S/ 24.60 and a 4.10 discount teaser. Payment sets differ (`208,202,210`, `210`, or `4`); hidden Lurín campaigns appear alongside public campaigns. These do not establish one reliable generally payable price or stable consumer program eligibility. No S/ 17.40 benefit is inferred. Teasers remain excluded.
- [Metro public dairy channel-1 catalog](https://www.metro.pe/api/catalog_system/pub/products/search?fq=C:/1001436/&sc=1&_from=0&_to=19): seller-1 teaser advertises a 5% Metro-card campaign, `PaymentMethodId=3,1,4,2`, explicit BIN restrictions and `MinimumQuantity=0`. Gloria SKU `39233309` has ordinary S/ 21.50 and reference S/ 24.60. The label mentions October 1–31, but no structured validity window or concrete payable amount is supplied. No rounding, stacking, location or checkout eligibility is assumed; percentages remain excluded.

All three returned legitimate anonymous public data. Tottus also exposed products with no benefit; Plaza Vea Laive SKU `11359044` had no teasers, and Metro's bounded text-search examples included no teasers. No trustworthy loyalty/Bonus, minimum-quantity or multibuy payable amount was established. Marketing-only online labels do not become conditional prices; an ordinary online reduction remains ordinary.

Supported now: **concrete conditional payment-card price**, stable program key **`cmr`**, adjacent consumer label **“Requiere tarjeta CMR”**. Other programs/types are deliberately not added without evidence. Source fixture mutations test malformed/missing/ambiguous identity and amount, duplicate prices, crossed prices, zero prices and non-lower prices. Such benefits are rejected while preserving a valid ordinary observation.

## Persistence and freshness

Reviewed generated Drizzle migration `0005_redundant_deadpool.sql` adds `retailer_listing_offers` with listing foreign key, unique listing/program identity, condition type/label, positive integer PEN cents, observed state timestamp and optional structured validity window. PEN and the listing's KG/UN quote basis are inherited; no currency conversion or package-total inference occurs. Current state only is stored. No conditional history series is built.

The existing retailer lock and ingestion transaction synchronize offers only for accepted fresh listing updates. A current benefit is inserted, a changed benefit updates its row, and absent/malformed benefit data removes the former benefit. Equal/older listing replays cannot insert/update/delete offers. Unseen products and failed acquisitions retain prior observations, subject to the freshness gate. Offer synchronization rolls back with ordinary listing/history failures.

Unchanged offers do **not** rewrite their row: `observed_at` records when that state was first observed. Every accepted newer listing observation atomically rechecks all its benefits, so public offer `observedAt` uses the listing's `last_seen_at` as verification time. This avoids a second freshness-only write. This invariant depends on every writer using shared ingestion; manual SQL or old deployed ingestion code must not be used after migration. Deploy ingestion and readers together.

Only offers verified within **36 hours**, not in the future, available on the listing, within any structured start/end window, participate or display as current benefits. Expiration is exclusive at the end instant. Exact stale ordinary rows retain existing labels; their benefits disappear. No end dates are fabricated from campaign prose. Later conditional history may append changes to a separate series without rewriting ordinary `price_history`.

## Ranking and presentation

Default `priceMode=standard` (omitted in clean URLs) ranks ordinary prices. Exact `lowestPriceCents` and ordinary cheapest-retailer fields always remain ordinary, including in benefits mode. A separate `bestRanking` contains the chosen potential amount, tied retailers and required conditions; `lowestBenefit` describes the best fresh conditional offer independently.

`priceMode=benefits` opts into **potential** benefits, not ownership of every card. It uses the lower applicable concrete amount for generic total/unit sorting and exact card minimum presentation. Conditions/program identity remain attached; ties are retained, and a benefit equal to the ordinary amount adds no requirement. Stale, unavailable, expired/future and higher benefits never beat ordinary prices.

Search cards keep the ordinary amount visible and show “Con CMR: S/ …” with “Requiere tarjeta CMR” beside it. The ordinary unit-price reference remains ordinary in both modes; each CMR block also shows its own price per kg, litre, unit or roll when quantity evidence permits, explicitly labeled “con CMR”. Benefits-mode sorting still uses the conditional unit price. Direct KG quotes already include `/ kg` in their amount and do not duplicate that reference. Missing/ambiguous quantity semantics remain withheld, and approximate roll prices retain “orientativo”. Detail rows distinguish ordinary online price, crossed reference and conditional block. The detail hero keeps “Mejor precio para todos” primary and places an existing lower CMR benefit beside its requirement in both modes. The URL benefits preference still selects potential ranking; it never replaces the ordinary amount. URL preference never writes an account, cookie or personal card profile.

See [search UX](search-ux.md) for immediate URL filtering and [validation](history/milestone-11-validation.md) for measured checks and remaining gates.

## Limitations

No promotion engine for 2x1/3x2, second-unit arithmetic, quantities, bundles, coupons, bank weekdays, percentage discount stacking or inferred card/loyalty programs. No new retailer, source category, dependency, queue, cache, analytics or other infrastructure. Anonymous context/location uncertainty remains.
