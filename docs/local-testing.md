# Local PostgreSQL tests

Docker Compose supplies an ephemeral PostgreSQL 17 database for integration tests and history browser fixtures. It requires no Neon account or database URL:

```sh
pnpm test:db:up
pnpm test:integration:local
pnpm build
pnpm test:e2e:history:local
```

To validate only the six history fixtures without starting Playwright:

```sh
pnpm test:e2e:history:local --validate-fixtures
```

Stop and discard the database when finished:

```sh
pnpm test:db:down
```

The container binds to `127.0.0.1:55432`, initializes `pg_trgm`, and uses temporary storage. Its dedicated `comprafino_test` database uses trust authentication for local testing; no password is stored in the repository. Stopping/recreating the container discards its contents. This Compose configuration is for tests only.

The local commands explicitly set `TEST_DATABASE_URL=postgresql://comprafino_test@127.0.0.1:55432/comprafino_test` and `COMPRAFINO_TEST_DATABASE_MODE=local`. They do not read `.env` or use the application `DATABASE_URL`. Each run applies reviewed migrations inside a random schema and drops that schema on completion, including failures. The history runner passes the same schema and local mode to its web server. Local web access requires an isolated browser-test schema; the local transport rejects non-loopback hosts and other database names.

Normal application connections continue to use Neon HTTP. The local test transport uses `pg` TCP connections while preserving Drizzle's lazy queries, batch transactions, and transaction-local schema isolation. The existing explicit `TEST_DATABASE_URL=… pnpm test:integration` and `TEST_DATABASE_URL=… pnpm test:e2e:history` commands still support Neon without local mode.

Browser tests require a successful production build first. A Turbopack worker-port restriction in the agent sandbox can prevent that build; run the build locally in that case.

## Canceled React streams

Next 16.3.8 can report `The destination stream closed early.` when navigation, canceled prefetches or browser teardown close an unfinished RSC response. Passing browser tests can therefore produce server error logs. This is an upstream cancellation classification bug, reproduced directly with a suspended React stream.

