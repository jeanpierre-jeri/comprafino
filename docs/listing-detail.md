# Public retailer-listing details — Milestone 17

`/listings/[id]` answers what happened to one exact retailer listing. Its identifier is the stored listing UUID. `/products/[id]` remains the safe exact cross-retailer comparison destination. A listing never needs a canonical association to have a public page.

## Public boundary and query

`getPublicRetailerListingDetail(db, listingId, { range?, now? })` lives in `packages/db/src/listing-detail.ts`. It validates UUIDs before accessing PostgreSQL, reads one listing plus its latest ordinary state, validates external values with Zod, and reads selected-range history through the shared history query. React contains no SQL. Metadata and page reads share React's request-local cache. No caching service or dependency was added.

Eligibility requires an active listing from a supported retailer, a nonblank source title, a current normalization version and matching input fingerprint, a trusted HTTPS retailer product URL, and a positive latest PEN ordinary state with the listing's supported UN/KG quote unit. Images are optional; untrusted or missing images use the existing fallback. A missing/invalid normalization, inactive listing, unsafe URL, unsupported/zero-price state, unknown UUID or malformed ID produces the same public-safe not-found presentation. Internal fingerprints, matching reasons, review status and raw ingestion payloads are omitted from the public result. Database failures use the existing public data-error presentation.

Pages show source identity/image, safely normalized brand and package information, retailer, ordinary/reference price, supported unit price, observation time in Peru, availability/freshness, separate CMR benefits, add-to-list, history, safe canonical comparison when available, and the original retailer link. Buying information precedes history. Titles use the source product name plus “precio e historial | CompraFino”; descriptions describe this retailer's observed history.

## Current buying information

An ordinary price is current only when its state remains open, the existing freshness policy says fresh, and the listing is not explicitly unavailable. Stale/unavailable records say “Último precio registrado” and disclose that they do not confirm today's buying price. A closed latest state or an observation older than the existing 72-hour historical threshold is explicitly historical. The displayed timestamp is always the listing's actual recorded observation, never a synthesized state interval endpoint. A reference price appears only when greater than the ordinary amount.

CMR uses the existing current-offer validity/program boundary and appears only alongside an eligible current ordinary price. Its program requirement remains visible. CMR never enters ordinary history, metrics or chart data. The detail's unit price always uses ordinary cents, regardless of search benefits mode.

Quantity/quality comes from the existing normalizer, family classifier and unit-price calculator: mass in S/kg, volume in S/L, count in S/unit, approximate paper-roll evidence labelled orientativo, and unsafe tuna/mixed quantities withheld. KG source quotes remain explicitly per kilogram. A number in a title does not establish a safe quantity.

## History and association

Both routes share `getScopedPriceHistory`, range parsing, `summarizePriceHistory`, durable `listing_observation_days`, `PriceHistoryPresentation`, chart tokens, tooltip and empty states. Listing detail supplies exactly one retailer series. The URL supports `range=7d`, `30d`, `90d`, defaulting to 7d. Range links retain normal browser back/forward behavior.

Ordinary states and immediate predecessors come from `price_history`, never conditional offers. No interpolation, daily fabrication, backfill or new history model exists. Only consecutive verified observation days support bounded step paths. Missing observation dates and unsupported state intervals break paths; pre-coverage states remain conservative points. Existing sparse/empty messages remain unchanged. Selected-range observed minimum/maximum, last ordinary change, change count and verified unchanged streak all reuse existing semantics. Sparse change history can still have verified unchanged segments; it must not be equated with missing observation coverage.

“Comparar este producto entre supermercados” appears only when the existing public canonical eligibility CTE admits the association: current matching version, automatic method, confidence at least 0.90, at least two usable retailer offers, and no manual/obsolete/below-threshold association anywhere in the group. Matching and ranking are unchanged. Review-only/unmatched identity never creates cross-retailer claims.

## Search, list and navigation

All independent cards under “Opciones en supermercados”, including cards with safe canonical associations, now open their listing UUID route from the existing stretched title link. Exact canonical cards keep `/products/[id]`. The separate comparison link on an associated retailer card remains useful. The external retailer CTA opens the trusted source in a new tab and remains separate from card navigation.

The detail uses `shoppingSeedForRetailerOffer` and `AddShoppingItem`; no intent rules are copied. Safe canonical listings retain preferred/strict flows. Other listings use existing conservative generic saving/withholding policies. Add controls and source/comparison links retain their separate interactive layers from Milestone 15.1.

The shared pending NavigationLink and route-level listing loading skeleton provide immediate feedback. Layout and chart reuse existing responsive styles and theme tokens. Chromium tests cover delayed navigation, back/forward, independent/associated cases, add controls, source URLs, ordinary/CMR separation, sparse/multi-state history, ranges, streaks/gaps, and 390px/1440px light/dark screenshots. Chromium suites and 390px/1440px light/dark screenshot review pass against the supplied local production build. The earlier sandbox restriction is recorded as historical.

## Validation and real audit

See [Milestone 17 validation](milestone-17-validation.md) and the [public catalog audit](listing-detail-audit.json). The read-only audit script reuses the production eligibility projection and history summaries. Run it with:

```sh
node --env-file-if-exists=.env --experimental-strip-types packages/db/src/listing-detail-audit-cli.ts
```

The audit is capped at 1000 catalog candidates; it fails instead of silently truncating. Its aggregate history query is used only by the CLI. Public detail queries scope history to one UUID.

## Limitations

History depth depends on real observations already collected. Unknown stock does not imply confirmed availability. Current status can expire between requests. A closed state endpoint describes its stored lifecycle rather than proving when the retailer changed its price. There are no recommendations, other-product carousels, accounts, alerts or inferred equivalences. Not-found responses streamed after a loading boundary follow Next.js semantics: the public not-found UI/noindex may accompany HTTP 200 after headers have streamed.

Milestone 17 is complete after local production build, Chromium fixture/regression runs and desktop/mobile light/dark visual verification. No next milestone or temporal recommendation work has begun.

## Milestone 18 evidence integration

The detail layout remains unchanged. Availability-only exact negatives preserve the last ordinary state and its history; existing unavailable/last-registered-price copy stays accessible. Stronger negative evidence persists through unknown quotes, and newer explicit source-positive recovery restores current buying information. Added isolated fixture regression covers unavailable search exclusion and retained detail/history, plus recovered search/detail. PostgreSQL fixtures and all eight isolated listing Chromium cases pass against the successful local production build. The new scenario scopes unavailable copy to the current-price panel because the same status is also shown in history. See [availability](availability.md).
