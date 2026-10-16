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

The shopping snapshot overflow regression fills the actual retained capacity (50,000 listings) by cloning one listing admitted and normalized through the real writers, using bulk SQL only inside its owned schema. Clones change IDs while retaining fingerprint inputs and positive ordinary quotes. It then injects one extra row and verifies reader rejection, plus recovery below the current-offer bound. This tests reader behavior at capacity; fixture preparation is not an ingestion-throughput benchmark.

Generic shopping snapshots retrieve only the requested query families; strict items retrieve their exact identities. Preferred items retain the supported-family superset because their fallback compatibility comes from current canonical titles. The full-current-catalog count still rejects overflow, within the same SQL snapshot. Its projection is not materialized, avoiding construction of unrelated listing JSON just to count rows.

`packages/db/src/offer-projection.integration.test.ts` compares the explicit output projection against the former `SELECT *` through two real clients in the same owned fixture. The reference client changes only those two output selections; it runs the same predicates and domain code. Tests compare complete search results (including sorting, pages, filters, units and discovery), raw offer rows and complete basket results except measured timings. Fixtures cover KG/UN, unknown quantities, benefits, tri-state availability, invalid fingerprints and rejected canonical associations. Raw basket snapshots must retain identical counts, products and history while excluding the five SQL search helpers and the internal native listing/retailer keys. The projection suite also checks retailer-scoped category evidence and title matches with missing categories; the canonical reference restores the previous JSON-based family filter and UUID ordering.

`packages/db/src/category-search.integration.test.ts` compares complete responses against the frozen two-read composition in `testing/legacy-category-search.ts`. It covers both price modes, all three orderings, pages 1/2/10, retailer/unit filters, family queries, empty category results with global coverage, missing/inactive/multiple source memberships, invalid identities and optional canonical comparisons. Real SQL observation verifies one public offer query instead of two. Additional boundary cases reject invalid membership data and global overflow even when the category subset is empty. Category browsing and text-only controls keep their original statements.

`packages/db/src/canonical-eligibility.integration.test.ts` executes the optimized identity projection and the frozen pre-03C SQL from `testing/legacy-public-eligibility.ts` against the same owned PostgreSQL fixture. It compares IDs, titles, retained-store counts, complete product/search responses and basket decisions/raw snapshots, including historical rows. Cases include automatic/manual/obsolete/below-threshold links, normalization-writer invalidation, an invalid inactive member, one-store groups, absent normalization/open prices, zero or KG ordinary states, stale/future observations and unavailable stock. The legacy SQL is a test oracle only; production readers share their eligibility fragments.

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

`apps/web/e2e/product-metadata.spec.ts` sends full HTTP requests to the production Next server and counts its actual current-comparison SQL through the existing test-only preload. The harness gives this spec an exclusive product via `COMPRAFINO_E2E_PRODUCT_READ_ID`; its counter/failure-control table lives only in the owned random schema and disappears with it. Ordinary history queries and other specs' products are not counted. Both default/explicit standard and benefits modes must perform one comparison read per request; invalid/repeated mode parameters normalize to standard. Repeated requests must read again. Controlled failures verify the safe error presentation and subsequent recovery; invalid, missing and ineligible IDs retain the not-found UI and `noindex` (Next may already have started a 200 stream). No production instrumentation, global cache or application migration is introduced. After building, run this regression alone with `pnpm test:e2e:fixtures:local --grep 'product metadata'`, or include it in the full fixture run.

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

## Catalog scale benchmark

`pnpm benchmark:catalog:local` measures the production search reader (the same offers-only path used by `/search`) and the actual shopping evaluation POST handler at 2,000, 10,000 and 50,000 listings. It explicitly selects the local test database, applies checked-in migrations in a random owned schema and removes that schema in `finally`. It does not read application credentials or contact retailers. This is local reader/handler timing, not Next HTTP, browser or deployment latency.

```sh
pnpm test:db:up
pnpm benchmark:catalog:local
# Short harness verification; two samples intentionally do not report p95:
pnpm benchmark:catalog:local --sizes=2000 --samples=2 --warmups=1
# A fresh explicit destination, never an existing baseline:
pnpm benchmark:catalog:local --output=.artifacts/catalog-my-run/results.json
```

