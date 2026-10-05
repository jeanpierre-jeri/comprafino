# Catalog normalization

Current domain guidance. Dated audits, measurements and acceptance narratives are preserved in [engineering history](history/engineering-notes-2026-10-05.md).

## Model and boundaries

`packages/core/src/catalog.ts` owns the pure validated normalizer. `CatalogAttributes` contains version, normalized full title, display brand, brand key/origin, per-item quantity, package count, total quantity, pricing basis, sold-by-weight flag, original package description and diagnostic issues. Unknown attributes are null. Normalization does not create canonical products or matching decisions; matching and search have separate owners.

Titles use NFKC, lowercase, collapsed whitespace, straight apostrophes and normalized dash/separator punctuation. Accents, model numbers, quantities and decimal points remain. There is no extra comparison title yet. Repeated calls with identical inputs produce identical attributes; title normalization is itself idempotent.

## Source precedence and brands

1. Validated structured brand wins. Each retailer adapter now preserves its source `brand` as `sourceBrand`; normalization never replaces raw retailer metadata. Known display spellings are cosmetic aliases, not fuzzy brand matching. Unknown structured brands receive conservative whitespace/case formatting, preserving punctuation and accents.
2. Legacy listings use exact Unicode word-boundary recognition from the small observed-brand vocabulary. An arbitrary leading word is never a brand; multiple recognized brands return null. Store-brand metadata works independently of title position. Brand origin (`source`/`title`) remains inspectable.
3. Pricing basis comes exclusively from validated source KG/UN, never inferred from a title.
4. For unit-priced offerings, trustworthy package descriptions supply quantities/counts before title fallback. Source/title disagreements retain the preferred source result and explicit conflict diagnostics. Label keys such as `Pack-Unitario:` are ignored during parsing; their raw text is preserved.
5. The pure API accepts optional verified per-item quantity/count hints ahead of text. Current adapters supply neither because no independently trustworthy numeric package specifications were established. Database processing deliberately accepts only currently persisted inputs. VTEX `Contenido Neto` and `Unidades Por Paquete` remain excluded.

Legacy rows without structured brands use conservative title fallback. Fresh ingestion preserves source brands; normalization never retroactively fetches them.

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

Reviewed generated migration `0001_slow_marvel_zombies.sql` adds nullable `source_brand`/`source_unit_multiplier` to `retailer_listings`, and a one-to-one `listing_normalizations` table. Raw listing titles, packages, prices and price history are untouched by normalization.

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
