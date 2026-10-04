# Public ordinary-price history — Milestone 13

Implementation is available; Milestone 13 is **not complete** until history-specific Chromium tests and desktop/mobile visual acceptance pass. The user confirmed the local production build and general E2E run passed; the isolated history browser cases remain unexecuted. Framework configuration is unchanged. The user authorized committing the remaining implementation; no push is authorized.

## Scope and ownership

History appears only on public exact canonical-product pages, after current retailer offers and before the source/freshness notice. Search cards and generic results remain current-price focused. The label is “Historial del precio para todos”. CMR, loyalty/card prices, multibuy and conditional promotions never contribute to ordinary metrics or plotted values. Current CMR blocks retain Milestone 11 behavior. There are no recommendations, averages, percentiles, alerts, AI, retailer additions or migration/history writes.

Core owns pure ranges, interval intersection and summary/point generation in `packages/core/src/price-history.ts`. DB exposes `getCanonicalProductPriceHistory(db, productId, { range?, now? })` in `packages/db/src/price-history.ts`. The web Server Component renders summaries and URL links; its chart Client Component handles SVG tooltips and simple retailer toggles. Shared UI provides a minimal shadcn base-nova ChartContainer and Recharts v3 primitives.

## Storage semantics discovered

`price_history` stores states, not one row per scrape. `valid_from` is the accepted observation timestamp that opened the state. The actual closing column is `valid_until` (not `valid_to`); NULL means open. A strictly newer accepted observation closes the open row and starts another when any of ordinary cents, reference cents, currency or quote unit differs. Therefore a new row does **not** necessarily mean an ordinary price change. Equal/older observations cannot overwrite the newer listing state. A partial unique index enforces one open state per listing; listing/start uniqueness prevents duplicate starts.

Repeated unchanged observations only advance `retailer_listings.last_seen_at`. All category, discovery and successful targeted quote refreshes share the same atomic writer/retailer lock. Category observations separately advance `last_category_observed_at`; discovery/targeted do not. Unavailable/missing/failed targeted results preserve quote timestamps and history. First-seen, canonical creation, matching and retailer-run success timestamps are not quote verifications.

The stored closed interval `[valid_from, valid_until)` describes the recorded state lifecycle. Its endpoint is when the next different state was observed, not proof of when the retailer actually changed its price. An open interval is bounded for summaries by the listing's latest successful verification, never by today alone. No daily rows or historical values are rewritten.

## Observation coverage and chart choice

There is no durable per-listing observation log. Only state starts, the latest successful listing verification and latest category/targeted metadata survive. Aggregate ingestion runs do not enumerate successfully observed SKUs. Consequently continuous unchanged observations cannot be distinguished reliably from periods without observations. No historical gap detector or freshness-threshold line segments are claimed.

The chart uses **disconnected event markers**, one series per retailer. It plots actual in-range state-start instants and, for an open state, a distinct latest successful verification in range. It creates no daily samples, range-boundary observations, closing-price observations or connecting lines. A prior closed state's closing timestamp belongs to the next observation, so it is not plotted as an observation of the old amount. Reference-only state starts are factual quote observations, but never count as ordinary changes. Tooltips distinguish state starts from latest verification and show retailer, PEN amount and Peru time.

This deliberately avoids stepped lines: even a step would imply coverage the database cannot prove. Copy explicitly explains missing observations and disconnected points. A state carried into a range can affect recorded-state metrics without creating a chart marker at the range start. The expandable per-retailer state list provides original starts/ends and marks states begun before the selected range.

