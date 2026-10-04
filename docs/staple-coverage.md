# Staple coverage and generic relevance — Milestone 9

## Baseline frozen before implementation

Read-only live audit on October 4, 2026 at 11:34:52 Peru; exact UTC instant is recorded in [baseline](staple-baseline.json). Clean starting commit: `1401f97`. The snapshot preserves the complete 536-row public-source catalog, category metadata, demand, history digest, canonical results and manually reviewed independent results. No retailer requests or writes were made by this baseline audit. Production discovery can run concurrently.

Relevance labels mean the packaged staple itself. Accessories, incidental ingredients/properties and mixed-family bundles are irrelevant. Same-family brands, shapes and quantities are relevant options, without implying exact equivalence. Precision@k uses exactly k returned offers; fewer than k gives null, never padded or divided by a smaller denominator. Metrics evaluate generic relevance order, not canonical cards or price sort. The report is independent of the classifier being evaluated.

| Query           | Exact groups | Generic results | Relevant / irrelevant | P@5  | P@10 | Unit prices | Retailers | Diagnosis                                                   |
| --------------- | -----------: | --------------: | --------------------- | ---- | ---- | ----------- | --------- | ----------------------------------------------------------- |
| huevos          |            3 |              30 | 27 / 3                | 1.00 | 1.00 | 27/30       | all three | Relevant coverage sufficient; accessory leakage later       |
| arroz           |            5 |              30 | 30 / 0                | 1.00 | 1.00 | 30/30       | all three | Sufficient; rice-flour/snack leakage beyond displayed bound |
| azúcar          |            0 |               9 | 0 / 9                 | 0.00 | —    | 7/9         | all three | Missing packaged sugar plus incidental sugar retrieval      |
| aceite          |            3 |              30 | 24 / 6                | 1.00 | 1.00 | 28/30       | all three | Sufficient oil; tuna leakage later                          |
| fideos          |            0 |               0 | 0 / 0                 | —    | —    | 0/0         | none      | Missing coverage                                            |
| harina          |            0 |               1 | 1 / 0                 | —    | —    | 1/1         | Plaza Vea | Clearly insufficient coverage                               |
| avena           |            0 |               0 | 0 / 0                 | —    | —    | 0/0         | none      | Missing coverage                                            |
| atún            |            0 |              15 | 13 / 2                | 1.00 | 1.00 | 13/15       | all three | Useful coverage; bundles and unsafe net/drained comparisons |
| detergente      |            0 |              29 | 26 / 3                | 1.00 | 1.00 | 24/29       | all three | Useful coverage; mixed softener bundles                     |
| papel higiénico |            0 |               0 | 0 / 0                 | —    | —    | 0/0         | none      | Missing coverage                                            |

Demand: huevos tottus 7, azucar 5, huevos 4, rice/oil brand searches 2 each, atún florida 2 and detergente bolivar 2. Counts are small and query variants are not added together. Sugar is the first new coverage priority. Eggs already have coverage; retain exact own-brand boundaries. Rice/oil/tuna/detergent do not justify additional crawling. Oats/pasta/flour/paper are bounded common-staple gaps despite absent recorded demand.

Before implementation, the public category trees of Plaza Vea and Metro returned HTTP 200. Existing persisted `category` is a source leaf ID (or Tottus merchant code), not a category path. No new source field or full taxonomy is needed. Validate narrow category responses before allowlisting ingestion. Mixed parent categories must not become family evidence.

## Derived family model and relevance

`packages/core/src/product-family.ts` owns ten small shopping-option families: eggs, rice, sugar, cooking_oil, pasta, flour, oats, canned_tuna, detergent and toilet_paper. Source categories and original titles remain unchanged. Families do not define exact identity and never enter matcher candidates, scores, thresholds or canonical persistence.

There is **no schema change or migration**. Family/origin/evidence is recomputed from each current listing snapshot during search and developer inspection. This avoids attaching mutable category classification to the exact normalization fingerprint. Repeated reads are deterministic; category changes take effect without re-normalizing unchanged title/content. Title/content changes still require the existing current-version/current-fingerprint normalization gate. `pnpm normalize:catalog -- --limit=1000` remains the repair path; no historical price is rewritten.

