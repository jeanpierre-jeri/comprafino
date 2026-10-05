# Milestone 14 validation — October 4, 2026 (Peru)

Implemented and live persistence validated; **not complete**. The normal Turbopack production build cannot bind its CSS worker port in this agent environment (`Operation not permitted`, os error 1). The initial general Chromium command consequently could not start its production server. A later user-produced production build is now available; the general Chromium suite passes after the navigation test race fix (13 passed, 14 skipped). Framework configuration is unchanged. Work is staged awaiting local build, Chromium and desktop/mobile light/dark acceptance; no commit or push is made.

[Recorded evidence](milestone-14-validation.json) includes live run summaries, repeat invariants, sample rollups, targeted evidence, storage and all real ordinary transitions. The [six-product history audit](milestone-14-history-audit.json) records original states, summaries, covered periods and segments for every retailer in 7/30/90-day ranges. Source operations were native public requests under unchanged bounds. No history was fabricated in live tables.

## Live persistence and integrity

The working tree started clean at `4a6e69b`. Before changing code, the read-only budget showed 826 known/normalized listings, 59 canonical groups, 133 public exact offers, 853 price states and a 10,928,128-byte database. The generated additive SQL was reviewed for FK, key, timestamp/count constraints and absence of backfill/data replacement, then applied through `pnpm db:migrate`.

| Full refresh    | Tottus observations / new states | Plaza Vea observations / new states | Metro observations / new states | Duration |
| --------------- | -------------------------------- | ----------------------------------- | ------------------------------- | -------- |
| First           | 150 / 0                          | 191 / 0                             | 208 / 2                         | 107.382s |
| Same-day repeat | 150 / 0                          | 191 / 0                             | 208 / 0                         | 113.309s |

Each run made 28 category requests (5 Tottus, 12 Plaza Vea, 11 Metro), zero targeted requests and zero normalization/matching writes. The schedule and caps were unchanged; the extra Plaza Vea page reflects usable-row selection, not expanded sources. Matching evaluated 9,008 candidates over 826 listings.

First run: **549 daily coverage rows**, each count 1. Repeat: **549 rows**, **zero added daily rows**, all first timestamps preserved, all latest timestamps advanced and all counts exactly 2. All **855 price states / 826 open states** retained the identical complete digest `3bfa778ce91d73dd77fb766ffca63871`. Zero invalid intervals, disconnected adjacent states or incorrect open counts were found.

One explicit targeted lookup for known public Metro SKU `427` (Primor Premium 900ml) succeeded: one request, one observation, zero price/normalization/matching writes. It created the **550th** day row with count 1. Its `last_category_observed_at` is NULL; first origin remains `unknown`, so no retroactive acquisition provenance is inferred. Earlier milestone evidence identifies this as a discovery-acquired public listing; this task directly proves its targeted coverage outside the category sample.

Final current coverage:

| Retailer  | Known | Known observed today | Expected public | Public observed today | Public missing today |
| --------- | ----: | -------------------: | --------------: | --------------------: | -------------------: |
| Metro     |   295 |                  209 |              48 |                    40 |                    8 |
| Plaza Vea |   269 |                  191 |              56 |                    45 |                   11 |
| Tottus    |   262 |                  150 |              29 |                    17 |                   12 |
| Total     |   826 |                  550 |             133 |                   102 |                   31 |

Earliest durable date: **October 4, 2026**, local Peru. Average accepted observations per covered listing/day: **1.9982** (549 rows at 2 and one at 1). No historical coverage was inserted. There are no natural closed-day gaps yet: collection began today. Missing today's evidence on 31 public listings is real current uncertainty, not proof of retailer failure; the day remains open and some recent pre-migration targeted observations are too young for another scheduled lookup. The existing targeted age/cooldown is unchanged. Other retained listings are outside the bounded category sample, so all-listing daily coverage is not promised.

## Real history audit

Six public exact products were audited: Gloria Zero Lacto 800ml; Gloria Zero Lacto 946ml tripack; Gloria Light 946ml tripack; Gloria Entera 946ml tripack; Ideal Cremosita 390g sixpack; La Calera brown eggs 30un. All retailer summaries/ranges are in the audit JSON. Observed dairy offers have actual same-day endpoints and flat verified intraday paths after the repeat. Coverage is partial for Gloria Zero Lacto 800ml (Plaza Vea has a path; Metro/Tottus do not). La Calera eggs has a Plaza Vea path while Tottus remains conservative. None of these public exact products has an ordinary-price transition or a verified multi-day streak yet.

All **three real ordinary transitions**, across **two listings**, were audited:

| Listing                                           | Recorded transition | Observed in Peru            | Public exact product?    |
| ------------------------------------------------- | ------------------- | --------------------------- | ------------------------ |
| Metro `39254015`, Danlac Light lactose-free 900ml | S/ 9.00 → S/ 7.50   | Oct 4, 11:50                | No canonical association |
| Same listing                                      | S/ 7.50 → S/ 9.00   | Oct 4, 16:02, first refresh | No canonical association |
| Metro `8457`, Danlac whole pasteurized 900ml      | S/ 6.90 → S/ 8.10   | Oct 4, 16:02, first refresh | No canonical association |

