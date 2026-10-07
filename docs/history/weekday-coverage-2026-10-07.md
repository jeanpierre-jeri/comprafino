# Read-only weekday coverage inspection — October 7, 2026

Inspected at 18:17–18:19 UTC (13:17–13:19 America/Lima), before implementation. Both commands read the configured catalog only, without ingestion, state changes or coverage backfill:

- `pnpm audit:observation-coverage`
- `pnpm --filter @comprafino/db exec node --env-file-if-exists=../../.env --experimental-strip-types src/weekday-audit-cli.ts`

There were 1,012 known listings and 2,975 daily coverage rows beginning October 4. Latest coverage was October 7; the maximum per SKU was four dates. Of 155 currently public exact listings, 154 had coverage on October 7 (the day was still partial).

| Retailer  | Covered listing-days | Listings with coverage | First / last local date | Comparable ordinary UN days | Mixed intraday days |
| --------- | -------------------: | ---------------------: | ----------------------- | --------------------------: | ------------------: |
| Metro     |                1,092 |                    358 | October 4 / October 7   |                       1,039 |                   8 |
| Plaza Vea |                  987 |                    329 | October 4 / October 7   |                         978 |                   1 |
| Tottus    |                  896 |                    323 | October 4 / October 7   |                         708 |                   0 |

“Comparable” here means positive ordinary UN price at the actual last observation and no differing price/unit/currency state between the day's first and last actual observations. This broad audit includes listings outside current public identity eligibility; it is not purchase authorization. No conditional prices contribute. Single observations remain samples, not all-day guarantees.

The coverage audit returned ten missing October 6 dates after earlier durable coverage: Metro 39264735, 39272346, 520; Plaza Vea 10672500, 11129476, 11566644, 28252, 5352; Tottus 113715174, 121520512. Missing dates are unknown evidence, not proof of failed retailer requests. The sample does not count pre-coverage dates as observed or infer them from open states.

Four dates cannot establish a repeated weekly pattern. The implemented criterion and UI are documented in [shopping lists](../shopping-list.md#weekday-purchase-advice). This dated snapshot is evidence only and does not authorize writes or future operational actions.
