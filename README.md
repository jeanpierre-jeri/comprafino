# CompraFino

A Peruvian grocery and household-products price intelligence platform with verified bounded Tottus, Plaza Vea and Metro ingestion pipelines.

## Problem

Supermarket pricing in Peru is fragmented across retailers. Promotions can depend on dates, quantities, payment methods and campaigns, making it difficult to judge the real cost of a purchase.

## Vision

The roadmap aims to help people decide where to buy, when to buy, whether a price is good, and how to optimize an entire shopping basket. These capabilities are **planned**, not available today.

## Current status

Milestones 1A/1B and Milestone 1C ingestion correctness: bounded public Tottus, Plaza Vea and Metro ingestion, validated listings, integer PEN cents, applied PostgreSQL migration, meaningful price-state history and ingestion runs. Two live Neon ingestions per retailer proved unchanged-run idempotency; Metro final local build/E2E verification is pending; controlled isolated-schema PostgreSQL tests verify price transitions, rollback and concurrent persistence. A development-only inspection page is available at `/dev/ingestion`. Consumer search/comparison, accounts and matching remain planned. The homepage requires no database.

## Initial retailers

**Tottus**, **Plaza Vea** and **Metro** have bounded category adapters.

## Architecture

Serverless first: Next.js is intended to run on Vercel, PostgreSQL on Neon, and future scheduled ingestion on GitHub Actions. There is no always-on API server or worker. The developer has configured Neon; the web application and scheduled ingestion have not been deployed. See [architecture](docs/architecture.md).

## Technology

- **Next.js 16 / React 19:** Server Components and server-side loading keep the first application simple and suited to Vercel.
- **PostgreSQL / Neon:** relational storage provides a durable basis for future catalog and price history without an always-on application server.
- **Drizzle:** typed queries and reviewed SQL migrations, using Neon's serverless HTTP driver.
- **pnpm workspaces:** package ownership and dependency relationships. **Turborepo:** task execution, dependency ordering, parallelism and caching.
- **TypeScript:** strict authoritative checking. **Zod 4:** validation at external boundaries, currently the database URL.
- **Oxlint / Oxfmt:** correctness-focused linting (including type-aware rules) and one repository formatter.
- **Vitest / Playwright Test:** fast unit tests and a real Chromium smoke test of the production application.

Stable dependency versions were checked against npm registry metadata before installation. Exact direct versions are pinned in manifests; `pnpm-lock.yaml` pins the full graph. [Dependency inventory](docs/dependencies.md) records ownership and purpose.

## Repository structure

```text
apps/web/          Next.js App Router application and E2E tests
packages/core/     Framework-independent pure logic and unit tests
packages/db/       Lazy Drizzle/Neon client, schema home, environment validation, migration configs
packages/scrapers/ Retailer public-data adapters, fixtures and bounded ingestion CLI
packages/ui/       Shared shadcn Base UI components, utilities and Tailwind theme
.github/workflows/ Credential-free CI and manual bounded retailer ingestion
docs/             Architecture, roadmap and dependency inventory
```

Internal dependencies: `web → ui, db`; `scrapers → core, db`; `db → core`. Library workspaces export typed source and are compiled by their consumer; they do not need artificial build scripts. The core package has no React, Next.js, database or browser dependency.

## Local development

Requires Node.js **24.x** and pnpm **12.8.1**. Use your existing version manager/Corepack to select the pinned pnpm version; do not install dependencies globally for this project.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://127.0.0.1:3000>. Stop with Ctrl+C. The app uses system fonts, so builds need no external font download. Only the shared Base UI button is a Client Component; the homepage and layout remain Server Components.

Codex repository instructions live in the root `AGENTS.md`. Next.js agent-file auto-generation is disabled so development does not create `CLAUDE.md` or duplicate app-level instructions.

If you are using the original bootstrap workspace and its older system pnpm, the ignored project-local binary is available:

```sh
export PATH="$PWD/.tools/bin:$PATH"
pnpm --version
```

