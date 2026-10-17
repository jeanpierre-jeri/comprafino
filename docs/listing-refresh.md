# Known listing refresh and demand-guided coverage

Current domain guidance. Dated audits, measurements and acceptance narratives are preserved in [engineering history](history/engineering-notes-2026-10-05.md).

## Targeted mechanisms

The October 3, 2026 Peru inspection covered the then-supported Tottus, Plaza Vea and Metro mechanisms; that dated evidence does not establish current endpoint behavior. The table describes the current adapters, including later [Makro support](retailers/makro.md). No source request was repeated for the October 17 documentation reconciliation. Native fetch suffices; no credentials, cookies, browser automation, redirects, retries or access-control bypass are used. Each listing costs **one request**, sequentially, with a one-second pause between requests and a thirty-second timeout. A timeout/error stops that request; no alternate access technique is attempted.

| Retailer  | Request                                                                                                       | Mapping and availability                                                                                                                                                                                                                                                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tottus    | Stored trusted `https://www.tottus.com.pe/tottus-pe/articulo/{productId}/{slug}`                              | Read explicit `__NEXT_DATA__.props.pageProps.productData`, verify product ID and exact variant ID equals stored SKU. Select active `TOTTUS_PERU` offering and ordinary `internetPrice`; higher-only `normalPrice`. Use explicit variant measurement. Published/purchaseable/online-sellable flags can establish a negative availability result; successful prices retain unknown delivery availability. |
| Plaza Vea | `https://www.plazavea.com.pe/api/catalog_system/pub/products/search?fq=skuId:{externalId}&sc=1&_from=0&_to=0` | Verify exact item/parent identity, reuse the existing full parser. Seller-1 ordinary `Price`, higher-only `ListPrice`, `IsAvailable` and positive `AvailableQuantity`; exclude conditional teasers.                                                                                                                                                                                                     |
| Makro     | Same VTEX path on `www.makro.plazavea.com.pe`, public channel `sc=9`                                          | Exact SKU/parent and seller-1 ordinary-price validation through the Makro parser; no Plaza Vea inventory inference.                                                                                                                                                                                                                                                                                     |
| Metro     | Same VTEX path/parameters on `www.metro.pe`                                                                   | Same exact identity gate and existing Metro seller-1 price/unit/package semantics.                                                                                                                                                                                                                                                                                                                      |

VTEX returns HTTP 206 with one parent product; only the requested SKU is retained even when a parent contains several variants. A different parent ID, duplicate variant or malformed payload fails closed. The Tottus PDP is about 1.1 MB in the inspected oil example; category/search HTML is larger. Its native public product URL is more precise than a text-search fallback. The internal API URL embedded in hydration is not a public endpoint and is never contacted. Product URLs/IDs can age; monitoring is necessary. Rate limits are unknown, so bounded sequential access remains conservative.

`SearchRetailerAdapter` gains `lookupListing(known)` through the small targeted adapter interface. Results distinguish `observed` with the existing `NormalizedRetailerListing`, `unavailable`, and `not-found`. System/parse failures throw. Tottus category, search and PDP variants share `normalizeTottusProduct`; its parser moved to `tottus-parser.ts` to avoid a dependency cycle. VTEX uses its existing parsers. There is no third price/listing persistence path. Tottus PDP source images can use a different CDN; source URLs are preserved, while public image allowlisting continues to decide whether they are shown.

Tottus empty or whitespace-only brand strings are treated as absent source-brand evidence across category, search and PDP parsing. Non-string brands still fail validation. Missing brand evidence never establishes an exact match; ordinary price, unit, SKU identity and tri-state availability validation remain required.

## Selection and request budget

Current selection follows [listingRefreshPolicy and selector](../packages/core/src/listing-refresh.ts): observation/evidence age at least **6 hours**, targeted cooldown **4 hours**, and default/maximum **500 requests** per invocation. A negative availability observation uses its verification timestamp when present; a newer unknown quote cannot indefinitely hide an older explicit negative. Whole-retailer job health is not SKU freshness.

Only numeric identities with a supported exact lookup path are eligible. Priority is public exact association → safe normalized shopping need → discovery origin → useful staple → other identity, then oldest quote and UUID within each tier. The scheduled SQL selector excludes unsupported paths before its independently bounded candidate pool. [10B evidence](history/catalog-refresh-selection-2026-10-16.md) documents the reproduced starvation and correction; it does not quantify production impact.

