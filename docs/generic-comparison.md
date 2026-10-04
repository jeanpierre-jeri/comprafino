# Generic comparison — Milestone 8

Implementation and data validation are ready; local production build and Chromium E2E confirmation remain required. The default Turbopack build fails in this agent sandbox while binding the CSS worker port (`Operation not permitted`). No framework configuration was changed, commit made, push performed or next milestone started.

## Exact identity and generic options

`searchPublicProducts` combines the unchanged canonical search with independent normalized retailer offers. Exact groups appear first when present. Each retains the existing automatic/current-version/≥0.90 association and two-retailer safety rules. Product detail pages and deterministic matching remain unchanged.

Generic cards represent one source listing and one ordinary observed retailer offer, including single-retailer products. They retain complete variant titles, source brands, quantity/count, retailer, freshness timestamp and trusted product/image links. Generic comparison never creates associations, merges brands, or claims quality equivalence. A subtle comparison link appears only when the listing already belongs to an eligible exact public group. Separate source offers remain visible even when linked to the same product.

## Unit-price model

Core's `calculateUnitPrice` returns either an exact bigint numerator/denominator in PEN cents per display unit, with a dimension, or a fixed unavailable reason. Cross multiplication orders fractions without floating-point arithmetic. Display rounds half-up to two currency decimals using integer arithmetic.

| Dimension | Stored quantity | Display | Packaged UN calculation          |
| --------- | --------------- | ------- | -------------------------------- |
| Mass      | integer g       | kg      | cents × 1000 / total grams       |
| Volume    | integer ml      | L       | cents × 1000 / total millilitres |
| Count     | integer unit    | unidad  | cents / total contained units    |

500 g at S/ 3.90 gives S/ 7.80/kg. 1.5 L at S/ 12.00 gives S/ 8.00/L. Thirty eggs at S/ 17.90 give S/ 0.60/unidad for display, but sorting uses 1790/30 cents. Two rounded prices can tie visually without being equal mathematically.

KG source quotes are already cents per kg and use denominator one. Package descriptions, variable weight and approximate mass do not cause a second division. The public total-price view labels and separates these quotes from package totals; it never calls the quote the cost of an unspecified package. UN is the price of the whole sale offering, not necessarily one egg/can. A reliable count of one is necessary before interpreting an UN price as a contained-unit price.

Multipacks use normalized **total** content: 6 × 390 g = 2340 g and 3 × 946 ml = 2838 ml. Egg trays of 15/30 use per-item count quantity 15/30 and package count one. Explicit count multipacks without unambiguous per-item allocation remain unavailable; a separately validated total count can be calculated.

## Ambiguity and eligibility

Invalid money, nonpositive/noninteger quantities, absent total quantities, diagnostics, mixed bundles and unresolved pack wording never produce unit prices. Missing unit price does not exclude an otherwise usable listing. Unknown `*pack` words (observed `Twopack`) are withheld despite the legacy normalizer's count-one default; recognized Tripack/Fourpack/Sixpack and Doypack syntax retain existing behavior. This safeguard does not rewrite normalization or canonical identity. No source multiplier becomes a package count.

Generic public offers require an active normalized listing, current normalization version and matching raw-input SHA-256 fingerprint, valid nonblank title, trusted corresponding retailer HTTPS URL, open PEN price state with matching KG/UN basis, availability other than false and a successful observation at most 36 hours old and not in the future. Zod validates database values before presentation; quantities are recomputed from validated fingerprint-consistent inputs by the existing pure normalizer. No review/matching decision is required to present an independent offer.

Prices come from open history, not listing mirrors. Card/loyalty/quantity teasers remain excluded by existing ingestion. Freshness uses actual `last_seen_at`, never normalization, association or price-state creation timestamps. Generic stale/unavailable offers are excluded entirely. Exact pages keep Milestone 7 historical labels and exclude stale/unavailable prices from cheapest/Desde.

## Search, sorting and bounds

The database boundary joins normalized listings, retailers and current history, with optional existing eligible canonical metadata in one query. Token admission and PostgreSQL `pg_trgm` relevance ranking reuse exact search's Unicode/prefix/numeric semantics. All terms must occur; numeric tokens match whole words. No SQL resides in React components, and no per-offer queries run.

