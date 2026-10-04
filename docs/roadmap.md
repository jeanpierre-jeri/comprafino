# Roadmap

Milestones 0–7 are complete, committed and pushed in the user-provided baseline (`13cb4ee`). Milestone 8 is implemented and data-validated; local build/E2E confirmation remains pending. Historical pending notes in earlier sections refer to their original agent runs.

## Milestone 0 — Foundation

Typed workspaces, Next.js placeholder, shared Base UI button, lazy database access, migration tooling, tests, CI and docs. No deployment or ingestion.

## Milestone 1 — Data ingestion proof

Implement adapters one at a time: **Tottus → Plaza Vea → Metro**. Inspect legitimate public sources, validate payloads and prove repeatable ingestion before consumer features. Establish the minimum real schema from observed requirements. Schedule conservative GitHub Actions jobs only after the adapter is proven.

### Milestone 1A — Tottus ingestion proof

Implemented: public hydration JSON investigation, bounded native-fetch adapter, SKU identity, Zod validation, integer PEN cents, source package/unit metadata, sanitized fixtures, generated schema/migration, atomic persistence SQL, price-state reference tests, run records, CLI, development inspection route and manual workflow. Live dry-run passed with 20 unique listings. No scraping libraries added.

Verified: applied migration and actual Neon constraints/indexes; two live runs (96 fetched / 50 persisted each, 50 then 0 new states); controlled PostgreSQL price transitions, rollback and concurrent writers in isolated test schemas. Availability and location-sensitive coverage remain limitations. The earlier build environment/tooling issue is resolved locally; the default Next.js configuration is preserved. Plaza Vea Milestone 1B is also verified below. Metro ingestion correctness is now verified below.

### Milestone 1B — Plaza Vea ingestion proof

Implemented and verified: public VTEX catalog investigation, bounded native-fetch dairy/eggs adapter, seller-1 SKU identity, external validation, integer PEN cents, ordinary prices excluding conditional teasers and reference prices only when strictly above current prices, source package/weighted-unit metadata, sanitized fixtures and tests, shared CLI, manual workflow and a retailer column in the existing developer inspection table. No dependency, schema or migration change. The shared adapter interface moved out of Tottus; generic persistence was reused unchanged.

Live dry-run: 20 unique listings. Consecutive persisted runs: 60 source products / 50 listings each, 50 then 0 new price states. Read-only PostgreSQL checks confirmed 50 unique listings and 50 open/total history states. Tottus live dry-run and all existing regression tests passed. The existing isolated-schema PostgreSQL suite passed three tests; Chromium smoke tests passed. The normal default Next.js 16.3.8 Turbopack build now succeeds locally after correcting pnpm. See [Plaza Vea integration](retailers/plaza-vea.md) for complete evidence and source comparison.

Limitations: anonymous channel/location context, one bounded category, skipped unavailable/marketplace offers, inconsistent optional package specifications and no persisted promotion details. Metro was subsequently investigated and implemented below; matching and consumer features remain deferred.

### Milestone 1C — Metro ingestion proof

Implemented and ingestion-verified: public VTEX IO/catalog investigation; native-fetch anonymous channel-1 dairy adapter; seller-1 SKU identity; boundary validation; integer PEN cents; higher-only reference prices; separate Metro-card teaser exclusion; raw package labels with placeholder filtering; weighted-unit/multiplier fixtures; shared CLI; manual workflow. No new dependencies, schema, migration or adapter-contract changes. Generic persistence and the existing developer page are reused unchanged. The three-retailer review also closed Tottus's higher-reference invariant gap with five regression cases.

Live dry-run: twenty unique listings. Consecutive persisted runs: sixty source products / fifty listings each, fifty then zero new price states. Read-only PostgreSQL verification confirmed fifty unique Metro listings and fifty total/open states, while Tottus/Plaza Vea retained fifty listings each. All 77 unit tests, formatting, lint, types and the three isolated-schema PostgreSQL tests pass. Both existing retailer live dry-runs pass. Chromium's two smoke tests passed against the matching cached production build with local-server permission; a fresh default Turbopack build remains blocked by the agent's known CSS-worker port restriction, even with elevated execution. These were historical agent checks; Metro is now committed in the completed Milestone 1 baseline. See [Metro integration](retailers/metro.md).

