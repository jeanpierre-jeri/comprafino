# Catalog operating budget — Milestone 10

Measured October 4, 2026, starting clean at `d8858b3`. Use `pnpm catalog:budget` with root `DATABASE_URL`. This developer CLI uses existing PostgreSQL, local category configuration, workflow files and optional [recorded full-refresh evidence](catalog-refresh-measurement.json). It makes no retailer/GitHub/billing API calls or writes. No new infrastructure, category sources, retailer or limits. [Read-only snapshot](catalog-budget-audit.json) and [quantity audit](quantity-quality.md) preserve measured evidence. Full-refresh evidence is a timestamped local measurement, not live GitHub workflow telemetry.

## Measured catalog and database

| Metric                                       |     Value |
| -------------------------------------------- | --------: |
| Known / normalized listings                  | 736 / 736 |
| Trusted public exact-group offers            |       127 |
| Canonical groups                             |        57 |
| Open / total price-history rows              | 736 / 763 |
| Ingestion runs                               |        45 |
| Discovery queries / daily-budget rows        |    14 / 1 |
| Lifetime recorded search requests            |        33 |
| Matching candidates                          |     8,853 |
| Stale public offers / targeted selected now  |     0 / 0 |
| Configured category sources                  |        16 |
| Maximum category observations per full cycle |       590 |

“Public offers” above means trusted exact canonical associations; the generic catalog can expose independent offers too. The quantity audit has 736 active current offers, including ones without a usable unit price. Keep these definitions distinct. Sources are two Tottus, seven PV and seven Metro retailer/category pairs.

Database size: **10,788,864 bytes (~10.29 MiB)**. Largest relations, including indexes/TOAST: listings 680 KiB (indexes 200 KiB), normalizations 312 KiB (indexes 96 KiB), history 272 KiB (indexes 168 KiB), canonical associations 104 KiB (indexes 32 KiB), discovery queries 64 KiB (indexes 48 KiB). Ingestion runs total 48 KiB. Whole database includes fixed PostgreSQL overhead and is not the sum of logical row payloads. Page allocation and recent updates make bytes/row only a rough projection.

The final metadata snapshot showed eleven visible connections; other audit/test snapshots showed eight to eighteen. These include concurrent database clients and shared provider behavior. It is not peak usage, a pool limit or workflow attribution. No connection failure was observed, so the existing Neon HTTP and pooled/direct strategy is retained. Exact Neon account quotas and GitHub billing assumptions are external/current-plan concerns; no stale free-tier limits are hardcoded or billing impact asserted.

## Refresh and request budget

One actual unchanged-scope full pipeline took **76.503 seconds**. It made **27 category requests**: Tottus five, PV eleven, Metro eleven; targeted requests **zero**. Category results: Tottus 243 source products / 150 observations / zero new states; PV 198 / 191 / one; Metro 208 / 208 / zero. PV's source ordering acquired one legitimate paper-and-cloth bundle, taking 735→736 listings and 762→763 history states. The bundle is withheld from unit comparison. Normalization processed 736 / wrote one new derived row; matching evaluated 8,853 / wrote zero products or associations.

Measured stage times: Tottus 11.312s, PV 18.155s, Metro 23.277s, targeted selection 0.723s, normalization 2.657s, matching 20.378s. Together category acquisition/persistence is 52.744s. Previous Milestone 9 local full refresh was 71.974s: these two comparable local observations average about 74s, without implying a stable production distribution. Individual `ingestion_runs` have real start/end durations but cannot reconstruct full pipeline/GitHub runtime or distinguish manual invocations reliably.

| Work      | Per run                                                        | Scheduled per day                                    |
| --------- | -------------------------------------------------------------- | ---------------------------------------------------- |
| Category  | 27 observed; 98 hard maximum                                   | ~54 at observed pages; max 196                       |
| Targeted  | 0 observed; cap 100                                            | 0 in this snapshot; max 200                          |
| Discovery | 3 requests per processed query; ≤10 queries/run = ≤30 requests | 30-query shared UTC daily cap = ≤90 requests         |
| Total     | Full-refresh observed 27; max 198 before discovery             | ~54 plus actual discovery/targeted; hard max **486** |