That helper is local to the bootstrap environment and is not required in a fresh checkout. The original bootstrap also stores Chromium locally; run `PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/browsers" pnpm test:e2e` to reuse it, or run the standard browser installation below. `pnpm-workspace.yaml` keeps the pnpm store inside the project; use the pinned pnpm yourself.

## Environment variables

The root `.env.example` contains `DATABASE_URL=` and the explicit integration-test opt-in `TEST_DATABASE_URL=`. No environment variable is needed for the homepage, unit tests or build.

For actual migrations:

```sh
cp .env.example .env
# Set DATABASE_URL to your Neon PostgreSQL connection URL.
pnpm db:generate
# Review the generated SQL before applying it.
pnpm db:migrate
```

Generation reads the schema locally and needs no database. The first migration creates retailers, retailer listings, price history and ingestion runs, and seeds the three retailer identities. Migration configuration loads root `.env`, respects existing process variables, and rejects a missing/invalid URL with a clear message. `createDatabase()` validates only when explicitly called. Web database access should receive `DATABASE_URL` through Vercel environment settings or `apps/web/.env.local`. Never commit secret files. The Tottus migration has since been applied and its live Neon constraints/indexes verified.

## Tottus ingestion

```sh
pnpm scrape:tottus -- --dry-run --limit=20
# After reviewing and applying migrations, with DATABASE_URL in root .env:
pnpm scrape:tottus -- --limit=50
```

Dry-run requires no database and prints five normalized samples. Default limit: 20; maximum: 500, restricted to one category. Persisted runs fail clearly without `DATABASE_URL`. `/dev/ingestion` reads current results during `pnpm dev`; set `DATABASE_URL` in `apps/web/.env.local`. The route returns 404 in production. The manual workflow `.github/workflows/ingest-tottus.yml` needs a repository secret named `DATABASE_URL`; it never applies migrations automatically. See [Tottus integration](docs/retailers/tottus.md) for observed fields, verification evidence and limitations.

## Plaza Vea ingestion

```sh
pnpm scrape:plaza-vea -- --dry-run --limit=20
pnpm scrape:plaza-vea -- --limit=50
```

Native fetch reads the public VTEX catalog for one dairy/eggs category in anonymous channel 1. Seller-1 ordinary prices exclude conditional card/quantity teaser discounts. Default 20 usable listings, maximum 500, at most 25 sequential pages / 500 source products. Dry-run needs no database; persisted mode requires `DATABASE_URL`. Two live runs verified 50 then 0 new price states. No dependencies or migrations were added. The manual `.github/workflows/ingest-plaza-vea.yml` reuses the same `DATABASE_URL` secret and has no schedule. See [Plaza Vea integration](docs/retailers/plaza-vea.md) for source fields, price/unit interpretation and location limitations.

## Metro ingestion

```sh
pnpm scrape:metro -- --dry-run --limit=20
pnpm scrape:metro -- --limit=50
```

Native fetch reads the public VTEX catalog for one dairy category in anonymous channel 1. Seller-1 ordinary prices exclude Metro-card promotion teasers; only higher reference prices are retained. Default 20 usable listings, maximum 500, at most 25 sequential pages / 500 source products. Dry-run needs no database; persisted mode requires `DATABASE_URL`. Two live runs verified 50 then 0 new price states. No dependencies or migrations were added. The manual `.github/workflows/ingest-metro.yml` reuses `DATABASE_URL` and has no schedule. See [Metro integration and three-retailer review](docs/retailers/metro.md) for live samples, price/package semantics and validation limitations. Final fresh local build/E2E confirmation is pending before commit.

## Scripts

| Command                             | Purpose                                                        |
| ----------------------------------- | -------------------------------------------------------------- |
| `pnpm dev`                          | Start the web development server directly through pnpm         |
| `pnpm build`                        | Build production application through Turbo                     |
| `pnpm lint` / `pnpm lint:fix`       | Type-aware Oxlint checks / fixes                               |
| `pnpm format` / `pnpm format:check` | Oxfmt formatting / verification                                |
| `pnpm typecheck`                    | Generate Next types and run `tsc --noEmit` for every workspace |
| `pnpm test`                         | Vitest tests in core, database and scraper packages            |
| `pnpm test:integration`             | Isolated-schema PostgreSQL tests; explicit `TEST_DATABASE_URL` |
| `pnpm test:e2e`                     | Chromium smoke test against a production server (build first)  |
| `pnpm db:generate`                  | Generate reviewed migrations from the schema                   |
| `pnpm db:migrate`                   | Apply migrations; requires `DATABASE_URL`                      |

