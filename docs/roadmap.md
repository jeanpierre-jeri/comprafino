# Roadmap

Milestone 0 is implemented. Milestone 1A has a working live Tottus dry-run and persistence implementation; live PostgreSQL verification remains pending. Later consumer milestones describe planned functionality.

## Milestone 0 — Foundation

Typed workspaces, Next.js placeholder, shared Base UI button, lazy database access, migration tooling, tests, CI and docs. No deployment or ingestion.

## Milestone 1 — Data ingestion proof

Implement adapters one at a time: **Tottus → Plaza Vea → Metro**. Inspect legitimate public sources, validate payloads and prove repeatable ingestion before consumer features. Establish the minimum real schema from observed requirements. Schedule conservative GitHub Actions jobs only after the adapter is proven.

### Milestone 1A — Tottus ingestion proof

Implemented: public hydration JSON investigation, bounded native-fetch adapter, SKU identity, Zod validation, integer PEN cents, source package/unit metadata, sanitized fixtures, generated schema/migration, atomic persistence SQL, price-state reference tests, run records, CLI, development inspection route and manual workflow. Live dry-run passed with 20 unique listings. No scraping libraries added.

Pending: review/apply migration to the developer's PostgreSQL, run persisted ingestion twice, verify price transitions/rollback and concurrent writers on PostgreSQL. Availability and location-sensitive coverage remain unproven. Do not mark the full end-to-end proof complete until those checks pass. Plaza Vea and Metro are unimplemented.

## Milestone 2 — Catalog normalization

Normalize brands, titles, quantities, units, package counts and categories. Preserve source values and test ambiguous cases.

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