Relevance remains the default. Native GET controls use `sort=relevance`, `sort=total-price`, or `sort=unit-price`; invalid/repeated parameters fall back to relevance. Generic sorting does not alter canonical ranking. Total price orders package cents, then a separately labelled direct-KG block. Unit price orders **only within** kg, litre and contained-unit blocks, followed by unavailable calculations. Blocks are not a cross-dimension cheapest ranking.

Every admitted candidate is validated and sorted before a maximum of thirty cards is selected. A maximum 1000 candidates (matching the existing operational catalog bound) is enforced with a 1001-row sentinel; exceeding it produces an honest search error rather than silently claiming a cheapest result from a truncated sample. In unit mode, each present block first receives an equal bounded quota; spare capacity is filled in ordered sequence. This prevents a large mass block from hiding all liquid options. Ties retain deterministic SQL relevance order. Current measured 534-row catalog requires no new indexes, schema, migration or external search service. Future growth requires deliberate query/index/pagination review.

Discovery receives the **combined** result count. Generic-only success creates no zero-result demand. Invalid queries and database errors do not create demand; true empty successful searches retain the existing after-response upsert. Public requests never call retailers or run matching.

## Real-data audit

Read-only initial inspection found 534 listings. Before implementation, reviewed 29 real egg quantities, 34 rice-related listings, milk/oil content and ambiguous detergent/bundle examples. This justified independent offer cards and separated dimensions. No retailer requests, catalog expansion, price/history writes or canonical writes were needed.

The [audit snapshot](generic-comparison-audit.json) records the final actual UTC instant (October 3, 2026 in Peru), current eligible counts, reasons, source titles/brands/quantities/counts/bases/associations, exact fractions and real searches. It is a point-in-time observation, not a permanent inventory. Reproduce with `pnpm audit:unit-prices` using root `.env`/`DATABASE_URL`; it is read-only and accepts no options. No new environment variables are introduced.

Final coverage: **534 eligible offers, 499 with unit prices (93.45%), 35 without**. Reasons: 34 ambiguous and one missing quantity. Category substring counts overlap and can include related products; they are not a taxonomy. Egg titles include 29 actual food offers plus five accessories with no unit prices. All 29 food offers were reviewed; counts span 10, 12, 15, 18, 24, 30 and 90. Tray/contained-unit semantics are correct. Twenty mass staples and fifteen liquid milk/oil offers were inspected, with an independent bigint arithmetic cross-check and five direct-KG samples. Three/six/four-pack cases are preserved. Metro Twopack and mixed bundles are withheld.

| Real query    | Exact groups | Generic cards (≤30) | Dimensions in relevance cards | Cards with unit price |
| ------------- | -----------: | ------------------: | ----------------------------- | --------------------: |
| huevos        |            3 |                  30 | count                         |                    27 |
| arroz         |            5 |                  30 | mass                          |                    30 |
| azúcar        |            0 |                   9 | volume                        |                     7 |
| aceite        |            3 |                  30 | mass, volume, count           |                    28 |
| leche         |           15 |                  30 | mass, volume                  |                    30 |
| harina        |            0 |                   1 | mass                          |                     1 |
| detergente    |            0 |                  29 | mass, volume                  |                    24 |
| avena / pasta |            0 |                   0 | none                          |                     0 |

These are limited relevance card counts, not full matching counts; best-price modes independently evaluate all eligible candidates. `gloria 946` returns four existing exact groups at the final snapshot (production data continued updating during the read-only audit).

Examples of package versus unit differences:

- Broad `huevos`: Bell's quail eggs 18 at S/ 6.90 are a lowest package total (La Calera ties); Bell's quail eggs 24 at S/ 8.90 yield the lowest count quote, S/ 0.37/unidad. Quail, chicken, organic and free-range descriptions remain visible; the calculation does not assert their equivalence. For chicken eggs, Metro 15 at S/ 9.30 gives S/ 0.62/unidad, while Bell's/Tottus 30 at S/ 15.90 give S/ 0.53/unidad.
- Rice staples: Metro Costeño Superior 750 g at S/ 4.10 gives S/ 5.47/kg, while Tottus Extra 10 kg at S/ 38.00 gives S/ 3.80/kg. Broad `arroz` also admits rice-containing yogurt at S/ 3.00; the snapshot honestly identifies it as the lowest matching package, not the cheapest rice staple.
- Cooking oil: Bell's 900 ml at S/ 5.50 gives S/ 6.11/L. Broad `aceite` also admits tuna in oil; its lowest package S/ 4.90 is a mass result and cannot outrank oil in the litre block.
- Milk: Bella Holandesa 405 g at S/ 3.20 gives S/ 7.90/kg; Milkito 800 ml at S/ 4.20 gives S/ 5.25/L in its separate block. There is no cheapest across those dimensions.

