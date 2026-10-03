# Scrapers

Native-fetch Tottus and Plaza Vea adapters share a retailer-independent contract, ingestion orchestration and database persistence. Source data → Zod source validation → normalized listing boundary → optional db persistence. Fixtures/tests require no network or database.

Root commands:

```sh
pnpm scrape:tottus -- --dry-run --limit=20
pnpm scrape:plaza-vea -- --dry-run --limit=20
pnpm scrape:plaza-vea -- --limit=50
```

Default 20 normalized listings, hard cap 500, sequential bounded category requests. Dry-run needs no database; persisted mode requires `DATABASE_URL`. Pagination, seller and price selection remain retailer-specific. See [Tottus](../../docs/retailers/tottus.md) and [Plaza Vea](../../docs/retailers/plaza-vea.md) for differing source-row counts and coverage limits. Metro is not implemented.
