# Search-driven catalog discovery

Milestone 6 adds bounded demand-driven discovery using PostgreSQL and the existing GitHub Actions infrastructure. No retailer, category crawl, matcher rule, dependency or external service is added. The Milestones 0–5 baseline is complete and deployed according to the developer. The new workflow is local until merged/deployed; this document does not claim its remote activation.

## Public path and privacy

Public search reads only the existing verified canonical catalog. After a successful **zero-result** search, a valid query schedules one database upsert with Next.js `after`, after the response finishes. The normal zero-result page returns immediately. Database demand-recording failure logs a fixed message and does not change the public response. Database search failures never become discovery demand. Existing-result searches never create demand. No retailer fetch, normalization, matching, workflow dispatch, polling or technical status is exposed in public search.

The Spanish copy says missing searches help expand coverage, without guaranteeing a product will appear. Public search's existing 2–120-character boundary remains unchanged; discovery has a stricter boundary.

Only query text and necessary operational metadata are stored: no IP, user identifier, headers, cookies or account information. The first trimmed/collapsed original spelling is retained as a sample. Query text itself can contain personal text entered by a user; there is no claim that queries are inherently anonymous or free of personal information. Commands print selected query text, counts and fixed error summaries, never raw request context, driver exceptions or credentials. No analytics SaaS or retention/deletion UI is introduced.

## Normalization and demand

`packages/core/src/discovery.ts` uses NFKC, trimming, lowercase and whitespace collapse. It preserves accents, punctuation, numbers, brand names and variants; no fuzzy deduplication or search-term identity inference. `Arroz Costeño`, `arroz  costeño` and `ARROZ COSTEÑO` have the same key. `gloria 946` and `gloria 1l` remain distinct.

Discovery requires 3–80 normalized characters, at least three letters/digits and at least one letter. Raw input is capped at 240 characters; runs of 33 whitespace characters and control/format characters are rejected before normalization. Blank, punctuation-only, numeric-only and excessively long inputs create no discovery work. This is validation, not natural-language intent parsing.

Reviewed generated migration `0003_fair_kylun.sql` adds:

- `discovery_queries`: UUID; unique normalized query; original sample; first/last requested timestamps; atomic request count; last attempt/completion; next eligibility; status; latest usable-listing count; fixed safe error summary. Unique identity and one next-eligibility index keep the small table simple. Counts saturate at PostgreSQL's integer maximum rather than overflow.
- `discovery_daily_budget`: UTC date primary key and processed count constrained to 0–30. A separate durable counter is necessary to preserve daily accounting across retries on later days and interrupted processes.

Every valid zero-result request increments demand atomically, including during processing/cooldown. It never resets attempt timestamps, next eligibility or outcome. The table itself is the initial popularity signal.

## Admission, cooldown and priority

Normal processing reserves at most the CLI limit and **30 queries per UTC day**, using database time. UTC days begin at 00:00 UTC / 19:00 Peru on the preceding local date. Limits apply to attempts, including successful empty searches, partial failures, all-retailer failures and interrupted work.

A transactional batch creates the day counter, locks it, then reads the current counter in a separate READ COMMITTED statement before selecting queries and incrementing budget. Concurrent local/workflow processors cannot both claim the same remaining budget. Query rows are locked with `SKIP LOCKED`; claiming sets `processing`, last attempt and next eligibility to 24 hours later before retailer work starts. Millisecond attempt timestamps round-trip through JavaScript; completion is guarded by ID and attempt timestamp so an obsolete processor cannot overwrite a later attempt. Day accounting uses the transaction timestamp consistently, even across midnight.

Eligible queries sort by request count descending, next eligibility ascending, first request ascending, then UUID. Admission therefore prioritizes the most requested missing items, then the oldest eligible demand. Query return/processing order inside an already-admitted batch is not a second priority policy.

