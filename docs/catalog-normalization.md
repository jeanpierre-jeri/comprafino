# Catalog normalization

## Pre-implementation analysis — October 3, 2026

The repository started clean at `20acec9`; generated Next.js files needed no cleanup. Read all retailer documentation, core listing boundary and PostgreSQL schema before implementation. Read the 150 persisted listings (50 per retailer), a bounded sample of the small current database, plus existing sanitized fixtures. Three additional public requests inspected five source examples each; no re-ingestion or price writes occurred during analysis.

- Tottus's meat sample includes `x 500 g`, exact `Empaque 1 kg`, accent/case variations, and many `Aprox` packages. KG quotes are variable-weight sales; approximate 2.3 kg chicken packaging is not an exact purchasable mass. Some unbranded-looking titles actually have structured source brand `TOTTUS`.
- Plaza Vea dairy/eggs includes `390g Paquete 6un`, `946ml Paquete 3un`, `Bandeja 30un`, `Galonera 1.6Kg`, Bell's and La Calera. Raw presentation reliably describes the selected offering in inspected examples. However, `Contenido Neto` says 1.029 L for a 946ml SKU and `Unidades Por Paquete` says 4 for its three-pack. These unreliable specifications must not become trusted quantity/count hints.
- Metro dairy includes Sixpack, Tripack, Fourpack, Pack x6, standalone mass/volume, accented Bonlé/Kéfir/Lúcuma and Cuisine & Co. Descriptions such as `Formato: Líquido` contain no quantity. `Queso Fresco Light Cuisine & Co x kg` has raw `unitMultiplier: 0.1 kg`; that is not 100 g of fixed package content. `Queso Edam Laive + Jamón Americano Suiza 300g` is a mixed bundle with uncertain allocation.
- All three public sources expose a structured `brand` string. Earlier ingestion dropped it, so existing rows cannot recover that value without future fresh ingestion. Preserve it going forward; use a small observed-brand vocabulary for conservative legacy fallback. Never infer an arbitrary first word as a brand.
- All sampled VTEX unit-priced offers have multiplier 1: this means one sale unit, not necessarily one can/egg. Weighted fixtures have multipliers 1.9/2.2, which must not become package counts.
- Persisted coverage is bounded meat/dairy/eggs, not a full catalog. Brand-at-start and some conversion aliases will need explicitly synthetic tests; do not label them observed persisted examples.

## Model and boundaries

`packages/core/src/catalog.ts` owns the pure validated normalizer. `CatalogAttributes` contains version, normalized full title, display brand, brand key/origin, per-item quantity, package count, total quantity, pricing basis, sold-by-weight flag, original package description and diagnostic issues. Unknown attributes are null. No category taxonomy, canonical products, match candidates, similarities, embeddings, search or price recommendations are added.

Titles use NFKC, lowercase, collapsed whitespace, straight apostrophes and normalized dash/separator punctuation. Accents, model numbers, quantities and decimal points remain. There is no extra comparison title yet. Repeated calls with identical inputs produce identical attributes; title normalization is itself idempotent.

## Source precedence and brands

1. Validated structured brand wins. Each retailer adapter now preserves its source `brand` as `sourceBrand`; normalization never replaces raw retailer metadata. Known display spellings are cosmetic aliases, not fuzzy brand matching. Unknown structured brands receive conservative whitespace/case formatting, preserving punctuation and accents.
2. Legacy listings use exact Unicode word-boundary recognition from the small observed-brand vocabulary. An arbitrary leading word is never a brand; multiple recognized brands return null. Store-brand metadata works independently of title position. Brand origin (`source`/`title`) remains inspectable.
3. Pricing basis comes exclusively from validated source KG/UN, never inferred from a title.
4. For unit-priced offerings, trustworthy package descriptions supply quantities/counts before title fallback. Source/title disagreements retain the preferred source result and explicit conflict diagnostics. Label keys such as `Pack-Unitario:` are ignored during parsing; their raw text is preserved.
5. The pure API accepts optional verified per-item quantity/count hints ahead of text. Current adapters supply neither because no independently trustworthy numeric package specifications were established. Database processing deliberately accepts only currently persisted inputs. VTEX `Contenido Neto` and `Unidades Por Paquete` remain excluded.

All 150 audited legacy rows lack newly preserved structured brands/multipliers. Their brands therefore came from title fallback, not a retroactive source fetch. Future ordinary ingestion will capture structured brands, including Tottus products whose titles omit the store brand. No ingestion was run just to improve audit metrics.

## Units and arithmetic

