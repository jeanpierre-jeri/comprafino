# Repository rules

- Use pnpm only; never install project dependencies globally.
- Keep TypeScript strict. Avoid `any`; validate external values at boundaries.
- Prefer simple solutions and add dependencies/infrastructure only for a current requirement.
- Prefer React Server Components; use Client Components for required interaction/browser APIs.
- Before Next.js changes, consult version-matched docs in `apps/web/node_modules/next/dist/docs/`. Keep Codex instructions here; do not add `CLAUDE.md`.
- Keep framework-independent domain logic in `packages/core`, PostgreSQL/Drizzle in `packages/db`, retailer ingestion in `packages/scrapers`, shared UI in `packages/ui`, and app UI in `apps/web`.
- Use `workspace:*` for internal dependencies; avoid circular relationships and unnecessary duplication.
- Schema changes require reviewed migrations. Never commit credentials.
- Pricing, promotion and matching logic requires meaningful tests.
- Update docs when commands, environment variables or architecture change.

# Retailer integration rules

- Prefer public data endpoints, then HTTP parsing; browser automation only when necessary.
- Use conservative requests and keep retailer behavior isolated.
- Never bypass authentication, CAPTCHAs, bot protection or access controls. Never use stealth tooling.

# Tooling rules

- Oxlint lints; Oxfmt formats; TypeScript is the authoritative type checker.
- Do not introduce ESLint, Prettier or Biome.
- Vitest tests pure logic and boundaries; Playwright Test tests the web application.
- Do not add forms, client caching, charts, scraping dependencies or infrastructure speculatively.

# Definition of done

Run applicable format, lint, typecheck, unit tests and build checks. For web changes, build first and run the Chromium E2E smoke test when available. Do not claim completion with failing checks; state exactly why any check cannot run. Keep documentation honest about implemented versus planned behavior.