After obvious unsafe property/accessory/mixed-bundle exclusions, precedence is:

1. Validated retailer leaf category. IDs are isolated by retailer; the source code is returned as evidence.
2. Known incompatible source categories, such as beverages, egg accessories, rice snacks and cosmetic oils, prevent weak title fallback.
3. Conservative leading product noun, with negative descriptors. There is no other reliable normalized path field in existing storage, so no invented path inference or giant taxonomy is added.

Broad Plaza Vea flour/baking and both mixed oats/cereal categories require a product noun. Metro flour is a validated narrow leaf. Observed pasta leaf evidence admits shapes such as Linguine without requiring the literal word fideos. Same-family variants remain visible and do not become equivalent products.

Negative evidence includes sin/zero/cero azúcar properties; egg organizers/cutters/cookers and chocolate eggs; prepared/cooked/chaufa rice; cosmetic/motor oil; tuna in oil as canned_tuna rather than oil; dental paste; oat drinks; and plus-separated mixed bundles. Known incompatible source categories override a weak noun. Plus-separated same-family bundles are also conservatively withheld; this loses some recall intentionally. Oat grain blends beginning with Avena are admitted with their descriptors; cereal copos merely containing oats and leading Quinua Avena blends remain outside the conservative fallback.

Query interpretation only recognizes a leading supported product noun. It supports huevo/huevos, fideo/fideos/pasta, aceite/aceites and accent variants of azúcar, atún and papel higiénico. Folding is restricted to recognizing the family phrase; remaining brand, size and variant tokens retain the existing spelling/prefix and exact-number semantics. `arroz costeño 5kg` still requires costeño, 5 and kg. `aceite primor 1l` still requires primor, 1 and l. Missing specific products remain empty. Ambiguous non-staple intents such as pasta dental, aceite corporal and arroz con pollo retain lexical search, as do arbitrary non-family queries.

For confident family queries, PostgreSQL requires every remaining token across the complete eligible candidate set (guard 1000). Core filters incompatible/unknown families before the thirty-offer limit or price sorting. Structured family evidence precedes title fallback; SQL exact-title/prefix/trigram ordering remains stable within each tier. Similarity cannot revive a family mismatch. Unknown queries retain the original token/trigram behavior. All three sort modes still operate over admitted products; unit dimensions and direct-KG separation are unchanged.

Combined search also excludes incidental canonical groups from a recognized family query using conservative member-title evidence. This prevents an exact group of sugar-free drinks or oat flour from falsely satisfying staple demand. Direct canonical query/detail APIs and associations remain unchanged. This title gate can conservatively hide valid groups whose names omit the product noun; independent offers can still use structured leaf evidence.

## Permanent coverage and limits

The allowlist uses complete paths from each public category tree, verified against a product response. Leaf-only `C:/<leaf>/` requests returned empty pages and were not ingested. Full narrow paths returned HTTP 200/206. Existing dairy scopes are retained. Each new retailer/category pair has **20 usable listings maximum, two sequential pages maximum, 40 source products maximum**, 30-second request timeout, one-second pauses and no retries. Short terminal pages sometimes report `0-19/11`; the parser now validates actual rows against the smaller terminal total rather than rejecting the observed range convention.

| Retailer  | Category     | Complete VTEX path      | Source rows fetched | Listings added |
| --------- | ------------ | ----------------------- | ------------------: | -------------: |
| Plaza Vea | Brown sugar  | 431/434/444             |                  11 |              8 |
| Plaza Vea | White sugar  | 431/434/1625            |                   7 |              3 |
| Plaza Vea | Long pasta   | 431/436/454             |                  20 |             20 |
| Plaza Vea | Flour/baking | 493/346/349             |                  20 |             20 |
| Plaza Vea | Oats         | 478/479/1639            |                  20 |             20 |
| Plaza Vea | Toilet paper | 399/1627/402            |                  20 |             20 |
| Metro     | Brown sugar  | 1001253/1001258/1001259 |                  19 |             19 |
| Metro     | White sugar  | 1001253/1001258/1001260 |                   9 |              9 |
| Metro     | Long pasta   | 1700/1711/1000743       |                  20 |             20 |
| Metro     | Flour        | 1700/1000694/1000766    |                  20 |             20 |
| Metro     | Oats         | 1001253/1001262/1001265 |                  20 |             20 |
| Metro     | Toilet paper | 1900/1001195/1001196    |                  20 |             20 |

