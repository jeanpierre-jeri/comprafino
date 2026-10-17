# Independent matching evaluation

`pnpm match:audit` evaluates the independent reviewed fixture with PostgreSQL similarity, without canonical writes. `pnpm match:evaluate` separately evaluates the calibration/holdout fixture. Both require root `DATABASE_URL` and the reviewed `pg_trgm` migration; independently labeled pairs remain in `packages/core/src/fixtures`, not the historical docs archive.

## Bounded four-retailer sample

The [08A sample and limitations](history/matching-retailer-sample-2026-10-16.md) are separate from the frozen historical corpus. Inputs, evaluator and tests live under `packages/db/src/testing/matching/`. The audit validator now accepts two to four distinct retailers; scoring and complete-link rules are unchanged. Confirmed negatives, inferred positives and unlabelled ambiguity are reported separately. This is an agent-reviewed purposive sample, not independent human validation or a catalog-wide precision estimate.

Run its integration test only with explicit `TEST_DATABASE_URL` and the existing owned-schema harness; see [local testing](local-testing.md#matching-sample-checks). Do not use `pnpm match:audit` to run this sample: that command still targets the unchanged historical fixture and application configuration. The new evaluator requires an injected database client.

## Dated matching audit

The original Milestone 3 frozen hashes, source expansion, normalization coverage, independent labels/metrics, manual group review and acceptance investigation are preserved in [engineering history](history/engineering-notes-2026-10-05.md#original-docscatalog-matching-auditmd). That October 3 evidence is a bounded historical audit, not a current catalog accuracy estimate. No matching thresholds, safety gates or fixtures change during Cleanup B.

See [current matching policy](catalog-matching.md) for deterministic decisions, complete-link grouping, protected persistence and automatic identity revalidation.
