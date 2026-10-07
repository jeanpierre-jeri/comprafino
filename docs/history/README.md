# Engineering history and artifact classification

Captured/indexed October 5, 2026 during Cleanup B, starting at `15cb5c2`. Historical measurements are not current operating limits, deployment proof or commit authorization. Unknown provenance remains unknown. Full original guidance, rationale and session acceptance narratives are preserved in [engineering notes](engineering-notes-2026-10-05.md), including the original README, roadmap and domain guides. Embedded measurement dates/baselines retain their meaning; the capture date is not a measurement date.

The [October 5 audit](../engineering-audit.md) retains its original `9ab4575` baseline and evidence, followed by remediation status. Audit file tables intentionally retain original paths as historical observations; current locations are listed here.

## Tracked JSON classification

Every JSON formerly under `docs/*.json` is classified below. No evidence JSON is deleted. Archived files preserve their original bytes. They are reviewed dated evidence rather than runtime fixtures. Missing dates/baselines in JSON are labeled rather than invented; original domain notes provide additional context where recorded.

| Original filename                      | Classification / current location                                                      | Recorded capture/measurement date | Recorded baseline                                          | Purpose                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `catalog-budget-audit.json`            | ARCHIVE — [catalog-budget-audit.json](catalog-budget-audit.json)                       | 2026-10-04T17:43:00.376Z          | `not recorded in JSON`                                     | budget snapshot                                                                                 |
| `catalog-coverage-audit.json`          | ARCHIVE — [catalog-coverage-audit.json](catalog-coverage-audit.json)                   | 2026-10-05                        | `c3e5eb7`                                                  | complete before/after coverage                                                                  |
| `conditional-live-validation.json`     | ARCHIVE — [conditional-live-validation.json](conditional-live-validation.json)         | 2026-10-04T18:17:09.310Z          | `not recorded in JSON`                                     | ordinary/benefit integrity                                                                      |
| `conditional-source-audit.json`        | ARCHIVE — [conditional-source-audit.json](conditional-source-audit.json)               | 2026-10-04T18:07:15.816Z          | `not recorded in JSON`                                     | public conditional source fields                                                                |
| `generic-comparison-audit.json`        | ARCHIVE — [generic-comparison-audit.json](generic-comparison-audit.json)               | 2026-10-04T03:31:53.020Z          | `not recorded in JSON`                                     | quantity/query evidence                                                                         |
| `listing-detail-audit.json`            | ARCHIVE — [listing-detail-audit.json](listing-detail-audit.json)                       | 2026-10-05T03:49:02.400Z          | `not recorded in JSON`                                     | independent listing/history boundaries                                                          |
| `listing-refresh-audit.json`           | ARCHIVE — [listing-refresh-audit.json](listing-refresh-audit.json)                     | 2026-10-04T02:53:58.348Z          | `not recorded in JSON`                                     | refresh coverage/selection                                                                      |
| `milestone-10-validation.json`         | ARCHIVE — [milestone-10-validation.json](milestone-10-validation.json)                 | not recorded in JSON              | `not recorded in JSON`                                     | refresh and repeat validation                                                                   |
| `milestone-14-history-audit.json`      | ARCHIVE — [milestone-14-history-audit.json](milestone-14-history-audit.json)           | 2026-10-04T21:10:05.200Z          | `not recorded in JSON`                                     | history depth/gaps                                                                              |
| `milestone-14-validation.json`         | ARCHIVE — [milestone-14-validation.json](milestone-14-validation.json)                 | 2026-10-04                        | `see embedded baseline object`                             | prospective coverage validation                                                                 |
| `milestone-16-performance.json`        | ARCHIVE — [milestone-16-performance.json](milestone-16-performance.json)               | 2026-10-05T03:20:43.255Z          | `not recorded in JSON`                                     | reviewed handler performance baseline                                                           |
| `milestone-18-basket-performance.json` | ARCHIVE — [milestone-18-basket-performance.json](milestone-18-basket-performance.json) | 2026-10-05T16:12:14.004Z          | `not recorded in JSON`                                     | distinct handler benchmark                                                                      |
| `price-history-audit.json`             | ARCHIVE — [price-history-audit.json](price-history-audit.json)                         | 2026-10-04T20:17:05.033Z          | `not recorded in JSON`                                     | ordinary history depth/changes                                                                  |
| `quantity-quality-audit.json`          | ARCHIVE — [quantity-quality-audit.json](quantity-quality-audit.json)                   | 2026-10-04T17:34:43.987Z          | `not recorded in JSON`                                     | complete quantity evidence                                                                      |
| `quantity-source-audit.json`           | ARCHIVE — [quantity-source-audit.json](quantity-source-audit.json)                     | 2026-10-04                        | `not recorded in JSON`                                     | captured source quantity semantics                                                              |
| `shopping-list-audit.json`             | ARCHIVE — [shopping-list-audit.json](shopping-list-audit.json)                         | 2026-10-05T02:22:10.511Z          | `not recorded in JSON`                                     | current-market need evaluations                                                                 |
| `staple-after.json`                    | ARCHIVE — [staple-after.json](staple-after.json)                                       | 2026-10-04T16:53:28.447Z          | `not recorded in JSON`                                     | reviewed after snapshot                                                                         |
| `staple-baseline.json`                 | ARCHIVE — [staple-baseline.json](staple-baseline.json)                                 | 2026-10-04T16:34:52.966Z          | `not recorded in JSON`                                     | reviewed before snapshot                                                                        |
| `staple-validation.json`               | ARCHIVE — [staple-validation.json](staple-validation.json)                             | not recorded in JSON              | `not recorded in JSON`                                     | source/acquisition/repeat checks                                                                |
| `catalog-refresh-measurement.json`     | KEEP ACTIVE — [runtime input](../catalog-refresh-measurement.json)                     | 2026-10-05T16:16:09.636Z          | `c3e5eb7` starting baseline, Milestone 18 worktree changes | Budget consumer; source identity/count and catalog-size provenance added from reviewed evidence |

REMOVE: none. Migration metadata and canonical/source test fixtures stay in their original packages and are outside this historical archive.

## Validation reports

- [Milestone 11 acceptance](milestone-11-validation.md)
- [Milestone 14 observation coverage](milestone-14-validation.md)
- [Milestone 17 listing detail](milestone-17-validation.md)

These reports and the full [original roadmap](engineering-notes-2026-10-05.md#original-docsroadmapmd) preserve October 3–5 chronology and recorded baseline references. Their old staged/pending/approval instructions describe earlier sessions only.

## New reports

Routine basket benchmarks now write new ignored `.artifacts/` files; explicit destinations are supported and existing files are refused. Read-only audits emit stdout without writing permanent documentation. Reviewed historical baselines are never automatic output targets. See [local testing](../local-testing.md#basket-benchmark-outputs).

Run `pnpm docs:check` to validate Markdown paths/anchors, root README commands and literal runtime JSON/workflow references. This dependency-free checker does not fetch external URLs or infer deployment state.

- [Account rollout observations, October 6](account-rollout-2026-10-06.md): anonymous production boundaries and scoped migration evidence; real-account acceptance remains unverified.
