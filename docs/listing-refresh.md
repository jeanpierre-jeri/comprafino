# Known listing refresh and demand-guided coverage

Milestone 7 closes the refresh gap for products discovered outside the scheduled categories. Implementation and bounded live validation are available; completion awaits fresh local production build and Chromium E2E confirmation because this agent encountered the known Turbopack CSS-worker port restriction. Milestones 0–6 are complete and deployed in the user-provided baseline `558cb56`. No category expansion, retailer, dependency, service or matcher change is introduced.

## Targeted mechanisms

All mechanisms were verified with anonymous public requests on October 3, 2026 (Peru). Native fetch suffices; no credentials, cookies, browser automation, redirects, retries or access-control bypass are used. Each listing costs **one request**, sequentially, with a one-second pause between requests and a thirty-second timeout. A timeout/error stops that request; no alternate access technique is attempted.

| Retailer  | Request                                                                                                       | Mapping and availability                                                                                                                                                                                                                                                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tottus    | Stored trusted `https://www.tottus.com.pe/tottus-pe/articulo/{productId}/{slug}`                              | Read explicit `__NEXT_DATA__.props.pageProps.productData`, verify product ID and exact variant ID equals stored SKU. Select active `TOTTUS_PERU` offering and ordinary `internetPrice`; higher-only `normalPrice`. Use explicit variant measurement. Published/purchaseable/online-sellable flags can establish a negative availability result; successful prices retain unknown delivery availability. |
| Plaza Vea | `https://www.plazavea.com.pe/api/catalog_system/pub/products/search?fq=skuId:{externalId}&sc=1&_from=0&_to=0` | Verify exact item/parent identity, reuse the existing full parser. Seller-1 ordinary `Price`, higher-only `ListPrice`, `IsAvailable` and positive `AvailableQuantity`; exclude conditional teasers.                                                                                                                                                                                                     |
| Metro     | Same VTEX path/parameters on `www.metro.pe`                                                                   | Same exact identity gate and existing Metro seller-1 price/unit/package semantics.                                                                                                                                                                                                                                                                                                                      |

VTEX returns HTTP 206 with one parent product; only the requested SKU is retained even when a parent contains several variants. A different parent ID, duplicate variant or malformed payload fails closed. The Tottus PDP is about 1.1 MB in the inspected oil example; category/search HTML is larger. Its native public product URL is more precise than a text-search fallback. The internal API URL embedded in hydration is not a public endpoint and is never contacted. Product URLs/IDs can age; monitoring is necessary. Rate limits are unknown, so bounded sequential access remains conservative.

`SearchRetailerAdapter` gains `lookupListing(known)` through the small targeted adapter interface. Results distinguish `observed` with the existing `NormalizedRetailerListing`, `unavailable`, and `not-found`. System/parse failures throw. Tottus category, search and PDP variants share `normalizeTottusProduct`; its parser moved to `tottus-parser.ts` to avoid a dependency cycle. VTEX uses its existing parsers. There is no third price/listing persistence path. Tottus PDP source images can use a different CDN; source URLs are preserved, while public image allowlisting continues to decide whether they are shown.

## Selection and request budget

Default admission requires both:

- Actual successful price observation (`retailer_listings.last_seen_at`) at least **24 hours** old.
- Last targeted attempt absent or at least **12 hours** old.

Only known numeric retailer identities with a verified lookup mechanism are selected. Sort by (1) trusted automatic/current-version canonical associations in groups of at least two retailers, including currently unavailable members needing recovery; (2) other listings first acquired through discovery; (3) remaining known listings. Within each tier, oldest price observation first, then listing UUID. Unmatched discovery rows cannot consume requests before public products. Operational retailer success does not make an individual SKU fresh and therefore is not an eligibility override.

A run admits at most **100 listings** across retailers, with no concurrent request fanout. At the initial live catalog size, there were 457 known listings, 84 public associations and nineteen discovery-created public listings. One hundred requests can cover every public listing even if category coverage fails, while leaving remaining capacity for other known rows. With two scheduled cycles daily and a 24-hour age gate, healthy category observations consume no targeted budget. This does not promise all unmatched rows get daily refreshes; public observations have priority. The complete-catalog downstream bound remains 1000 rows and fails safely instead of truncating.

Before each request, a retailer-row-locked compare-and-set records an attempt only if observation and attempt timestamps still match selection. Competing processors cannot claim the same snapshot; a newer observation causes a skip. Interrupted claims remain in the twelve-hour cooldown with a failed latest outcome. The budget is per invocation, not a daily global counter; GitHub's shared concurrency group serializes scheduled discovery and refresh. Independent local processes must respect the same budgets; snapshot admission and database locks remain protections rather than a promise of catalog-wide serialization.

