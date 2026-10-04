# Catalog refresh and operational freshness

Milestones 0–6 are complete and deployed in the user-provided baseline `558cb56`. Milestone 7 adds [known listing refresh](listing-refresh.md) between category ingestion and the existing single normalization/matching pass. That document specifies exact lookup mechanisms, budgets, observation freshness, unavailable/missing semantics, public cheapest-price exclusion and the real audit. Milestone 7 awaits local build/E2E confirmation; historical notes below describe earlier runs.

## Architecture and coverage

```text
GitHub Actions → pnpm refresh:catalog
  → Tottus (meat + dairy), Plaza Vea (dairy/eggs), Metro (dairy), sequentially
  → up to 100 eligible known-listing targeted lookups
  → existing normalizeCatalog API
  → existing matchCatalog API
  → Neon/PostgreSQL → public persisted search/comparison reads
```

The command lives in `packages/scrapers`, reusing `ingest` and the database APIs behind `pnpm normalize:catalog` / `pnpm match:catalog`. Pure operational freshness belongs to core; database inspection belongs to db; `/dev/ingestion` remains a Server Component. No matching or scraping runs during public requests. Normalization rules, matching version/weights/thresholds/candidates and canonical identities are unchanged.

`refresh-adapters.ts` freezes existing validated coverage: Tottus meats at 50 and dairy at 100; Plaza Vea dairy/eggs at 100; Metro dairy at 100. Tottus's historical 151 rows included retained observations beyond the current 50-row meat sample. Both Tottus categories fetch before one deduplicated atomic retailer write. This prevents a failed category from recording a successful full-retailer refresh. Existing adapter request/page caps, conservative pauses and timeouts remain. There are no new categories, retailers, full-catalog crawling or higher limits.

Changing source ordering can discover a new item inside an existing bounded sample. Absent historical items remain stored rather than being deleted: 350 fresh observations can coexist with more retained rows. This is not full coverage. Downstream normalization/matching reads the complete current database up to 1000 rows, with an explicit row-count guard that fails rather than silently processing a truncated catalog. Review that bound deliberately before any future expansion.

## Schedule and concurrency

`.github/workflows/refresh-catalog.yml` supports `schedule` and `workflow_dispatch`. Cron `17 11,23 * * *` runs at **11:17 and 23:17 UTC**, corresponding to **06:17 and 18:17 Peru (America/Lima, UTC−5)**. Twice daily limits public requests, Actions minutes and Neon writes while allowing roughly twelve-hour observations. Minute 17 avoids the busiest round-hour scheduling window.

The stable concurrency group `comprafino-catalog-refresh` and `cancel-in-progress: false` prevent overlapping full refresh workflows without canceling a running refresh. GitHub's default concurrency queue keeps one pending run; another trigger can replace that pending run. This is not a durable queue of every requested execution. Retailer-specific manual workflows retain their own groups; database retailer-row locks and atomic batches remain the safeguards across manual/local writers. The full workflow's concurrency does not serialize arbitrary local processes.

The workflow checks out code, uses the repository-pinned pnpm and Node 24, installs with `--frozen-lockfile`, and passes `${{ secrets.DATABASE_URL }}` only to the refresh command. Its timeout is sixty minutes to accommodate up to 100 sequential targeted requests, each with a thirty-second timeout. It does not apply migrations or run scraping in ordinary CI.

Scheduled jobs may begin late or be dropped under GitHub load. They run from the default branch; the workflow must exist there and Actions must be enabled. Public-repository schedules may be disabled after sixty days of inactivity. See [GitHub schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) and [concurrency documentation](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency). Neither the cron nor the freshness policy promises exact or real-time prices.

## Failure and last-known-good behavior

Each retailer is attempted even when another fails. Fetch/parsing failure writes no listings; persistence uses the existing all-or-nothing listing/history transaction. No failed scrape deletes, deactivates or expires prior offers. Confirmed targeted unavailability can mark availability false without advancing price freshness; missing products retain prices and age naturally. Public stale prices cannot win best price; see the listing-refresh policy. On partial failure, successful retailers commit, then normalization and matching use all current rows, including failed retailers' last-known-good data. The overall command exits nonzero, so Actions visibly fails.

If all category retailers fail, targeted lookup still runs; downstream stages run if targeted observations succeeded (or the targeted stage failed after possible partial writes). If no category or targeted observation succeeds, downstream stages are skipped. If normalization fails or returns stale rows, matching is skipped. Matching failure or a stale/split/manual scope yields failure; existing guarded transactional matching protects canonical associations against partial replacement. Successfully committed earlier stages are not rolled back across the entire pipeline: they are individually valid and the next refresh can reconcile derived data. A concurrent source change can refuse downstream writes; rerun the pipeline after checking its summary.

