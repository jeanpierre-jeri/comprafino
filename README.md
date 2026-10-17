# CompraFino

Para orientarte en el código, las herramientas y el trabajo pendiente, empieza por la [guía del proyecto](docs/README.md).

Authenticated lists persist and synchronize with the account; signed-out lists remain browser-local. Pending anonymous imports can be preserved, downloaded or explicitly discarded, or resumed in their original account, without automatic ownership transfer. See [persistence and recovery](docs/shopping-list-persistence.md). Repository implementation and local verification do not establish the current production revision or migration state.

CompraFino compares observed grocery and household prices from Tottus, Plaza Vea, Metro and Makro in Peru. It provides exact product comparisons, independent retailer search options, ordinary price history with observation gaps, and anonymous browser-local and authenticated synchronized recurring shopping lists with current basket comparisons across up to three supermarkets. Concrete Tottus CMR benefits are shown separately from ordinary prices. Prices are observations, not checkout guarantees.

Makro support uses public VTEX channel 9 and ordinary prices only. Quantity/payment promotions and address-specific availability remain unsupported. Its schema requirements and source boundaries are documented in [Makro integration](docs/retailers/makro.md); new environments apply the full reviewed migration journal.

## Architecture and packages

Next.js App Router serves the public UI from persisted PostgreSQL data. GitHub Actions runs bounded retailer ingestion, refresh and search-driven discovery. Public browsing never fetches retailer websites. There is no separate always-on API server or worker.

| Package             | Responsibility                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `apps/web`          | Server-rendered routes, interactive controls, browser list storage and application tests              |
| `packages/core`     | Framework-independent validation, pricing, normalization, matching and shopping/basket policy         |
| `packages/db`       | Lazy Drizzle/Neon access, reviewed PostgreSQL migrations, ingestion transactions and query boundaries |
| `packages/scrapers` | Isolated public-data retailer adapters and bounded acquisition orchestration                          |
| `packages/ui`       | Shared Base UI components, theme and Recharts primitives                                              |

Dependencies flow `web → ui, db, core`, `scrapers → core, db`, `db → core`. Internal dependencies use `workspace:*`; packages export typed source. See [architecture](docs/architecture.md), [dependencies](docs/dependencies.md) and [code readability/frontend state](docs/code-readability.md).

## Install and develop

Use Node.js **24.x** and pnpm **12.8.1**, pinned by `.node-version` and `packageManager`. Select these with your version manager/Corepack; use pnpm only and do not install project dependencies globally.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://127.0.0.1:3000>. The homepage, unit tests and build require no database credentials. Database-backed routes require the reviewed schema and `DATABASE_URL`. System fonts avoid external font downloads.

`apps/web/next-env.d.ts` is generated and ignored. `pnpm typecheck` runs `next typegen` before TypeScript, including on a fresh clone. Repository agent instructions live in [AGENTS.md](AGENTS.md).

## Environment and database setup

```sh
cp .env.example .env
# Set DATABASE_URL in root .env to the application PostgreSQL connection URL.
pnpm db:migrate
```

Apply the existing reviewed migration journal first. `pnpm db:generate` is for an intentional schema change: review its SQL and metadata before applying it. Builds and startup never apply migrations automatically. PostgreSQL must support the journaled `pg_trgm` extension.

Root CLI commands load `.env`. Set `DATABASE_URL` separately in `apps/web/.env.local` for development routes, and in hosting settings for deployment. Never commit credentials. `TEST_DATABASE_URL` is an explicit dedicated-test opt-in; test runners never use application `DATABASE_URL` as a fallback. Local Docker wrappers supply their own disposable URL.

Test-only `COMPRAFINO_TEST_DATABASE_MODE`, `COMPRAFINO_E2E_SCHEMA`, `COMPRAFINO_E2E_PRELOAD`, `COMPRAFINO_CONTROLLED_E2E` and fixture-ID variables belong to the harness; do not set them in normal development or deployment. See [local testing](docs/local-testing.md).

