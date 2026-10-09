# Search-driven catalog discovery

Current domain guidance. Dated audits, measurements and acceptance narratives are preserved in [engineering history](history/engineering-notes-2026-10-05.md).

## Public path and privacy

Public search reads only the existing verified canonical catalog. After a successful **zero-result** search, a valid query schedules one database upsert with Next.js `after`, after the response finishes. The normal zero-result page returns immediately. Database demand-recording failure logs a fixed message and does not change the public response. Database search failures never become discovery demand. Existing-result searches never create demand. No retailer fetch, normalization, matching, workflow dispatch, polling or technical status is exposed in public search.

The Spanish copy says missing searches help expand coverage, without guaranteeing a product will appear. Public search's existing 2–120-character boundary remains unchanged; discovery has a stricter boundary.

Only query text and necessary operational metadata are stored: no IP, user identifier, headers, cookies or account information. The first trimmed/collapsed original spelling is retained as a sample. Query text itself can contain personal text entered by a user; there is no claim that queries are inherently anonymous or free of personal information. Commands print selected query text, counts and fixed error summaries, never raw request context, driver exceptions or credentials. No analytics SaaS or retention/deletion UI is introduced.

## Normalization and demand

`packages/core/src/discovery.ts` uses NFKC, trimming, lowercase and whitespace collapse. It preserves accents, punctuation, numbers, brand names and variants; no fuzzy deduplication or search-term identity inference. `Arroz Costeño`, `arroz  costeño` and `ARROZ COSTEÑO` have the same key. `gloria 946` and `gloria 1l` remain distinct.

Discovery requires 3–80 normalized characters, at least three letters/digits and at least one letter. Raw input is capped at 240 characters and its trimmed/collapsed original sample at 120 characters; runs of 33 whitespace characters and control/format characters are rejected before normalization. Blank, punctuation-only, numeric-only and excessively long inputs create no discovery work. This is validation, not natural-language intent parsing.

Reviewed generated migration `0003_fair_kylun.sql` adds:

- `discovery_queries`: UUID; unique normalized query; original sample; first/last requested timestamps; atomic request count; last attempt/completion; next eligibility; status; latest usable-listing count; fixed safe error summary. Unique identity and one next-eligibility index keep the small table simple. Counts saturate at PostgreSQL's integer maximum rather than overflow.
- `discovery_daily_budget`: UTC date primary key and processed count constrained to 0–30. A separate durable counter is necessary to preserve daily accounting across retries on later days and interrupted processes.

Every admitted valid zero-result request increments demand atomically, including during processing/cooldown. It never resets attempt timestamps, next eligibility or outcome. The table itself is the initial popularity signal. Admission retains at most **3,000 distinct demand rows**: approximately 100 current daily processing budgets, deliberately generous for recurring/popular work while bounding indefinite distinct-query storage. A schema-local advisory lock and a subsequent READ COMMITTED statement serialize count/admission across requests. At capacity existing keys still increment; new distinct demand returns false without changing the public empty-search response. Older installations above this bound do not admit new keys until cleanup frees capacity.

Normal scheduled discovery runs remove at most **100 inactive rows** before claiming work, oldest request then UUID, after **30 days without demand** and after cooldown. A month covers multiple weekly recurring searches and exceeds retry/cooldown by a wide margin; abandoned pending demand, fulfilled demand and inactive failed/empty outcomes have the same inactivity lifecycle. Cleanup locks candidates with `SKIP LOCKED`, never removes `processing` claims (including interrupted claims), and detaches acquisition foreign keys before deleting rows atomically. Listing/history/first-acquisition source remain; the expired query's text, count and query-specific coverage attribution are removed. No aggregate containing unnecessary raw text is retained. Existing daily budget counters remain independent.

Cleanup is safe to rerun, bounded per scheduled invocation and logs only an operation name and removed count. Dry-run does not clean up. Retention is scheduled best effort rather than an exact deletion deadline; scheduler outages, backlog, cooldown and interrupted processing can extend retention. Interrupted claims use the existing 24-hour recovery policy before their eventual completed/inactive cleanup. No account, IP tracking, fingerprinting or rate-limit service is added. Existing schema columns suffice; no migration is needed.

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

All requests are sequential, with an identifying CompraFino user agent, 30-second timeout and no retries or redirect following. At most four retailer search calls occur per admitted query, so the daily cap allows at most 120 calls. No full catalog is crawled. Public endpoints and source payloads were observed with representative rice/oil/detergent queries, including accents and phrases. No browser automation, authentication, CAPTCHA or protection bypass is used.

