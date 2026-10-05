# Local PostgreSQL and browser testing

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

Production retains Neon HTTP. Local mode uses `pg` TCP with the same Drizzle batch and transaction-local schema isolation, rejects non-loopback hosts/other database names, and scopes web access through a fixture schema. An explicit dedicated Neon test database can instead run `TEST_DATABASE_URL=… pnpm test:integration` or `TEST_DATABASE_URL=… pnpm test:e2e:history` without local mode.

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

The `CI` workflow's `check` job runs frozen installation, format, Oxlint, authoritative TypeScript, unit/stream regressions, disposable PostgreSQL integration, one production build and one combined Chromium invocation. Fork PRs receive the same secret-free fixture coverage. It installs Chromium headless shell/system requirements, stops the container with `always()` and uploads `apps/web/test-results/` as `playwright-failure-results` on failure with seven-day retention.

There is one job/install/container/build/fixture seed/server startup. Actual test counts and runtimes belong in dated validation evidence, not this setup guide. See [history](history/README.md) and [audit remediation](engineering-audit.md#cleanup-a-remediation-status--october-5-2026).

## Canceled React streams

The **next@16.3.8** patch at `patches/next@16.3.8.patch` classifies unfinished canceled RSC responses as `ResponseAborted`, preventing spurious `The destination stream closed early.` error logs during navigation, canceled prefetches or teardown. Genuine render errors remain reported with a digest; completed streams remain successful. See [patch provenance and removal condition](dependencies.md#next-stream-cancellation-patch).

Frozen installation applies the patch; rebuild/restart afterward. `pnpm test` includes browser-free regressions for cancellation, completion and genuine render failure across all eight precompiled runtime variants. Run them alone with `pnpm --filter @comprafino/web test`; no Chromium/server is started.

If a build fails due to host port restrictions, that is an environment result, not E2E acceptance. After a failed Turbopack build, a stale `.next/cache/turbopack` can affect retries; preserve failure diagnostics and quarantine that generated cache before an uncached retry when indicated. Prior sandbox/local acceptance details are [historical investigation evidence](history/engineering-notes-2026-10-05.md#original-docslocal-testingmd).

## Basket benchmark outputs

After `pnpm test:db:up`, `pnpm benchmark:basket:local` seeds a separate disposable current catalog and runs the actual evaluation POST handler on 5-, 20- and 50-item lists in ordinary/benefits modes. It measures DB transport/handler execution, excluding Next HTTP/deployment overhead. Its owned schema is removed in `finally`.

Default output is a new timestamped `.artifacts/basket-*.json`, ignored by Git. Use `pnpm benchmark:basket:local --output=.artifacts/my-basket-run.json` for an explicit destination. Paths resolve from the repository root; absolute paths are supported. Writes use exclusive creation and refuse existing files, including archived reviewed baselines. To replace reviewed evidence, produce a new file intentionally and review its provenance/diff. No benchmark automatically writes `docs/history/milestone-16-performance.json`.
