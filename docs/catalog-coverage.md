# Catalog usefulness and controlled coverage — Milestone 18

Measured October 5, 2026 (Peru), starting clean at `c3e5eb7`. Implementation, real expansion and validation are complete; **Milestone 18 is staged for commit review**. No commit, push, deployment or subsequent milestone is authorized by this report.

Reproduce the complete read-only audit with `pnpm audit:catalog-coverage`, optionally `pnpm audit:catalog-coverage -- --timings`. `pnpm audit:availability` runs the same evidence report. Both require root `DATABASE_URL`, make no retailer calls/writes, validate external DB values and refuse a catalog above 1,000 rather than truncate. [Measured before/after evidence](catalog-coverage-audit.json) includes retailer/family breakdowns, public-search results, shopping-list evaluations, refresh outcomes, budget and timings.

## Definitions and current usefulness

Quantity quality below is intrinsic unit-price quality, evaluated independently of observation age and availability; it is not proof of a current offer. Strong includes direct KG quotes; the final audit separately reports **704 strong contained quantities and 75 direct KG quotes**. Public generic options reuse the real open-PEN-state, active/available, 36-hour freshness, normalization fingerprint/version and trusted URL boundary. Public exact rows also require the existing safe canonical eligibility CTE. Associations count stored identity separately from current public eligibility.

Generic shopping potential requires a supported profile, a fresh public offer, strong contained quantity and the profile's measure. It precedes need-specific package rounding, form compatibility, overbuy and preferred-savings gates. Strict/preferred exact potential means a trusted current canonical UN sale package; it does not require generic substitutions. Basket potential is the union, not the sum, of these two sets. Search-only rows can still be useful for exact discovery/history; they are not equivalent to safe generic coverage.

| Metric                                                        |         Before |          After |
| ------------------------------------------------------------- | -------------: | -------------: |
| Known listings                                                |            943 |            952 |
| Fresh / stale / >72h                                          |   903 / 40 / 0 |    951 / 1 / 0 |
| Positive retained ordinary prices                             |            943 |            952 |
| Current usable ordinary offers / public generic options       |            903 |            951 |
| Current normalization                                         |            943 |            952 |
| Strong / approximate / withheld unit quality                  | 771 / 39 / 133 | 779 / 39 / 134 |
| Supported substitution profiles, including stale rows         |            102 |            106 |
| Stored canonical associations                                 |            147 |            147 |
| Current public exact-group listings                           |            146 |            147 |
| Generic shopping potential                                    |             94 |            103 |
| Strict/preferred exact package potential                      |            146 |            147 |
| Basket potential, unique union                                |            219 |            228 |
| Public listing-detail pages, including retained stale history |            943 |            952 |
| Current searchable rows without basket potential              |            684 |            723 |

| Retailer  | Known before → after | Fresh/public generic after | Current exact | Generic potential | Exact package potential | Basket potential | Strong / approximate / withheld |
| --------- | -------------------- | -------------------------: | ------------: | ----------------: | ----------------------: | ---------------: | ------------------------------- |
| Tottus    | 291 → 293            |                        292 |            34 |                47 |                      34 |               75 | 271 / 0 / 22                    |
| Plaza Vea | 312 → 312            |                        312 |            61 |                26 |                      61 |               77 | 255 / 20 / 37                   |
| Metro     | 340 → 347            |                        347 |            52 |                30 |                      52 |               76 | 253 / 19 / 75                   |

## Family audit and priority

The internal classification is deliberately categorical. GOOD requires at least six fresh safe potential candidates across all three retailers. LIMITED requires at least two but weaker count/diversity. POOR has fewer than two safe current candidates in a supported family. UNSAFE means products exist but this family has no supported generic substitution policy. UNSAFE does not prohibit exact canonical purchases. No public ranking or numerical score is introduced.

Counts use complete family buckets, not the search page's 30-option limit. Milk is a lexical audit bucket of titles beginning with leche; no milk taxonomy/substitution policy is invented. Soap/basic cleaning and shampoo have no supported current family/source coverage, so this milestone records them as unsupported instead of inventing broader taxonomy.