Limitations: one bounded category, anonymous location/channel context, missing/inconsistent package metadata, skipped unavailable offers and no persisted promotion details. The existing adapter contract fits all three retailers; no rename or expansion is justified. Milestone 1 is complete in the current task baseline. Stop adding retailers; catalog normalization is implemented below as a separate milestone.

## Milestone 2 — Catalog normalization

Implemented: framework/database-independent deterministic normalizer; explicit g/kg/ml/l/unit system with exact integer base conversion; conservative brands/source precedence; full-title Unicode normalization; package counts/totals; separate pricing basis and variable-weight semantics; ambiguity diagnostics. Source brand/multiplier retention, reviewed/applied additive Drizzle migration, indexed one-to-one derived attributes with version/fingerprint, bounded idempotent `pnpm normalize:catalog`, development-only inspection and tests. No canonical taxonomy, cross-retailer matching or public search.

Verified: 50 persisted listings per retailer, 150 total; 132 identified brands, 101 mass/volume quantities, five count quantities, 114 package counts, 35 weighted offerings, eight rows with issues and 21 unresolved rows. Twenty diverse results plus five diagnostic rows were reviewed; package-label/count parsing gaps were corrected. Final repeated runs made zero writes and left price history identical. All 152 unit tests and seven isolated-schema PostgreSQL tests pass. No new dependencies or automatic ingestion coupling.

Complete in the current user-provided task baseline, committed at `3abd9f9`. The build/E2E limitations in [catalog normalization](catalog-normalization.md) describe the historical agent run. Milestone 3 refreshed structured source metadata and normalization independently; current coverage is documented in [catalog matching](catalog-matching.md).

## Milestone 3 — Cross-retailer product matching

Implemented: deterministic brand-block candidates; exact quantity/dimension/count/total, pricing, brand and observed variant/container guards; pg_trgm similarity; evidence score and auto/review/incompatible/no-match outcomes; complete-link canonical grouping with retailer uniqueness; reviewed/applied additive canonical migration, versioned links, shared retailer-lock transactions, guarded recomputation/idempotency; matching/evaluation CLIs; read-only production-blocked `/dev/matching`; unit and isolated PostgreSQL tests. No AI, new retailer, public UI or npm dependency.

Initial verification on 151 listings: 744 candidates, 12 auto matches, 50 reviews, 667 incompatible and 15 no-match; 12 two-retailer canonical groups with 24 links, zero three-retailer groups. Repeated normalization/matching writes nothing, and matching leaves price history unchanged. The 66 reviewed real pairs yield TP 12 / FP 0 / TN 49 / FN 5, 100% observed automatic precision and 70.59% recall. The poorly balanced 26-pair holdout has zero automatic predictions and one missed positive; independent precision was unestablished at that stage. All 12 automatic matches and at least ten reviews plus high-similarity rejects were inspected.

Follow-up verified: the user confirmed local default Turbopack build and Chromium E2E passed for the earlier staged implementation. Authorized bounded dairy expansion added 100 Tottus, 50 Plaza Vea and 50 Metro listings, yielding 351 normalized listings. Matcher/normalizer hashes stayed unchanged. The frozen matcher produces 7278 candidates, 46 auto pairs, 355 reviews, 6703 incompatible and 174 no-match; saved groups are 19 two-retailer and nine three-retailer, with 65 associations. All 28 groups were inspected. A separate 105-pair independent audit includes 34 new automatic decisions, 30 reviews, 30 rejects and eleven targeted contrasts: TP 34 / FP 0 / TN 52 / FN 19, 100% observed automatic precision and 64.15% audit-sample recall. No thresholds/rules were changed. See [independent audit](catalog-matching-audit.md) for separate calibration metrics, suspicious cases and evidence limits.

Complete in the user-provided Milestone 4 baseline, committed at `9d104b1`. Earlier build/E2E notes in matching documents describe historical agent runs, not an outstanding Milestone 3 gate.

## Milestone 4 — Public product search and retailer price comparison

Implemented: functional homepage GET form, `/search?q=...`, `/products/[id]`, PostgreSQL parameterized token search with pg_trgm ranking, verified automatic/current-version/high-confidence associations only, at least two usable distinct retailer offers, open ordinary history prices, integer PEN presentation, higher-only references, all cheapest ties, actual Peru observation timestamps, safe source links, allowlisted retailer images with fallback, Spanish empty/error/not-found states, responsive consumer UI and basic metadata. No matcher change, migration or dependency.