These came from real retailer data. They do not appear on a public exact-product page because matching eligibility remains unchanged. The controlled fixture decrease is a separate isolated test, never inserted for live appearance.

855 states include 826 initial states, 3 ordinary transitions and 26 other (reference-only) transitions. 798 listings have one state. Earliest state start is October 3 at 12:45 Peru; final audit October 4 around 16:10 gives roughly **27h25m** since acquisition began. Durable coverage spans only **one local date**. Young history supports current/min/max/state details and intraday repeated-observation paths today; several covered days will support streaks and genuine daily segments, and several weeks will give more useful descriptive range metrics.

## Storage

After the 549-row same-day repeat, table allocation is **114,688 bytes (112 KiB)** and index allocation **57,344 bytes (56 KiB)**, **172,032 bytes (168 KiB)** combined. Adding the targeted row did not allocate another page. There is only the listing/date primary-key index.

| Daily listings covered          | Rows per full day | Rows per 30 days | Approximate monthly allocation at measured ratio |
| ------------------------------- | ----------------: | ---------------: | -----------------------------------------------: |
| Current bounded category sample |               549 |           16,470 |                                         4.92 MiB |
| All currently known listings    |               826 |           24,780 |                                         7.41 MiB |
| Scenario: 1,000 listings        |             1,000 |           30,000 |                                         8.97 MiB |
| Scenario: 1,500 listings        |             1,500 |           45,000 |                                        13.45 MiB |

These row projections are maximums under complete daily coverage, not guarantees from the bounded source sample. The byte scenario scales a small real allocation after two updates; fixed overhead, dead tuples, index packing and vacuum affect the ratio. It is an estimate, not measured monthly growth or a provider billing forecast. The 1,000-row catalog guard stays unchanged; 1,500 cannot be enabled under it. Growth is small enough to retain the simple rollup without partitioning, extra indexes or retention infrastructure.

## Checks and fixtures

Formatting, type-aware Oxlint, strict TypeScript and **540 unit tests** pass. Seventeen added unit cases cover Peru day boundaries, first/repeated/next-day rollup, replay immunity, consecutive days/gaps/clipping, increases/decreases, integer percentage/absolute differences, min/max/count, pre-coverage evidence, reference-only changes, insufficient current evidence, unsupported intervals and coverage beginning exactly at a transition. The existing CMR and failed-adapter tests remain in the regression suite.