**199 actual new listings:** Plaza Vea 91, Metro 108, Tottus 0. All twelve live ingestion runs succeeded. Plaza Vea sugar rows without available seller-1 quotes were skipped; no availability or zero price was invented. A few broad flour rows are baking ingredients, retained as source data but excluded from family search. No rice/oil/tuna/detergent categories were added because the baseline already had useful options. Eggs retain sufficient existing coverage. Tottus retains meats/dairy only; no unvalidated category URL was guessed. Initial research made two category-tree requests, twelve empty leaf-path checks and twelve full-path sample requests, separately from these twelve one-page ingestion calls.

Scheduled refresh now fetches Tottus 50 meat + 100 dairy and Plaza Vea/Metro 100 dairy + up to 120 staples each: **590 usable observations maximum per cycle**, deduplicated within retailer. Fetch all categories before one atomic retailer write; a failed category prevents that retailer batch, while other retailers/targeted work retain existing isolation. The flow stays category ingestion → targeted known listings (100 cap) → one normalization → one matching. The existing cron, concurrency, credentials and request timeouts are unchanged. The workflow timeout rises from 60 to 120 minutes to accommodate existing maximum category pages plus new sources and targeted worst-case request duration. This changes no schedule or infrastructure.

## Unit-price semantics and observed ambiguities

Mass staples use S/kg, oils S/L; detergent mass and liquid remain separate blocks. Unknown multipacks (Twopack/Duopack), conflicting quantity syntax and unsupported count words remain withheld rather than repaired. A captured Metro title says **Harina de Arroz Costeño 1 g**. Its raw/display quantity is retained, but mass staple quantities below 10 g are withheld from generic unit pricing when family evidence is present. The implausible 1 g cannot win a S/kg value ranking. No exact normalization or canonical identity is changed.

Tuna's current source contract cannot reliably distinguish net and drained weight. Generic mass unit prices for tuna are withheld, including multipacks with declared grams; display quantities remain. Two packs with trustworthy can counts can still expose S/unit, without comparing can size equivalence. Net/drained support requires independently verified source fields, not a title guess.

Toilet paper unit prices use reliable contained counts only. A roll is not equivalent across length, sheet count or ply; the UI explicitly calls price/roll indicative and preserves title/package variants. One captured `4 unid` form remains ambiguous. Sugar `Bolsa1 kg` and oats Duopack also remain conservative unknowns. Optional source specifications can themselves conflict (a pasta specification says 80g while its title says 950g); those unverified specification hints are not promoted to exact quantity inputs.

## Reviewed after-audit and metrics

The [after snapshot](staple-after.json) repeats the same ten-query audit on October 4, 2026 after bounded ingestion, scheduled refresh and the canonical family presentation gate. All 273 displayed generic titles were manually reviewed, including at least ten sugar, rice and oil options and the pasta/flour/oats/paper samples. Labels are independent of production classification; a source quantity typo is a relevance-positive staple with a separate unit-price limitation. Results are bounded to thirty offers; counts do not assert complete family recall.