Verified: five real search queries and five comparison query results against independent PostgreSQL reads; 28 public groups / 65 offers in the observed catalog, 299 unit tests and 15 isolated PostgreSQL tests passing. Format/lint/strict types pass. Added credential-free browser states and optional persisted-catalog mobile comparison flows; production developer-tool blocking tests remain.

Complete in the user-provided Milestone 5 baseline, committed at `8cd5689`. Previous build/E2E notes in [public search](public-search.md) describe historical agent validation.

## Milestone 5 — Scheduled catalog refresh, freshness and operational reliability

Implemented: shared local refresh command and no-mutation dry-run, fixed existing bounded retailer/category coverage, twice-daily GitHub Actions schedule/manual dispatch, noncanceling full-refresh concurrency, isolated retailer failures with last-known-good data, existing atomic normalization/matching APIs, safe operational summaries/nonzero failures, distinct latest-attempt/latest-success reads, centralized 18/30-hour thresholds and production-blocked `/dev/ingestion` operations view. No schema/migration, dependency, retailer/category expansion, public redesign or matching changes.

Verified: two real refreshes (85.099s / 45.701s); 350 persisted observations each; one initial new Tottus state within the existing dairy sample, then zero new states; two initial normalization writes, then zero; zero matching writes both times. Retained catalog is 352 rows, with identical complete history digest across the repeat. Deterministic failure/freshness tests and PostgreSQL lifecycle/isolation coverage are included. See [operations](operations.md) for complete evidence and final validation results.

Milestone 5 is complete and deployed in the developer-provided baseline; its original agent build restriction was resolved outside that run.

## Milestone 6 — Search-driven catalog discovery

Implemented: conservative zero-result demand recording after the response, PostgreSQL deduplication/popularity, 24-hour cooldown, locked thirty-attempt UTC daily budget, bounded public search for all three existing retailers, shared ingestion persistence, unchanged normalization/matching, safe partial/no-result/failure outcomes, read-only developer inspection and six-hour GitHub Actions scheduling. No category crawl, new retailer, matcher rule, dependency or infrastructure is added.

Validation: deterministic unit tests and isolated concurrent PostgreSQL tests, real bounded searches and immediate-repeat cooldown verification. See [discovery](discovery.md) for complete measured results. Pending: fresh local default `pnpm build` and Chromium `pnpm test:e2e` confirmation because of the known agent worker-port restriction. Changes stay staged without a commit until that gate passes; new workflow activation requires publishing the reviewed change.

Next catalog-coverage recommendation: use accumulated demand to review representative new listings and conservative normalization/matching gaps, measure source/downstream workload and intentionally expand refresh coverage for already-discovered products. Review the complete-catalog processing bound before increasing sustained ingestion. Proactive category expansion remains a separate authorized milestone; do not start it automatically.

## Milestone 7 — Freshness for discovered products and demand-guided coverage

Implemented: exact Tottus product-page variant and Plaza Vea/Metro SKU lookups; same normalized listing and persistence contract; immutable acquisition/query provenance, category observations, latest targeted attempt/outcome migration; public-first oldest-observation admission, 24-hour age, twelve-hour attempt cooldown and 100-per-run budget; sequential requests, three-error retailer circuit and partial-failure reporting; integration before one normalization/matching pass; read-only demand/coverage report and development metrics; fresh ≤36h / labelled stale ≤72h / historical >72h public semantics, only fresh usable offers participating in best price. No scoring/threshold change, new dependency, retailer, category expansion or service.

Verified: existing category cycle passed, nine public listings observed twice with zero price/normalization/matching writes, 93 fresh public offers audited, twenty-four verified discovery-created public listings now have a targeted path (nineteen historical plus five newly attributed). The [audit](listing-refresh.md) records the changing live catalog and exact counts/limits. The original agent build/E2E restriction described in that document is historical. Milestone 7 is complete in the user-provided committed/pushed baseline `13cb4ee`.

Future category review should inspect egg demand within existing coverage, then consider measured rice/oil demand and proven comparability, followed by tuna/detergent after normalization gaps are reviewed. This milestone does not begin that expansion.

## Milestone 8 — Generic product comparison and unit pricing

Implemented: independent fresh normalized retailer offers alongside unchanged exact groups; bigint rational kg/L/unit prices, direct KG semantics, multipack totals and conservative unavailable reasons; native URL relevance/package/unit sorting with separate dimensions; single-retailer eligibility, trusted provenance, exact-group links and combined zero-result discovery admission; development price inspection and read-only audit command. No matching thresholds, identity rules, dependencies or schema changed.