The version-pinned `patches/next@16.3.8.patch` backports the behavior of [Next.js PR #96715](https://github.com/vercel/next.js/pull/96715). It registers a close listener before React pipes the response and aborts unfinished renders with Next's existing `ResponseAborted` type. Completed streams and actual render failures retain their existing behavior. The shared Node stream helper is patched directly; the eight precompiled development/production, Webpack/Turbopack and experimental runtime variants receive a small adapter implementing the same listener ordering without rewriting minified bundles. No console filtering, prefetch disabling, dependency version change or Next configuration change is involved.

`pnpm install --frozen-lockfile` applies the patch locally and in CI. Rebuild and restart existing servers after installation; an earlier `.next` build can retain unpatched runtime code. `pnpm test` includes 24 browser-free RSC runtime regressions covering cancellation, normal completion and genuine render errors across all eight variants. Run them alone with `pnpm --filter @comprafino/web test`. These checks use Playwright's Node runner and do not start a web server or Chromium; ordinary browser suites exclude this file.

When upgrading Next, verify that the stable release includes the upstream fix, remove this version-specific patch and adapter, update the lockfile, and keep the cancellation/error regressions. The installed version is still 16.3.8.

A local follow-up build failed with `ServerActionsGraphs::new was canceled` after a failed sandbox build. Quarantining `.next/cache/turbopack` removed that failure on a clean retry; the retry reached the known sandbox CSS-worker port-binding restriction instead. This supports a stale persistent compilation cache as the cause of that separate build failure. Both caches were preserved under `/tmp/comprafino-turbopack-recovery-7r5t8909/`, leaving the next local build uncached. After a sandbox build panic, quarantine its generated Turbopack build cache before requesting a local retry so the failed agent build does not contaminate that retry. No cache or bundler configuration was changed. A successful local production build and Chromium run are still required.

Verified: 41 integration tests and all six fixture kinds pass against this container, and cleanup leaves no test schemas. Formatting, lint, typechecking and 542 unit tests pass. The current sandbox production build fails at the documented Turbopack worker-port restriction; the local history browser run remains pending.

## Shopping-list fixtures

After a successful production build, run `pnpm test:e2e:list:local` for the shopping-list Chromium scenarios. The existing isolated-schema harness also seeds two fresh egg identities across three retailers and a supported CMR offer; generic/preferred/strict behavior and a fixture price change use that catalog. The browser writes only localStorage; the price-change test writes only its random fixture schema. `pnpm test:e2e:list:local --validate-fixtures` checks seed eligibility without running browsers. It uses the same explicit loopback test URL and cleanup as history tests, with `SHOPPING_LIST_FIXTURE_IDS` supplied only by the harness. No additional database or credentials are required.

Milestone 15's current verification and pending build/browser gate are recorded in [shopping lists](shopping-list.md).

## Milestone 16 basket validation

`pnpm test:integration:local` also runs the isolated shopping-snapshot suite. `pnpm test:e2e:list:local` seeds three controlled exact milk products with known one/two/three-store optima and runs the basket scenarios alongside existing shopping-list tests. `--validate-fixtures` checks those optima without starting browsers.

`pnpm benchmark:basket:local` creates a separate disposable schema with 900 current listings and exercises the actual evaluation POST handler on valid 5-, 20- and 50-item lists in both modes. It writes `docs/milestone-16-performance.json` and drops the schema in `finally`; no application database configuration or retailer request is used. It measures handler execution/DB transport, without a Next.js HTTP server or deployment overhead. Run it after `pnpm test:db:up`; stop the disposable database with `pnpm test:db:down` when finished. See [basket optimization](basket-optimization.md) for current validation and build/browser gates.

## Listing detail fixtures

After a successful production build, run `pnpm test:e2e:history:local --listings` for isolated Milestone 17 Chromium coverage. `--listings --validate-fixtures` validates its PostgreSQL listing/history/range/CMR/coverage assertions without starting a browser; it does not constitute E2E or visual acceptance. The existing randomly scoped history runner creates listing UUIDs and a separate unmatched listing, passes fixture IDs through `PRICE_HISTORY_FIXTURE_IDS`, and cleans up its disposable schema. Run the existing shopping fixture suite too, since retailer-option card destinations now use listing pages. No retailer-site dependency is required.

## Required deterministic CI (Cleanup A)

The required `check` job now runs format, Oxlint, authoritative TypeScript, unit tests, disposable PostgreSQL integration tests, one production build and the combined Chromium fixture/smoke harness. It starts the existing PostgreSQL 17 Compose container once. Integration suites and the combined browser harness each apply reviewed migrations in their owned random schemas; the browser harness drops its schema in `finally`. The container is stopped in an `always()` step.

After starting the test database and successfully building, run all controlled browser suites and ordinary smoke together:

```sh
pnpm test:e2e:fixtures:local
```

For database-only fixture assertions:

```sh
pnpm test:e2e:fixtures:local --validate-fixtures
```

The combined `--all` harness seeds history, listing-detail, shopping and basket fixtures once and starts one production web server for the whole Playwright invocation. Unrelated listing fixture prices deliberately exceed the controlled shopping winners. Existing individual suite commands remain supported. The combined suite has 54 deterministic Chromium cases and eight optional live-catalog cases across seven files, as confirmed by the local browser run (discovery alone did not resolve all runtime skips). Required browser coverage includes six controlled history shapes, listing navigation/history/ranges/availability, shopping intent/CMR/storage/cross-tab behavior, basket optima and credential-free home/search/theme/navigation smoke.

Required CI uses no repository secrets or application `DATABASE_URL`; fork PRs receive the same owned PostgreSQL and fixture coverage. The harness supplies only its disposable test URL and schema to the web process. `COMPRAFINO_CONTROLLED_E2E=1` marks the combined run so existing live-catalog-only tests remain skipped there; these remain optional via explicit application `DATABASE_URL` in an ordinary `pnpm test:e2e` invocation. Browser browsing/demand writes in required CI go only to its random schema. Neither harness reads root `.env`.

On CI failure, `apps/web/test-results/` (including retained-on-failure traces and per-test screenshots/results) is uploaded as `playwright-failure-results` with seven-day retention. Existing retry policy is unchanged. SVG path assertions remain where they prove genuine chart gaps; basic chart visibility and tooltip assertions no longer depend on Recharts surface/tooltip class names, and selected listing navigation assertions use accessible links.

Cost/structure: one runner/job, one dependency install, one container, one build, one Chromium install, one browser fixture seeding and one server startup. Compared with invoking the three browser harness modes separately, this avoids two repeated fixture seeds/migration applications and two server startups. Local PostgreSQL integration measured 4.34 seconds and combined fixture validation 1.48 seconds, excluding container setup. Full browser/build duration still needs local/CI measurement; budget roughly 5–10 additional minutes for Chromium setup and controlled suites on a cold runner, within the existing 20-minute job limit. This estimate is not a measured GitHub Actions runtime.

Cleanup A validation on October 5, 2026: unit, SQL and static gate results are recorded in the engineering audit remediation status. The agent production build remains blocked by Turbopack worker port binding (`Operation not permitted`). The first local Chromium run started the production server and reported 33 passed, one failed, eight skipped and 20 not run in 24 seconds. The removal regression exposed a stale basket/render snapshot mismatch; a fix now withholds evaluation responses for a changed list, price mode or refresh revision. The updated source still requires a local rebuild and complete browser rerun. Database-only fixture validation is not Chromium execution.

Final Cleanup A acceptance: the user confirmed that the production build and deterministic Chromium fixture suite passed locally after cache recovery. The milestone is complete; earlier pending local-check notes above describe the investigation history. The version-pinned Next 16.3.8 cancellation patch remains in place.