| Query           | Exact groups before→after | Offers before→after | P@5 before→after | P@10 before→after | Retailers before→after | Unit-price offers before→after |
| --------------- | ------------------------- | ------------------- | ---------------- | ----------------- | ---------------------- | ------------------------------ |
| huevos          | 3→3                       | 30→29               | 1.00→1.00        | 1.00→1.00         | M, T, PV→M, T, PV      | 27/30→29/29                    |
| arroz           | 5→5                       | 30→30               | 1.00→1.00        | 1.00→1.00         | M, T, PV→M, T, PV      | 30/30→30/30                    |
| azúcar          | 0→3                       | 9→30                | 0.00→1.00        | —→1.00            | M, T, PV→M, PV         | 7/9→29/30                      |
| aceite          | 3→3                       | 30→27               | 1.00→1.00        | 1.00→1.00         | T, PV, M→T, PV, M      | 28/30→25/27                    |
| fideos          | 0→0                       | 0→30                | —→1.00           | —→1.00            | none→PV, M             | 0/0→25/30                      |
| harina          | 0→5                       | 1→30                | —→1.00           | —→1.00            | PV→M, PV               | 1/1→29/30                      |
| avena           | 0→4                       | 0→30                | —→1.00           | —→1.00            | none→PV, M             | 0/0→29/30                      |
| atún            | 0→0                       | 15→13               | 1.00→1.00        | 1.00→1.00         | T, PV, M→T, PV, M      | 13/15→2/13                     |
| detergente      | 0→0                       | 29→24               | 1.00→1.00        | 1.00→1.00         | T, M, PV→T, M, PV      | 24/29→23/24                    |
| papel higiénico | 0→3                       | 0→30                | —→1.00           | —→1.00            | none→M, PV             | 0/0→29/30                      |

M = Metro, T = Tottus, PV = Plaza Vea. Missing precision denominators are not zero scores. Top-ten precision for initially useful families was already 1.00; the improvement there is removing irrelevant results later and recognizing singular/category-only nouns. Sugar improves from 0.00 P@5 to 1.00; its original nine results do not permit P@10. All newly covered empty searches now have P@5/P@10 1.00. These small manually reviewed samples do not establish all-query precision, full recall or value equivalence.

Representative retained results (ordinary observed prices, not guarantees):

- Sugar: Metro rubia 1 kg S/3.80; Metro rubia 5 kg S/15.50; Máxima rubia 1 kg S/3.50; Bell’s blanca 2 kg S/9.00. No sin azúcar drinks are admitted.
- Rice: Costeño extra 3 kg S/15.90; Costeño extra 5 kg S/22.70; Costeño extra 750 g S/4.50; Costeño superior 5 kg S/20.90.
- Oil: Oleico 710 ml S/27.90; Bell’s vegetal 3 L S/18.50; Primor vegetal 5 L S/62.50; Tottus vegetal 3 L S/19.90. Tuna is absent from this option set.
- Pasta: Nicolini spaghetti 1 kg S/3.90; Don Vittorio spaghetti 500 g S/3.40. Flour: Favorita 1 kg S/4.50. Oats: Quaker 900 g appears at S/11.20 PV / S/13.50 Metro. New pasta/other-shape exact matching remains conservative: fideos has independent options but no exact canonical groups for the literal query.
- Tuna/detergent already had useful data; no additional crawl. Tuna now has 13 options, two count-based unit prices and zero mass comparisons. Detergent has 24 options with 23 calculable unit prices across separate mass/volume dimensions. Paper now has 30 displayed relevant options, 29 calculable contained-count prices.

## Persistence, refresh and discovery validation

[Measured source/run/derivation evidence](staple-validation.json) records all 199 source observations. Stored title, price and source category agreed for all 199; declared quantities were reviewed from their titles and package text without trusting unverified specification hints. Before scheduled refresh, all 562 pre-existing history states retained their original digest (`67d84270b55e58dfa3c4b9ab6af89a41`). Ingestion added exactly 199 initial states. One derivation pass changed 199 normalizations and created 16 products/32 links; its immediate repeat changed neither. Both derivation snapshots retained all 761 price states and digest `783ca566a1eed1d1167b25e9c034a144`.

Full scheduled refresh succeeded in 71.974 seconds: Tottus fetched/persisted/changed 243/150/0, Plaza Vea 198/191/0, Metro 208/208/1. No catalog additions occurred; normalization and matching wrote zero. Targeted selection required zero calls because eligible observations were recent. Metro's legitimate price transition was Leche Deslactosada Danlac Light 900 ml SKU 39254015, S/9.00→S/7.50; the final history therefore has 762 states and 735 open states, not an identical ingestion-repeat digest. Price-history changes caused by real new quotes are expected.

