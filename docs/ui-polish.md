# Public UI polish — Milestone 12

The goal is a calm, useful consumer experience: warmer surfaces, clearer hierarchy and inviting product browsing, with restraint. Milestones 0–11 are complete in the provided baseline `6c3a52f`. This milestone changes presentation, without expanding the backend or catalog.

## Home

A soft sage hero pairs the existing headline with a prominent white search surface. Desktop uses two balanced columns; mobile stacks them with smaller type and spacing to keep search within reach. Four ordinary starter links (huevos, arroz, aceite, leche) are examples, not claims about popularity or current inventory. They reuse existing search routes and disable prefetch so the database-independent home does not initiate background searches. Three short steps explain search, price context and supermarket links. A compact retailer strip reinforces Tottus, Plaza Vea and Metro coverage without implying partnership.

## Search and filters

A grouped search heading replaces the bare title/form. Exact products have their own tonal section, distinct from independent supermarket options. Counts remain bounded returned-result counts, not full-catalog totals. Compatible unit-price and direct-kg groups retain their existing separation and arithmetic. Filtered-empty results offer a link to the same query without filters; true-empty results retain discovery copy and a starter search. Invalid queries and database failures keep their existing behavior.

Native selects remain labelled, URL-driven and immediate. The white toolbar has 44px controls, visible focus, disabled pending state and its native output/status announcement. Desktop uses three or four columns according to available controls. Mobile uses two columns from 380px, with an odd final price control spanning the row; narrower widths stack controls so long options fit. Comparison pages constrain the price select width.

## Product cards and comparison destination

App-owned Server Components `GenericOfferCard` and `ExactProductCard` share the visual card system. A framed image, retailer/comparison badge, complete title and package line form the first group. Mobile uses a 112px image beside the title; desktop uses a taller image above it. Titles are never line-clamped. Ordinary prices use the strongest typography, reference prices stay small and crossed out, and unit prices support the total. CMR amounts use a secondary warm surface with the required-card label. Exact cards show the existing lowest conditional benefit separately, including its retailers, without replacing the ordinary minimum or changing ranking.

Generic images and source CTAs link to the validated retailer URL. Comparison links only appear for existing eligible exact associations. Cards provide border/shadow hover and focus feedback, not whole-card JavaScript navigation. Source links keep accessible new-tab text and `noopener noreferrer`. Observation timestamps stay visible in Peru time. The exact-product hero combines the image, identity and ordinary best price; retailer rows distinguish ordinary, reference and conditional prices, freshness, ties and source links. Stale/unavailable labels and eligibility are unchanged.

## Visual system and accessibility

The shared UI stylesheet owns color roles, neutral/sage surfaces, warm benefit surfaces, soft shadows, consistent radii and reusable surface/card/link/badge classes. Typography uses a local system-font stack; no downloaded fonts or assets. Green is reserved for brand, price and interaction emphasis. Retailer labels use quiet colored badges and readable text rather than color alone. A skip link, global visible focus, semantic headings, native controls and reduced-motion support improve keyboard and motion accessibility. Existing image fallback remains.

## Manual acceptance and validation

Production Chromium pages were inspected before and after the refinements using persisted catalog data, not mocked offers. Screenshots are kept locally in ignored `.tools/ui-polish/` rather than committed as brittle snapshot tests.

Reviewed at 1440px desktop and 390px mobile:

- Home, `/search?q=huevos`, `/search?q=arroz`, `/search?q=aceite`.
- `/search?q=leche&priceMode=benefits` and detergent results for long titles/missing unit prices.
- Gloria six-pack exact product `df95f601-09b4-88a7-a48b-12d304075fee`, with multiple retailers and Tottus CMR, in ordinary and benefits modes.
- Filtered-empty eggs/litre results and the existing E2E missing-product query.

The first visual pass prompted a smaller mobile home headline and detail image, and better three-control toolbar distribution. Final visual review found a more composed first impression, clearer exact-versus-generic grouping, readable ordinary/unit/benefit prices and stronger source/comparison affordances. Complete long titles wrap without clipping; the audited unresolved detergent pack keeps its ordinary price without inventing a unit price. No horizontal overflow occurred on any reviewed desktop/390px page, or on benefits search at 375, 430 and 768px. Filter reset preserved the query and restored results; the multi-basis select updated the URL. Keyboard skip/link focus was visible, and reduced-motion emulation reported a zero-duration card transition. No major browsing regression was found. This was a Chromium review, not a physical-device or full screen-reader audit.

Validation on October 4, 2026 (Peru):

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`: pass.
- `pnpm test`: 511 unit tests pass (368 core, 34 database, 109 scraper).
- `pnpm test:integration`: 36 real PostgreSQL tests pass. The configured development URL was explicitly supplied to `TEST_DATABASE_URL` in the runner; the harness created/dropped only its isolated random schema. No test database fallback was added.
- `pnpm build`: fresh default Next.js 16.3.8 Turbopack production build passes. Local worker/server ports required approved execution outside the restricted sandbox; framework configuration is unchanged.
- `pnpm test:e2e`: all 14 Chromium tests pass with the existing persisted catalog explicitly enabled. One added smoke case checks mobile starter URLs and keyboard skip navigation. Initial exact-label lookup failures were resolved by explicit select names matching visible labels; checks were not weakened. Existing mobile price, unit-sort, retailer/benefits/back, CMR and production developer-route checks pass.

The E2E server logged “destination stream closed early” during navigations; the full suite passed. This cancellation noise remains a known limitation rather than a failed check. Screenshots are manual audit aids, with no snapshot-testing dependency.

The audit evaluates composition and scanability, not measured engagement or conversion. Existing remote image availability, observed-price freshness, anonymous location/channel context and bounded catalog/search coverage remain limitations.

## Scope and next milestone

No dependencies, migrations, data-model changes, new pricing/matching logic, retailer ingestion requests, accounts, analytics, caching, infrastructure, illustrations or animation libraries were added. No price-history UI was implemented. GET search, immediate filter navigation, discovery admission, freshness rules, exact identity and ordinary/conditional ranking stay in their existing packages.

Milestone 13 should first review ordinary history interval integrity and observation gaps, then design a compact exact-product history view with retailer, quote basis, change time and last verification. Historical CMR needs a separate storage decision: current offer rows cannot reconstruct past benefits. Do not combine ordinary and conditional prices into one unlabeled series. This is a recommendation only; Milestone 13 has not started.
