# Scrapers

Native-fetch Tottus, Plaza Vea and Metro adapters share a retailer-independent contract, ingestion orchestration and database persistence. Source data → Zod source validation → normalized listing boundary → optional db persistence. Fixtures/tests require no network or database.

Root commands:

```sh
pnpm scrape:tottus -- --dry-run --limit=20
pnpm scrape:plaza-vea -- --dry-run --limit=20
pnpm scrape:plaza-vea -- --limit=50
pnpm scrape:metro -- --dry-run --limit=20
pnpm scrape:metro -- --limit=50
```

Default 20 normalized listings, hard cap 500, sequential bounded category requests. Dry-run needs no database; persisted mode requires `DATABASE_URL`. Pagination, seller and price selection remain retailer-specific. See [Tottus](../../docs/retailers/tottus.md), [Plaza Vea](../../docs/retailers/plaza-vea.md) and [Metro](../../docs/retailers/metro.md) for differing source-row counts and coverage limits.

For the bounded matching audit, `pnpm scrape:tottus -- --category=dairy --limit=100` selects the observed, allowlisted dairy source. Default Tottus meats and Plaza Vea/Metro dairy paths stay unchanged. No arbitrary URL/category ID option exists. Tottus rows with omitted price unit are excluded rather than assuming unit/per-KG pricing; unsupported explicit units still fail. The source-row discovered count includes skipped rows. Prices and history for valid listings are unchanged. See [independent audit](../../docs/catalog-matching-audit.md).

Milestone 9 adds permanent bounded Plaza Vea/Metro sugar-brown, sugar-white, pasta, flour, oats and toilet-paper sources. Use `--category=<name> --limit=20` with their existing scrape command; add `--dry-run` for source inspection. Each new pair permits twenty usable listings and two pages maximum. Tottus's validated meat/dairy scopes remain. Scheduled refresh includes these sources, deduplicates before each atomic retailer write and derives once. See [staple coverage](../../docs/staple-coverage.md).
