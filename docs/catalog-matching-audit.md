# Independent matching audit — Milestone 3

The user confirmed the staged implementation's default Next.js 16 Turbopack build and Chromium E2E passed. No commit was made. This follow-up collects broader real evidence before accepting matching, without modifying version 1 scoring, thresholds, hard compatibility, comparison-title normalization, identity tokens, grouping, or persistence.

## Frozen implementation

The following SHA-256 values were recorded before additional ingestion and remained identical after the audit:

| File                            | SHA-256                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `packages/core/src/matching.ts` | `e46dda295c9a6f69118d0e431b6def1ff9005a3b658c09b985c29e6381d5da57` |
| `packages/db/src/matching.ts`   | `f24d9274a478cb2348cb629f245408b11146d05669560d91a9da3173a51f1466` |
| `packages/core/src/catalog.ts`  | `901e6656b37caea1114ae295bfe4e682602b5a57f15c43f3f8d5be49a359d395` |

The initial database reproduced 151 listings, 744 candidates, 12 automatic pairs, 50 reviews, 667 incompatible, 15 no-match and 12 two-retailer groups. These results are the historical design sample, not the independent audit.

## Conservative coverage expansion

Existing Plaza Vea and Metro adapters already select dairy categories. The smallest useful addition was one allowlisted Tottus dairy path discovered in its public Peru navigation: `https://www.tottus.com.pe/tottus-pe/lista/CATG16061/Lacteos`. Existing HTML hydration parsing, request identification, one-second pauses, timeouts, no-retry/no-redirect policy and page/limit caps were reused. Default Tottus ingestion still selects meats.

```sh
pnpm scrape:tottus -- --category=dairy --dry-run --limit=20
pnpm scrape:tottus -- --category=dairy --limit=100
pnpm scrape:plaza-vea -- --limit=100
pnpm scrape:metro -- --limit=100
pnpm normalize:catalog -- --limit=1000
```

No catalog crawl, fourth retailer, new scraping architecture or dependency was added. Tottus dairy exposed a real cheese row with an omitted `measurements.unit`; strict parsing initially stopped. The minimum source-boundary correction allows an absent unit in the validated source shape and excludes that row from purchasable listings. It never assumes UN/KG. Explicit unsupported units still fail validation. Discovered counts include all source rows, including omitted-unit rows; price, reference, card exclusion and history semantics for valid listings are unchanged. A sanitized dairy fixture covers this case and ordinary versus card prices.

| Retailer  | Source fetched | Persisted in additional run | New listings / initial price states | Final stored listings |
| --------- | -------------: | --------------------------: | ----------------------------------: | --------------------: |
| Tottus    |            147 |                         100 |                                 100 |                   151 |
| Plaza Vea |            100 |                         100 |                                  50 |                   100 |
| Metro     |            100 |                         100 |                                  50 |                   100 |
| Total     |            347 |                         300 |                                 200 |                   351 |

Tottus retained its 51 earlier meat listings and added 100 dairy listings; weighted meat did not supply the independent automatic-match evidence. Plaza Vea/Metro refreshed their original 50 and added 50 each. There were no extra changed states for their already-known listings during these expansion runs.

## Normalization coverage

The existing Milestone 2 normalizer stayed unchanged. Initial processing created 200 derived rows; the 151 old derived rows were unchanged. Per-retailer repeats reported zero changed, 351 unchanged and zero stale rows. Ordered price-history digests remained identical across normalization and later matching/repeat verification.

| Retailer  | Processed | Brand | Mass/volume | Count quantity | Package count | Weighted | Diagnostics | Unresolved |
| --------- | --------: | ----: | ----------: | -------------: | ------------: | -------: | ----------: | ---------: |
| Tottus    |       151 |   151 |         104 |              1 |           112 |       39 |           7 |          7 |
| Plaza Vea |       100 |   100 |          94 |              6 |           100 |        0 |           0 |          0 |
| Metro     |       100 |   100 |          91 |              0 |            92 |        6 |           2 |          3 |
| Total     |       351 |   351 |         289 |              7 |           304 |       45 |           9 |         10 |

New-listing coverage alone: Tottus 100 brands, 94 mass/volume quantities, one count quantity, 95 package counts, five weighted, zero diagnostics/unresolved; Plaza Vea 50 brands, 49 mass/volume quantities, one count quantity, 50 package counts, zero weighted/diagnostics/unresolved; Metro 50 brands, 44 mass/volume quantities, zero count quantities, 44 package counts, five weighted, one diagnostic/unresolved. Coverage counts overlap and establish attribute presence rather than complete manufacturer identity.

## Untouched matcher results

Run the existing algorithm with `--limit=1000` over the complete expanded sample; no rule changes preceded or followed these measurements.