Google sign-in uses Better Auth 1.7.7. Auth requests require server-only `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and the existing database URL. Public browsing/builds remain credential-free. Auth and list tables are part of the reviewed migration journal; their presence and provider configuration must be checked in the intended environment. See [auth setup and dated rollout evidence](docs/auth.md).

## Validation and deterministic fixtures

```sh
pnpm format:check
pnpm docs:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db:up
pnpm test:integration:local
pnpm build
pnpm --filter @comprafino/web exec playwright install chromium --only-shell
pnpm test:e2e:fixtures:local
pnpm test:db:down
```

Oxlint lints, Oxfmt formats and TypeScript is authoritative. Vitest covers pure logic and boundaries; `pnpm test` also runs the browser-free Next stream regressions. PostgreSQL integration and browser fixtures apply the checked-in journal to owned random schemas and clean them up. Build before Chromium. On Linux, Playwright's `--with-deps` option installs browser system requirements.

`pnpm test:e2e` runs ordinary production smoke and optional live-catalog cases. Required CI instead runs the combined deterministic history/listing/shopping/basket fixture and smoke suite without repository secrets, including fork PRs. The `CI` workflow's `check` job uploads `playwright-failure-results` on failure. Individual fixture commands and database-only validation are documented in [local testing](docs/local-testing.md).

## Operational commands

In a local terminal, root commands show start/completion and elapsed time every fifteen seconds. Catalogue acquisition, derivation, discovery and targeted refresh also report work counters and phases. Additional progress stays off in CI/production and uses stderr, preserving JSON reports on stdout. Use `COMPRAFINO_PROGRESS=0 pnpm acquire:catalog -- --pages=100` to silence it locally. See [catalogue progress and budgets](docs/catalog-expansion.md#acquisition-and-coverage).

Commands below use root `DATABASE_URL` unless marked database-free. Apply migrations before writers and readers, and roll out all ingestion/identity writers together.

| Command                                                                                   | Purpose                                                                                                                                |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm scrape:tottus`, `pnpm scrape:plaza-vea`, `pnpm scrape:metro`, `pnpm scrape:makro`   | Bounded allowlisted ingestion; append `-- --dry-run --limit=20` to inspect without a database                                          |
| `pnpm acquire:catalog -- --pages=100`                                                     | Scheduled resumable category processor, followed by targeted refresh and incremental derivation; `--dry-run` only reads DB state       |
| `pnpm derive:catalog -- --limit=50000`                                                    | Bounded incremental normalization/matching without retailer calls; `--dry-run` only reads pending work                                 |
| `pnpm refresh:catalog`                                                                    | Legacy manual fixed-category sample, targeted refresh and incremental derivation; `-- --dry-run` fetches retailers without persistence |
| `pnpm refresh:listings -- --dry-run --limit=50`                                           | Read-only database selection preview; normal mode performs bounded exact lookup                                                        |
| `pnpm discover:catalog -- --dry-run --limit=3`                                            | Read-only demand preview; normal mode processes bounded retailer searches                                                              |
| `pnpm normalize:catalog -- --limit=50000`                                                 | Recompute derived listing identity; no retailer requests or price-history changes                                                      |
| `pnpm match:catalog -- --dry-run --limit=2000`                                            | Bounded manual exact-association preview, not whole-catalog derivation; use `derive:catalog` for incremental work                      |
| `pnpm match:evaluate`, `pnpm match:audit`                                                 | Separate calibration and independent reviewed matching evaluations                                                                     |
| `pnpm coverage:report`, `pnpm audit:catalog-coverage`, `pnpm audit:availability`          | Read-only freshness, usefulness and availability reports                                                                               |
| `pnpm audit:unit-prices`, `pnpm audit:staples`, `pnpm audit:quantity-quality`             | Read-only relevance and comparison-quality audits                                                                                      |
| `pnpm audit:price-history`, `pnpm audit:observation-coverage`, `pnpm audit:shopping-list` | Read-only temporal and shopping audits                                                                                                 |
| `pnpm catalog:budget`                                                                     | Current configured limits and DB metrics alongside qualified dated evidence                                                            |
| `pnpm benchmark:basket:local`                                                             | Disposable DB handler benchmark; writes a new ignored `.artifacts/` report                                                             |