**41 PostgreSQL tests pass**, four added scenarios plus rollback assertions: shared category/discovery/targeted coverage, actual unique-key enforcement and concurrent accepted observations, failed/negative/malformed/unusable outcomes, next-day Lima boundary, unchanged/changed history compatibility, scoped history query without state multiplication, range exclusion, real fixture gap detection and developer coverage reads. All writes use fresh random schemas; no live retailer is involved. The first run revealed test ordering interference with discovery cleanup (a new fixture's FK); moving those fixture cases after discovery-reset cases fixed it. The subsequent complete suite passed.

Six isolated fixture kinds pass SQL/model validation: historical events, sparse, outside range, continuous days, a missing day and a decrease. The runner applies journaled migrations, checks isolation and removes only its own schema. Continuous fixture reports six unchanged covered days; gap fixture reports two paths and a two-day streak; decrease fixture reports S/ 1.50 down (20%). Current fixture CMR remains separate.

Six history Chromium cases are prepared (four retained plus two added), covering verified step paths, gap splitting, decrease/streak copy, ordinary/CMR separation, sparse states, controls/tooltips, ranges and desktop/mobile light/dark screenshots/no overflow. **Final history fixture browser and manual visual acceptance remain pending.** On the subsequently available local production build, the general suite passes (13 passed, 14 skipped) and the corrected mobile navigation case passes 10/10 repeated runs. The isolated history browser suite was then run: four cases passed (ordinary/CMR separation, ranges, sparse history and verified continuity/gap/insights); two failed. One assertion incorrectly treated a flat SVG path's zero-height box as hidden. The other revealed that ComposedChart's axis tooltip mode broke marker mouseover tooltips.

The flat-path assertion now checks the visible chart and the SVG path's nonzero drawn width. The chart retains ScatterChart's original item tooltip mode, with separate joined paths from core's already expanded horizontal/vertical state endpoints. Empty segment shapes introduce no fake observation markers. Format/lint/types and all 540 unit tests pass after the fix. A fresh production build is needed before repeating those history cases; the agent again hits the known Turbopack CSS worker-port restriction. No passing final history run or visual approval is claimed.

Local completion commands, after setting the explicit test URL securely:

```sh
pnpm build
pnpm test:e2e
TEST_DATABASE_URL=... pnpm test:e2e:history
```

The isolated runner's screenshots live under the web Playwright test results directory. Review continuous, gap and decrease fixtures at 390px/1280px in both themes, plus real product pages from the audit. Confirm no lines across gaps, correct ordinary/CMR separation and readable controls/tooltips. After those checks pass, commit the staged work as `feat: add durable price observation coverage`; do not push automatically.

## Requested final report

| #   | Item                       | Result                                                                                                                                                                                                      |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Observation model          | One prospective listing/local-day rollup with first/latest/count.                                                                                                                                           |
| 2   | Reason                     | Preserves successful unchanged observations at bounded daily storage; actual prices remain state-oriented.                                                                                                  |
| 3   | Day/timezone               | `America/Lima` everywhere; 7/30/90 ranges remain rolling instant windows.                                                                                                                                   |
| 4   | Schema                     | Reviewed/applied `0006_light_blink.sql`, FK, composite primary key and count/time checks; no backfill or extra index.                                                                                       |
| 5   | Ingestion                  | Shared atomic accepted-upsert CTE covers category and discovery.                                                                                                                                            |
| 6   | Targeted refresh           | Same API; live public Metro `427` created coverage with no price state.                                                                                                                                     |
| 7   | Same-day idempotency       | 549→549 rows; every count 1→2, first preserved/latest advanced; equal/older replays ignored.                                                                                                                |
| 8   | Failures/gaps              | No failed, missing, unavailable or unusable success row; gaps remain unknown evidence. Rollback is atomic.                                                                                                  |
| 9   | Chart continuity           | Exact steps inside consecutive covered dates, bounded by actual first/latest observations; gaps/unsupported states split paths.                                                                             |
| 10  | Pre-coverage               | Disconnected event markers and original state details; no invented continuity.                                                                                                                              |
| 11  | Insights                   | Retailer-specific up/down, absolute/rounded percentage, min/max, selected-range change count and verified unchanged-day streak.                                                                             |
| 12  | Streak                     | At least two covered dates ending today; stops at gap/change day/unsupported interval/range boundary.                                                                                                       |
| 13  | Range metrics              | Min/max from intersecting usable ordinary states; counts from contiguous amount transitions starting in range. Reference/CMR/refreshes excluded.                                                            |
| 14  | Live rows                  | 549 from full category day; 550 after targeted diagnostic.                                                                                                                                                  |
| 15  | Repeat                     | All invariants passed; unchanged 855-state digest.                                                                                                                                                          |
| 16  | Public coverage            | 102/133 today; 31 missing, day still open.                                                                                                                                                                  |
| 17  | Retailers                  | Metro 40/48; Plaza Vea 45/56; Tottus 17/29 public today.                                                                                                                                                    |
| 18  | Real gaps                  | No closed-day gap yet; first durable date is today. Pre-coverage gaps cannot be reconstructed.                                                                                                              |
| 19  | Real changes               | Three transitions in two unlinked Metro listings, two newly observed during refresh; no public exact transition.                                                                                            |
| 20  | Depth                      | About 27h25m total acquisition history; one local coverage date.                                                                                                                                            |
| 21  | Current monthly projection | 24,780 rows at 826 fully observed listings; category sample alone 16,470.                                                                                                                                   |
| 22  | 1,000 listings             | 30,000 rows/month, rough 8.97 MiB allocation.                                                                                                                                                               |
| 23  | 1,500 listings             | 45,000 rows/month, rough 13.45 MiB; existing catalog guard excludes this size.                                                                                                                              |
| 24  | Unit tests                 | 17 added, 540 total passing.                                                                                                                                                                                |
| 25  | PostgreSQL                 | 4 added scenarios, 41 total passing; isolated schemas.                                                                                                                                                      |
| 26  | E2E                        | Six fixture kinds validated in DB; Chromium blocked by absent successful restricted build.                                                                                                                  |
| 27  | Visual                     | Desktop/mobile and light/dark browser/manual acceptance pending local checks; screenshot cases prepared.                                                                                                    |
| 28  | Dependencies               | None added.                                                                                                                                                                                                 |
| 29  | Important files            | Core coverage/history and tests; DB schema/migration, shared writer, query, audit/report, reference model and tests; history chart/cards, dev ingestion, isolated E2E fixture/spec; documentation/evidence. |
| 30  | Commit                     | None: staged awaiting the explicit local build/E2E gate. No push.                                                                                                                                           |
| 31  | Limits                     | Daily endpoints/count, no every-scrape reconstruction, unknown stock/location, bounded acquisition, pre-coverage uncertainty, young data, old deployed writers need update.                                 |
| 32  | Milestone complete?        | No, pending local production build, Chromium and visual acceptance.                                                                                                                                         |
| 33  | Before evaluating buy/wait | Collect at least 4–6 weeks of genuine coverage, then assess completeness and promotion-cycle depth; do not implement recommendations yet.                                                                   |

## Navigation test follow-up

The user's general E2E run found a race in the mobile keyboard chip test: `isVisible()` succeeded, then the loading boundary replaced the homepage before `toHaveAttribute()` could read the chip. The trace/error snapshot shows the loading skeleton after the chip disappeared. The test now captures pending attributes, repeated clicks and reduced-motion styling in one browser-side task, preserving its checks without waiting for an unmounted link. Application navigation behavior is unchanged. Format/lint/types pass and the general production Chromium run passes (13 passed, 14 skipped), followed by 10/10 repeated mobile navigation passes. The existing stream-closure log still appears during navigation testing; it did not fail this successful run.
