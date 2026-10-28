# Generic comparison

Current domain guidance. Dated audits, measurements and acceptance narratives are preserved in [engineering history](history/engineering-notes-2026-10-05.md).

## Exact identity and generic options

The public route uses `searchGroupedPublicProducts`: a single product grid groups current filtered offers by the canonical UUID admitted by the existing automatic/current-version/≥0.90 association and whole-group safety rules. Unconfirmed listings remain independent, including identical titles. `searchPublicProducts` keeps its separate internal comparison/offer contract for audits. Product detail and deterministic matching remain unchanged.

Cards retain full variant titles, presentation, ordinary “Desde” price, valid unit price, current filtered supermarket coverage and “Comparar precios”. Confirmed groups open their shared comparison; independent products open their listing detail and keep trusted source links. Ordinary and conditional minima, all ties and stock evidence come from eligible members, never name similarity. The product and store-offer totals are separate. See [confirmed product cards](public-search.md#confirmed-product-cards).

## Unit-price model

Core's `calculateUnitPrice` returns either an exact bigint numerator/denominator in PEN cents per display unit, with a dimension, or a fixed unavailable reason. Cross multiplication orders fractions without floating-point arithmetic. Display rounds half-up to two currency decimals using integer arithmetic.

| Dimension | Stored quantity | Display | Packaged UN calculation          |
| --------- | --------------- | ------- | -------------------------------- |
| Mass      | integer g       | kg      | cents × 1000 / total grams       |
| Volume    | integer ml      | L       | cents × 1000 / total millilitres |
| Count     | integer unit    | unidad  | cents / total contained units    |

500 g at S/ 3.90 gives S/ 7.80/kg. 1.5 L at S/ 12.00 gives S/ 8.00/L. Thirty eggs at S/ 17.90 give S/ 0.60/huevo for display when a strong contained-item basis and egg family are established, but sorting uses 1790/30 cents. Two rounded prices can tie visually without being equal mathematically.

KG source quotes are already cents per kg and use denominator one. Package descriptions, variable weight and approximate mass do not cause a second division. The public total-price view labels and separates these quotes from package totals; it never calls the quote the cost of an unspecified package. UN is the price of the whole sale offering, not necessarily one egg/can. A reliable count of one is necessary before interpreting an UN price as a contained-unit price.

Multipacks use normalized **total** content: 6 × 390 g = 2340 g and 3 × 946 ml = 2838 ml. Egg trays of 15/30 use per-item count quantity 15/30 and package count one. Explicit count multipacks without unambiguous per-item allocation remain unavailable; a separately validated total count can be calculated.

## Ambiguity and eligibility

Invalid money, nonpositive/noninteger quantities, absent total quantities, diagnostics, mixed bundles and unresolved pack wording never produce unit prices. Missing unit price does not exclude an otherwise usable listing. Independent cards and listing detail explain existing unavailable reasons without inferring quantities. Other contained items retain “/ unidad”; direct KG quotes retain their source label. Unknown `*pack` words (observed `Twopack`) are withheld despite the legacy normalizer's count-one default; recognized Tripack/Fourpack/Sixpack and Doypack syntax retain existing behavior. This safeguard does not rewrite normalization or canonical identity. No source multiplier becomes a package count.

Generic public offers require an active normalized listing, current normalization version and matching raw-input SHA-256 fingerprint, valid nonblank title, trusted corresponding retailer HTTPS URL, open PEN price state with matching KG/UN basis, availability other than false and a successful observation at most 36 hours old and not in the future. Zod validates database values before presentation; quantities are recomputed from validated fingerprint-consistent inputs by the existing pure normalizer. No review/matching decision is required to present an independent offer.

Prices come from open history, not listing mirrors. Card/loyalty/quantity teasers remain excluded by existing ingestion. Freshness uses actual `last_seen_at`, never normalization, association or price-state creation timestamps. Generic stale/unavailable offers are excluded entirely. Exact pages keep Milestone 7 historical labels and exclude stale/unavailable prices from cheapest/Desde.

## Search, sorting and bounds

The database boundary joins normalized listings, retailers and current history, with optional existing eligible canonical metadata in one query. Token admission and PostgreSQL `pg_trgm` relevance ranking reuse exact search's Unicode/prefix/numeric semantics. All terms must occur; numeric tokens match whole words. No SQL resides in React components, and no per-offer queries run.

Relevance remains the default. Native GET controls use `sort=relevance`, `sort=total-price`, or `sort=unit-price`; invalid/repeated parameters fall back to relevance. Generic sorting does not alter canonical ranking. Total price orders package cents, then a separately labelled direct-KG block. Unit price orders **only within** kg, litre and contained-unit blocks, followed by unavailable calculations. Blocks are not a cross-dimension cheapest ranking.

Every admitted candidate is validated and filtered before grouping, sorting and pagination. Thirty product cards are selected per page; all eligible members contribute to each selected group. The complete-candidate guard uses `catalogPolicy.retainedListingCap` and its overflow sentinel; exceeding it produces a search error rather than partial minima or totals. In unit mode, each present block first receives an equal bounded quota; spare capacity is filled in ordered sequence. Later pages exclude first-page selections. Ties retain deterministic relevance order. No schema, migration or additional query is needed for grouping.

Public discovery receives the unfiltered eligible store-offer count before grouping and pagination. Generic-only success creates no zero-result demand. Invalid queries and database errors do not create demand; true empty successful searches retain the existing after-response upsert. Public requests never call retailers or run matching.

The [October 28 search/list transfer study](history/search-shopping-transfer-2026-10-28.md) measures complete search scopes at 1,000/10,000/50,000 listings. The [partial release candidate](history/partial-transfer-release-2026-10-28.md) keeps the original `e83e843` search reader and nested listing objects. Only shopping snapshots use compact tuples. The search compact transport and all its benchmarks are preserved in a separate local worktree; they are excluded from this candidate. Local JSON bytes are distinct from Neon billed transfer.