Use `--cases=<id,id>` and `--concurrency=1|4|both` to select cases without repeating a completed matrix; case IDs appear in the JSONL evidence. Selected sequential cases run in the listed order, with duplicates removed, so a known regression can be checked first. `--stability-samples=100` adds a separate mixed-20 basket repetition at 50,000 in waves of four, after the selected matrix and diagnostics, reusing that owned fixture. It accepts multiples of four from 20 through 100, requires the 50,000 size and defaults to disabled. These extra results are in `stabilityMeasurements`, not the standard `measurements` array; the option explicitly adds its fixed case regardless of `--cases`/`--concurrency`. `--diagnostics` adds paired SQL plans after the measurements, comparing family/category queries with transaction-local `enable_nestloop=off` and a strict basket with transaction-local `jit=off`. These exploratory plans do not change global settings and are not percentile measurements.

The default matrix includes broad/selective/absent/family searches, category with and without text, retailer/unit filters, all three sort orders, pages 1/2/10, standard/benefits modes, mixed 5/20/50-item baskets and strict/generic controls. Search uses `includeComparisons: false`, matching the current public page. Mixed lists contain unique generic needs and distinct strict/preferred identities; they pass the actual shopping list schema. Two workloads also run in waves of four simultaneous requests through the local pool of four connections.

Each case defaults to two excluded warmups and 20 measured requests. Failed requests and their SQLSTATE/message are retained separately, including warmup failures. All concurrent operations settle before cleanup. Success percentiles use successful requests only; fewer than 20 successes suppress p95, and no successes yields null percentiles. Completion latency across all attempts is separate. A zero exit status means the measurement finished, not that an availability target passed. The report retains raw samples, nearest-rank p50/p95, client DB wait, total time, process CPU and Node memory. Case and measurement start/end timestamps allow correlation with external container-memory samples. Percentiles from 20 observations are descriptive, not a production SLA. SQL rows, nested candidate/history rows and UTF-8 JSON sizes are captured in an excluded warmup; JSON size estimates decoded payload and is not wire traffic. DB wait includes transport, parsing and pool wait; sums can exceed total time when queries overlap. Separate `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` files report server execution time and plans for representative queries, including the mixed 20-item basket. Memory samples include warmups, omit PostgreSQL/Next and can miss synchronous peaks; process maxRSS covers the process lifetime.

Fixture preparation ingests 80 templates through real listing, normalization and matching writers across four stores, with 36 daily observations, price changes, CMR benefits, missing quantities and true/false/unknown availability. Complete blocks are cloned for volume, including valid normalizations, group membership and history; every clone's fingerprint is checked. Only fixture association timestamps are moved to the first unchanged observation to exercise the four completed weeks of history. Repeated titles and canonical identities deliberately measure reader volume, not lexical diversity, production distribution or ingestion throughput. Row counts/distributions are saved per size and table statistics are analyzed before reads.

`apps/web/testing/catalog-benchmark-cli.ts` owns workload and handler wiring; `packages/db/src/testing/catalog-benchmark-fixtures.ts` owns fixture SQL; `packages/db/src/testing/catalog-benchmark-observer.ts` observes only the injected test client. The Compose container retains Docker’s default 64 MiB `/dev/shm`. Earlier basket queries exhausted that limit at four concurrent requests and 50,000 listings. The basket now reuses a narrow open-price relation inside its statement; see the [03F measurements and limits](history/catalog-shared-memory-performance-2026-10-15.md). Continue recording errors and the container limit rather than silently increasing resources or treating fast failures as successful latency. The benchmark command does not rewrite application SQL, cache settings or indexes. Run CPU-heavy checks separately from measurements. Default output is a new `.artifacts/catalog-<timestamp>/` directory with results, incremental JSONL evidence, fixture counts and plans. Files use exclusive creation; archived reports are never overwritten. Keep the entire directory when sharing a run because `.artifacts/` is ignored by Git.

## Catalog HTTP benchmark

Build first, then run `pnpm benchmark:catalog:http:local`. The HTTP runner starts its own production `next start` child on an available loopback port, using the same explicit local test URL, random owned schema, catalog fixtures and shared search/basket workloads as the reader benchmark. It stops that child before removing its schema. An unexpected child exit rejects pending drain waits, and teardown recognizes signal termination without waiting for an exit event that already occurred. No application database, retailer request, production instrumentation or comparison-rule change is involved.

```sh
pnpm test:db:up
pnpm build
pnpm benchmark:catalog:http:local --stability-samples=100
# Verify the harness with fewer samples; p95 is intentionally omitted:
pnpm benchmark:catalog:http:local --sizes=2000 --samples=2 --warmups=1
```