Search acquisition now prioritizes listings containing every normalized query term in the title or structured source brand **before** applying the ten-SKU limit to the parsed source page. Stable ordering retains source rank within matching/nonmatching tiers. Discovery persists only listings that satisfy those terms, using the public search word-prefix and exact-number semantics; accents, quantities and variant terms remain required. Broad suggestions cannot consume admission slots or establish coverage for a different requested brand. This is acquisition relevance, never canonical identity evidence. No extra pages or retailer requests are added.

Search ranking within each tier is source-defined. VTEX can return loosely related items; Tottus's `metadata.vectorSearchApplied` can return broad semantic suggestions even for an unknown term. Returned listings are hints, not proof that the requested product exists. Tottus's page/HTML payload is relatively large despite the ten-listing retained bound. Location-specific delivery availability is not established.

## Persistence and outcomes

Completion accepts at most **40 usable listings per query**: ten for each of the four registered retailers. The outcome validator and PostgreSQL `discovery_counts` constraint share that bound, independently of the unchanged 30-query daily budget. Existing databases require [migration 0012](../packages/db/migrations/0012_chilly_thunderbolt_ross.sql), which raises the former 30-listing constraint, before running the updated processor; review it and apply with `pnpm db:migrate`. A completion failure retains already committed listings and leaves the claim in `processing` until its existing 24-hour recovery window permits another attempt.

For each query, all four retailers are attempted independently. Each successful listing batch uses `persistListingsDetailed`, which exposes actual insert counts from the **same atomic ingestion statements** used by `persistListings`. Existing source identities, retailer locks, fresh-observation guards and price-history idempotency remain authoritative. Ordinary unchanged observations may update last-seen timestamps; they do not append unnecessary history or rewrite unchanged derived data. Discovery does not create category-refresh `ingestion_runs`, so a ten-item demand search cannot advance whole-retailer operational freshness.

If any usable listings were persisted, the existing complete-catalog normalization and matching APIs run in order. Matching version, weights, thresholds, compatibility, candidate construction and grouping are unchanged. Query text is never passed as product identity or a canonical association. Only the existing high-confidence cross-retailer groups become public; unmatched listings and review candidates remain nonpublic.

`completed` means all retailers succeeded and usable listings exist; `no_results` means all succeeded with zero usable listings; `partial` means at least one retailer succeeded and at least one failed; `failed` means all retailers failed or downstream derivation failed. Successful empty retailer searches remain distinguishable from errors. Valid retailer results are retained on partial failure. Normalization failure skips matching; already committed listing batches are retained. Failed/partial commands exit nonzero so Actions reports the problem. Errors are allowlisted summaries, not source/driver exception text. A database outage can prevent recording completion; the claimed row and workflow status remain recovery evidence.

The existing complete-catalog 2000-row guard remains. Ingestion serializes admission under the shared catalog lock, updates all known identities, and admits only new identities that fit, in the relevance-filtered batch order. Excess new identities are skipped before any listing, offer, observation-day or history writes. Discovery reports `skippedByCapacity` per retailer, query and run; usable listing/result counts exclude these skips. Capacity skips alone are a completed attempt, including when no rows fit, and do not fail the workflow. Normalization and matching run only when at least one identity was accepted; real source, persistence and derivation failures retain their failure status. An already oversized catalog still refuses downstream truncation. At a full catalog, relevance priority cannot admit new identities: existing listings and history are not evicted and the cap is not raised. Review workload before expanding the bound. Milestone 7 adds bounded exact lookups for known listings outside the existing category scopes; their freshness no longer depends on repeated discovery demand. It does not expand category coverage.

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

## Milestone 8 combined-result admission

Public search now reads verified exact groups plus independent eligible generic retailer offers. The combined count is passed to discovery admission and recording; generic-only results do not create demand. True combined empty searches retain after-response recording. Existing query validation, cooldown/budget and offline discovery processing are unchanged. Generic offers require no association because they make no identity-equivalence claim; only the exact view requires matching. See [generic comparison](generic-comparison.md) for measured keyword limitations.

Makro joins the existing source contract with public sales channel 9; ordinary-price and quantity/identity safeguards are shared with Plaza Vea. See [Makro](retailers/makro.md). Apply its retailer migration before the four-store processor runs.
