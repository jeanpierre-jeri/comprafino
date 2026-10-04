# Public product search and comparison

Milestone 4 implements the first public product experience over persisted data. Implementation and database validation are finished; a fresh local default production build and Chromium E2E confirmation are pending because the agent environment cannot bind Turbopack's CSS worker port. No commit or deployment is claimed.

## Scope and routes

- `/`: static homepage with a labeled GET search form; no database required.
- `/search?q=gloria`: request-rendered, bounded product search.
- `/products/[id]`: request-rendered comparison of an existing verified group. Invalid/unknown/ineligible IDs use Next.js `notFound()` and a public Spanish empty page. Next.js may stream a not-found response with HTTP 200; the not-found UI and framework noindex behavior remain authoritative for streamed responses.

Only existing canonical associations are read. Each displayed group requires at least two distinct retailers with usable ordinary offers. Associations must be automatic, from the current matcher version (1), with confidence at least 0.90. A group containing any manual, obsolete-version or lower-confidence link is excluded entirely. Review decisions are not persisted as public associations; unmatched listings never appear as cross-store equivalents. Search neither runs matching nor writes to PostgreSQL. The matcher is unchanged.

Eligible offers require an active listing, availability other than explicitly false, and an open PEN/UN price-history state. Unknown source availability is allowed; explicit unavailability, inactive listings and missing open prices are excluded. At least two eligible retailers must remain. Thus some saved groups can cease to be publicly comparable without altering their identity associations. There is no arbitrary age-based expiration.

## Search and ranking

`packages/core/src/public-products.ts` reuses `normalizeTitle`, then separates adjacent letters/numbers (946ml → 946 ml), converts punctuation to spaces and collapses whitespace. NFKC, lowercase, accents, brand names, quantities and all identity-bearing variant words survive. No synonyms, translations or accent folding are added; `light`, `zero lacto`, `sin lactosa`, `entera` and `descremada` remain query terms. PostgreSQL applies the corresponding normalization to canonical names, brand keys and associated normalized retailer titles.

Missing/blank/punctuation-only and normalized queries shorter than two characters return no DB results; the UI asks for 2–120 characters. Inputs longer than 120 raw characters are rejected. Repeated `q` parameters are treated as a missing query. Results are limited to twenty, without pagination.

Every distinct query token must match a word prefix in the combined identity text; all-numeric tokens must match whole words. For example, 946 matches 946ml after separation, while 94 does not match 946. Word order does not prevent a result. Trigrams **only rank products that satisfy every token**; typos cannot bypass variant terms. Ranking is lexicographic:

1. Exact normalized canonical title.
2. Normalized canonical title prefix.
3. Exact normalized brand.
4. Highest `public.similarity()` against canonical or associated normalized retailer titles.
5. Display name using PostgreSQL C collation, then product UUID.

SQL is parameterized through Drizzle; query text cannot introduce wildcard or SQL behavior. At 28 saved groups, bounded aggregate queries require no extra index, schema migration or search service. Broader fuzzy recall, autocomplete, taxonomy and synonyms are deferred.

## Database and price boundaries

`packages/db/src/public-products.ts` exports `searchCanonicalProducts(db, query)` and `getCanonicalProductComparison(db, id)`. Each performs one aggregate SQL batch, with joins through canonical associations → retailer listings → open history. There is no per-result price query. Zod validates returned product, retailer, integer-price and timestamp values before presentation. Domain-oriented results include display name, brand, exact quantity/count, sorted offers, representative image, retailer count, minimum ordinary price and all cheapest retailer names. Internal scores/reasons/normalization diagnostics are not returned.

The authoritative price source is `price_history` where `valid_until IS NULL`, using the existing unique-open-state constraint. Listing price mirrors are not substituted. Ordinary ingestion already excludes card/member/quantity teaser discounts. Reference prices survive only when strictly greater than the open current price. Money remains integer PEN cents, formatted by the shared `formatPen` utility as `S/ 6.20`.

Offers sort by current cents ascending, then retailer ID. All offers equal to the minimum are cheapest; the detail UI marks a tie and credits all stores. No invented unique winner, savings percentages or generalized unit-price calculation is presented. Exact structured package size/count provides context while preserving existing canonical names.

Freshness uses `retailer_listings.last_seen_at`, the actual last observation (including unchanged prices), rather than history `valid_from`, which is when the price state began. `<time>` carries the ISO instant; visible dates/times use `es-PE` and `America/Lima`. The UI explains possible location, channel, availability and retailer-update differences. Prices are observed, never called live, guaranteed or real-time. There is no schedule, strict TTL or background refresh job.