Explicit input units: g, kg, ml, l, unit. Supported aliases include GR/gr/grs/gramo(s), KG/kilo(s)/kilogramo(s), ML/mililitro(s), L/lt/lts/litro(s), UN/und/uds/unidad/unidades. Output uses integer g, ml or unit. 1 kg becomes 1000 g; 1.5 L becomes 1500 ml. Decimal strings are converted with BigInt arithmetic, including supported comma-decimal syntax, without floating-point multiplication. Nonpositive, nonintegral base quantities and values/totals exceeding PostgreSQL integer range stay unknown. Unsupported units are not guessed. Count, mass and volume remain separate dimensions.

## Packages, weight and ambiguity

- `x 500 g` is package mass, never 500 packages. `6 x 390 g`, `390g x 6`, `pack x6`, `Paquete 6un`, `Pack 3 Cajas`, Tripack/Fourpack/Sixpack are recognized conservatively. Bare/contradictory pack descriptions retain an unknown package count.
- A simple measurable offering with no multipack signal defaults to one package; `Paquete 180g` is one 180 g package. Missing content and missing package context do not invent a count.
- Count-only `6un`/`30un` describes contained physical units: eggs in a 30-unit tray have quantity 30 unit, package count 1, total 30 unit. Explicit packs without per-item content (`Pack x6 Leche ...`) retain count 6 and unknown quantity/total.
- Exact quantity times known package count produces total quantity: six 390 g cans total 2340 g; three 946 ml cartons total 2838 ml. A count-only multipack with unclear per-item allocation stays unresolved.
- UN means a price for one sale offering, which can contain measurable mass/volume. KG means per-kilogram pricing and `soldByWeight=true`; exact package quantity/count/total remain null even if text or a multiplier mentions weight.
- Approximate package mass (`Aprox`) is preserved as text, not an exact comparable quantity. Even a 500 g title cannot override an approximate source description. This intentionally lowers coverage for meat.
- VTEX `unitMultiplier` is preserved separately as source metadata; multiplier 1 is not a pack count, and weighted 1.9/2.2 multipliers do not prove fixed package mass. Existing legacy weighted multiplier text remains available without inventing structured backfills.
- Multiple competing quantities/counts, mixed bundles (`Laive + Jamón ... Suiza`), missing mass and uncertain packaging retain nulls and diagnostics where applicable. The parser does not attempt a retailer-specific regex for every naming oddity.

## Persistence and processing

Reviewed generated migration `0001_slow_marvel_zombies.sql` adds nullable `source_brand`/`source_unit_multiplier` to `retailer_listings`, and a one-to-one `listing_normalizations` table. It was applied successfully to configured Neon during this milestone. Raw listing titles, packages, prices and price history are untouched by normalization.

Derived values use explicit columns, with a composite index on brand key, unit, quantity and package count for future matching queries. SQL checks enforce paired quantity/unit, positive counts, consistent totals, brand origin and weight/pricing separation. A listing foreign key cascades derived-row deletion. JSON is only a parameterized batch transport, not opaque persisted attributes.

Version 1, a SHA-256 input fingerprint and `normalized_at` make reprocessing/staleness inspectable. Fingerprints include only title, package, price basis, source brand and multiplier, not price or observation time. Future rule changes should increment the version. Upserts also compare derived columns, allowing corrections to an unpublished version's audited output. Unchanged repeats perform no updates and preserve timestamps.

A bounded batch locks retailer identities in stable order using ingestion's existing lock convention, verifies each listing's raw inputs still match the read snapshot, then upserts eligible derived rows atomically. Changed/unchanged/stale counts are distinct. A stale read is skipped; rerun for current metadata. There are no per-listing writes. All writers must follow the shared locking convention. Changing raw inputs makes developer inspection mark derived values stale until reprocessed.

```sh
pnpm db:migrate
pnpm normalize:catalog -- --limit=100
pnpm normalize:catalog -- --retailer=tottus --limit=50
pnpm normalize:catalog -- --retailer=plaza-vea --limit=50
pnpm normalize:catalog -- --retailer=metro --limit=50
pnpm normalize:catalog -- --retailer=metro --limit=50 --dry-run
```

Root `.env`/`DATABASE_URL` is required even in dry-run: this command reads persisted listings, not retailer websites. Default limit 100, maximum 5000; stable retailer/external-ID ordering, with a global limit unless retailer-filtered. Repeats intentionally inspect the same bounded sample. Duplicate/unknown options and invalid bounds fail before database access. Dry-run performs no writes. Output includes actual coverage, persistence counts and five samples; driver details/credentials are never printed on failure.

`/dev/catalog` is a request-time Server Component, showing up to 20 listings per retailer, both titles, brand/origin, quantity, count, total, pricing basis, weight status, raw package description and issues/staleness/version. Missing configuration and connection errors produce safe guidance. It returns 404 in production and has no editing interface.

## Real-data audit

