# Roadmap

Milestones 0–2 are complete in the committed task baseline (`3abd9f9`). Milestone 3's implementation, original local build/E2E and broader independent audit are verified. The expanded 351-listing dairy/meat dataset has 28 audited canonical groups; the unchanged matcher achieved 34/34 observed automatic precision in 105 new reviewed pairs. Final fresh local build/E2E confirmation is pending for the additional ingestion/category/audit code, before commit. Consumer milestones remain planned.

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

Pending: fresh local production build/E2E for the minimal allowlisted Tottus dairy/omitted-price-unit boundary and audit additions, then the intended commit. The independent-audit target is met; do not claim final completion before these updated-code checks pass. Stage and wait for confirmation; no push or public search.

## Milestone 4 — Search MVP

Public product search and filtering over verified catalog data.

## Milestone 5 — Product comparison

Compare current prices and price per unit across retailers; expose observation time and availability.

## Milestone 6 — Price history

Store and visualize meaningful price changes. Avoid redundant unchanged observations while preserving freshness information.

## Milestone 7 — Promotions

Model percentage discounts, 2x1, second-unit discounts, quantity discounts, date ranges, specific weekdays, payment requirements and membership requirements. Test effective prices and eligibility.

## Milestone 8 — Buy now or wait

Use current/historical prices, confirmed future promotions and clearly labelled historical patterns. Never present unconfirmed future prices as facts.

## Milestone 9 — Shopping lists

Allow users to assemble full grocery baskets, using the simplest adequate state/persistence approach.

## Milestone 10 — Basket optimization

Compare one-store purchases and two-store combinations, delivery/travel costs where applicable and user preferences. Test explicit constraints.

## Milestone 11 — Accounts and alerts

Add authentication only when user-specific lists, preferences or alerts justify it.

## Milestone 12 — Scale only as needed

Potential options, not guaranteed requirements: TanStack Query, TanStack Form, shadcn Chart/Recharts, Cheerio, browser Playwright, Upstash, Inngest, dedicated workers and a dedicated search engine. Introduce each only for demonstrated requirements or measured workloads.