The checked-in workflows schedule `acquire:catalog` and discovery every two hours, sharing noncanceling concurrency. This is intended cadence, not observed update frequency or a guarantee that a full catalog cycle finishes each run. Exact cron expressions, timeouts and workflow links are maintained in [operations](docs/operations.md#scheduling-and-concurrency). Retailer-specific ingestion workflows remain manual; workflow `DATABASE_URL` secrets are operational inputs, not CI fixture inputs. See [discovery](docs/discovery.md) and [listing refresh](docs/listing-refresh.md).

Read-only `pnpm health:catalog` and the scheduled/post-acquisition health checks report overdue refreshes, failed attempts, lost current search coverage and measured capacity skips. See [catalog health and notification setup](docs/catalog-health.md).

## Deployment

Vercel hosts the Next.js app, Neon supplies PostgreSQL, and GitHub Actions schedules acquisition. Local repository state does not establish which revision is currently deployed.

For Vercel, select `apps/web` as Root Directory, enable access to files outside that directory, retain the Next.js preset and set Install Command to `pnpm install --frozen-lockfile`. Use the workspace web build (`pnpm build` within that root); keep the default Next.js output. Set `DATABASE_URL` in the required deployment environments. Apply reviewed migrations explicitly before coordinated writer/reader rollout, then verify production public routes and refresh outcomes. Developer `/dev/*` routes return 404 in production.

Frozen installation retains the version-pinned **next@16.3.8** stream-cancellation patch. Rebuild/restart after installation. Its reason, regressions and removal condition are in [dependencies](docs/dependencies.md#next-stream-cancellation-patch).

## Important limitations and deeper guides

Retained capacity is **50,000 retailer listings**, as configured by [catalogPolicy](packages/core/src/catalog-policy.ts). A listing is one store offer, not necessarily a distinct product or a valid cross-store comparison. This admission/read guard does not establish acquired inventory, useful coverage or hosting capacity. [Resumable acquisition](docs/catalog-expansion.md) advances bounded public-category work; capacity never increases automatically. Anonymous location/channel stock can be unknown, and observed prices can become stale. Exact comparison requires trusted identity; generic search relevance does not prove safe substitution. Supported substitutions remain conservative. Ordinary purchase prices must be positive; reference prices and conditional benefits have separate meanings.

Signed-out shopping lists are stored in this browser, with a session fallback if storage fails. Signed-in lists synchronize with the account, with guarded anonymous import and account transitions. This behavior requires the reviewed auth/list migrations and server configuration in the deployed environment; repository implementation does not establish production rollout. There is no account dashboard or delivery/travel fee calculation. Conservative [weekday purchase advice](docs/shopping-list.md#weekday-purchase-advice) is implemented for supported specific selections, using four complete weeks of ordinary-price evidence. Insufficient evidence or no clear repeated pattern produces an explicit abstention, not a forecast or guaranteed future saving. History gaps are disclosed without backfill. No remote quota or live catalog count is promised by repository documentation.

See [eligibility vocabulary](docs/eligibility.md), [normalization](docs/catalog-normalization.md), [matching](docs/catalog-matching.md), [public search](docs/public-search.md), [quantity quality](docs/quantity-quality.md), [availability](docs/availability.md), [conditional pricing](docs/conditional-pricing.md), [price history](docs/price-history.md), [shopping lists](docs/shopping-list.md), [basket optimization](docs/basket-optimization.md), [catalog budget](docs/catalog-budget.md), [roadmap](docs/roadmap.md) and [dated engineering history](docs/history/README.md).

**04A remains deferred:** the [isolated hosting test kit](docs/hosting-test-environment.md) is prepared locally; remote load, cancellation and recovery remain unverified. No remote test resources or deployments are required for this documentation update. [Dated evidence and resumption criteria](docs/history/hosting-request-budgets-2026-10-16.md#decisión-posterior-verificación-remota-aplazada) remain separate from local correctness and performance results.