Existing `ingestion_runs` already has `started_at`, `ended_at`, running/success/failed status, discovered/persisted/new-state counts and a concise safe error. No schema or migration is added. Run start/finish are separate from listing commits: termination may leave a running row, and a failure after the listing commit can need reconciliation. A database outage that prevents run creation/completion cannot reliably record its own failure; Actions logs/status remain the fallback. Fetch failure before the adapter returns records zero discovered rows, not partial progress.

Logs identify stage starts/ends and an overall JSON summary with counts and duration. Errors use fixed safe summaries, never raw exceptions, stack traces, connection URLs or credentials. Developer display validates operational fields and strips stored error text, including historical arbitrary errors.

## Latest attempt, latest success and freshness

Each retailer is queried independently for its newest attempt of any status and its newest successful attempt. A global latest-ten list cannot hide a retailer's previous success or latest failure. Counts refer to the latest attempt: discovered source rows, persisted inserts/fresh listing updates, and changed/new price states (including first observations). They are not total catalog counts. Failed fetches can show zeros alongside an older successful attempt.

`packages/core/src/freshness.ts` centralizes thresholds:

| Last successful attempt age | Classification |
| --------------------------- | -------------- |
| ≤ 18 hours                  | healthy        |
| > 18 and ≤ 30 hours         | delayed        |
| > 30 hours                  | stale          |
| No recorded success         | unknown        |

Age uses the successful attempt's start time, conservatively preceding completion. Status and age are separate: a failed latest attempt can coexist with healthy previous data; a running/interrupted attempt does not advance success. The six-hour slack after an expected twelve-hour refresh allows cron/source delay; thirty hours covers more than two missed expected refresh opportunities.

Manual retailer commands record successful attempts for their bounded requested scope, so they can advance retailer-level freshness without refreshing every scheduled category. Inspect counts, workflow logs and actual listing timestamps when diagnosing this limitation. Operational freshness is not proof that every historical listing was fetched.

`/dev/ingestion` now shows per-retailer freshness, attempt status/time, success time/age, discovered/persisted/new-state counts and a fixed safe failure summary. Visible operational times use Peru time. The existing run history/listing table remains. It is read-only, without charts/retries, and returns 404 in production before any database query. Pipeline-stage summaries remain in Actions/CLI logs; there is no new persistent normalization/matching-run schema.

Public comparison continues to display actual `last_seen_at` observations, including last-known-good prices. A public stale-offer message is deferred: retailer-level success alone cannot establish freshness of every retained bounded-sample offer, and adding operational queries would couple the current single-batch public read to run monitoring. No price is hidden automatically, and no public UI redesign is included.

## Commands and troubleshooting

```sh
# DATABASE_URL in root .env or the process environment; migrations already applied
pnpm refresh:catalog
# Fetch/parse the same bounded sources, no DB connection or mutations
pnpm refresh:catalog -- --dry-run

# Troubleshoot one retailer without running the others
pnpm scrape:tottus -- --limit=50
pnpm scrape:tottus -- --category=dairy --limit=100
pnpm scrape:plaza-vea -- --limit=100
pnpm scrape:metro -- --limit=100
# Add --dry-run to any retailer command to fetch without persistence

# Repair derived data after reviewing source ingestion
pnpm normalize:catalog -- --limit=1000
pnpm match:catalog -- --limit=1000
```

Dry-run fetches all three retailer scopes, reports discovered counts and zero persisted/changed counts, skips downstream persistence and does not simulate derived state. It needs no database. Invalid/duplicate flags fail before requests.

To trigger a full refresh manually in GitHub, open **Actions → Catalog refresh → Run workflow**, choose the intended branch, and inspect stage/count summaries. Configure the existing `DATABASE_URL` repository secret first; apply reviewed migrations separately. Do not change real source URLs or damage stored data to test failures: deterministic fake adapters/tasks cover the partial/all-failure paths.

For a failure, distinguish source/network validation from database configuration/schema problems using the stage and safe summary. Try the corresponding bounded dry-run; if the source is restricted or changes shape, stop and review the adapter. Never bypass access controls. Check previous successful attempts and actual listing observations before judging price freshness. Reconcile an interrupted `running` attempt from logs rather than calling it successful.

