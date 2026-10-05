# Staple coverage and generic relevance

Current domain guidance. Dated audits, measurements and acceptance narratives are preserved in [engineering history](history/engineering-notes-2026-10-05.md).

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

Scheduled retailer totals derive from `refreshCoverage`. Metro also includes the validated narrow eggs scope; use `pnpm catalog:budget` for configured observation and page caps. Fetch all categories before one atomic retailer write; a failed category prevents that retailer batch while other retailers/targeted work retain failure isolation. The flow remains category ingestion → targeted known listings → one normalization → one matching.

## Unit-price semantics and observed ambiguities

Mass staples use S/kg, oils S/L; detergent mass and liquid remain separate blocks. Unknown multipacks (Twopack/Duopack), conflicting quantity syntax and unsupported count words remain withheld rather than repaired. A captured Metro title says **Harina de Arroz Costeño 1 g**. Its raw/display quantity is retained, but mass staple quantities below 10 g are withheld from generic unit pricing when family evidence is present. The implausible 1 g cannot win a S/kg value ranking. No exact normalization or canonical identity is changed.

Tuna's current source contract cannot reliably distinguish net and drained weight. Generic mass unit prices for tuna are withheld, including multipacks with declared grams; display quantities remain. Two packs with trustworthy can counts can still expose S/unit, without comparing can size equivalence. Net/drained support requires independently verified source fields, not a title guess.

Toilet paper unit prices use reliable contained counts only. A roll is not equivalent across length, sheet count or ply; the UI explicitly calls price/roll indicative and preserves title/package variants. One captured `4 unid` form remains ambiguous. Sugar `Bolsa1 kg` and oats Duopack also remain conservative unknowns. Optional source specifications can themselves conflict (a pasta specification says 80g while its title says 950g); those unverified specification hints are not promoted to exact quantity inputs.
