# Milestone 11 validation and handoff

Started from a clean tree at `f2505e7` on October 4, 2026. Milestones 0–10 are the user-provided completed baseline. Milestone 11 implementation and source/database validation are ready; **the milestone is not complete until local production build, Chromium E2E and visual confirmation pass**. Changes are staged, with no commit or push.

## Source and persisted evidence

[Source audit](conditional-source-audit.json) records seven current concrete Tottus CMR prices, one no-benefit control, Plaza Vea payment/discount/hidden-location teasers, and Metro's percentage/BIN-restricted dairy campaign. [Live validation](conditional-live-validation.json) records actual persistence, row revisions, history digest and public standard/benefits reads. Requests were legitimate public anonymous requests; no retailer dependency is used in automated tests.

Reviewed generated migration `0005_redundant_deadpool.sql` was applied successfully to the configured development database. It adds a separate current-offer table, unique listing/program identity, positive cents, explicit program/condition constraints and optional validity windows; ordinary tables/history rows are unchanged by the migration.

Two existing bounded Tottus dairy ingestions (`limit=48`) each fetched **51 source rows**, persisted **48 listing observations**, and opened **zero ordinary history states**. Run IDs: `964d5899-20a1-4af8-9710-420075cc8f67`, `85186ee0-f81f-4700-9ec5-2a20f702a60c`. All **seven** benefit rows retain their PostgreSQL `xmin` revisions on repeat. Freshness advanced on listings while unchanged offer rows were not rewritten.

All **763** ordinary history states retain digest `db3e44dab8fbfa44c75542c511a15d17` before ingestion, after first ingestion, after repeat and after normalization. This digest uses ordered full history row JSON; older milestone digest formats need not match it. Equality across this validation demonstrates unchanged history, rather than comparing differently serialized historical audit hashes. There were no changed ordinary amounts/reference states. Normalization reports **0 changed / 736 unchanged / 0 stale**. Normalizer/version and matcher/threshold source files are unchanged; no live rematching was needed.

| Tottus SKU | Product                                | Ordinary | CMR      | Reference |
| ---------- | -------------------------------------- | -------- | -------- | --------- |
| 129087925  | Gloria whole milk 6 × 390 g            | S/ 21.90 | S/ 20.90 | S/ 24.60  |
| 126990866  | Laive lactose-free milk 4 × 946 ml     | S/ 20.50 | S/ 19.50 | S/ 24.50  |
| 145813821  | Gloria strawberry yogurt 1.6 kg        | S/ 8.90  | S/ 7.90  | S/ 10.80  |
| 145813834  | Gloria vanilla yogurt 1.6 kg           | S/ 8.90  | S/ 7.90  | S/ 10.80  |
| 145813808  | Gloria lúcuma yogurt 1.6 kg            | S/ 8.90  | S/ 7.90  | S/ 10.80  |
| 145813824  | Gloria strawberry/banana yogurt 1.6 kg | S/ 8.90  | S/ 7.90  | S/ 10.80  |
| 145813806  | Gloria peach yogurt 1.6 kg             | S/ 8.90  | S/ 7.90  | S/ 10.80  |

The Nan 3 eight-can formula control has S/ 40.40 ordinary and no CMR/reference amount. Plaza Vea Gloria SKU `11359692` has S/ 21.50 ordinary / S/ 24.60 reference with discount teasers excluded. Metro Gloria SKU `39233309` has the same ordinary/reference and a 5% BIN-restricted card teaser excluded. Plaza Vea Laive `11359044` is an ordinary no-teaser control. See [pricing documentation](../conditional-pricing.md) for why no additional program/quantity offer type was implemented.

Exact product `df95f601-09b4-88a7-a48b-12d304075fee` is the audited Gloria whole-milk six-pack. Its standard minimum is **S/ 21.50 at Plaza Vea**. Benefits ranking selects **S/ 20.90 at Tottus, requiring CMR**; ordinary minimum fields remain S/ 21.50 and Tottus's ordinary row stays S/ 21.90.

Read-only current searches in both modes retain staple coverage: huevos **29 generic / 3 exact**, arroz **30 bounded generic / 5 exact**, aceite **27 generic / 3 exact**. Strong comparable bases are unit, kg and L respectively. Gloria has mass/volume/item bases. No family relevance or canonical thresholds were modified; existing sugar/variant regressions pass. Source prices are timestamped observations, not location-independent guarantees.

## Automated verification

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`: pass after final formatting.
- `pnpm test`: **511** unit cases pass (368 core, 34 DB, 109 scraper); **12 new** cases cover conditional price/program validation, stale/future/expired offers, ordinary versus benefits/ties, URL defaults/invalid values/serialization and basis/retailer compatibility, plus real CMR fixture extraction and malformed benefits.
- `pnpm test:integration`: **36** isolated PostgreSQL tests pass, including **2 new** scenarios. They verify current-offer insert/unchanged revision/update/removal, older/equal replay protection, independent ordinary history, generic and canonical standard/benefits winners, conditions, retailer/unit filters, expiry/staleness and filtered-empty discovery suppression. Tests explicitly receive the configured URL through `TEST_DATABASE_URL`, create/drop only a fresh isolated schema and never use live retailer data.
- Initial integration validation found two fixture issues: the new competitor used the Tottus-only helper, and placing the new 990-cent fixture ahead of an existing temporary 990-cent rejection constraint made that older test invalid. The competitor now explicitly uses Metro; new scenarios run after existing constraint tests. Targeted scenarios and the final full suite pass. Test schemas were torn down.
- `pnpm build`: fails at the known default Turbopack CSS-worker port bind (`Operation not permitted`). Next.js configuration is unchanged; no alternative bundler was substituted.
- `pnpm test:e2e`: attempted after the build; production web server cannot start. **No browser test is claimed as passed.** Updated the former Apply flow and added persisted-catalog immediate sort/retailer/benefits/back flows at 390px, plus a real exact-product ordinary/CMR detail check. Existing homepage, canonical comparison, discovery and sugar relevance flows remain.
- Manual desktop/390px rendering, keyboard focus and overflow audit: **blocked by the absent successful production build**. Compact control/card changes are implemented and typechecked; visual correctness is not claimed.

No dependencies, environment variables, retailer, permanent source category, schedule, request budget, account/profile, client caching or infrastructure were added. No price-history UI was started.

## Local completion gate

With the migrated development/test database configured and matching server/runner `DATABASE_URL`:

```sh
pnpm build
pnpm test:e2e
```

Reuse `PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/browsers"` only if needed for the existing bootstrap Chromium. Review desktop and 390px `/search?q=huevos`, `arroz`, `aceite`, and `/products/df95f601-09b4-88a7-a48b-12d304075fee`, both price modes. Check immediate filter navigation, back restoration, unit labels/conditions, keyboard/focus behavior, density and no overflow. Avoid submitting fresh missing searches solely for a visual check; existing E2E true-empty flow retains the original discovery behavior.

After local build/E2E and manual review succeed, the requested commit is `feat: add conditional pricing and improve search UX`. Do not push automatically. No commit hash exists yet. Important changed files are the core offer/filter modules, DB schema/migration and ingestion/public query modules, Tottus parser/fixtures, search controls/cards/detail, unit/PostgreSQL/E2E tests and pricing/search/operations/roadmap docs.

For Milestone 12, review interval integrity and observed gaps before a compact ordinary-price history table. Decide conditional historical storage separately; current CMR offer state cannot reconstruct earlier prices. This is a recommendation, not implementation authorization.
