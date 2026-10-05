# Local PostgreSQL tests

Docker Compose supplies an ephemeral PostgreSQL 17 database for integration tests and history browser fixtures. It requires no Neon account or database URL:

```sh
pnpm test:db:up
pnpm test:integration:local
pnpm build
pnpm test:e2e:history:local
```

To validate only the six history fixtures without starting Playwright:

```sh
pnpm test:e2e:history:local --validate-fixtures
```

Stop and discard the database when finished:

```sh
pnpm test:db:down
```

The container binds to `127.0.0.1:55432`, initializes `pg_trgm`, and uses temporary storage. Its dedicated `comprafino_test` database uses trust authentication for local testing; no password is stored in the repository. Stopping/recreating the container discards its contents. This Compose configuration is for tests only.

The local commands explicitly set `TEST_DATABASE_URL=postgresql://comprafino_test@127.0.0.1:55432/comprafino_test` and `COMPRAFINO_TEST_DATABASE_MODE=local`. They do not read `.env` or use the application `DATABASE_URL`. Each run applies reviewed migrations inside a random schema and drops that schema on completion, including failures. The history runner passes the same schema and local mode to its web server. Local web access requires an isolated browser-test schema; the local transport rejects non-loopback hosts and other database names.

Normal application connections continue to use Neon HTTP. The local test transport uses `pg` TCP connections while preserving Drizzle's lazy queries, batch transactions, and transaction-local schema isolation. The existing explicit `TEST_DATABASE_URL=… pnpm test:integration` and `TEST_DATABASE_URL=… pnpm test:e2e:history` commands still support Neon without local mode.

Browser tests require a successful production build first. A Turbopack worker-port restriction in the agent sandbox can prevent that build; run the build locally in that case.

Verified: 41 integration tests and all six fixture kinds pass against this container, and cleanup leaves no test schemas. Formatting, lint, typechecking and 542 unit tests pass. The current sandbox production build fails at the documented Turbopack worker-port restriction; the local history browser run remains pending.