Search reads its asynchronous `searchParams` at request time. Product loading calls Next.js 16 `connection()` before database access; the local version-matched docs were consulted. React `cache()` only deduplicates metadata/page reads within one request. No persistent application cache, `use cache`, global dynamic override or separate price store is added. The static homepage remains database-independent.

## Presentation and failures

Responsive search cards and vertically stacked comparison rows work without a wide table. Forms use native GET navigation, labels, a real submit button and visible keyboard focus; results and offers use semantic lists/articles/headings. Retailer links name their source and new-tab behavior, with `noopener noreferrer`. Trusted product links require HTTPS on the corresponding retailer's exact hostname, with no credentials/nonstandard port. Unsafe URLs are omitted.

Images use existing persisted URLs, selected by lexical retailer ID among valid sources independently of prices. `next/image` permits only the observed Tottus, Plaza Vea and Metro image hosts and their required product-image paths, without custom ports or redirect following. VTEX version query strings remain allowed because observed URLs use them. Missing/failed images show a text fallback; no scraping/processing pipeline is added.

No results: **“No encontramos ese producto todavía.”** The UI says zero-result demand helps expand coverage, without promising availability. Valid zero-result searches schedule only a database demand upsert after the response; retailer work occurs later in GitHub Actions. No fabricated alternative/review candidate is shown. Database failures produce a generic public message and fixed safe server logs. Product metadata uses the saved display name. `/dev/ingestion`, `/dev/catalog` and `/dev/matching` remain production-blocked, with their existing browser regression tests retained.

## Real-data verification — October 3, 2026

Read-only PostgreSQL inspection found 28 saved groups / 65 links (19 two-retailer, nine three-retailer groups); all currently satisfy the public query. Five real search queries returned:

| Query          | Results | Representative results                                                           |
| -------------- | ------: | -------------------------------------------------------------------------------- |
| `gloria 946`   |       3 | Whole, Light and Zero Lacto 946 ml three-packs                                   |
| `laive`        |       7 | Salted butter 180/350 g, Parmesan 35 g, lactose-free milk/mixtures               |
| `yogurt`       |       4 | Gloria honey 800 g, Vakimu original/forest-fruit 960 g, Danlac Maracumango 900 g |
| `mantequilla`  |       3 | Gloria salted 180 g and Laive salted 180/350 g                                   |
| `leche gloria` |      12 | Distinct whole/light/Zero Lacto, single/three/six-pack variants                  |

Five comparison **query results** were checked against an independent raw SQL read of open history and retailer listings. Identity titles, structured package sizes, retailer counts, current and reference cents, cheapest/tied retailers, source URLs and actual timestamps all agreed. Listing mirrors also agreed with history in these real rows. Browser-rendered pages could not be opened/verified because no production build was produced; do not confuse this data audit with completed browser validation.

| Product                                     |   Tottus | Plaza Vea |    Metro | Cheapest                 |
| ------------------------------------------- | -------: | --------: | -------: | ------------------------ |
| Gloria Entera UHT, 3 × 946 ml               | S/ 16.10 |  S/ 16.20 | S/ 15.90 | Metro                    |
| Gloria salted butter, 180 g                 | S/ 10.40 |   S/ 9.90 |  S/ 9.50 | Metro                    |
| Laive Light lactose-free mixture, 6 × 480 g | S/ 23.50 |  S/ 23.50 | S/ 24.50 | Plaza Vea and Tottus tie |
| Danlac Maracumango yogurt, 900 g            |  S/ 9.50 |   S/ 9.70 | S/ 10.90 | Tottus                   |
| Laive salted butter, 350 g                  |        — |  S/ 16.90 | S/ 20.90 | Plaza Vea                |

For the whole 946 ml three-pack, Metro's higher reference is S/ 18.00 and Tottus's is S/ 17.90; Plaza Vea has no meaningful reference. Every Laive Light mixture offer has no meaningful reference. The checked offers were observed October 3, 2026 around 17:28–17:29 Peru time (22:28–22:29 UTC). These are persisted observations, not new retailer fetches or price guarantees. Some legacy retailer URL slugs have a different size than their current saved titles; URLs are provenance, not an alternate identity source.

## Validation and local confirmation