| Family          | Known before → after | Fresh search options after | Safe generic potential | Current canonical comparisons | Unit quality strong / approximate / withheld | Classification / gap                                                |
| --------------- | -------------------- | -------------------------: | ---------------------: | ----------------------------: | -------------------------------------------- | ------------------------------------------------------------------- |
| Huevos          | 30 → 35              |                         35 |                     22 |                             3 | 34 / 0 / 1                                   | LIMITED before → GOOD; Metro had 7 stale rows and no fresh option   |
| Arroz           | 54 → 54              |                         54 |                     44 |                             7 | 54 / 0 / 0                                   | GOOD; specialty rice stays separate                                 |
| Aceite          | 31 → 31              |                         31 |                     18 |                             3 | 29 / 0 / 2                                   | GOOD; vegetable and sunflower contexts differ                       |
| Azúcar          | 52 → 52              |                         52 |                      0 |                             4 | 51 / 0 / 1                                   | UNSAFE; no generic policy                                           |
| Fideos/pasta    | 41 → 43              |                         43 |                      0 |                             0 | 37 / 0 / 6                                   | UNSAFE; no generic policy, Tottus absent                            |
| Harina          | 33 → 33              |                         33 |                      0 |                             5 | 32 / 0 / 1                                   | UNSAFE; no generic policy, Tottus absent                            |
| Avena           | 35 → 35              |                         35 |                      0 |                             4 | 33 / 0 / 2                                   | UNSAFE; no generic policy, Tottus absent                            |
| Leche           | 87 → 87              |                         87 |                      0 |                            15 | 86 / 0 / 1                                   | UNSAFE; fat/lactose/content semantics remain withheld               |
| Atún            | 37 → 37              |                         37 |                      0 |                             5 | 0 / 0 / 37                                   | UNSAFE; net/drained semantics unresolved                            |
| Detergente      | 24 → 24              |                         24 |                     19 |                             0 | 23 / 0 / 1                                   | GOOD overall; powder/liquid/machine contexts stay separate          |
| Papel higiénico | 40 → 40              |                         40 |                      0 |                             3 | 0 / 39 / 1                                   | UNSAFE; approximate rolls do not establish substitution equivalence |

The JSON preserves each family's retailer counts, safe profiles, freshness, unit quality, exclusions and association metrics. Broad current shopping searches returned 35 eggs, 54 rice, 31 oils, 80 lexical milk and 24 detergent candidates. The ordinary representative contexts yielded respectively **22 / 44 / 17 / 0 / 12 powder / 6 liquid** safe quantity candidates before overbuy. The family-wide oil/detergent totals include separate supported forms, hence differ from the generic vegetable/powder/liquid contexts. Existing quail search/substitution regressions remain intact.

## One controlled expansion

The only new source is **Metro eggs**, verified against both the public category tree and one returned product page: `C:/1001327/1001347/1001348/`, leaf `1001348`. Anonymous channel 1, existing seller-1 parser, sequential requests, 30-second timeout and no retries/bypasses. Scheduled limit **10 usable listings**, at most **two 20-product pages**. The operator CLI retains its staple maximum 20; `pnpm scrape:metro -- --category=eggs --limit=10` reproduces this trial. Plaza Vea/Tottus reject that category. No other source, retailer, schedule or dependency is added.

The existing-source measurement acquired four rotating rows before this expansion: two Tottus poultry listings and two Metro pasta listings. These are **not** attributed to the new source. Count progression: **943 → 947 existing-source baseline → 952 controlled expansion → 952 after full refresh and repeat**.

The expansion requested one 20-product page, persisted ten quotes and added five Metro eggs identities/initial ordinary states. Normalization wrote five rows; matching generated 9,751 candidates and wrote no products/associations. Additions:

| Listing                               | New generic/basket potential        |
| ------------------------------------- | ----------------------------------- |
| Huevos Clásicos Pardos La Calera 30un | Yes                                 |
| Huevos Pardo San Fernando 30un        | Yes                                 |
| Huevos para el Ande La Calera 15un    | Yes                                 |
| Huevo de Corral La Calera 12un.       | No; specialty substitution withheld |
| Huevos Pardos Metro Bandeja 90 Unid   | No; contained quantity unresolved   |

Do not reinterpret Unid or corral to inflate coverage. All five have useful search/history pages; only three add current safe generic potential. Metro's seven previously known eggs were recovered by targeted refresh **before** expansion. The new category principally maintains their scheduled coverage and adds three useful alternatives. No new exact egg group was manufactured.

## Refresh efficiency, budget and performance

| Measurement                                   |                     Previous sources baseline | Expanded full refresh | Immediate repeat |
| --------------------------------------------- | --------------------------------------------: | --------------------: | ---------------: |
| Command runtime                               |                                     164.889 s |              87.602 s |         99.840 s |
| Category requests                             |                                            27 |                    28 |               28 |
| Category unique persisted observations        |                                           549 |                   559 |              559 |
| Targeted requests / successful observations   |                                       40 / 39 |                 0 / 0 |            0 / 0 |
| Category/targeted duplicate same-run coverage |                                             0 |                     0 |                0 |
| New ordinary states                           |                                           102 |                     0 |                0 |
| Normalization writes                          |                                             4 |                     0 |                0 |
| Matching product/link writes                  |                                             0 |                     0 |                0 |
| Result                                        | Partial: one strict source validation failure |                Passed |           Passed |

The baseline used the updated evidence writer/selection but skipped the new eggs request; it includes one no-op one-second combiner pause. Its 40-lookups backlog prevents treating the shorter later runtime as a speedup caused by expansion. Normal age/claim guards exclude just-updated category rows; no negative availability recovery exceptions existed in this live dataset. Expanded/repeat efficiency is **559 accepted category observations / 28 requests ≈ 19.96**. Baseline overall is **588 / 67 ≈ 8.78**, including its failed request. Category source-product counts are not usable-observation or duplicate counts.