October 3, 2026: 50 existing persisted listings per retailer, 150 total. First pass created 150 derived rows. Reviewing 20 diverse results and five diagnostic rows found two systematic gaps: Paquete + mass was mistaken for an unknown pack, and metadata key Pack-Unitario was treated as a pack signal. Regression tests and generic parsing corrections fixed two Plaza Vea butter rows and three Metro unitary rows. Final repeated runs report zero changed, 50 unchanged and zero stale for each retailer; all 150 price-history rows remained identical before/after the correction/repeat audit.

| Retailer  | Processed | Brand | Mass/volume | Count quantity | Package count | Sold by weight | With issues | Unresolved |
| --------- | --------: | ----: | ----------: | -------------: | ------------: | -------------: | ----------: | ---------: |
| Tottus    |        50 |    33 |           9 |              0 |            16 |             34 |           7 |         19 |
| Plaza Vea |        50 |    50 |          45 |              5 |            50 |              0 |           0 |          0 |
| Metro     |        50 |    49 |          47 |              0 |            48 |              1 |           1 |          2 |
| Total     |       150 |   132 |         101 |              5 |           114 |             35 |           8 |         21 |

Coverage is presence of attributes, not accuracy or proof of equivalence. These categories overlap. Unresolved means missing brand, missing quantity/count for a unit-priced offering, or any diagnostic. Deliberately unknown package content for KG offerings alone does not count as unresolved. Tottus missing brands and approximate UN masses dominate; do not inflate coverage by inferring that every unbranded meat is Tottus. Metro's unknown-mass six-pack and mixed bundle remain unresolved.

### Manual review

Twenty diverse inspected results follow; five additional diagnostic rows were examined to verify the systematic corrections described above. The review checked package count versus mass, KG versus fixed content, brand origin, decimal conversion, liters versus counts and multipack totals. Price/ListPrice are absent from normalization inputs. No dangerous false positive was found in the reviewed final results; this is a bounded manual review, not full-catalog accuracy validation.

| Retailer / raw title                                                     | Brand        | Quantity | Packages | Total   | Basis | Note                 |
| ------------------------------------------------------------------------ | ------------ | -------- | -------: | ------- | ----- | -------------------- |
| tottus: Filete De Tilapia Sin Piel Tottus                                | Tottus       | 1000 g   |        1 | 1000 g  | unit  | —                    |
| tottus: Porciones De Salmón Tottus Premium 500 g                         | Tottus       | 500 g    |        1 | 500 g   | unit  | —                    |
| tottus: Sangrecita Sin Condimento Redondos                               | Redondos     | —        |        1 | —       | unit  | approximate-quantity |
| tottus: Carne Molida De Res x 500 g                                      | —            | —        |        1 | —       | unit  | approximate-quantity |
| tottus: Pollo Fresco Con Menudencia Tottus                               | Tottus       | —        |        — | —       | kg    | Variable weight      |
| tottus: Pollo Entero Trozado Redondos x Kg                               | Redondos     | —        |        — | —       | kg    | Variable weight      |
| tottus: Carne Molida Pavita San Fernando x 500 g                         | San Fernando | 500 g    |        1 | 500 g   | unit  | —                    |
| plaza-vea: Yogurt Parcialmente Descremado GLORIA Vainilla Galonera 1.6Kg | Gloria       | 1600 g   |        1 | 1600 g  | unit  | —                    |
| plaza-vea: Huevos Pardos BELL'S Bandeja 30un                             | Bell's       | 30 unit  |        1 | 30 unit | unit  | —                    |
| plaza-vea: Leche Reconstituida Entera GLORIA Lata 390g Paquete 6un       | Gloria       | 390 g    |        6 | 2340 g  | unit  | —                    |
| plaza-vea: Leche UHT GLORIA Zero Lacto Caja 946ml                        | Gloria       | 946 ml   |        1 | 946 ml  | unit  | —                    |
| plaza-vea: Leche UHT GLORIA Zero Lacto Caja 946ml Paquete 3un            | Gloria       | 946 ml   |        3 | 2838 ml | unit  | —                    |
| plaza-vea: Huevos Pardos LA CALERA Paquete 30un                          | La Calera    | 30 unit  |        1 | 30 unit | unit  | —                    |
| metro: Queso Fresco Light Cuisine & Co x kg                              | Cuisine & Co | —        |        — | —       | kg    | Variable weight      |
| metro: Queso Edam Laive + Jamón Americano Suiza 300g                     | —            | —        |        — | —       | unit  | mixed-bundle         |
| metro: Sixpack Leche Reconstituida Gloria Lata 390g                      | Gloria       | 390 g    |        6 | 2340 g  | unit  | —                    |
| metro: Pack x6 Leche Evaporada Gloria Entera                             | Gloria       | —        |        6 | —       | unit  | —                    |
| metro: Yogurt Bebible Gloria Lúcuma Galonera 1.6kg                       | Gloria       | 1600 g   |        1 | 1600 g  | unit  | —                    |
| metro: Tripack Leche UHT Sin Lactosa Gloria Zero Lacto Caja 946ml        | Gloria       | 946 ml   |        3 | 2838 ml | unit  | —                    |
| metro: Fourpack Leche Semidescremada UHT Laive Sin Lactosa Caja 946ml    | Laive        | 946 ml   |        4 | 3784 ml | unit  | —                    |