Added 22 core unit tests, four database boundary tests and three PostgreSQL integration scenarios. Tests cover query normalization/limits/variants, filtering, deterministic ranking, no SQL injection, open-history authority despite a divergent listing mirror, references, sorting/ties, retailer sources, timestamps, absent products and exclusion of manual/obsolete/low-confidence/unmatched relationships. PostgreSQL fixtures are realistic controlled products and are contained in the existing isolated schema lifecycle, never live retailer data.

All 299 unit tests and 15 isolated PostgreSQL tests pass. Format, lint and strict types pass. Integration execution explicitly injects `TEST_DATABASE_URL`; test code still never loads `.env` or falls back to `DATABASE_URL`. No migration, runtime dependency or ingestion/matcher rule change was needed.

`pnpm build` failed on the known Turbopack CSS-worker port-binding restriction (`Operation not permitted`), including an elevated attempt. `pnpm test:e2e` cannot start `next start` because `.next` has no production build. Build configuration/command remain default Turbopack. Final changes are staged pending fresh local confirmation; no commit is made yet.

Playwright adds missing/blank/short-query and malformed-ID checks to credential-free smoke coverage. Two additional tests opt in when the runner has an explicit `DATABASE_URL`: real homepage → search → comparison (390 px/mobile, values verified against persistence) and no-results/nonexistent-ID states. The existing harness has no isolated database fixture lifecycle; these optional tests use the persisted catalog without website requests or invented pricing. The schema-isolated integration suite provides stable controlled database coverage. To run all eight browser tests locally after building, explicitly pass the same database used by the web server to the test runner:

```sh
pnpm build
# DATABASE_URL already exported, or load root .env explicitly for this local check:
node --env-file=.env --input-type=module -e 'import { spawnSync } from "node:child_process"; const r = spawnSync("pnpm", ["test:e2e"], { stdio: "inherit", env: process.env }); process.exitCode = r.status ?? 1;'
```

Use `PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/browsers"` if reusing the bootstrap Chromium installation. CI without database credentials runs six smoke tests and explicitly skips two persisted-catalog tests. The runner and Next.js must use the same database; point both at a test branch if desired. For the optional catalog flow, the saved Gloria 946 ml groups must exist.

## Limits and next work

This is an intentionally small dairy-focused verified subset, not the entire supermarket catalog. Coverage/recall, source descriptions and stable IDs inherit the conservative offline matcher limitations. Matching/normalization must be rerun after source identity changes. There is no public review queue, manual curation, live matching, unit-price recommendation, promotion engine, history chart, account, alert, scheduled ingestion or analytics. Existing developer tools remain internal.

After local build/browser validation closes Milestone 4, prioritize scheduled conservative ingestion and observation-freshness operations, including failure monitoring and a deliberate normalization/matching refresh policy. Automated freshness is needed before making stronger public freshness promises. Do not start that milestone automatically.

## Milestone 5 operations follow-up

Public search is complete in the current user-provided baseline (`8cd5689`); earlier pending notes above are historical. [Operations](operations.md) now provides offline twice-daily bounded refresh and developer monitoring. Public queries/UI and actual observation timestamps are unchanged. A retailer-level stale message is deferred because a successful bounded attempt does not refresh every retained listing; operational monitoring remains outside the single-batch public query. Last-known-good offers stay visible with their actual timestamps.

## Milestone 6 discovery follow-up

The public search query and canonical eligibility are unchanged. A successful zero-result query meeting the stricter 3–80-character [discovery boundary](discovery.md) schedules a deduplicated demand upsert with Next.js `after`; the response never waits for retailer requests or processing. Existing-result and invalid searches create no demand. `/dev/discovery` adds read-only developer inspection and production-404 smoke coverage. Discovery runs the existing offline matcher and never associates products from query text.

## Milestone 7 observation freshness

[Known listing refresh](listing-refresh.md) adds request-time observation classification: fresh ≤36h, visible stale >36–72h, historical >72h. Only fresh offers whose availability is not false participate in cheapest retailer/ties, result minimum and `Desde`. Missing current best price is represented as null and rendered as `Estamos actualizando este producto.` Existing trusted two-retailer groups retain historical pages, including unavailable members, without treating them as usable current prices. Public reads use actual `last_seen_at`, never derivation timestamps. Earlier two-usable-retailer and last-known-good descriptions above are historical; source/version/confidence, active-row, open-history and price-unit gates remain. No request triggers retailer scraping.
