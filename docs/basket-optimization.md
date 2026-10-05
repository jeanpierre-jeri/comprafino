# Current basket optimization — Milestone 16

Implemented and validated. The user’s local production build succeeded, and the standard Chromium run passed 21 tests with 29 expected fixture/database skips. The isolated shopping/basket Chromium run now passes all 22 tests, including all five Milestone 16 scenarios. The earlier agent Turbopack CSS-worker port restriction is historical; Next.js configuration is unchanged. Work remains staged and uncommitted.

## Ownership and safety

`packages/core/src/shopping-list.ts` now exposes `evaluateShoppingFulfillment`: the existing per-item evaluator and the basket boundary share semantic compatibility, current pricing, quantity evidence and whole-package fulfillment. It returns the original display evaluation plus **all approved options**, before the three-option display limit. `evaluateShoppingListItem` remains a wrapper over the same logic. The optimizer in `packages/core/src/basket-optimization.ts` accepts only these approved, retailer-identified options and has no search, product-family or substitution logic.

Milestone 15.1 remains authoritative: generic saved queries/profile normalization, retailer/brand qualifier removal, conservative null profiles, and distinct quail eggs/integral rice/olive oil semantics are preserved. Broad relevance never proves equivalence. Negative source-family evidence remains negative. Independent listings retain null canonical IDs and cannot satisfy strict identity or acquire product/history associations.

Strict needs use the existing safe public canonical association. Preferred needs keep exact options and admit each alternative only when the existing shared rules establish equivalent quantity and at least **both S/ 1 and 5%** savings against the globally cheapest current exact fulfillment. This gate runs once before retailer subsets; omitting a retailer never creates preferred unavailability. When exact fulfillment is genuinely unavailable, existing compatibility/reference requirements still apply. Missing public identity cannot be reconstructed from a local label. Package alternatives require fresh strong exact contents; reference selection is deterministic by listing ID and excludes unavailable/stale offers.

Generic normalized quantities, explicit exact sale-package counts and legacy normalized exact semantics are unchanged. Quantities use integer thousandths and whole packages, bounded to at most 100% overbuy. Direct per-kg quotes do not become package prices. Each need buys enough packages of **one listing**, without splitting a need across listings or pooling packages across distinct needs. Saved frequencies do not multiply quantities or produce recurring bills.

## Current snapshot query and scale tradeoff

`evaluateCurrentShoppingList` performs one parameterized SQL statement in one DB batch for a nonempty list, sharing a statement snapshot and evaluation time across all needs. It returns requested public canonical metadata and the full current normalized offer snapshot across Metro, Plaza Vea and Tottus. Empty lists make no query. Shared `eligibleProducts`, `currentGenericOfferRows`, `genericProductOffer` and `listingOffers` enforce existing public matching, active/available, PEN/open history, quote basis, normalization fingerprint/version, trusted URL and conditional-offer boundaries.

Current prices must be verified within 36 hours, including the boundary, and cannot be future observations. Only supported current concrete CMR prices participate in benefits mode; structured start/end windows remain authoritative, with exclusive expiration. Catalog evaluation is read-only and never ingests, refreshes, searches retailer websites or creates discovery demand.

Fetching the **bounded eligible catalog snapshot is an intentional current-scale tradeoff**: predictable one-query work, complete candidate coverage and simple safety reuse. The existing 1,000-listing operational bound remains; requesting 1,001 rows detects overflow and returns an API error rather than a truncated optimum. No search-page or three-option display limit affects optimization.

If the catalog guard grows substantially, move candidate filtering earlier into SQL by requested canonical IDs and safe substitution families, preserving the same domain safety gate and complete candidate accounting. That future optimization is not implemented now. There is no new schema, migration, dependency, infrastructure or cache.

The uncached POST `/api/list/evaluate` validates version-two input and returns validated per-item evaluations, three basket tiers, evaluation time and timings. `timings.queryMs` measures awaited DB retrieval/transport, not PostgreSQL execution alone. `timings.totalMs` begins before request JSON parsing and includes DB retrieval, domain evaluation and optimization; it is captured before final response validation/serialization. `Server-Timing` exposes both. The benchmark also measures full handler invocation through validated response-body consumption (`handlerResponseMs`). Query/overflow/malformed-output failures remain 503 errors with retry, never partial-basket results.

## Optimization and deterministic order

Enumerate all seven nonempty subsets of the three supported retailers. For each subset, select the cheapest approved fulfillment of each need. Report the best solution using **at most** one, two and three retailers, using only retailers actually assigned purchases. Complete coverage outranks partial coverage. When no complete plan exists at a limit, maximize covered needs first, then minimize partial cost.