### Remaining uncertainty and limitations

`Carne Molida De Res x 500 g` has source `Empaque 500 g Aprox`: exact quantity/total stay null and brand is unavailable in the legacy row. `Filete De Pechuga Importada` is KG and has no title brand even though the fresh public source exposes TOTTUS; no brand was backfilled by assumption. `Pack x6 Leche Evaporada Gloria Entera` knows six packages but no per-item mass. `Queso Edam Laive + Jamón Americano Suiza 300g` has unknown brand/content allocation. Unknown brands, sub-base precision, complex bundles and unsupported packaging remain limitations. The finite title-brand vocabulary can miss brands and cannot guarantee brand-role interpretation in arbitrary future categories. Preserve source brand/origin and review new category coverage before matching.

No exact quantity is assigned to KG listings, even if a source estimate seems plausible. Unit-priced approximate-weight meat also cannot yet support exact price-per-mass comparison. Ambiguous count-only packs require better per-item semantics. Normalization is independently rerunnable but has no scheduling, unbounded full-catalog mode or automatic ingestion hook.

## Tests and validation

69 table-driven core normalization tests cover real three-retailer examples plus explicitly synthetic aliases/syntax, exact decimal conversion, totals, multipacks, count-only eggs, KG/UN separation, approximate/missing/ambiguous values, Unicode, brands, source precedence, overflow and determinism. Three database unit tests cover options, fingerprints and batch safeguards; three adapter regression tests verify structured brands/multipliers cross the boundary. Total repository unit tests: 152.

The PostgreSQL suite now applies every journaled migration to its fresh random schema. Four new tests supplement the three ingestion tests: normalization idempotency and metadata recomputation without price-history changes; stale reads/concurrent writers/version recomputation; atomic derived-batch rollback; SQL quantity/count/total/brand/pricing checks. All seven passed using an explicitly injected one-off TEST_DATABASE_URL for the configured connection, with schema isolation and teardown. The suite still never loads `.env` or falls back to DATABASE_URL. No dependencies or infrastructure were added.

Formatting, lint, TypeScript and unit checks are run before staging. The normal `pnpm build` and elevated retry both hit the agent's existing Turbopack CSS-worker port-binding restriction (`Operation not permitted`); build architecture is unchanged. `pnpm test:e2e` could not start because the failed build left no production artifact. The added `/dev/catalog` production-404 smoke test therefore requires local validation along with the two existing smoke tests. Changes remain staged, uncommitted, until the developer confirms a fresh local default build and Chromium E2E. Milestone 2 implementation and data audit are ready; its definition of done remains pending these checks.

## Ingestion and Milestone 3 recommendation

Keep normalization as a separate bounded job for now: it can process recent ingestion after ingestion succeeds, fail/retry independently and reprocess rule versions without modifying raw source or prices. Once routine runs are proven, the existing manual ingestion workflow can invoke the standalone command explicitly; no queue/worker is needed. This milestone adds no automatic coupling.

Milestone 3 should start by re-ingesting representative listings to capture structured brands, validating stale/version status and inspecting unresolved bundles/approximate weights. Use brand, physical dimension, exact quantity, package count and product variants as deterministic evidence; equal attributes alone do not prove product equivalence. Unresolved records need explicit uncertainty. Develop reviewed matching rules and meaningful tests as a separate milestone. No cross-retailer links, matching UI or public search have been created here.

## Milestone 3 follow-up

The pending commit/build notes above record the historical Milestone 2 agent run; normalization is complete in the current committed baseline `3abd9f9`. Milestone 3 refreshed the existing three bounded ingestion samples to capture source brands, reran normalization and confirmed zero-write repeats. There are now 151 listings, all with identified brands, 102 mass/volume quantities, five count quantities, 115 package counts, 35 weighted listings, eight diagnostic rows and nine unresolved rows. The new Tottus listing came from ordinary bounded source ordering, without category expansion. See [catalog matching](catalog-matching.md) for current coverage, canonical identity, evaluation and pending Milestone 3 validation.

## Milestone 10 follow-up

Current comparison policy and audited quantities are in [quantity quality](quantity-quality.md); current operating counts, request budgets and headroom are in [catalog budget](catalog-budget.md). Comparison bases now separate approximate rolls from physical item counts, and all semantically unresolved tuna unit prices are withheld. Persisted normalization version 1, canonical matcher rules and existing source/refresh limits remain unchanged. Earlier milestone validation notes are historical; Milestones 0–9 are complete in the user-provided baseline `d8858b3`.