Verified: 534 eligible offers, 499 calculable / 35 withheld; reviewed 29 eggs, twenty mass staples, fifteen volume offers and direct-KG samples; real huevos/arroz/azúcar/aceite/milk searches. Format/lint/types, 430 unit tests and 28 isolated PostgreSQL tests pass. The original build/E2E restriction described in [generic comparison](generic-comparison.md) is historical. Milestone 8 is complete in the user-provided baseline `1401f97`. Its audit exposed missing staple coverage and incidental-keyword relevance, addressed below.

## Milestone 9 — Staple-category coverage and generic-search relevance

Implemented: small recomputable ten-family evidence model outside exact identity; validated source-leaf precedence, conservative product nouns and negative evidence; family-aware generic/combined admission with retained brand/size/variant tokens and lexical fallback; twelve bounded permanent PV/Metro category sources; scheduled integration before one derivation pass; source/family developer inspection; tuna net/drained and tiny-staple quantity safeguards, indicative paper-roll explanation; repeatable relevance audit and reviewed regression fixtures. No dependencies, schema/migrations or matcher thresholds changed.

Verified: 199 added listings, 735 total; sugar P@5 0.00→1.00, all ten after-query P@5/P@10 1.00, bounded relevance counts/coverage and limitations recorded in [staple report](staple-coverage.md). Source persistence and original history integrity passed, normalization/matching repeats wrote zero, full scheduled and one-SKU targeted refresh passed. Format/lint/types, 481 unit cases and 33 isolated PostgreSQL cases pass.

Milestone 9 is complete in the user-provided baseline `d8858b3`; its earlier agent build/E2E notes in the staple report are historical.

## Milestone 10 — Quantity/source quality and catalog operating budget

Implemented: explicit comparison basis and strong/approximate quality, conservative tuna content/count rejection, separate approximate roll grouping and display, detergent dimension safety, source audit, complete-catalog quantity audit, and local/DB operating budget command with actual workflow cadence and category request counts. Exact normalization remains version 1 and matcher rules/thresholds remain unchanged. No migrations, dependencies, new retailers, permanent categories or infrastructure.

Verified: 736 listings, 127 public exact offers / 57 groups, 763 history states; 605 strong physical + 31 strong item-count + 38 approximate roll comparisons, 62 withheld. Full refresh 76.503s / 27 category requests / zero targeted, 8,853 candidates / zero matching writes. Two normalization repeats and one targeted lookup wrote zero and preserved history. Format/lint/types, 499 unit tests and 34 isolated PostgreSQL tests pass. See [quantity quality](quantity-quality.md) and [catalog budget](catalog-budget.md) for source evidence, safety policies, unavailable metrics and projections.

Pending: fresh local `pnpm build` and Chromium `pnpm test:e2e` confirmation after the known Turbopack CSS-worker port restriction. Changes are staged without commit/push until that explicit gate; Milestone 10 is not complete yet.

Recommend reviewing the 1000-listing guard and validating small Tottus sources before future bounded expansion. The first price-history UX should show ordinary observed changes/timestamps/gaps on exact product detail pages; no later milestone is started.

## Later — Price history

Store and visualize meaningful price changes. Avoid redundant unchanged observations while preserving freshness information.

## Later — Promotions

Model percentage discounts, 2x1, second-unit discounts, quantity discounts, date ranges, specific weekdays, payment requirements and membership requirements. Test effective prices and eligibility.

## Later — Buy now or wait

Use current/historical prices, confirmed future promotions and clearly labelled historical patterns. Never present unconfirmed future prices as facts.

## Later — Shopping lists

Allow users to assemble full grocery baskets, using the simplest adequate state/persistence approach.

## Later — Basket optimization

Compare one-store purchases and two-store combinations, delivery/travel costs where applicable and user preferences. Test explicit constraints.

## Later — Accounts and alerts

Add authentication only when user-specific lists, preferences or alerts justify it.

## Later — Scale only as needed

Potential options, not guaranteed requirements: TanStack Query, TanStack Form, shadcn Chart/Recharts, Cheerio, browser Playwright, Upstash, Inngest, dedicated workers and a dedicated search engine. Introduce each only for demonstrated requirements or measured workloads.