## Validation and limitations

35 new core tests cover mass/volume/count, multipacks versus trays, packaged UN/direct KG, missing/ambiguous/invalid/zero quantities, stale/future observations, availability, rounding and precise sorting, incompatible dimensions and safe sort defaults. Seven new DB unit tests cover boundary validation, single-store identity, missing quantities, trusted provenance, exact metadata, sorting and block-preserving limits. Existing matching/pricing regressions remain intact.

Four new isolated PostgreSQL scenarios cover generic search, single retailers, open-history authority, sort-before-limit, eligibility/freshness, incompatible blocks/direct KG and combined discovery suppression/true empty demand. Existing canonical search test additionally verifies generic relationship metadata. All **430 unit tests** and **28 isolated PostgreSQL tests** pass; format, lint and strict types pass. Automated tests never contact retailer sites. The PostgreSQL harness explicitly receives TEST_DATABASE_URL, writes only in its random schema and tears it down.

One added opt-in persisted-catalog E2E flow checks eggs, URL sorting, exact calculated prices and single-retailer cards without comparison links. Existing exact search/detail and true-empty discovery UI tests remain. The current harness has no fixture lifecycle; controlled deterministic behavior is verified by PostgreSQL fixtures. Browser tests require the same explicitly configured persisted database as the web server. Credential-free smoke tests remain available.

`pnpm build` hits the known sandbox CSS-worker port restriction. `pnpm test:e2e` cannot start its production server after the failed build, so browser rendering is unverified. Per the milestone's explicit gate, changes are staged and await local build/E2E confirmation before `feat: add generic product and unit-price comparison` is committed. Milestone 8 is **not complete** until that gate passes. No dependencies, migrations, new retailers, promotions, infrastructure, classifier or AI were added.

Keyword matching is not category understanding. Accessories, rice snacks/yogurt, tuna in oil and “sin azúcar” drinks can match broad queries. The current catalog has **no actual packaged sugar, oats or pasta**, and only one rice flour; the azúcar results above are drinks/bundles, not sugar staples. Unit arithmetic does not establish product substitutability. Unknown multipack syntax is withheld instead of repaired speculatively. No synonym expansion, accent folding, category ontology, facets or pagination is provided. Native query spelling can exclude singular egg titles from plural huevos results. Source coverage, anonymous context/location, changing data and conservative exact matching remain existing limitations.

After local confirmation, the next milestone should address measured search relevance/category coverage before stronger generic recommendations: prioritize actual staple intent and negative descriptors without weakening exact identity, and review bounded sugar/oat/pasta acquisitions plus unresolved pack syntax. Do not begin it automatically.

## Milestone 9 follow-up

Milestone 8 is complete in the user-provided baseline `1401f97`; its original pending notes above are historical. Generic search now uses deterministic family evidence and bounded permanent staple coverage, preserving specific query tokens and existing sort/eligibility behavior. Incidental exact groups no longer count as family coverage. Tuna mass prices are withheld without verified net/drained semantics; an observed 1 g flour typo is also withheld while display quantity remains. See [staple coverage](staple-coverage.md) for the new before/after audit, tests, known quantity/recall limits and current Milestone 9 build/E2E gate.

## Milestone 10 follow-up

Current comparison policy and audited quantities are in [quantity quality](quantity-quality.md); current operating counts, request budgets and headroom are in [catalog budget](catalog-budget.md). Comparison bases now separate approximate rolls from physical item counts, and all semantically unresolved tuna unit prices are withheld. Persisted normalization version 1, canonical matcher rules and existing source/refresh limits remain unchanged. Earlier milestone validation notes are historical; Milestones 0–9 are complete in the user-provided baseline `d8858b3`.

## Milestone 11 follow-up

[Immediate URL controls](search-ux.md) replace native Apply sorting and add retailer, compatible basis and optional benefits. Filtering precedes the existing card bound; discovery depends on unfiltered eligible candidates. Concrete CMR prices remain separate from ordinary totals/history; only explicit benefits mode recalculates ranked unit prices using the conditional amount, with adjacent card labels. Existing basis/quality policy, relevance, matching and normalization remain unchanged. See [conditional pricing](conditional-pricing.md).
