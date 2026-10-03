# Database boundary

`createDatabase()` creates a lazy Drizzle client using Neon HTTP. Use it only from server code or scripts; imports do not require credentials. The homepage has no database dependency.

`src/schema.ts` is intentionally empty. Define real tables after reviewing ingestion requirements, then run `pnpm db:generate` at the root and commit the reviewed SQL and metadata under `migrations/`. Generation does not need credentials; an empty schema produces no SQL changes.

Copy the root `.env.example` to `.env` and supply a Neon PostgreSQL URL before running `pnpm db:migrate`. Migration configuration loads that file (existing process variables take precedence), validates the URL and fails clearly if missing. Migrations are explicit operations, never part of web builds or startup. No live migration has been performed during bootstrap.

Future Next.js consumers should load their database environment through Vercel or `apps/web/.env.local`. Keep this package out of Client Components. The HTTP driver suits stateless queries and batched transactions; choose a pooled driver later only if interactive transactions actually require it.