Before each request, a retailer-row-locked compare-and-set checks the selected observation/attempt timestamps and records admission. Competing processors cannot claim the same snapshot; newer observations cause a skip. Interrupted claims retain cooldown. The request budget is per invocation, not a global daily counter. [Workflow cadence and concurrency](operations.md#scheduling-and-concurrency) and database locks/leases are separate protections.

Global retained capacity and overflow behavior come from [catalogPolicy](../packages/core/src/catalog-policy.ts). Old 100-request, 24/12-hour and 1,000-row measurements are historical, not current operating parameters; original milestone evidence remains in [engineering history](history/engineering-notes-2026-10-05.md#original-docslisting-refreshmd).

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

Source validation diagnostics distinguish JSON syntax from schema errors. Schema diagnostics include at most five allowlisted field paths and issue codes; dynamic keys, source values and validation messages are omitted.

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

Default/max targeted limit comes from `listingRefreshPolicy`; minimum 1. Unknown, duplicated or malformed options fail before database/network work. `--external-id` requires a retailer and selects at most one existing listing; it is an operator diagnostic scope, never used by the scheduler. It still records attempts and uses guarded persistence. Both dry-run and reporting require migrated `DATABASE_URL`; targeted dry-run makes no retailer calls or writes. Persisted standalone refresh attempts complete normalization/matching after successful observations, reporting downstream failures separately. Full matching refuses scopes above 5,000; it is not the large-catalog scheduled path. For resumable work, use `acquire:catalog` and incremental `derive:catalog`, as documented in [operations](operations.md#commands-and-repair).

The scheduled `acquire:catalog` flow is resumable category pages → targeted known listings → incremental normalization/matching, with budgets and failure isolation in [catalog expansion](catalog-expansion.md). `refresh:catalog` remains a manual fixed-category sample; its dry-run fetches category data without persistence or targeted work. Targeted/discovery dry-runs instead only read the database. Neither a documented command nor a historical approval authorizes a production run. Exact schedules/timeouts are maintained in [operations](operations.md#scheduling-and-concurrency).

## Demand and developer inspection

`coverage:report` is read-only and bounded by the current `catalogPolicy`, the top twenty discovery queries and twenty recurring brand/source-category combinations. It reports lifetime requests, current matching public groups, and groups whose members retain first-acquisition query provenance. The last figure does **not** claim causal creation or attribute every later rediscovery: prior origin is unknown, and existing listing query identity is intentionally retained. Current public results answer whether a query is now covered without inventing historical attribution.

Per retailer and globally: known/public listings, category-observed public listings, recent category observations, public listings without category observation, eligible targeted selection, fresh/stale/too-stale observations, unavailable members, last targeted attempt, latest outcome counts and acquisition sources. Outcome counts are latest per-listing states, not append-only per-run history. Brand/category rows include listing counts and distinct first-acquisition discovery queries; source categories are not a canonical taxonomy. `/dev/ingestion` renders these metrics/demand and remains blocked before database access in production. No charts or editing controls are added.

A missing category observation is initially **unknown coverage**, not proof that an item cannot appear in that category. After a complete frozen category cycle, it identifies absence from the observed bounded sample. Ever-observed coverage can age or source ordering can rotate; the report also exposes observations within 24 hours. No category crawl starts automatically from demand.

## Milestone 14 prospective observation evidence

All successful category, discovery and targeted quotes now update one shared atomic listing/day coverage rollup in America/Lima. Failed/negative/unusable outcomes create no price coverage; unchanged accepted observations increment the rollup without duplicate price states. Existing schedules, source/request limits and the complete-catalog guard remain. Apply reviewed migration `0006_light_blink.sql` before deploying all writers/readers together. Use `pnpm audit:observation-coverage` and `/dev/ingestion` to inspect collection. See [observation model](observation-coverage.md) and [measured validation/storage](history/milestone-14-validation.md). Prior milestone measurements above are historical.

## Milestone 18 usefulness and stock evidence

The [coverage audit](catalog-coverage.md) and [availability model](availability.md) supersede the earlier operating snapshot. Targeted priority is now exact public → safe normalized shopping → discovery → other quantity-useful staples → other identities, with oldest quote first inside each tier. Category freshness still prevents redundant requests; explicit negative stock can become due by its separate evidence timestamp despite a recent unknown quote, allowing truthful recovery. VTEX/Tottus missing seller evidence fails instead of becoming unavailable. Exact misses are counted prospectively without deletion/stock inference. Reviewed migrations 0007/0008 add compatible evidence fields; update all writers together. Limits, matcher thresholds and schedules stay intact.
