# Catalog health monitoring

`pnpm health:catalog` is read-only: it makes database queries, no retailer requests or catalog/account writes. It reuses the existing complete bounded coverage audit and per-retailer operation inspection. Output contains source names, counts, timestamps and fixed reasons, never product titles, search demand, account data, credentials or driver messages.

## Policy and failures

- `refresh_overdue`: no successful retailer attempt, or the last successful attempt started more than the existing 30-hour delayed-health boundary ago. A currently running attempt does not reset this clock.
- `latest_attempt_failed`: the latest recorded retailer attempt failed even if an older successful attempt remains fresh.
- `no_fresh_searchable_offers`: a retailer has zero current public generic offers. The existing boundary checks current normalization/identity, positive ordinary prices, 36-hour quote freshness and tri-state stock. Unknown availability remains eligible; explicit false does not. A green acquisition run cannot hide an entirely stale or unusable source catalog.
- `catalog_overflow`: retained rows exceed `catalogPolicy.retainedListingCap`. The bounded audit can instead fail before classification; either outcome fails the monitor.
- `capacity_skips`: a supplied acquisition log explicitly reports skipped new identities. This fails the monitoring step without changing successful acquisition semantics, refreshing existing identities or increasing the cap.
- `catalog_full`: retained rows equal the configured cap. This is a warning, not a failing health result by itself.

Individual stale offers and partial coverage remain reported by the detailed audits; this first monitor does not invent a percentage threshold or persist multi-run state. Zero current offers reflects the existing freshness window, rather than an instantaneous source request failure. Health timestamps and offer queries are separate reads; an acquisition in progress can be visible between them.

The CLI exits 1 for attention or an unavailable/invalid report and 0 for a healthy report (possibly with a capacity warning). A DB outage, corrupt boundary or exceeded catalog bound cannot become healthy. Failure diagnostics remain fixed and safe.

## Capacity evidence

Refresh/discovery CLIs append one JSON line with `operation: "catalog_capacity"` and `skippedByCapacity`. Existing human/JSON output is retained. The workflows use Bash with pipe failure propagation to capture stdout into `$RUNNER_TEMP/catalog-acquisition.log`, then inspect health even if acquisition failed. The original acquisition exit code remains a failing workflow step.

```sh
pnpm health:catalog
pnpm health:catalog -- --acquisition-log=/path/to/catalog-acquisition.log
```

The optional log must contain exactly one valid capacity marker and be at most 2 MiB. Missing, malformed or duplicate markers fail safely; fetched-minus-persisted is never interpreted as skipped capacity. A run that fails before emitting its marker therefore yields an unavailable post-acquisition check in addition to the original failure. Logs are not uploaded or recopied into reports. Standalone health runs have `skippedByCapacity: null`, meaning **not measured**, not zero.

## Schedule and delivery

[Catalog health](../.github/workflows/catalog-health.yml) runs every six hours at `29 2,8,14,20 * * *` UTC: **21:29/03:29/09:29/15:29 Peru**. It supports manual dispatch, uses the existing `DATABASE_URL` repository secret and has a ten-minute timeout. Its separate noncanceling concurrency group does not delay ingestion. Refresh and discovery also run the health step after acquisition. All workflows require publication to the default branch before this configuration becomes active. Schedules can be delayed or dropped; this monitor cannot detect its own nonexecution.

Each Actions execution prints safe JSON, adds fixed annotations and writes a Markdown step summary. Native failure notifications are the initial delivery mechanism. In GitHub notification settings, enable Actions email/web notifications and optionally failed workflows only. Scheduled notification ownership follows the workflow creator or the user who changes/re-enables its schedule. See [GitHub notification behavior](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs). Account notification settings and actual delivery are not established by repository code; no Slack/email webhook or account changes are made here.

## Verification

Core tests cover the existing delayed threshold, failed attempts versus previous successes, zero current coverage, capacity warnings/skips/overflow and inconsistent/future snapshots. Log tests reject missing, corrupt, duplicate and oversized observations. Isolated PostgreSQL tests use an explicit owned random schema to prove actual freshness/stock gates, safe output and read-only behavior. See [local testing](local-testing.md).