GitHub Actions failure notifications are the initial zero-additional-service alert mechanism. Enable Actions email/web notifications (optionally failures only) in GitHub notification settings; scheduled notifications go to the responsible schedule actor, not every collaborator. See [GitHub workflow notifications](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs). Actions status is always available in the repository. No Slack, alert SaaS or paid monitoring is introduced.

GitHub Actions + Neon + Vercel deployment remain the low/zero-cost architecture, subject to account quotas and provider limits. No dependencies, Redis, queues, worker, new host or external scheduler were added.

## Live validation — October 3, 2026

Two consecutive bounded development-database refreshes succeeded:

| Retailer  | First fetched / persisted / new states | Repeat fetched / persisted / new states |
| --------- | -------------------------------------- | --------------------------------------- |
| Tottus    | 243 / 150 / 1                          | 243 / 150 / 0                           |
| Plaza Vea | 100 / 100 / 0                          | 100 / 100 / 0                           |
| Metro     | 100 / 100 / 0                          | 100 / 100 / 0                           |

First refresh: **85.099 seconds**, 352 normalization inputs, two changed normalizations; 7325 matching candidates, zero association/product writes. Immediate repeat: **45.701 seconds**, 352 normalization inputs, zero normalization writes; 7325 matching candidates, zero association/product writes.

The initial new state belongs to newly observed Tottus SKU `130135935`, “Leche Laive Practitarro Sixpack Botella 390 g”, current 2390 / reference 2520 cents. This entered the same 100-row dairy sample as source ordering changed; category/limits were not expanded. The other normalization update was existing “Bisteck De Res Tottus” SKU `115851723`. No false idempotency failure is claimed. Retained totals are Tottus 152, Plaza Vea 100, Metro 100. The new row remains subject to unchanged conservative matching; it caused no canonical reassignment.

Complete ordered price-history digest before/after the repeat was identical (`d09ca342168a017569af110dbbf4a666`), with 377 historical and 352 open states. Thus the repeat advanced listing observations without unnecessary price-history writes. Both downstream stages also reported zero writes.

Deterministic tests cover full success, one retailer failing while others/downstream continue and overall failure, all failures skipping writes, normalization blocking matching, matching failure, dry-run, fixed safe errors, unchanged repeated orchestration, fixed coverage and atomic two-category Tottus fetching. Core tests cover threshold boundaries, missing/running history and distinct attempt/success. Existing PostgreSQL tests remain authoritative for actual price/normalization/matching idempotency, locks and rollback; the new lifecycle test adds last-known-good and latest-attempt/latest-success inspection.

During the first integration run, the existing harness's batch-only search-path isolation let the new single-query lifecycle operations create two development `ingestion_runs` records. Exactly those two test IDs were removed; live listing/history writes were never involved. The harness now wraps single Drizzle queries in the same isolated transaction/search path as batches. This incident and its fix are recorded explicitly rather than claiming the first test run was isolated successfully.

Final validation: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, all **317 unit tests** (18 new), and all **16 PostgreSQL integration tests** (one new) pass. The corrected PostgreSQL suite uses explicit one-off `TEST_DATABASE_URL` injection and drops its isolated schema. A final live read confirms the same history digest and the legitimate second-refresh run IDs, with all three retailers healthy. Fake-task partial-failure testing passes: Plaza Vea fails, Tottus/Metro and downstream stages succeed, and the aggregate status remains failed. Workflow YAML parsed successfully and its required cron/setup/frozen-install/concurrency/secret/command structure was verified; ordinary CI contains no scheduled scrape command.

`pnpm build` fails on the known Turbopack CSS-worker port bind (`Operation not permitted`); the default Next.js configuration is unchanged. `pnpm test:e2e` was attempted but its production web server could not start, and no successful production build exists. Fresh local production build and Chromium E2E confirmation are required before committing. Browser rendering of the changed developer page remains unverified in this environment. Changes are staged with no commit/push or schedule activation. Catalog expansion is the next proposed milestone after that gate and initial scheduled-run verification; do not expand automatically.

## Discovery operations

Run `pnpm discover:catalog -- --dry-run --limit=3` to inspect pending demand without writes or source calls; normal mode removes `--dry-run`. Apply reviewed migration `0003_fair_kylun.sql` before deploying the public search change. Cron `43 0,6,12,18 * * *` uses ten-query batches, shared noncanceling refresh concurrency, a 24-hour per-query claim cooldown and a database-enforced thirty-attempt UTC daily cap. Source failures preserve successful batches and report partial/nonzero failure. `/dev/discovery` is development-only. Complete [discovery documentation](discovery.md) covers privacy, ranking, safe errors, interrupted claims and catalog/freshness bounds. No workflow is triggered by an individual public request.