A separate explicit Metro SKU 427 targeted refresh passed: one observed request, zero price states, zero normalization/matching writes. The complete-catalog guard remains 1000; 735 known rows leave limited headroom. Category-covered new staple groups continue refreshing permanently. Keep monitoring the 100-targeted-request budget as trusted public offers grow; no automatic budget expansion is included.

Relevant family results suppress zero-result discovery. Missing complete brand/size queries still record the actual query. Incidental canonical groups also cannot hide genuinely missing staple demand. Discovery processing/cooldowns/budgets and exact matching remain unchanged; no public request performs retailer access.

## Tests, files and completion gate

Added 51 deterministic unit cases: 43 reviewed classification/query/evidence/fallback cases, two unit-price safeguards, four category path/range/page/limit cases, and two scheduled category/isolation cases. PostgreSQL adds five scenarios for family relevance, specificity, source-category recomputation, freshness/sort dimensions, generic discovery and incidental canonical coverage with unchanged exact routes. Tests never contact retailers. The isolated PostgreSQL runner was explicitly given the configured Neon connection as TEST_DATABASE_URL for this run; the harness never loads credentials or falls back to DATABASE_URL, and its writes stay within a random temporary schema.

Validation: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, **481 unit tests**, and **33 PostgreSQL integration tests** pass. Playwright discovers eleven Chromium tests, including the new persisted sugar/oil regression and retained eggs/exact routes. **Build failed** on the known Turbopack CSS-worker port bind (`Operation not permitted`); **E2E could not start** its production server. Browser rendering remains unverified. No Next.js configuration workaround is included. The user independently committed image-loading changes during this work (`c7db122`, `ab90080`). These are preserved; the milestone adds no Next.js configuration workaround. The initial audit was frozen at `1401f97`, and the final milestone diff is based on the current `ab90080` HEAD.

Important files: core product-family logic/reviewed fixture and unit prices; db generic/combined search, audit CLI and catalog inspection; scraper allowlist/adapters/category tests and refresh wiring; web catalog inspection, explanatory paper/tuna notes and E2E case; scheduled workflow timeout; this report and before/after evidence. **No dependencies, migrations, new retailer or infrastructure were added.**

Commands:

```sh
pnpm audit:staples             # read-only; root DATABASE_URL; no source calls
pnpm scrape:plaza-vea -- --category=sugar-brown --limit=20
pnpm scrape:metro -- --category=oats --limit=20
# Add --dry-run to inspect without persistence.
pnpm refresh:catalog          # permanent allowlisted scopes + one derivation pass
pnpm normalize:catalog -- --limit=1000
```

Milestone 8 is complete in the user-provided baseline `1401f97`; its old pending notes are historical. Milestone 9 implementation/data checks are finished but **Milestone 9 is not complete** until fresh local `pnpm build` and `pnpm test:e2e` confirmation. Changes are staged, uncommitted and unpushed under the task's explicit gate. After confirmation, the requested commit is `feat: improve staple search relevance and coverage`.

Remaining relevance gaps: conservative noun recognition hides some leading grain blends and name-only canonical groups; arbitrary queries retain lexical limitations; unsupported accent variants of brand names and typos are unchanged. Family-level unit comparison does not establish equivalent quality/ingredients. Remaining coverage gaps: new staples cover only PV/Metro, bounded long-pasta pages omit some shapes, and the allowlist is not a complete catalog. Net/drained weight, unknown multipacks and unreliable source quantities remain withheld. Recommend a subsequent milestone reviewing quantity/source ambiguities and family recall against accumulated demand, with catalog/targeted-budget headroom measured first. No next milestone is begun.

## Milestone 10 follow-up

Current comparison policy and audited quantities are in [quantity quality](quantity-quality.md); current operating counts, request budgets and headroom are in [catalog budget](catalog-budget.md). Comparison bases now separate approximate rolls from physical item counts, and all semantically unresolved tuna unit prices are withheld. Persisted normalization version 1, canonical matcher rules and existing source/refresh limits remain unchanged. Earlier milestone validation notes are historical; Milestones 0–9 are complete in the user-provided baseline `d8858b3`.
