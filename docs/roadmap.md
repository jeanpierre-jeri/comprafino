# Roadmap

Milestone 0 and Milestone 1 are complete in the task baseline (Metro committed at `20acec9`). Milestone 2 normalization is implemented and audited; final local default build/Chromium E2E confirmation and commit remain pending because the agent's Turbopack worker cannot bind its port. Later consumer milestones describe planned functionality.

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

Pending: fresh local `pnpm build` and `pnpm test:e2e`, then the requested `feat: add catalog normalization` commit. Agent default/elevated Turbopack builds hit the known worker-port restriction; E2E cannot start without a fresh production artifact. Build architecture remains unchanged. [Catalog normalization](catalog-normalization.md) documents the full audit, limitations and future matching recommendation. Milestone 2 is not declared fully complete until those checks pass; Milestone 3 has not begun.

## Milestone 3 — Cross-retailer product matching

Use identifiers, normalized attributes, deterministic rules and PostgreSQL similarity to identify equivalent products. Start without LLM matching; represent uncertainty explicitly.

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
