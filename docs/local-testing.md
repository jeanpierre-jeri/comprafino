# Local PostgreSQL and browser testing

Milestone 19B adds `packages/core/src/shopping-list-sync.test.ts`, `packages/db/src/user-shopping-lists.integration.test.ts` and `apps/web/testing/shopping-list-sync*.spec.ts`. The existing explicit local integration command includes DB CAS/no-op/corruption tests and real Better Auth sync HTTP tests; each suite owns a separate disposable schema. Test-only transport barriers force races without sleeps or production hooks. Milestone 19C adds pure merge and injected client synchronization tests. The combined Chromium fixture run checks production sync, anonymous import/clearing, authenticated tab refresh and logout isolation. See [persistence verification](shopping-list-persistence.md#verification-and-next-phase).

## Disposable database and required checks

Docker Compose provides PostgreSQL 17 with `pg_trgm`, loopback port 55432 and temporary storage:

```sh
pnpm test:db:up
pnpm test:integration:local
pnpm build
pnpm --filter @comprafino/web exec playwright install chromium --only-shell
pnpm test:e2e:fixtures:local
pnpm test:db:down
```

The dedicated `comprafino_test` database uses local trust authentication. Recreating/stopping the container discards its contents. This configuration is for tests only.

The wrappers explicitly set `TEST_DATABASE_URL=postgresql://comprafino_test@127.0.0.1:55432/comprafino_test` and `COMPRAFINO_TEST_DATABASE_MODE=local`, without reading `.env` or falling back to application `DATABASE_URL`. Each integration/fixture run applies checked-in journaled migrations inside its own random schema and drops that schema on completion/failure. Tests skip extension creation to avoid changing shared public objects. An interrupted process can leave its owned schema for inspection; do not drop arbitrary schemas.

Production `packages/db/src/client.ts` always creates Neon HTTP clients and reads no test-mode/schema variables. Test-only transport is under `packages/db/src/testing/`; `pg` is a dev dependency. `ownedTestDatabase` requires explicit `TEST_DATABASE_URL`, validates a random owned schema, checks transaction-local isolation, filters extension creation, rewrites migration foreign keys and tears down partial setup on failure. Local mode rejects non-loopback hosts/other database names.

The fixture harness supplies `COMPRAFINO_E2E_PRELOAD` to Playwright. Only its production-server child starts with explicit `node --import <http-preload.ts>`. That test-only preload intercepts Neon's HTTP wire API, injects the owned schema into each direct/batched transaction, and executes local tests over `pg` TCP (or forwards to an explicit dedicated Neon test database). Local browser fixtures use the reserved `fixture.neon.invalid` connection hostname so Next can validate the Neon HTTP endpoint before interception; only the preload maps this to the explicit loopback test URL. It validates the target URL, allowing Neon's added `application_name`, preserves raw-text result parsing and rolls back failed batches. No production source/bundle imports the preload; ordinary start/deployment does not install it. Test variables alone cannot switch the production client to local transport. An explicit dedicated Neon test database can instead run `TEST_DATABASE_URL=… pnpm test:integration` or `TEST_DATABASE_URL=… pnpm test:e2e:history` without local mode.

## Browser fixtures

Build first. `pnpm test:e2e:fixtures:local` runs the combined controlled history, independent listing, shopping, storage and basket scenarios plus ordinary smoke against one production server. The harness supplies `COMPRAFINO_E2E_SCHEMA`, `PRICE_HISTORY_FIXTURE_IDS`, `SHOPPING_LIST_FIXTURE_IDS` and `COMPRAFINO_CONTROLLED_E2E=1` only to its owned test processes. Do not set test overrides in deployment or normal development.

Individual commands remain available:

```sh
pnpm test:e2e:history:local
pnpm test:e2e:history:local --listings
pnpm test:e2e:list:local
# Database assertions only; this is not Chromium execution:
pnpm test:e2e:fixtures:local --validate-fixtures
```

Fixtures seed known ordinary transitions/gaps, exact and unmatched listings, separate CMR benefits and known one/two/three-store optima. Browser storage changes remain local; fixture mutations and discovery writes stay within the owned schema. No retailer request or application credential is needed. Ordinary `pnpm test:e2e` offers optional live-catalog checks via an explicitly supplied application URL; controlled CI skips those cases.

## Required deterministic CI (Cleanup A)

The `CI` workflow's `check` job runs frozen installation, format, documentation references, Oxlint, authoritative TypeScript, unit/stream regressions, disposable PostgreSQL integration, one production build and one combined Chromium invocation. Fork PRs receive the same secret-free fixture coverage. It installs Chromium headless shell/system requirements, stops the container with `always()` and uploads `apps/web/test-results/` as `playwright-failure-results` on failure with seven-day retention.

There is one job/install/container/build/fixture seed/server startup. Actual test counts and runtimes belong in dated validation evidence, not this setup guide. See [history](history/README.md) and [audit remediation](engineering-audit.md#cleanup-a-remediation-status--october-5-2026).

## Canceled React streams

The **next@16.3.8** patch at `patches/next@16.3.8.patch` classifies unfinished canceled RSC responses as `ResponseAborted`, preventing spurious `The destination stream closed early.` error logs during navigation, canceled prefetches or teardown. Genuine render errors remain reported with a digest; completed streams remain successful. See [patch provenance and removal condition](dependencies.md#next-stream-cancellation-patch).

Frozen installation applies the patch; rebuild/restart afterward. `pnpm test` includes browser-free regressions for cancellation, completion and genuine render failure across all eight precompiled runtime variants. Run them alone with `pnpm --filter @comprafino/web test`; no Chromium/server is started. Run this browser-free Playwright configuration and the Chromium configuration sequentially: both own `apps/web/test-results/`.

If a build fails due to host port restrictions, that is an environment result, not E2E acceptance. After a failed Turbopack build, a stale `.next/cache/turbopack` can affect retries; preserve failure diagnostics and quarantine that generated cache before an uncached retry when indicated. Prior sandbox/local acceptance details are [historical investigation evidence](history/engineering-notes-2026-10-05.md#original-docslocal-testingmd).

## Basket benchmark outputs

After `pnpm test:db:up`, `pnpm benchmark:basket:local` seeds a separate disposable current catalog and runs the actual evaluation POST handler on 5-, 20- and 50-item lists in ordinary/benefits modes. It measures DB transport/handler execution, excluding Next HTTP/deployment overhead. Its owned schema is removed in `finally`.

`apps/web/testing/basket-benchmark-cli.ts` owns the HTTP handler wiring; `packages/db/src/testing/basket-benchmark-fixtures.ts` owns DB fixture mechanics. It invokes the same handler factory used by the production route with its explicit isolated client. Default output is a new timestamped `.artifacts/basket-*.json`, ignored by Git. Use `pnpm benchmark:basket:local --output=.artifacts/my-basket-run.json` for an explicit destination. Paths resolve from the repository root; absolute paths are supported. Writes use exclusive creation and refuse existing files, including archived reviewed baselines. To replace reviewed evidence, produce a new file intentionally and review its provenance/diff. No benchmark automatically writes `docs/history/milestone-16-performance.json`.

## Test ownership and state

Milestone 19A adds credential-free auth configuration/schema/session tests in `apps/web/testing/auth.spec.ts`, real Better Auth PostgreSQL handler tests in `auth.integration.spec.ts`, and Chromium identity/sign-out regressions in `apps/web/e2e/auth.spec.ts`. Root `pnpm test:integration` runs DB Vitest suites then the web Playwright auth configuration sequentially; `pnpm test:integration:local` supplies the same explicit disposable URL to both. Missing `TEST_DATABASE_URL` clearly skips auth integration tests, without an application URL fallback. Better Auth's privileged test plugin is used only in test source/configuration, with real signed cookies and owned schema persistence. The Chromium test server uses fake server auth credentials, and the OAuth callback test stubs provider network responses. No test requires real Google credentials/requests or a production test endpoint. See [auth limitations and setup](auth.md).

| Location                                   | Requires                                   | Responsibility                                                                          |
| ------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `packages/core/src/*.test.ts`              | Neither PostgreSQL nor Chromium            | Pure validation, domain policy and safe diagnostic formatting                           |
| `packages/db/src/*.test.ts`                | Neither                                    | Query/boundary contracts and transport configuration                                    |
| `packages/scrapers/src/*.test.ts`          | Neither                                    | Offline source fixtures, request bounds and failure isolation/diagnostics               |
| `apps/web/testing/shopping-api.spec.ts`    | Neither                                    | HTTP status, body bytes/schema, mode, output validation and rejection before evaluation |
| `apps/web/e2e/stream-cancellation.spec.ts` | Neither                                    | Version-pinned Next runtime stream regressions                                          |
| `packages/db/src/*.integration.test.ts`    | Explicit PostgreSQL                        | Real SQL invariants and transactions in owned random schemas                            |
| `apps/web/e2e/` other specs                | Chromium; controlled cases also PostgreSQL | Production UI, navigation/storage and controlled DB fixtures                            |

DB integration domains are ingestion/state persistence, normalization, matching/identity, public search/detail/shopping query eligibility, history/benefits/coverage, availability, catalog capacity, discovery, shopping/basket snapshots, and the fixture HTTP transport. Every file owns one schema. Catalog cases truncate mutable fixture data together before each case, preserving retailer seeds/FKs; shopping cases reseed their catalog before each case. There are no cross-case fixture dependencies. Fixture constructors live in `packages/db/src/testing/catalog-fixtures.ts`; lifecycle and migration mechanics live in `testing/database.ts`. The browser harness and benchmark use the same lifecycle. Browser price mutations and basket restriction helpers attach through `testing/fixture-client.ts`, which requires the explicit test URL and validated parent schema and never uses application `DATABASE_URL`.

Cases run sequentially within a suite; race tests explicitly create contention inside the case. Independent files use Vitest's existing file concurrency after serial and shuffled verification. To check order independence:

```sh
pnpm test:integration:local --sequence.shuffle --sequence.seed=1052026
# Diagnostic serial execution if needed:
pnpm test:integration:local --no-file-parallelism
```

The transport integration case spawns a production-client subprocess with the explicit preload and verifies schema scoping, result parsing, rollback and target ownership. Successful/failed normal runs remove only their owned schemas and close local pools in `finally`; forced process termination can still leave a schema. Inspect rather than broadly deleting leftovers:

```sh
docker compose -f compose.test.yaml exec -T postgres psql -U comprafino_test -d comprafino_test -c "select nspname from pg_namespace where nspname ~ '^comprafino_(test|e2e)_[0-9a-f]{32}$';"
```