## Persistence, provenance and migration

Reviewed/applied additive Drizzle migration `0004_slim_lady_vermin.sql` adds five listing fields:

- `first_seen_via`: immutable first acquisition (`category`, `discovery`, or `unknown`). Existing rows stay unknown; no historical provenance is fabricated.
- `discovery_query_id`: optional first-acquisition query foreign key; new discovery acquisitions retain query attribution.
- `last_category_observed_at`: actual last observation through the bounded category path. Targeted and discovery observations do not advance it.
- `last_targeted_attempt_at` and `targeted_status`: latest targeted admission/outcome, with constrained observed/unavailable/not-found/failed statuses.

Listing identity remains retailer plus external SKU. A discovery-created listing later seen in a category crawl keeps its first origin/query identity while gaining category coverage. The shared existing atomic `persistListingsDetailed`/`persistenceStatements` accepts acquisition metadata. Category commands default to category; discovery explicitly supplies its claim; targeted supplies targeted. Existing `last_seen_at` remains the actual successful quote-observation timestamp, so no duplicate freshness field is needed. Unchanged prices advance observations without appending history or rewriting unchanged normalization/matching. First-seen, canonical creation, normalization and matching times are never price freshness.

## Unavailable, missing and failure behavior

Confirmed unavailable/missing seller offers retain listings and all history. Unavailable sets `available=false` without advancing `last_seen_at` or creating a price state. No zero placeholder becomes a current price. A negative response cannot override a newer successful quote. A later successful normal observation restores availability/unknown status through the same persistence path.

HTTP 404/410 on Tottus, HTTP 404 or validated empty/no-exact-SKU VTEX results are expected `not-found`, preserving prior price/availability/observation and recording the negative attempt. This does not establish permanent removal. Repeated misses eventually make the retained offer stale by its unchanged observation time. There is no deletion or speculative permanent-removal threshold. A published Tottus page with unrecognized/malformed fields is a system failure, not proof of absence.

Individual failures record safe outcomes and continue. Three consecutive system failures for one retailer stop its remaining requests for that invocation, while other retailers continue. Expected missing/unavailable outcomes do not trip this circuit or fail the job. Any actual system failure produces a partial targeted summary and nonzero command/overall scheduled status. Database admission/finish failures stop targeted processing because continuing without durable attempt metadata would be unsafe. Already committed successful observations survive; scheduled orchestration still derives them and continues other work.

Normalization failure skips matching. Downstream guarded writes can refuse stale snapshots during independent local discovery/refresh activity; commands report the failed stage and preserve successful source observations. There are no automatic retry loops. A later ordinary cycle reconciles derived data.

## Public freshness and cheapest-price safety

At request time, using actual successful `last_seen_at`:

| Observation age            | Public behavior                                                                | Cheapest / Desde                   |
| -------------------------- | ------------------------------------------------------------------------------ | ---------------------------------- |
| ≤36 hours                  | Fresh ordinary observed price                                                  | Eligible if available is not false |
| >36 and ≤72 hours          | Visible with `Precio pendiente de actualización.`                              | Excluded                           |
| >72 hours                  | Historical price with `Último precio registrado · pendiente de actualización.` | Excluded                           |
| Future/invalid observation | Treated as too stale                                                           | Excluded                           |
| Explicitly unavailable     | Visible with `No disponible en la última consulta.`                            | Excluded regardless of age         |

This deliberately excludes **every stale offer**, including stale-but-visible offers, from cheapest retailer, tied best price, search-result minimum and `Desde`. Only fresh usable offers can win. If none qualify, `lowestPriceCents=null`, cheapest retailers are empty, and both search cards and the product page show `Estamos actualizando este producto.` Historical product pages remain available as long as their trusted two-retailer group and open historical states exist, including when an offer is unavailable. Manual/obsolete/low-confidence associations, inactive rows, missing price states and unsupported price units retain existing public safety gates. No polling, refresh control or redesign is added.

Operational whole-retailer thresholds remain healthy ≤18h, delayed ≤30h, stale >30h. They describe category job health, not individual offer freshness.

## Commands and scheduled flow

```sh
pnpm db:migrate  # only after reviewing the generated migration
pnpm refresh:listings -- --dry-run --limit=50
pnpm refresh:listings -- --limit=100
pnpm refresh:listings -- --retailer=tottus --limit=50
# Explicit one-SKU inspection bypasses age/cooldown selection; permits immediate live repeat.
pnpm refresh:listings -- --retailer=tottus --external-id=113706603
pnpm coverage:report
pnpm refresh:catalog
```