Circle, diamond and square markers plus named toggle buttons distinguish retailers without depending solely on color. The colors reuse existing retailer text tokens. There are no smoothing curves, gradients or new chart library. [Official shadcn source](https://ui.shadcn.com/r/styles/base-nova/chart.json) is adapted to CSS variables and the repository's strict types; only needed primitives are retained.

## Ranges and metric definitions

The URL accepts exactly `range=7d`, `30d`, or `90d`. Missing, invalid or repeated values default to **7d**. The live audit showed less than one day of history, making 7 days a reasonable initial default. The default is stable and tested rather than changed dynamically per product. A range is the trailing 7/30/90 × 24 hours from request time; display dates/times use `America/Lima`. Range links preserve `priceMode=benefits`, and changing benefits preserves the range. No arbitrary dates or client caching.

A closed state intersects when its start is at/before the range end and its exclusive end is strictly after the range start. An open state contributes only if its last successful verification is at/after the range start. A state ending exactly at the range start is excluded. A state starting before the range can legitimately contribute as a **recorded state**, without claiming daily coverage. Original timestamps remain intact in the result.

Per retailer:

- **Latest verified price in range:** the open ordinary state when its latest verification is inside the range. The existing current comparison remains authoritative and useful even when this metric is absent.
- **Minimum/maximum recorded price:** ordinary cents among intersecting recorded states; NULL/“—” when none exist. These describe the stored states, not a proven continuously observed low/high over every day.
- **Difference:** open price minus the earliest intersecting state's ordinary price, when both exist; otherwise NULL. Signed PEN formatting reuses the tested existing `formatPen` helper.
- **Number of changes:** actual contiguous ordinary transitions whose new state starts inside the selected range. A predecessor outside the range can establish a transition at its start; reference-only changes are excluded.
- **Last change:** latest such transition, with prior/new ordinary cents and actual new-state observation time. Up/down copy uses cents, never reference or CMR amounts. Missing transitions show “Sin cambios observados en este rango”, not an assertion that the retailer never changed.

The query fetches public identity, retailer/listing provenance, successful verification/availability and ordinary states with original timestamps and predecessor metadata. It shares exact-product eligibility: automatic current-version confidence ≥0.90, active normalized listings, PEN/UN open ordinary states, at least two retailers, and rejection of a group with any manual/obsolete/below-confidence link. Review and unmatched listings cannot leak. Historical reads are bounded by the canonical product, relevant listings and selected range, with a single indexed predecessor lookup per returned state. There is no React SQL, per-retailer query loop or whole-table web fetch.

## Sparse history and display behavior

When every retailer has no intersecting state, the section shows a clean no-records message. With recorded prices but no ordinary transition, it shows “Aún no tenemos suficiente historial para mostrar una tendencia.” and omits the chart. Useful current/min/max summaries and state details remain. Chart visibility does not depend on the number of reference-only changes. Range links remain available in sparse/error states. History load failures do not discard the current comparison.

Light/dark surfaces, grids, labels, markers, tooltip and empty states use shared CSS tokens. The chart has a fixed 256px height, responsive width, three sparse date ticks, a readable PEN axis and wrapping ≥44px retailer/range controls. State details provide prices without relying on hover. **These design provisions have type checks but have not yet received browser/visual verification** at desktop or ~390px in either theme. Touch tooltip behavior, keyboard SVG navigation, overlap handling and contrast require the pending browser acceptance. No visual screenshot claims are made.

## Live read-only audit

[Recorded audit](price-history-audit.json), October 4, 2026, approximately 15:17 Peru:

- 763 history states, 736 listings and 736 open states.
- Earliest start October 3 at 12:45 Peru; latest start October 4 at 12:32 Peru: approximately 23h47m between state starts, not verified observation coverage.
- 709 listings have one state; 27 have two states. Of 27 transitions, **one** changed ordinary cents; 26 left ordinary cents unchanged.
- No adjacent state starts exceed 36 hours. This is not evidence of continuous observations or no gaps.
- The real ordinary change is Metro SKU `39254015`, **Leche Deslactosada Danlac Light Botella 900ml**, S/ 9.00 → S/ 7.50 on October 4 at 11:50 Peru. It has no canonical association, so it correctly does not appear on an exact-product history page.

Six eligible exact products were inspected through the DB query in all three ranges. Current offers, original state sequences, min/max, last change, change count and chart point sequences are in the JSON. They all have zero ordinary transitions; reference changes do not manufacture a trend.

| Exact product                        | Canonical ID                           | Metro / Plaza Vea / Tottus ordinary prices |
| ------------------------------------ | -------------------------------------- | ------------------------------------------ |
| Gloria Zero Lacto bolsa 800ml        | `157d7678-aa71-832c-bf8d-dd6885a89e42` | S/ 5.20 / 5.10 / 5.10                      |
| Gloria Zero Lacto caja 946ml tripack | `36b44e42-3f15-8ac8-a66d-2f5153cdb339` | S/ 16.20 / 16.50 / 16.10                   |
| Gloria Light caja 946ml tripack      | `4cf1e951-c626-8948-86da-b54020a18727` | S/ 16.20 / 16.50 / 16.10                   |
| Gloria Entera caja 946ml tripack     | `69c3625d-2d3e-8624-b483-2323e108f94b` | S/ 15.90 / 16.20 / 16.10                   |
| Ideal Cremosita 390g sixpack         | `898b8c56-fc13-89ca-9369-7860882dc6bd` | S/ 22.90 / 23.50 / 23.50                   |
| La Calera huevos pardos 30un         | `05c25031-29a8-8ee6-9dff-129036aa42c9` | — / S/ 17.90 / 17.90; only first states    |

For each retailer in these examples, min=max=current and last change is absent in 7/30/90 days. Public manual screenshots should use these real products, with their sparse state honestly visible. No fake history was inserted into application tables for appearance.

## Tests and commands

Added ten core cases cover range/default parsing, half-open clipping/carry-in, actual current verification, min/max, up/down/latest transitions, a predecessor outside the range, unchanged/reference-only states, disconnected predecessors, one/no-state results, immutable inputs, future verification and no invented daily/boundary points. Existing money tests cover the reused PEN helper. Two DB boundary cases reject unsafe/non-test schema names and verify lazy client construction.

The isolated PostgreSQL history case checks multiple retailers, selected clipping, prior state carry-in, current open/closed history, latest unchanged verification, last-change predecessor outside the result, malformed/missing identity, active CMR exclusion, unmatched rows and manual/review-confidence group rejection. It uses the existing randomly scoped migration harness, no live retailer calls.

Four browser scenarios cover sufficient fixture history, retailer toggles, summary/last-change values, URL ranges/back/benefits preservation, sparse/outside-range behavior, separate CMR and 390px light/dark chart/tooltip behavior. These are added but **not run yet**. The fixture runner creates a random schema, applies checked-in table migrations there (no shared extension creation), seeds three exact products using controlled observations/links, validates results, runs only the history spec and drops only its own schema in `finally`.

Neon HTTP did not honor URL `search_path` options during fixture validation. The runner therefore passes validated `COMPRAFINO_E2E_SCHEMA=comprafino_e2e_<32 hex>` to its child web server. Every direct query/batch is wrapped with transaction-local `set_config`, with no public fallback. Normal database access remains unchanged without that explicit override. Do not set it in deployment. `PRICE_HISTORY_FIXTURE_IDS` supplies only fixture IDs to Playwright. No production endpoint/test bypass was introduced. Interruptions can leave a random schema for manual review; the runner never drops public tables.

```sh
pnpm audit:price-history
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
# Explicit opt-in; the harness never reads .env or falls back:
TEST_DATABASE_URL=... pnpm test:integration
pnpm build
pnpm test:e2e
TEST_DATABASE_URL=... pnpm test:e2e:history
# Fixture/SQL validation only, without a browser or build:
TEST_DATABASE_URL=... pnpm --filter @comprafino/db test:e2e:history --validate-fixtures
```

The audit command loads the existing root `.env` and is read-only. It compares current offers with range-supported current values and records all three ranges. Integration and fixture validation here explicitly supplied the configured development database as `TEST_DATABASE_URL` in the runner; all writes stayed in the harness's random schemas.

Validation status: formatting, lint, strict typechecking, **523 unit tests** and **37 PostgreSQL integration tests** pass. Rich/sparse/outside-range fixture construction, Neon isolation and cleanup pass. The restricted-sandbox `pnpm build` failed at the existing Turbopack CSS worker port restriction (`Operation not permitted`); no configuration workaround/elevated build was attempted. The user subsequently confirmed a fresh local default Turbopack build passed and provided the general production E2E result: 13 passed, 12 skipped, with known navigation stream-closure log messages. The isolated history fixture browser cases remain unexecuted; general E2E success and navigation visual acceptance do not establish history-chart acceptance. No completed price-history milestone or passing history-specific browser audit is claimed.

## Files and next decision

Important changes: core history helpers/tests; DB history query/integration, read-only audit CLI and JSON, isolated browser-fixture runner/client boundary; shared chart component/Recharts dependency; product history Server/Client Components, product route and range-preserving price controls; four E2E cases; README, architecture, dependency inventory and roadmap. No migration. The user authorized committing all remaining staged and relevant unstaged work as `feat: add public price history`. History-specific browser validation remains pending as documented above. Do not push automatically.

Future price insights first need more genuine historical depth and durable per-listing successful observation coverage, with a separately reviewed storage/cost decision. Then evaluate whether metrics can support descriptive comparisons before any buy/wait claim. Conditional history requires its own model; today's CMR rows cannot reconstruct past benefits. This is a recommendation only; no next-milestone implementation has begun.