Category maximum is **24 Tottus pages + 50 VTEX dairy pages + 24 staple pages**, not merely the sixteen source count. Sparse/unavailable products can need extra pages before the usable-listing limit. Audits, manual invocations and the separate one-SKU targeted regression are excluded from scheduled estimates. That targeted regression made one observed call with zero history/normalization/matching writes. Targeted lookups stay sequential with age/cooldown gating; discovery is query-demand/cooldown gated. Limits are unchanged.

The command reports durable reserved discovery attempts. Those include interrupted claims, so three times the reserved count is an upper estimate of attempted source searches, not an observed request log. Thirteen query attempts were reserved on October 4 UTC, giving an upper estimate of 39 source searches that day, not an observed call count. Three queries were processing and one pending in the snapshot. With only fourteen accumulated unique queries and thirty-three search requests, current demand is small; no historical request volume or average discovery duration is fabricated.

## Workflow time budget

Actual checked workflow cadence: full refresh `17 11,23 * * *` (**06:17/18:17 Peru**, twice daily); discovery `43 0,6,12,18 * * *` (**19:43/01:43/07:43/13:43 Peru**, four daily). Shared noncanceling concurrency serializes the two workflows. Limits remain 120 minutes for refresh and 60 for discovery.

Observed refresh **command** runtime projects to **~2.55 minutes/day, ~76.5 minutes per 30-day month**. GitHub run durations are unavailable and were not queried. Total workflow estimate is explicitly:

`minutes/day ≈ 2.55 + 4 × D + 6 × H`

`minutes/30-day month ≈ 76.5 + 120 × D + 180 × H`

Here `D` is average discovery command minutes and `H` is average checkout/setup/install overhead per job, both currently unmeasured. These formulas assume every scheduled run executes; delays/pending-run replacement can change counts. For illustration only, **D=1 and H=1 minute** would mean ~12.6 minutes/day / ~377 minutes/month. That is a scenario, not observed Actions consumption or billing. Measure actual successful workflow durations separately before quota decisions; no external API integration is added.

## Growth and expansion scenarios

Listings are retained and relatively stable, but bounded source rotation and demand acquisition can still add rows. History is append-on-change (including the first observation), not append-per-refresh. All 763 states fall inside the last seven days because bootstrap began October 3; **27 are repeat-listing transitions** and 736 are first states. This is too short/bootstrap-heavy to give a trustworthy monthly price-change rate or storage growth. Monthly history growth is deliberately **unavailable**, not `736 × 60`.

Predictable operating rows: three category ingestion run records × two cycles/day × thirty days = **180/month**, plus manual ingestion. Discovery and targeted persistence do not create `ingestion_runs`. Discovery budget rows add at most one per active UTC day (~30/month); unique queries are deduplicated and grow with new demand, while requests/statuses update existing rows. Normalizations remain one per listing. No retention policy or telemetry infrastructure is added.

The following are simple projections, not a simulator. Same brand/retailer composition implies candidate work approximately quadratic; normalization/listing storage approximately linear. Use stage measurements to illustrate runtime, without treating source/network latency as constant.

| Scenario                                               | Requests                                                                 |                                               Candidate estimate | Illustrative full command time                                          | Storage / guard                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------: | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| +5 bounded category sources per retailer (15 total)    | +15 typical pages (+56% category); +30 hard-max pages; daily cap 486→546 | At worst 300 new unique listings: 1,036 rows, ~17,540 candidates | ~125–130s if acquisition scales with pages and matching with candidates | Listing/normalization allocation ~1.41×; **exceeds 1000 guard**; Tottus sources still unverified |
| 2× listings (1,472) with existing source/lookup bounds | Same request caps; older/unobserved backlog grows                        |                                                 **35,412 (~4×)** | ~140s if category remains 53s, normalization ~5s and matching ~82s      | Listing/normalization ~2×; **cannot run under current guard**                                    |
| 1,500 listings with existing bounds                    | Same request caps; freshness coverage worsens                            |                                              **36,772 (~4.15×)** | ~145s under the same assumptions                                        | Listing/normalization ~2.04×; **cannot run under current guard**                                 |