Default/max targeted limit is 100; minimum 1. Unknown, duplicated or malformed options fail before database/network work. `--external-id` requires a retailer and selects at most one existing listing; it is an operator diagnostic scope, never used by the scheduler. It still records attempts and uses guarded persistence. Both dry-run and reporting require migrated `DATABASE_URL`; targeted dry-run makes no retailer calls or writes. Persisted standalone refresh derives the complete catalog once after successful observations, reporting lookup and downstream results separately.

The existing twice-daily `refresh:catalog` flow is category ingestion → targeted known listings → one normalization → one matching. Categories/limits and cron `17 11,23 * * *` remain unchanged. Failed category retailers do not block targeted refresh; successful targeted observations can justify downstream work even if all categories fail. Category successes update observations before targeted selection, avoiding redundant requests. Dry-run catalog mode retains its existing retailer category fetch behavior, without targeted DB/network work. The workflow timeout is now sixty minutes: 100 worst-case thirty-second requests plus one-second pauses require approximately 52 minutes before category/downstream work. No new schedule, secret or infrastructure is added. The existing shared concurrency group and no-cancel behavior remain.

## Demand and developer inspection

`coverage:report` is read-only and bounded to the complete catalog ≤1000, the top twenty discovery queries and twenty recurring brand/source-category combinations. It reports lifetime requests, current matching public groups, and groups whose members retain first-acquisition query provenance. The last figure does **not** claim causal creation or attribute every later rediscovery: prior origin is unknown, and existing listing query identity is intentionally retained. Current public results answer whether a query is now covered without inventing historical attribution.

Per retailer and globally: known/public listings, category-observed public listings, recent category observations, public listings without category observation, eligible targeted selection, fresh/stale/too-stale observations, unavailable members, last targeted attempt, latest outcome counts and acquisition sources. Outcome counts are latest per-listing states, not append-only per-run history. Brand/category rows include listing counts and distinct first-acquisition discovery queries; source categories are not a canonical taxonomy. `/dev/ingestion` renders these metrics/demand and remains blocked before database access in production. No charts or editing controls are added.

A missing category observation is initially **unknown coverage**, not proof that an item cannot appear in that category. After a complete frozen category cycle, it identifies absence from the observed bounded sample. Ever-observed coverage can age or source ordering can rotate; the report also exposes observations within 24 hours. No category crawl starts automatically from demand.

## Live validation and audit — October 3, 2026 (Peru)

Initial read-only production audit: Tottus 197 / Plaza Vea 130 / Metro 130 known listings; twenty / thirty-three / thirty-one public associations, respectively. Historical Milestone 6 evidence identifies nineteen associations in eight discovery-created public groups (rice and oil). Origin was not stored, so those pre-migration identities remain unknown in the new schema.

A full bounded existing-category refresh passed: 350 observations, nine new listings due to source ordering inside the same scopes, 466 total listings, nine normalization writes, zero matching writes. Its targeted selection was empty because all prices were recent. Categories were not expanded. The normal targeted dry-run also selected zero rows and made zero calls/writes.

Nine explicit known public listings were observed twice, sequentially: eight outside the just-observed category sample and one Metro category-covered listing. All three retailer mechanisms passed. The sample spans Primor Clásico 1.8 L, Primor Premium 900 ml, Costeño Añejo Extra 750 g and one existing category product. Each pass made nine requests with zero failures, zero new price states, zero normalization writes and zero product/link matching writes. The selected listings retained ten total historical states before and after both passes; every successful observation timestamp advanced.

| Retailer  | SKU       | Current PEN cents | Observed category coverage |
| --------- | --------- | ----------------: | -------------------------- |
| Metro     | 34895     |              1970 | Yes                        |
| Tottus    | 119580636 |              1680 | No                         |
| Metro     | 39257746  |               430 | No                         |
| Metro     | 427       |               950 | No                         |
| Tottus    | 113706603 |               970 | No                         |
| Plaza Vea | 10614795  |               950 | No                         |
| Plaza Vea | 10181308  |              1520 | No                         |
| Plaza Vea | 11129479  |               410 | No                         |
| Metro     | 39181622  |              1750 | No                         |

First observations: 02:38:20–02:38:42 UTC; immediate repeat observations: 02:39:06–02:39:21 UTC (21:38–21:39 Peru, October 3). No natural price change occurred in this sample. Actual changed-price behavior is covered by PostgreSQL tests rather than fabricated live price mutations.

The checked-in [audit snapshot](listing-refresh-audit.json) was read at **02:53:58 UTC October 4 / 21:53:58 Peru October 3**. Production continued receiving real discovery demand/listings during validation: the snapshot contains sixty-eight additional new discovery acquisitions after the category cycle. It is a measured point-in-time report, not a permanent total or a claim that this task processed those requests.