Total controlled retailer requests: baseline 67, manual expansion 1, expanded full 28, repeat 28, one read-only failure diagnostic 1 = **125**. Public/category-tree validation adds two requests separately (one metadata tree, one page). Audits make no retailer requests. Scheduled category sources 16→17, maximum observations 590→600, typical category requests 27→28, hard category cap 98→100. Twice-daily scheduled category estimate 54→56; combined category/targeted/discovery daily hard cap **486→490**. Targeted cap 100/run, discovery 30 queries/day and cron/cooldowns remain unchanged.

DB size **11,575,296→11,747,328 bytes** (11.04→11.20 MiB); matching **9,697→9,751** candidates. History **981→1,088** states: nine acquisitions plus 98 genuine ordinary transitions. Coverage **815→1,394** listing/day rows; accepted observations **2,459→4,175**. Repeats increment existing daily rollups without new ordinary states or daily identities. History allocation **311,296→327,680 bytes**; coverage relation **180,224→262,144 bytes**, including indexes/TOAST. Final ordinary digest is `050cba85b87d5775fb3f6804f9a37fa6`. Explicit normalization/matching repeats write zero.

Monthly ordinary-state growth remains unavailable: bootstrap/manual runs and less than several stable days do not establish a reliable rate. Fixed 952-listing complete daily coverage is an **upper scenario of 952 rows/day / 28,560 per 30 days**, not an achieved cadence. Current allocated coverage bytes/row would imply roughly 5.1 MiB/month under that scenario, an allocation approximation. New history allocation is small and does not justify hard deletion. Today's measured coverage includes 740 listings, not all 951 fresh offers; fresh within 36 hours does not prove observation on every Peru day.

Real configured DB timings: one warmup and three sequential samples of four supported generic needs; retrieval + domain evaluation, not deployed HTTP. Basket retrieval median **1,946.6→1,879.6 ms**, total evaluation **2,023.7→1,969.6 ms**. One deterministic UUID detail median **314.1→260.7 ms**. Noise/concurrent DB work prevents claiming a performance improvement. The isolated 900-listing actual API handler benchmark, five samples per case, measures median handler response consumption **87.7–97.3 ms** for 5/20/50 items in ordinary/benefits modes; transport-free local results are not Neon/deployment latency. [Benchmark](milestone-18-basket-performance.json) preserves this rerun without changing Milestone 16 evidence.

**Keep the 1,000 guard**, with 48 slots remaining. Storage is not the immediate constraint; complete snapshot latency, discovery/rotation headroom, quadratic matching and refresh coverage are. Do not raise to 1,250/1,500 simply because DB bytes are small. The updated ingestion writer serializes identity admission and atomically rejects over-cap additions, while permitting existing-identity refresh. An over-cap mixed batch rolls back as a whole; targeted existing identities can still refresh. All writers must receive this code for the admission guarantee; old deployed writers do not acquire this guard. Review capacity before further source expansion.

## Availability and validation

See [availability](availability.md) for evidence distinctions, prospective migration fields, exact-miss policy, race/recovery behavior, legacy rollout and preserved history. No public redesign or matching/substitution policy change occurs. Existing search, list/basket and listing-detail boundaries already exclude explicit false and admit null under freshness rules.

One retained stale row remains: Tottus `153822664`, Chorizo San Fernando Cebolla Caramelizada Empaque 400 g. Exact diagnostic returned HTTP 200 but failed strict Zod source validation. No stock/deletion inference, history rewrite or retry/bypass was made. No live verified-unavailable or exact-missing row was observed in this sample; those transitions are proved through isolated fixtures/tests rather than fabricated production evidence.

Passed: format, lint, strict TypeScript, **643 unit tests**, **52 isolated PostgreSQL tests**, coverage/availability/public-search/shopping/observation/budget audits, expanded full refresh and repeat, explicit zero-write derivation repeats, real DB timings and isolated basket benchmark. The existing-source baseline deliberately reports partial/nonzero due to the source validation failure. PostgreSQL tests cover unknown/positive/negative evidence, timestamps, out-of-order observations, failure/omission/replay, preserved history/coverage, recovery and concurrent capacity. Listing/history and shopping/basket fixture validation pass without live retailers.

The user-provided **local production build passed** with Next.js 16.3.8 Turbopack, and the standard Chromium run passed **22 tests with 36 expected fixture/database skips**. The initial isolated listing run exposed a test selector matching both current-offer and history unavailable copy. Scoping that assertion to the current-price panel resolves the ambiguity; a fresh isolated run passes **all eight listing tests (3.7 seconds)**, including unavailable search exclusion, historically accessible detail and recovered search/detail. The subsequent isolated shopping/basket run passes **all 22 tests (48.6 seconds)**. Format/lint/types also pass after this test-only correction. The earlier sandbox CSS-worker port restriction is historical; Next configuration is unchanged. No dependencies added. Two additive/corrective reviewed migrations were applied to the configured DB; all runtime/scheduled writer changes remain local and staged, not deployed.

Reproduce the production and browser checks:

```sh
pnpm build
pnpm test:e2e
pnpm test:e2e:history:local --listings
pnpm test:e2e:list:local
```

Recommended next milestone after acceptance: improve measured catalog snapshot/query efficiency and review controlled capacity while collecting observation history. Any later substitution-family policy must receive separate source review/tests; no new policy or temporal recommendations are started here.
