# Roadmap

Repository status reviewed on October 17, 2026 against local commit `e7aa576`. This guide describes implementation and links dated evidence; it does not establish the current production revision, schema, catalog size or provider configuration.

## Current capabilities

- Bounded public-data acquisition from Tottus, Plaza Vea, Metro and Makro. The scheduled processor resumes category pages and pending derivation; search-driven discovery and exact known-listing refresh complement it. [Operating flow and schedule](operations.md).
- Conservative exact matching, public exact/generic search and independent retailer listing details. Search results are not proof of useful substitutes or valid comparisons. [Eligibility](eligibility.md) and [matching](catalog-matching.md).
- Ordinary history with real observation gaps and separate supported CMR benefits. [History](price-history.md) and [conditional pricing](conditional-pricing.md).
- Anonymous recurring lists, Google sign-in, synchronized account lists and guarded recovery of pending browser imports. Local recovery preserves ownership and never automatically transfers a list to another account. [Auth](auth.md) and [persistence/recovery](shopping-list-persistence.md).
- Current basket comparisons with at most one, two or three stores selected from the four supported retailers; saved selections remain distinct from suggested alternatives. [Basket rules](basket-optimization.md) and [mobile verification](history/mobile-shopping-journey-2026-10-16.md).
- Conservative weekday advice for supported specific selections. It requires four complete weeks and the same sufficiently lower ordinary-price weekday in each; insufficient history, ties or inconsistent patterns produce no recommendation. Implementation does not establish that the live catalog currently meets that gate. [Evidence requirements](shopping-list.md#weekday-purchase-advice).

## Capacity and local verification

Retained capacity is controlled by [catalogPolicy](../packages/core/src/catalog-policy.ts); [catalog expansion](catalog-expansion.md) describes admission, durable progress and work budgets. This is configured capacity, not an inventory count, comparison coverage, throughput guarantee or permission to increase limits.

The local performance work 03A–03F includes query/projection improvements and measurements at 2,000, 10,000 and 50,000 records, including four concurrent requests. [HTTP results](history/catalog-http-performance-2026-10-16.md) and [request budgets](history/public-request-budgets-2026-10-16.md) document latency, cancellation and remaining limits. These optimizations are implemented; further optimization requires a demonstrated bottleneck. Local stability does not certify hosting performance.

The bounded [catalog review 10A](history/catalog-usefulness-2026-10-16.md), [refresh-selection correction 10B](history/catalog-refresh-selection-2026-10-16.md), [Makro comparison sample 08A](history/matching-retailer-sample-2026-10-16.md) and [import recovery 07](history/shopping-import-recovery-2026-10-17.md) each retain their own scope and limitations. No sample proves complete source inventory or global matching accuracy.

## Operations and production evidence

[Catalog health monitoring](catalog-health.md) has scheduled and post-acquisition checks. Cron definitions and commands are maintained in [operations](operations.md#scheduling-and-concurrency); intended cadence does not prove successful runs or per-product freshness. Actual catalog counts, successful workflow durations, notification delivery, current deployment/migrations and provider settings need environment evidence.

[October 6 account rollout observations](history/account-rollout-2026-10-06.md) record checks and user-confirmed sync from that date. They are not a fresh production acceptance for later commits. Local tests use synthetic users and owned database schemas; no production inspection or remote command was performed for this reconciliation.

## Priorities with few users

Follow the [current project priorities](history/project-review-2026-10-14.md#priorización-actual--16-de-octubre-de-2026) and [bounded prompts](history/project-review-prompts-2026-10-14.md). Address reproduced wrong prices, lost data and blocked user journeys first. Observe a small real-user journey before adding product scope; do not infer usability from automated browser tests.

Revalidate the historical dependency warning before deciding on an update. Additional account export/deletion controls remain separate work; downloading a pending anonymous copy is not an account-data export. Indexing/share-link work depends on the chosen acquisition channel. New alerts, source/category expansion or infrastructure need a current requirement and evidence.

**04A remains deferred by the user.** The [hosting kit](hosting-test-environment.md) is local preparation only. Remote load, server-side cancellation and recovery are not verified. Resume under the [recorded criteria](history/hosting-request-budgets-2026-10-16.md#decisión-posterior-verificación-remota-aplazada); do not provision resources or deploy as part of this roadmap.

## Historical milestones

The [October 5 engineering audit](engineering-audit.md#final-remediation-status--october-5-2026), [original milestone chronology](history/engineering-notes-2026-10-05.md#original-docsroadmapmd) and [history index](history/README.md) preserve earlier implementation, measurements and acceptance notes. Their old counts and authorizations retain their dates and do not authorize current operational actions.