| Metric                                                         | Count |
| -------------------------------------------------------------- | ----: |
| Known listings                                                 |   534 |
| Public offers/associations audited                             |    93 |
| Fresh ≤36h                                                     |    93 |
| Stale-but-visible >36–72h                                      |     0 |
| Too stale >72h                                                 |     0 |
| Public listings category-observed                              |    67 |
| Public listings outside observed category sample               |    26 |
| Historically discovery-created public listings now refreshable |    19 |
| Public listings with newly recorded discovery acquisition      |     5 |
| Known identities with a targeted mechanism                     |   534 |
| Public identities with a targeted mechanism                    |    93 |
| Known identities without a mechanism                           |     0 |

All 534 have a supported exact lookup identity/URL; live requests verified the bounded sample, not every SKU. Nineteen historically verified discovery acquisitions and five newly attributed discovery acquisitions give **24 verified discovery-created public listings with targeted paths**. They account for twenty-four of the twenty-six public listings outside category observations; two are retained earlier category listings. The remaining public source origins cannot be inferred solely from schema defaults. Current total origins: 457 unknown, nine category, sixty-eight discovery. No retroactive guessing was applied. The catalog now has 93 public associations, still below the 100-request budget; revisit that budget deliberately if public growth exceeds it.

Measured demand at the final audit: `huevos tottus` seven requests; `huevos` four; `arroz costeño`, `arroz extra costeño`, `aceite primor`, `aceite vegetal primor`, `atún florida` and `detergente bolivar` two each. Rice queries currently return five/four public groups; oil queries return three each; generic eggs now returns three, including three groups with recorded first-acquisition query provenance. The retailer-brand egg query, tuna and detergent still return zero public groups. Independent production discovery progressed during validation; those new groups are not claimed as work performed by this task.

Counts are small and overlapping query spellings are not summed into causal product demand. Eggs lead current demand, but existing dairy/egg coverage should be inspected first; retailer-specific own-brand identity must not be relaxed merely to make cross-retailer results appear. Rice and Primor oil have demonstrated comparable groups and are strong candidates for a future carefully bounded category review. Tuna and detergent follow; detergent needs the already-documented brand/pack/variant normalization review. Synthetic absent-product demand is not an expansion recommendation: its unrelated source suggestions can acquire listings later linked into groups without satisfying the original query. **No next milestone is started.**

## Validation and remaining limits

Unit tests cover admission priority/age/cooldown/limit, stale boundaries and cheapest exclusion/all-stale state, exact retailer mapping, invalid identity/URLs, ordinary price semantics, unavailable/missing/system outcomes, per-listing and per-retailer isolation, concurrent admission skips and scheduler ordering/one derivation pass. Isolated PostgreSQL tests cover immutable acquisition/category provenance, unchanged/changed history, concurrent claim serialization, negative outcomes versus newer successes, preserved history/observation, read-only demand/coverage reporting and all-stale public pages. Tests make no retailer requests.

Format, lint and strict types passed; **388 unit tests** and **24 isolated PostgreSQL tests** passed (24 new unit cases and four new PostgreSQL scenarios). The final one-SKU Tottus CLI also passed with successful normalization/matching and zero price-state or derived writes; its immediate repeat also passed with zero price-state and derived writes. During concurrent production discovery, an earlier diagnostic CLI exited nonzero after recording a successful quote. Its generic error did not establish the exact downstream cause; after stage reporting was added, the later run and repeat completed without bypassing guards. The default build hit Turbopack's existing CSS-worker bind error (`Operation not permitted`); Chromium E2E could not start a production server without a successful build. Framework configuration is unchanged. Changes remain staged without commit or push until the developer confirms `pnpm build` and `pnpm test:e2e` locally, per the task's explicit gate.

Remaining limits: anonymous channel/context and location-specific availability, unknown historical origins/query causality, changing category ordering, retailer URL/payload changes, no permanent-removal inference, latest rather than append-only targeted outcomes, complete-catalog 1000-row guard, per-invocation rather than global daily targeted budget, and low observed demand sample size. Broad untested SKU classes may fail safe validation; a supported lookup path is not a promise every current product is still sold. Schedules may delay. No matcher weights, thresholds or scoring code changed.

## Milestone 10 follow-up

Current comparison policy and audited quantities are in [quantity quality](quantity-quality.md); current operating counts, request budgets and headroom are in [catalog budget](catalog-budget.md). Comparison bases now separate approximate rolls from physical item counts, and all semantically unresolved tuna unit prices are withheld. Persisted normalization version 1, canonical matcher rules and existing source/refresh limits remain unchanged. Earlier milestone validation notes are historical; Milestones 0–9 are complete in the user-provided baseline `d8858b3`.