Never-attempted queries are eligible immediately. After 24 hours, `failed`, `partial`, `no_results` and interrupted `processing` rows can retry. A successful nonempty `completed` query requires new zero-result demand since its last attempt before becoming eligible again. This avoids perpetual searches for fulfilled demand. Repeated requests increase popularity without shortening cooldown. There is no exponential backoff. An interrupted claim consumes its budget and remains in cooldown until recovery is eligible.

## Retailer searches and bounds

`SearchRetailerAdapter` minimally extends the existing category adapter with `searchProducts(query, limit)`. Output is the same validated `NormalizedRetailerListing`; there is no discovery-only listing model.

| Retailer  | Legitimate public mechanism                                        | Source bound per query                                              | Identity / semantics                                                                                                            |
| --------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Tottus    | `/tottus-pe/buscar?Ntt=…&page=1`; native fetch of `__NEXT_DATA__`  | One page, at most 48 source products, at most 10 usable unique SKUs | `skuId`, separate `productId`; existing internet/normal price parser; conditional prices excluded; availability remains unknown |
| Plaza Vea | `/api/catalog_system/pub/products/search?ft=…&sc=1&_from=0&_to=19` | One page, at most 20 source products, at most 10 usable unique SKUs | `itemId`, separate `productId`; existing available seller-1 ordinary PEN prices; card/quantity teaser prices excluded           |
| Metro     | Same public VTEX path and parameters on `www.metro.pe`             | One page, at most 20 source products, at most 10 usable unique SKUs | Same existing seller-1, availability, price-unit and package semantics                                                          |

VTEX phrases use ordinary URI percent-encoded whitespace (`%20`), rather than form-style `+`; the public endpoints returned HTTP 400 for the latter in live investigation. Empty arrays with zero total are successful empty searches; malformed payloads/ranges and HTTP errors are failures. A larger total is not a reason to fetch another page. Tottus pagination must be page one; explicit empty hydration results are successful empty searches.

All requests are sequential, with an identifying CompraFino user agent, 30-second timeout and no retries or redirect following. At most three retailer search calls occur per admitted query, so the daily cap allows at most 90 calls. No full catalog is crawled. Public endpoints and source payloads were observed with representative rice/oil/detergent queries, including accents and phrases. No browser automation, authentication, CAPTCHA or protection bypass is used.

Search ranking is source-defined. VTEX can return loosely related items; Tottus's `metadata.vectorSearchApplied` can return broad semantic suggestions even for an unknown term. Returned listings are hints, not proof that the requested product exists. Tottus's page/HTML payload is relatively large despite the ten-listing retained bound. Location-specific delivery availability is not established.

## Persistence and outcomes

For each query, all three retailers are attempted independently. Each successful listing batch uses `persistListingsDetailed`, which exposes actual insert counts from the **same atomic ingestion statements** used by `persistListings`. Existing source identities, retailer locks, fresh-observation guards and price-history idempotency remain authoritative. Ordinary unchanged observations may update last-seen timestamps; they do not append unnecessary history or rewrite unchanged derived data. Discovery does not create category-refresh `ingestion_runs`, so a ten-item demand search cannot advance whole-retailer operational freshness.

If any usable listings were persisted, the existing complete-catalog normalization and matching APIs run in order. Matching version, weights, thresholds, compatibility, candidate construction and grouping are unchanged. Query text is never passed as product identity or a canonical association. Only the existing high-confidence cross-retailer groups become public; unmatched listings and review candidates remain nonpublic.

`completed` means all retailers succeeded and usable listings exist; `no_results` means all succeeded with zero usable listings; `partial` means at least one retailer succeeded and at least one failed; `failed` means all retailers failed or downstream derivation failed. Successful empty retailer searches remain distinguishable from errors. Valid retailer results are retained on partial failure. Normalization failure skips matching; already committed listing batches are retained. Failed/partial commands exit nonzero so Actions reports the problem. Errors are allowlisted summaries, not source/driver exception text. A database outage can prevent recording completion; the claimed row and workflow status remain recovery evidence.