Option ties follow the existing order: purchase cost, lower overbuy, lower effective unit cost, lexical listing ID. Basket ties follow covered-need count descending, cost ascending, fewer actual retailers, lexical sorted retailer-ID sequence, then assignments ordered by item UUID and compared by the shared option comparator; sorted missing UUIDs provide the final stable signature. Overbuy is never summed across incompatible measures. Money uses safe integer PEN cents, including checked aggregate totals.

Results distinguish `empty`, `complete` and `incomplete`. Complete plans have `totalCostCents`; incomplete plans have only `partialSubtotalCents`, covered assignments and missing IDs. Response validation checks consistent coverage, actual retailer sets, totals, tier limits and marginal savings. Marginal savings are computed only between adjacent **complete** tiers; every comparison touching an incomplete tier is null. No complete total or saving is manufactured from a subtotal.

## `/list` behavior

All three maximum-retailer tiers are always shown for a nonempty successfully evaluated list. Cards show the actual retailer count and names, so a two/three-store limit may display **1 supermercado · Metro**. Equal complete totals say “No ahorras más al añadir otra tienda.” Adding a store to an incomplete plan may explain improved coverage or completion, without a saving claim.

The initially selected plan is the complete one-store result when available; otherwise the first higher complete limit; otherwise the best partial result. This is presentation only. Selecting another limit persists through evaluation refreshes and edits within the current page session.

Incomplete cards and selected details prominently display “Canasta incompleta · X de Y productos”, “Subtotal de productos disponibles” and “Faltan”. Selected purchases group by supermarket with product, whole packages, quantity, overbuy, price and retailer link. Preferred substitutions are marked explicitly. Canonical/history links appear only for existing safe public associations.

Standard mode uses ordinary prices. Benefits mode shows potential prices and required CMR conditions, plus the ordinary total/subtotal **for the same selected assignments**; that amount is not the independently optimized standard basket. Switching mode recomputes the global preference gate and basket optimization. Saved quantities and identities remain unchanged. Frequency groups, editing/removal, migration, browser persistence, minute/tab-return refresh and error/retry behavior remain.

## Validation and performance

Vitest covers exact optima (including non-nested winning combinations), an independent exhaustive-assignment oracle, complete/partial/empty results, default selection, actual counts, zero/marginal savings, deterministic shuffled inputs, fourth-ranked listings needed for coverage, thresholds, safety/identity, quantity/freshness/CMR and overflow. API unit tests cover invalid input, uncached timing headers and failure separation. PostgreSQL regressions exercise one-query evaluation, equivalence with the existing per-item evaluator, all intents, quail rejection, null identity, normalization/public eligibility, benefits and the snapshot guard. Browser scenarios cover comparison selection, actual counts, partial coverage, preferred/benefit labels, edit refresh, retry and 390px/1280px in both themes.

The reproducible [performance snapshot](milestone-16-performance.json) uses a disposable loopback PostgreSQL 17 schema with 900 current normalized listings, valid lists mixing supported/unsupported generics and exact/preferred milk, one warmup and five measured runs per case, in both pricing modes. It calls the actual POST handler with native TypeScript and consumes/validates its JSON response. **It does not measure Next.js HTTP startup, deployment latency or network overhead.** Median values are recorded in the JSON; this controlled measurement is not a production latency claim.

Current validation: format, lint and TypeScript passed; **623 unit tests** and **47 PostgreSQL integration tests** passed; isolated shopping/history/basket fixture validation passed. The user’s successful local production build and standard Chromium output establish **21 passed / 29 expected skips** across 50 discovered tests. After correcting three E2E synchronization/selector issues, a fresh isolated `pnpm test:e2e:list:local` run passed **all 22 tests in 45.5 seconds**, including all five basket scenarios. Those corrections wait for animated dialog removal before a card-background click, scope Edit to saved-item frequency sections, and scope retry errors to main content rather than Next.js’s route announcer. Application/substitution/optimizer code is unchanged by this follow-up. Mobile/desktop screenshots in both themes were generated; the mobile comparison was visually inspected. Work remains staged and uncommitted.

Median local timings in milliseconds (900 listings, five measured runs after warmup):

| Items | Mode     | DB retrieval | API handler through response consumption |
| ----- | -------- | ------------ | ---------------------------------------- |
| 5     | Standard | 44.1         | 83.2                                     |
| 20    | Standard | 43.3         | 86.6                                     |
| 50    | Standard | 42.3         | 88.9                                     |
| 5     | Benefits | 43.1         | 80.9                                     |
| 20    | Benefits | 42.1         | 87.5                                     |
| 50    | Benefits | 40.7         | 88.2                                     |

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db:up
pnpm test:integration:local
pnpm test:e2e:list:local --validate-fixtures
pnpm benchmark:basket:local
pnpm build
pnpm test:e2e
pnpm test:e2e:list:local
pnpm test:db:down
```

No temporal advice, weekdays/month-period recommendations, travel/distance, delivery fees, alerts, accounts or individual retailer-listing history pages are included.