The options `--output`, `--sizes`, `--samples`, `--warmups`, `--cases` and `--concurrency=1|4|both` match the reader runner. The HTTP matrix adds concurrent category/text searches and exclusively generic baskets to the existing concurrent broad search and mixed basket. `--stability-samples=100` adds **both** mixed-20 and generic-5 controls at 50,000, in waves of four; include both cases when selecting cases. The default is 20 measured requests and two excluded warmup rounds per case. Each concurrent round sends four requests. All work drains between waves, including Next `after()` promises and underlying SQL that can continue after a client cancellation. This closed workload does not model an open arrival rate.

The client records time until response headers, time until the complete uncompressed HTML/JSON body, status, bytes, validation and cancellation separately. A search page can stream an error with HTTP 200; the validator rejects that response. Every successful response checks search IDs and order within comparable groups, ordinary and conditional prices and pagination, or complete basket decisions excluding only their timestamp and timing fields, against the production reader in the same fixture. React can flush sibling groups out of DOM order, so raw HTML order across groups is not used as an ordering oracle. One excluded reader observation supplies each oracle; it is not a reader percentile sample. Failed responses remain in raw samples; successful-body p95 requires at least 20 successes. A completed benchmark is not an availability acceptance result.

Only this child's explicit `--import packages/db/src/testing/http-benchmark-preload.ts` adds request/SQL/response/after events and 100 ms server memory samples. It builds on the existing owned HTTP preload and observes the documented Next request-context `waitUntil` promise. Production operation, fetch and transaction-local SQL budgets apply. The additional fixture wrapper reports fetch abort separately from underlying PostgreSQL completion. A separate 90-second HTTP client deadline bounds normal attempts. Diagnostic 100 ms client cancellations run outside percentile samples and are followed by recovery requests. Optional `--fault-probes` adds first-scale search/evaluation slow SQL probes (including a canceled client), verifies SQLSTATE 57014 and recovery, and records `faultResults` outside normal latency samples. Only the owned benchmark preload can inject these faults; normal production routes cannot. Neither HTTP disconnects nor local fetch aborts guarantee SQL cancellation; teardown waits for tracked work to settle.

Review `summary.workErrors` and `summary.warmupWorkErrors` as well as HTTP/result failures: a streamed search can return valid offers while its later demand write fails. These counters separately expose SQL, fetch and rejected `after()` work. A runner exit code of zero means the measurements were collected; acceptance also requires reviewing the recorded failures and recovery evidence.

Results include JSONL progress, server events/logs, complete probe/failure bodies, reference responses, fixture counts, selected foreground read-only SQL plans and cleanup evidence. Outputs use exclusive creation. Basket handler time comes from its existing JSON and `Server-Timing`; SQL wire time excludes subsequent parsing/domain work. Search's interval after the final foreground transport includes normalization, React rendering and serialization, so it must not be labeled isolated render CPU. HTTP does not measure browser assets/hydration or deployment networking. The server is a separate Node process from the client. Its CPU and memory also include the test adapter, which serializes local TCP results into the Neon wire format; a deployed Neon service performs that serialization outside Next. Monitor PostgreSQL and `/dev/shm` separately and retain the 64 MiB limit. Do not run builds or test suites during timed measurements. Keep the entire ignored `.artifacts/` directory with the dated report.

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

## Weekday recommendation checks

`packages/core/src/weekday-recommendation.test.ts` covers Lima week boundaries, sparse coverage, gaps, unsupported days, constant prices, ties, repeated minima, inconsistent patterns and material difference thresholds. The existing shopping DB suite adds real SQL coverage for ordinary/reference intraday transitions, missing dates, retailer isolation, generic withholding, association-date safety and benefits-mode independence in its owned random schema. Chromium shopping fixtures assert the insufficient-history copy for generic and exact rows. A separate browser case injects a validated evaluation response to exercise the suggestion/disclosure and no-pattern presentation; SQL pattern correctness is checked by the isolated DB case. Run the same integration/build/combined Chromium commands above; no application database is used for test writes.

The read-only audit can be repeated with `pnpm --filter @comprafino/db exec node --env-file-if-exists=../../.env --experimental-strip-types src/weekday-audit-cli.ts`, alongside `pnpm audit:observation-coverage`. These explicitly read the configured application catalog and write no records; they are inspections, not test commands.