Turbo caches builds, type checks and unit tests. The root development command starts the single web server directly through pnpm, avoiding Turbo's child-process output interaction with pnpm 12's Node.js fallback launcher. Development is uncached. Repository lint/format run once from the root. Only workspaces with actual tasks declare them.

## Testing

Unit tests cover source fixtures, money parsing, normalization, persistence SQL contracts, a deterministic price-state reference model and run outcomes without live network/database calls. `pnpm test:integration` separately exercises the real Neon HTTP persistence batch on PostgreSQL, without Turbo caching. It skips clearly when `TEST_DATABASE_URL` is absent and never loads `.env` or falls back to `DATABASE_URL`. Export the test URL explicitly, preferably for a dedicated Neon test database/branch. The suite applies the checked-in migration inside a fresh randomly named schema, sets transaction-local search paths without a public fallback, and drops only its own schema afterwards. Its only migration adjustment qualifies foreign keys with that test schema; live tables are untouched. The role needs schema-creation permission. An interrupted process may leave its isolated schema for manual review/cleanup. Browser smoke testing checks the homepage and production blocking of developer tooling against `next start` on port 3100.

```sh
pnpm test
pnpm build
pnpm --filter @comprafino/web exec playwright install chromium --only-shell
pnpm test:e2e
```

On a Linux machine missing Chromium system libraries, use `playwright install --with-deps chromium --only-shell` in the web workspace. CI installs only Chromium's headless shell and its system requirements, then runs the smoke test without credentials. CI also checks frozen installation, formatting, lint, types, unit tests and production build on PRs and pushes to `main`.

`@playwright/test` is application testing tooling; no browser scraper dependency is installed. React Testing Library is deferred until component-level tests justify it.

## Data ingestion philosophy

Use legitimate publicly accessible data only, with conservative requests. Prefer simple JSON/data endpoints, then HTTP parsing; browser automation is a last step justified by a real adapter. Do not bypass authentication, CAPTCHAs, bot protection or access controls, and do not use stealth tooling. Validate external data before domain logic or persistence. No ingestion schedule exists yet.

## Initial deployment strategy

Intended free-tier starting point (not deployed): **Vercel** for web, **Neon** for PostgreSQL, **GitHub Actions** for scheduled ingestion. Free-tier quotas and provider terms must be assessed when deploying.

For a future Vercel project, select this monorepo, set Root Directory to `apps/web`, enable inclusion of source outside that directory, and use the Next.js preset with the pinned pnpm lockfile. Use `pnpm exec turbo run build --filter=@comprafino/web` from the repository root if customizing the build command; the default app `pnpm build` also works. Set `DATABASE_URL` for server database features; the developer inspection route remains unavailable in production. Provision Neon separately and run reviewed migrations explicitly before dependent releases. The manual Tottus, Plaza Vea and Metro ingestion workflows require the GitHub Actions secret `DATABASE_URL` and explicitly applied migrations. They have no schedule. Do not put credentials in build commands or client bundles.

## Roadmap

Next after final Milestone 1C local build/E2E verification: catalog normalization. All three retailer ingestions have live idempotency evidence; Metro changes remain staged because the fresh agent Turbopack build still hits its known worker-port restriction. The default build configuration is unchanged. Subsequent milestones cover normalization, deterministic cross-retailer matching, search, comparison, price history, promotions, buying guidance, shopping lists and basket optimization. Accounts and additional infrastructure arrive only when justified. See the [roadmap](docs/roadmap.md).

TanStack Form, TanStack Query and shadcn Chart/Recharts are intended options for future complexity, not current dependencies. Redis, queues, external search, AI, dedicated workers and browser scraping are also deferred.