Existing history allocated size of 272 KiB would be roughly 544/554 KiB at 2×/2.04× rows and unchanged history composition; this is a rough storage scenario, not monthly growth. Do not multiply the whole 10.29 MiB database by catalog count because fixed overhead/history/index pages differ. If request limits stay fixed, expanding listings does not automatically double acquisition work; it instead increases derivation and freshness pressure. No category source was actually added.

## Headroom decision

1. **More staples?** Small bounded additions are affordable at current measured latency/storage, but require source validation, quantity review and preserving room for discovery/rotation. Fifteen new sources are unsafe under the present row guard.
2. **Matching?** 8,853 candidates / ~20s is material but not currently a failure. Candidate scaling is a later constraint; do not retune thresholds or optimize prematurely.
3. **Refresh duration?** ~77s is comfortable against twelve-hour cadence and the workflow timeout; source timeouts/targeted backlog are more relevant than steady measured time.
4. **History growth?** 763 rows / 272 KiB is small; establish several stable days before projecting append-on-change growth.
5. **Discovery volume?** Current demand is small, capped at ninety source requests/day. Repeated popular query processing can add derivation work; no average duration exists yet.
6. **First constraint?** **1,000-listing complete-catalog guard**, with only **264 slots remaining**, then oldest-offer targeted coverage and candidate growth. Public exact offers already exceed the 100-per-invocation lookup cap, but current category observations cover many and no lookups were due. The cap does not guarantee every public offer recovery in one failed-category cycle.

Safe next expansion: first validate a few Tottus staple sources to reduce the retailer gap, without activating them; review complete-catalog growth/search/matching guard deliberately before sustained additions. If subsequently authorized, trial at most **one twenty-listing source per retailer** (≤60 new unique listings), keep current request limits, and monitor retained-row rotation, public freshness and candidate counts. Do not automatically add sources or raise limits here.

## Validation and next UX

The quantity audit, existing generic/unit-price audit, full scheduled flow, two zero-write normalization repeats and explicit Metro targeted regression succeeded. History digest after full refresh stays `7fb5f1a0abaf405c98dee46fc13eb7a7` through normalization/targeted validation. Matching implementation/thresholds are unchanged and writes were zero. Format/lint/types, **499 unit tests** and **34 isolated PostgreSQL tests** pass. Build fails at the known Turbopack CSS-worker port restriction; Chromium E2E cannot start its production server. The normal Next.js configuration is retained; stage and await fresh local build/E2E confirmation before the requested commit. No commit, push or next milestone yet.

First price-history UX recommendation: a small exact-product detail section showing observed ordinary-price changes per retailer with timestamps, sale unit and stale/unavailable labels. Begin with a compact table, disclose gaps and conditional-price exclusions, and verify price-state intervals before any chart or “buy now” claim. This is a recommendation only; no price-history UI is implemented.

## Milestone 14 prospective observation evidence

All successful category, discovery and targeted quotes now update one shared atomic listing/day coverage rollup in America/Lima. Failed/negative/unusable outcomes create no price coverage; unchanged accepted observations increment the rollup without duplicate price states. Existing schedules, source/request limits and the complete-catalog guard remain. Apply reviewed migration `0006_light_blink.sql` before deploying all writers/readers together. Use `pnpm audit:observation-coverage` and `/dev/ingestion` to inspect collection. See [observation model](observation-coverage.md) and [measured validation/storage](milestone-14-validation.md). Prior milestone measurements above are historical.

## Milestone 18 measured revision

The October 4 numbers above are historical. The [October 5 coverage report](catalog-coverage.md) records 943→952 listings, 11.04→11.20 MiB, 9,697→9,751 matching candidates, 981→1,088 history states and 815→1,394 coverage rows. One bounded Metro eggs source raises the scheduled daily request hard cap 486→490. Expanded/repeated refreshes pass at 87.602/99.840 seconds; the 164.889-second old-source baseline has 40 targeted requests and one source-validation failure. Real DB basket retrieval median is 1.88 seconds; listing detail 261 ms. Keep the 1,000 guard, with 48 slots, and deploy updated admission/evidence writers together. Stable monthly price-change growth remains unmeasured. See [before/after evidence](catalog-coverage-audit.json); local production build and Chromium checks pass (22 smoke cases with 36 expected skips, eight isolated listing and 22 shopping/basket cases).
