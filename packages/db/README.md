# Database

Lazy Drizzle/Neon HTTP client; importing opens no connection. Schema: retailers, retailer listings, meaningful price history, ingestion runs. Generate with `pnpm db:generate`, review SQL, and explicitly apply with `pnpm db:migrate` using root `.env`/`DATABASE_URL`. The first migration seeds all three retailer identities. No migrations run on build/startup.

Persistence validates listings, uses one atomic HTTP batch and serializes by retailer row lock. Equal/older observations are ignored; unchanged fresh observations update last-seen without appending history. SQL contract tests and the pure observation reference model do not execute PostgreSQL. Live migration, idempotency, rollback and concurrent-writer checks remain required; see [Tottus integration](../../docs/retailers/tottus.md).
