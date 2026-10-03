# Scrapers

Native-fetch Tottus adapter and ingestion orchestration. Source hydration JSON → Zod source validation → normalized listing boundary → optional db persistence. Parsing fixtures requires no network or database. Root commands: `pnpm scrape:tottus -- --dry-run --limit=20` and `pnpm scrape:tottus -- --limit=50`. Default 20, hard cap 500, sequential category requests. See [Tottus integration](../../docs/retailers/tottus.md). Plaza Vea and Metro are not implemented.