| Metric                | Initial design dataset | Expanded frozen matcher |
| --------------------- | ---------------------: | ----------------------: |
| Listings considered   |                    151 |                     351 |
| Candidate pairs       |                    744 |                    7278 |
| Automatic pairs       |                     12 |                      46 |
| Reviews               |                     50 |                     355 |
| Incompatible          |                    667 |                    6703 |
| No-match              |                     15 |                     174 |
| Canonical groups      |                     12 |                      28 |
| Two-retailer groups   |                     12 |                      19 |
| Three-retailer groups |                      0 |                       9 |

The expanded cross-retailer Cartesian space would contain 40,200 pairs; brand-block candidates reduce it to 7278. The independent audit was labelled against the dry-run output before expanded canonical groups were persisted. After the audit passed, the same matcher persisted 28 groups with 65 associations. Nine three-retailer groups contribute 27 pairwise edges; nineteen two-retailer groups contribute nineteen: all 46 automatic pairs are represented without duplicate retailer members.

A complete-scope repeat made zero product/link inserts, updates or deletes. Raw/normalized snapshots and price history remained preserved. Use `--limit=1000` for this dataset: the unchanged default global limit of 100 now covers only Metro's first 100 listings, so it cannot demonstrate cross-retailer coverage and persisted mode refuses scopes splitting saved groups.

## Independent sample and labels

The sanitized checked-in `packages/core/src/fixtures/matching-independent.json` records **105 manually reviewed real pairs**, product titles, normalized attributes, public source SKU IDs, expected outcomes, per-pair rationale, sampling strata and a ledger of every canonical group. Every pair includes at least one newly ingested listing. Original calibration fixture pairs and the twelve previously reviewed automatic pairs are excluded from the independent metric denominator.

| Stratum                                             | Reviewed pairs | Positive identities | Negative / unresolved identities |
| --------------------------------------------------- | -------------: | ------------------: | -------------------------------: |
| All newly produced automatic pairs                  |             34 |                  34 |                                0 |
| Highest-score new review pairs                      |             30 |                  17 |                               13 |
| Highest-similarity new rejected pairs               |             30 |                   0 |                               30 |
| Targeted brand / unknown-content / family contrasts |             11 |                   2 |                                9 |
| Total                                               |            105 |                  53 |                               52 |

Selection is deterministic: all newly produced automatic pairs; then thirty review pairs by descending score and thirty rejected pairs by descending similarity, with listing-ID tie-breaks; eleven manually chosen contrasts add store brands, missing package content, equal total mass/different product families and Bonle/Bonlé brand spelling. Twenty-eight of the high rejected pairs have hard conflicts; two are conservative variable-weight no-match cases. The audit exceeds the targets of 20 automatic decisions (preferably 30+), 20 reviews and 20 rejects.

Expected `match` means the reviewed source descriptions support the same consumer variant. Expected `review` means evidence is insufficient, not a positive identity. TP/FP refer specifically to automatic decisions; a positive retained as review/incompatible/no-match is an FN. A nonpositive retained outside automatic matching is a TN. This measures automatic linking rather than exact reproduction of review/no-match labels.

The labels were manually reviewed by the development agent after seeing the frozen decision strata, **not by a separate blinded reviewer**. Independence here means the additional pairs did not design the weights/rules. No manufacturer/GTIN validation was obtained; correlated triangle edges and known product families reduce effective independence. Precision is observed within this bounded selected sample; recall is audit-sample recall, not population recall. These limitations remain explicit rather than presenting the sample as proof of universal 98% precision.

## Independent metrics — not combined with calibration

| Independent stratum   |     TP |    FP |     TN |     FN | Automatic precision |                                 Recall |
| --------------------- | -----: | ----: | -----: | -----: | ------------------: | -------------------------------------: |
| Newly automatic only  |     34 |     0 |      0 |      0 |    **100% (34/34)** | 100% within selected auto stratum only |
| High reviews          |      0 |     0 |     13 |     17 |           Undefined |                                     0% |
| High rejects          |      0 |     0 |     30 |      0 |           Undefined |       Undefined: no labelled positives |
| Targeted              |      0 |     0 |      9 |      2 |           Undefined |                                     0% |
| All independent pairs | **34** | **0** | **52** | **19** |    **100% (34/34)** |                     **64.15% (34/53)** |

Eight targeted brand contrasts are not generated by candidate blocking: six correct negative brand contrasts and two positive Bonle/Bonlé pairs missed by strict keys. The evaluation explicitly scores targeted contrasts to verify hard-rule behavior, recording candidate eligibility separately; none can become an automatic link. This does not hide candidate-generation false negatives.

For comparison, unchanged **historical design metrics** remain separate:

| Design sample                      | Pairs |  TP |  FP |  TN |  FN | Automatic precision | Recall |
| ---------------------------------- | ----: | --: | --: | --: | --: | ------------------: | -----: |
| Calibration                        |    40 |  12 |   0 |  24 |   4 |                100% |    75% |
| Original holdout                   |    26 |   0 |   0 |  25 |   1 |           Undefined |     0% |
| Historical combined design fixture |    66 |  12 |   0 |  49 |   5 |                100% | 70.59% |