The existing complete-catalog 1000-row guard remains. Exceeding it refuses downstream truncation and fails safely; source listings may already have persisted before that guard trips. Deliberately review workload and the bound before ongoing growth reaches it. Discovery freshness for products outside the existing scheduled category scopes is another limitation: their observations are revisited by later eligible discovery demand, not by a new catalog-wide refresh introduced here.

Observed detergent coverage gaps are reserved for a later normalization/matching review: Metro's structured brand normalizes to `bolívar`, while Plaza Vea/Tottus use `bolivar`; strict brand identity keeps those distinct. Variant descriptors also differ. Metro's observed `Twopack … 3L` currently normalizes package count to one, while Plaza Vea's explicit `3L x2un` yields two; the unknown pack syntax must be reviewed before broader unit-price use. Mixed detergent/softener bundles retain unresolved content and diagnostics. No normalization aliases, matcher weights or safety gates were changed to improve discovery recall.

## Commands, scheduling and inspection

```sh
pnpm db:generate
# Review the additive migration before applying it.
pnpm db:migrate
pnpm discover:catalog -- --dry-run --limit=3
pnpm discover:catalog -- --limit=3
pnpm discover:catalog -- --limit=3  # immediate repeat: cooldown prevents retailer work
```

Default batch limit is 10; accepted bounds are 1–30. Unknown/duplicate options fail before database access. Both modes require root `DATABASE_URL` and migrated tables. **Dry-run only previews admission:** no claim, budget update, retailer calls, persistence, normalization or matching. Normal summaries report attempts, existing cooldown rows, retailer calls, usable listings, actual new listing inserts, normalization writes, matching writes and newly created canonical groups. Insert counts are distinct from updated observations and newly opened price states. Cooldown counts describe all stored rows currently in cooldown, not selected/attempted rows.

`.github/workflows/discover-catalog.yml` runs at `43 0,6,12,18 * * *` (00:43, 06:43, 12:43, 18:43 UTC; 19:43 preceding Peru day, 01:43, 07:43, 13:43 Peru). It processes ten queries per run, with the database cap limiting the day to thirty. Manual `workflow_dispatch` shares the same cap. It reuses `DATABASE_URL`, pinned pnpm/Node and frozen installation; it never applies migrations automatically. Its 60-minute timeout bounds slow source/downstream work. It shares refresh's `comprafino-catalog-refresh` concurrency group, with `cancel-in-progress: false`, to prevent overlapping scheduled full-scope pipelines. Database locks remain necessary for independent local/manual invocations. Schedules may be delayed; no per-user workflow is triggered.

`/dev/discovery` is a read-only Server Component, showing the top 100 queries by lifetime demand, the original sample, timestamps, state, latest usable count, cooldown/next eligibility and safe errors. It also shows UTC daily usage. Production returns 404 before database access. No editing or retry buttons are added.

## Validation

Deterministic unit tests cover normalization, input boundaries, zero-result-only demand, safe outcomes, CLI bounds, retailer URL encoding/single-page limits/empty responses/errors, bounded/deduplicated output, success/partial/all failure/no results, derivation order/failure and zero-write downstream results. Four added isolated PostgreSQL tests cover concurrent demand/counts, 24-hour eligibility despite fresh demand, stale completion protection, concurrent daily-cap claims, popularity/age priority, no-write preview and completed-demand dormancy. No unit/integration test contacts a live retailer.

Live validation and final check results are recorded below. Default Turbopack build currently hits the known CSS-worker port-binding restriction (`Operation not permitted`); Chromium E2E cannot start without its production artifact. Build configuration is unchanged. Keep changes staged, without a commit, until the developer confirms fresh local `pnpm build` and `pnpm test:e2e` results. Milestone 6 is pending that gate; do not start proactive expansion automatically.

## Live validation — October 3, 2026 (Peru)

The initial catalog had 352 listings and 28 canonical groups. Every query below was confirmed to have zero results through `searchCanonicalProducts` before recording. Each was recorded twice with different case/spacing: six unique rows, each with request count two. Live commands used the configured Neon database; retailer requests were bounded text searches, without category expansion.

