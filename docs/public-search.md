# Public product search and comparison

Current domain guidance. Dated audits, measurements and acceptance narratives are preserved in [engineering history](history/engineering-notes-2026-10-05.md).

## Scope and routes

- `/`: static homepage with a labeled GET search form; no database required.
- `/search?q=gloria`: request-rendered, bounded product search.
- `/products/[id]`: request-rendered comparison of an existing verified group. Invalid/unknown/ineligible IDs use Next.js `notFound()` and a public Spanish empty page. Next.js may stream a not-found response with HTTP 200; the not-found UI and framework noindex behavior remain authoritative for streamed responses.

Only existing canonical associations are read. Each displayed group requires at least two distinct retailers with active listings, normalizations and positive open ordinary PEN/UN states. Associations must be automatic, from the current matcher version (1), with confidence at least 0.90. A group containing any manual, obsolete-version or lower-confidence link is excluded entirely. Review decisions are not persisted as public associations; unmatched listings never appear as cross-store equivalents. Search never runs matching; a true empty search can record discovery demand after the response. The matcher is unchanged.

Exact comparisons retain stale and explicitly unavailable records for context. `retailerCount` counts those retained stores; `currentOfferCount` separately counts positive ordinary offers observed within the inclusive 36-hour freshness window, not in the future, with availability other than false. Only those current offers contribute to “Desde” and cheapest-store ranking. Unknown availability is disclosed and never interpreted as confirmed stock. Zero current offers leave the group/detail accessible with an updating message. Inactive listings and missing open price states are excluded; at least two retained retailers are required. Independent generic offers enforce freshness and availability before presentation. See [generic comparison](generic-comparison.md).

## Search and ranking

`packages/core/src/public-products.ts` reuses `normalizeTitle`, then separates adjacent letters/numbers (946ml → 946 ml), converts punctuation to spaces and collapses whitespace. NFKC, lowercase, accents, brand names, quantities and all identity-bearing variant words survive. No synonyms, translations or accent folding are added; `light`, `zero lacto`, `sin lactosa`, `entera` and `descremada` remain query terms. PostgreSQL applies the corresponding normalization to canonical names, brand keys and associated normalized retailer titles.

Missing/blank/punctuation-only and normalized queries shorter than two characters return no DB results; the UI asks for 2–120 characters. Inputs longer than 120 raw characters are rejected. Repeated `q` parameters are treated as a missing query. Results are limited to twenty, without pagination.

Every distinct query token must match a word prefix in the combined identity text; all-numeric tokens must match whole words. For example, 946 matches 946ml after separation, while 94 does not match 946. Word order does not prevent a result. Trigrams **only rank products that satisfy every token**; typos cannot bypass variant terms. Ranking is lexicographic:

1. Exact normalized canonical title.
2. Normalized canonical title prefix.
3. Exact normalized brand.
4. Highest `public.similarity()` against canonical or associated normalized retailer titles.
5. Display name using PostgreSQL C collation, then product UUID.

SQL is parameterized through Drizzle; query text cannot introduce wildcard or SQL behavior. The current bounded aggregate search uses the existing schema and requires no additional search service. Broader fuzzy recall, autocomplete, taxonomy and synonyms are deferred.

## Database and price boundaries

`packages/db/src/public-products.ts` exports `searchCanonicalProducts(db, query)` and `getCanonicalProductComparison(db, id)`. Each performs one aggregate SQL batch, with joins through canonical associations → retailer listings → open history. There is no per-result price query. Zod validates returned product, retailer, integer-price and timestamp values before presentation. Domain-oriented results include display name, brand, exact quantity/count, sorted offers, representative image, retailer count, minimum ordinary price and all cheapest retailer names. Internal scores/reasons/normalization diagnostics are not returned.

The authoritative price source is `price_history` where `valid_until IS NULL`, using the existing unique-open-state constraint. Listing price mirrors are not substituted. Ordinary ingestion already excludes card/member/quantity teaser discounts. Reference prices survive only when strictly greater than the open current price. Money remains integer PEN cents, formatted by the shared `formatPen` utility as `S/ 6.20`.

Offers sort by current cents ascending, then retailer ID. All fresh, not-explicitly-unavailable offers equal to the minimum are cheapest; the detail UI marks a tie and credits all stores. No invented unique winner or savings percentages are presented. Supported unit references use the existing conservative quantity and freshness calculation. Exact structured package size/count provides context while preserving existing canonical names.

Freshness uses `retailer_listings.last_seen_at`, the actual last observation (including unchanged prices), rather than history `valid_from`, which is when the price state began. `<time>` carries the ISO instant; visible dates/times use `es-PE` and `America/Lima`. The UI explains possible location, channel, availability and retailer-update differences. Prices are observed, never called live, guaranteed or real-time. There is no schedule, strict TTL or background refresh job.

Search reads its asynchronous `searchParams` at request time. Product loading calls Next.js 16 `connection()` before database access; the local version-matched docs were consulted. React `cache()` only deduplicates metadata/page reads within one request. No persistent application cache, `use cache`, global dynamic override or separate price store is added. The static homepage remains database-independent.

## Presentation and failures

Responsive search cards and vertically stacked comparison rows work without a wide table. Forms use native GET navigation, labels, a real submit button and visible keyboard focus; results and offers use semantic lists/articles/headings. Retailer links name their source and new-tab behavior, with `noopener noreferrer`. Trusted product links require HTTPS on the corresponding retailer's exact hostname, with no credentials/nonstandard port. Unsafe URLs are omitted.

Images use existing persisted URLs, selected by lexical retailer ID among valid sources independently of prices. `next/image` permits only the observed Tottus, Plaza Vea and Metro image hosts and their required product-image paths, without custom ports or redirect following. VTEX version query strings remain allowed because observed URLs use them. Missing/failed images show a text fallback; no scraping/processing pipeline is added.

No results: **“No encontramos ese producto todavía.”** The UI says zero-result demand helps expand coverage, without promising availability. Valid zero-result searches schedule only a database demand upsert after the response; retailer work occurs later in GitHub Actions. No fabricated alternative/review candidate is shown. Database failures produce a generic public message and fixed safe server logs. Product metadata uses the saved display name. `/dev/ingestion`, `/dev/catalog` and `/dev/matching` remain production-blocked, with their existing browser regression tests retained.

## Limits

Coverage is a bounded grocery/household subset, not the whole supermarket catalog. Source descriptions and stable IDs inherit conservative matcher limitations. Rerun normalization and matching after source identity changes; stale automatic claims remain withheld. Generic relevance, exact identity and safe substitution are separate. Accounts and shopping-list recommendations have separate owners; see [authentication](auth.md) and [shopping lists](shopping-list.md). Alerts remain deferred. Scheduled acquisition and ordinary history are implemented by separate owners.

## Positive ordinary purchasing prices (Cleanup A)

An ordinary payable quote must be a positive integer PEN-cent amount. Source listing validation (including Tottus category/search/PDP normalization) rejects zero before ingestion. Existing zero states are withheld by current exact/generic SQL projections and public mapping/ranking, shopping fulfillment and basket approval/optimization. A zero ordinary quote cannot become a current/free winner, even in benefits mode. Valid positive ordinary quotes and reference/conditional price semantics are unchanged. Historical price tables and their nonnegative constraints remain unchanged; historical states are not rewritten.
