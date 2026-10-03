# CompraFino

A Peruvian grocery and household-products price intelligence platform, currently at the technical foundation stage.

## Problem

Supermarket pricing in Peru is fragmented across retailers. Promotions can depend on dates, quantities, payment methods and campaigns, making it difficult to judge the real cost of a purchase.

## Vision

The roadmap aims to help people decide where to buy, when to buy, whether a price is good, and how to optimize an entire shopping basket. These capabilities are **planned**, not available today.

## Current status

Foundation/bootstrap only: a Spanish placeholder homepage, shared Base UI button, strict typed workspaces, a small pure utility, unit and browser smoke tests, and lazy database access with migration tooling. No catalog, retailer ingestion, comparison, search, account system or live database schema exists yet. The homepage deliberately disables search and requires no database.

## Initial retailers

Planned integrations: **Tottus**, **Plaza Vea**, and **Metro**, in that order. None is implemented.

## Architecture

Serverless first: Next.js is intended to run on Vercel, PostgreSQL on Neon, and future scheduled ingestion on GitHub Actions. There is no always-on API server or worker. No resources have been provisioned or deployed. See [architecture](docs/architecture.md).

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
packages/scrapers/ Future retailer ingestion boundary (no adapters/dependencies yet)
packages/ui/       Shared shadcn Base UI components, utilities and Tailwind theme
.github/workflows/ Credential-free CI; future ingestion workflows belong here
docs/             Architecture, roadmap and dependency inventory
```

Internal dependencies are intentionally minimal: `web → ui`. Core, database and scrapers are separate today; adapters will depend on core/database only when implemented. Library workspaces export typed source and are compiled by their consumer; they do not need artificial build scripts. The core package has no React, Next.js, database or browser dependency.

## Local development

Requires Node.js **24.x** and pnpm **12.8.1**. Use your existing version manager/Corepack to select the pinned pnpm version; do not install dependencies globally for this project.

```sh
cd comprafino
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://127.0.0.1:3000>. Stop with Ctrl+C. The app uses system fonts, so builds need no external font download. Only the shared Base UI button is a Client Component; the homepage and layout remain Server Components.

If you are using the original bootstrap workspace and its older system pnpm, the ignored project-local binary is available:

```sh
export PATH="$PWD/.tools/bin:$PATH"
pnpm --version
```

That helper is local to the bootstrap environment and is not required in a fresh checkout. The original bootstrap also stores Chromium locally; run `PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/browsers" pnpm test:e2e` to reuse it, or run the standard browser installation below. `pnpm-workspace.yaml` keeps the pnpm store inside the project; use the pinned pnpm yourself.

## Environment variables

The root `.env.example` contains `DATABASE_URL=`. No environment variable is needed for the homepage, unit tests or build.

For actual migrations:

```sh
cp .env.example .env
# Set DATABASE_URL to your Neon PostgreSQL connection URL.
pnpm db:generate
# Review the generated SQL before applying it.
pnpm db:migrate
```

Generation reads the schema locally and needs no database. The schema is intentionally empty, so no product tables or SQL changes are generated yet. Migration configuration loads root `.env`, respects existing process variables, and rejects a missing/invalid URL with a clear message. `createDatabase()` validates only when explicitly called. Future web database access should receive `DATABASE_URL` through Vercel environment settings or `apps/web/.env.local`. Never commit secret files. No live migration was performed during bootstrap.

## Scripts

| Command                             | Purpose                                                        |
| ----------------------------------- | -------------------------------------------------------------- |
| `pnpm dev`                          | Start the Next.js development server                           |
| `pnpm build`                        | Build production application through Turbo                     |
| `pnpm lint` / `pnpm lint:fix`       | Type-aware Oxlint checks / fixes                               |
| `pnpm format` / `pnpm format:check` | Oxfmt formatting / verification                                |
| `pnpm typecheck`                    | Generate Next types and run `tsc --noEmit` for every workspace |
| `pnpm test`                         | Vitest tests in core and database packages                     |
| `pnpm test:e2e`                     | Chromium smoke test against a production server (build first)  |
| `pnpm db:generate`                  | Generate reviewed migrations from the schema                   |
| `pnpm db:migrate`                   | Apply migrations; requires `DATABASE_URL`                      |

Turbo caches builds, type checks and unit tests; development servers are persistent and uncached. Repository lint/format run once from the root. Only workspaces with actual tasks declare them.

## Testing

Unit tests cover a generic pure utility and database configuration boundaries without database calls. Browser smoke testing checks the homepage, language, planned retailers and disabled upcoming search, against `next start` on port 3100.

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

For a future Vercel project, select this monorepo, set Root Directory to `apps/web`, enable inclusion of source outside that directory, and use the Next.js preset with the pinned pnpm lockfile. Use `pnpm exec turbo run build --filter=@comprafino/web` from the repository root if customizing the build command; the default app `pnpm build` also works. Set `DATABASE_URL` only once server database features exist. Provision Neon separately and run reviewed migrations explicitly before dependent releases. Configure GitHub Actions database secrets only when a tested ingestion workflow needs them. Do not put credentials in build commands or client bundles.

## Roadmap

Next: prove ingestion for one retailer before building consumer features. Subsequent milestones cover normalization, deterministic cross-retailer matching, search, comparison, price history, promotions, buying guidance, shopping lists and basket optimization. Accounts and additional infrastructure arrive only when justified. See the [roadmap](docs/roadmap.md).

TanStack Form, TanStack Query and shadcn Chart/Recharts are intended options for future complexity, not current dependencies. Redis, queues, external search, AI, dedicated workers and browser scraping are also deferred.