| Query                   | Tottus usable | Plaza Vea usable | Metro usable | New listings | New groups in its attempt | Public results after all discovery |
| ----------------------- | ------------: | ---------------: | -----------: | -----------: | ------------------------: | ---------------------------------: |
| `arroz costeño`         |            10 |           Failed |       Failed |           10 |                         0 |                                  5 |
| `aceite primor`         |            10 |           Failed |       Failed |           10 |                         0 |                                  3 |
| `atún florida`          |            10 |           Failed |       Failed |           10 |                         0 |                                  0 |
| `arroz extra costeño`   |            10 |               10 |           10 |           23 |                         5 |                                  4 |
| `aceite vegetal primor` |            10 |               10 |           10 |           22 |                         3 |                                  3 |
| `detergente bolivar`    |            10 |               10 |           10 |           30 |                         0 |                                  0 |

The first batch exposed the VTEX phrase-encoding issue and exercised genuine partial failure: Tottus results persisted, normalized and retained a `partial` outcome; the command exited nonzero. After standard URI whitespace encoding was corrected and covered by a regression test, three **distinct** pending phrases exercised successful three-retailer processing. No earlier cooldown was reset or bypassed. Initial rice/oil queries became publicly searchable from the later related discovery, while their historical partial outcomes accurately remain recorded.

Totals: six queries recorded/processed; twelve demand requests; eighteen retailer search calls in the processor, including six failed calls; 120 usable listing observations (60 Tottus, 30 Plaza Vea, 30 Metro); **105 actual inserts** (45 Tottus, 30 Plaza Vea, 30 Metro); 105 normalization writes; 27 matching writes (eight products plus nineteen associations); eight new public groups. Final catalog: **457 listings, 457 normalizations, 36 canonical groups**. Investigative source requests are separate from those processor-call counts.

The successful batch read one page per retailer/query: Tottus 48/48/45 source products, and each VTEX retailer twenty products per query. It retained only ten usable unique SKUs each. Fifteen observations reused existing Tottus identities, without extra price-history or normalization writes. The second batch's totals were ninety usable observations, seventy-five actual inserts/normalization writes and eight new groups.

All eight new groups were inspected from persisted member titles, source brands and exact content: five Plaza Vea–Metro rice pairs (extra 750 g/5 kg, añejo extra 750 g/5 kg and integral 750 g), plus three three-retailer Primor oils (Clásico 900 ml/1.8 L and Premium 900 ml). Variants and quantities remain distinct. This inspection does not establish barcode/manufacturer equivalence beyond the existing matcher evidence. Tuna's partial single-retailer discovery and detergent's unmatched listings remain useful catalog data without fabricated public comparisons.

Public API rechecks returned products for `arroz costeño` (5), `aceite primor` (3), `arroz extra costeño` (4) and `aceite vegetal primor` (3). `atún florida` and `detergente bolivar` remain zero. Browser-rendered flows remain pending the build gate; these counts verify persisted public-query availability.

Both immediate repeats passed. The first skipped three cooldown rows; the final repeat skipped six. Final repeat: zero queries processed, zero retailer calls, zero inserts, zero normalization/matching writes, zero new groups; daily usage remained six. Dry-run selected only eligible pending demand and reported zero calls/writes.

Final available checks passed: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, **364 unit tests** (47 added) and **20 isolated PostgreSQL tests** (four discovery scenarios added). The PostgreSQL runner explicitly injected `TEST_DATABASE_URL`; the suite never loads `.env` or falls back to `DATABASE_URL`, and its randomly named schema was torn down. The reviewed additive migration was applied successfully. No dependencies were added. `pnpm build` failed at Turbopack's CSS worker port bind; `pnpm test:e2e` could not start the production web server. Nothing was committed or pushed; local build/E2E confirmation is required before `feat: add search-driven catalog discovery` can be committed.
