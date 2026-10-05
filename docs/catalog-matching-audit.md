# Independent matching evaluation

`pnpm match:audit` evaluates the independent reviewed fixture with PostgreSQL similarity, without canonical writes. `pnpm match:evaluate` separately evaluates the calibration/holdout fixture. Both require root `DATABASE_URL` and the reviewed `pg_trgm` migration; independently labeled pairs remain in `packages/core/src/fixtures`, not the historical docs archive.

## Dated matching audit

The original Milestone 3 frozen hashes, source expansion, normalization coverage, independent labels/metrics, manual group review and acceptance investigation are preserved in [engineering history](history/engineering-notes-2026-10-05.md#original-docscatalog-matching-auditmd). That October 3 evidence is a bounded historical audit, not a current catalog accuracy estimate. No matching thresholds, safety gates or fixtures change during Cleanup B.

See [current matching policy](catalog-matching.md) for deterministic decisions, complete-link grouping, protected persistence and automatic identity revalidation.