The independent 64.15% recall is lower than the historical combined result. Seventeen new labelled positives remain review because of harmless wording/spelling/style differences; two exact product positives miss candidates because structured Bonle/Bonlé keys differ. No token/brand synonym or threshold was added to make those examples pass.

## Every canonical group inspected

All **28** automatic canonical groups were manually inspected, including their 46 internal pairwise decisions. The fixture stores every member, reviewed status and outcome. No false product merge or systematic dangerous automatic pattern was established from available source descriptions.

The nine three-retailer groups are:

- Laive Light lactose-free mixture, six 480 g cartons.
- Gloria whole UHT milk, three 946 ml cartons.
- Gloria salted butter, single 180 g.
- Gloria Light UHT milk, three 946 ml cartons.
- Gloria Light Zero Lacto milk, six 390 g cans.
- Danlac Frutado Maracumango yogurt, single 900 g.
- Standard Laive lactose-free mixture, six 480 g cartons.
- Gloria Zero Lacto UHT milk, three 946 ml cartons.
- Ideal Cremosita mixture, six 390 g cans.

The other nineteen two-retailer groups keep evaporated/reconstituted milk, light/standard and single/multipack variants separate. Representative newly verified groups include Laive Parmesan 35 g, Vakimu Greek forest-fruit 960 g, Sello de Oro margarine bar 200 g, Laive light lactose-free milk single 390 g, Gloria Zero Lacto UHT bag 800 ml, Gloria Greek honey yogurt 800 g and Laive salted butter 350 g.

### Suspicious cases and unresolved evidence

| Case                                       | Finding                                                                       | Outcome                                                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Gloria Niños milk six-pack                 | Both matched Metro/Tottus titles omit honey; Plaza Vea explicitly names honey | Matched plain source descriptions are consistent; explicit-honey pair remains review. Manufacturer-level identity remains unproven |
| Gloria salted butter 180 g                 | Tottus has another source ID/title including Envase 180 g                     | Possible same-retailer duplicate retained separately; no uniqueness weakening or same-retailer merge                               |
| Strawberry-banana versus strawberry yogurt | High review score 0.9349 despite a real flavor difference                     | Identity tokens prevent automatic matching; broad review queue remains a limitation                                                |
| Light versus standard lactose-free mixture | Review scores around 0.9259                                                   | Light token prevents automatic matching; no canonical merge                                                                        |
| Bonle versus Bonlé                         | Same reviewed Familiar six-pack, two cross-retailer pairs                     | Strict brand blocking causes two FNs; leave unchanged for precision                                                                |
| Unknown Metro Zero Lacto content           | Missing quantity/count and normalization diagnostic                           | No automatic package identity; remains unresolved                                                                                  |
| Same 390 g total, milk versus butter       | Brand/quantity/count/total agree but product families differ                  | No match; structured equality never establishes identity alone                                                                     |
| Source omitted price unit                  | Tottus cheese metadata lacks UN/KG                                            | Excluded at ingestion; no invented price basis                                                                                     |

Milk processing and container differences were also checked: UHT versus omitted processing stays review; reconstituted/evaporated groups remain distinct; many rejected milk pairs have similarity 1 but different quantity, dimension, package count or bag/carton format. No same-total/different-count pair was established in this sample, so none was fabricated for independent metrics.

## Decision, persistence and validation

Independent observed automatic precision is 100%, above the requested ≥98% decision criterion; no systematic false-positive pattern was found. **Keep version 1 unchanged.** Lower recall and broad review remain acceptable costs; no score, threshold, token, compatibility, brand or normalization changes were made. Before/after matcher metrics are identical because no correction was warranted.

```sh
pnpm match:catalog -- --dry-run --limit=1000
pnpm match:catalog -- --limit=1000
pnpm match:audit
pnpm match:evaluate
```

`match:audit` validates and scores the independent fixture with PostgreSQL without canonical writes; `match:evaluate` still reports the historical calibration/holdout fixture separately. Both require root `.env`/`DATABASE_URL` and the applied pg_trgm migration. Audit helpers do not change matcher APIs or behavior.

Validation passes format, lint, strict TypeScript, all 273 unit tests and all twelve isolated PostgreSQL integration tests. Added coverage checks the allowlisted category/unchanged defaults, omitted-price-unit boundary using real sanitized metadata, no overlap with calibration, nonpositive identity gates, all reviewed groups, and independent metrics through actual PostgreSQL trigram scoring.

The user's local build/E2E confirmation applies to the **previous staged implementation**. The minimal ingestion/category and audit code additions require a fresh local `pnpm build` and `pnpm test:e2e` confirmation before commit. Build architecture is unchanged. Stage this final result and wait for that confirmation; do not commit or push yet. The intended commit remains `feat: add cross-retailer product matching`. Milestone 3's independent-audit acceptance is satisfied on the documented evidence; final completion/commit remains pending fresh validation. No public search was begun.
