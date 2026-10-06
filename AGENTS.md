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
- Test writes must use an owned random schema and explicit test configuration; never fall back to application `DATABASE_URL`. See `docs/local-testing.md`.
- All identity writers must preserve derived-identity safety; preserve positive ordinary purchase prices and tri-state availability. See `docs/eligibility.md` and `docs/catalog-matching.md`.
- Dated material in `docs/history/` and the engineering audit is evidence, not current commit authorization.

# Retailer integration rules

- Prefer public data endpoints, then HTTP parsing; browser automation only when necessary.
- Use conservative requests and keep retailer behavior isolated.
- Never bypass authentication, CAPTCHAs, bot protection or access controls. Never use stealth tooling.

# Tooling rules

- Oxlint lints; Oxfmt formats; TypeScript is the authoritative type checker.
- Do not introduce ESLint, Prettier or Biome.
- Vitest tests pure logic and boundaries; Playwright Test tests the web application.
- Do not add forms, additional client caching, charts, scraping dependencies or infrastructure speculatively. TanStack Query is the approved browser server-state boundary.

# Code readability

- Keep short two-way ternaries simple; use explicit branches, switches or named helpers for multi-way decisions. Oxlint enforces no nested ternaries and braces for multi-line control flow.
- Put an opening control-flow brace after the condition, and put the body and closing brace on separate lines. A short early return may omit braces (`if (!value) return false;`); keep throws and other actions in blocks.
- Separate imports from implementation, independent declarations, consecutive methods and logical phases with a blank line. Keep related variable declarations together.
- Use descriptive names outside tiny callbacks. Extract functions/components around a clear responsibility; avoid generic helper collections and arbitrary file-length limits.
- Use TanStack Query for browser-fetched server state and provider-scoped Zustand stores for shared client state. Keep simple local interaction state in React; never share mutable user state across server requests or persist account lists through Zustand middleware.
- Preserve domain behavior and safety comments during readability changes. Keep framework-independent decisions in the existing packages.

# Definition of done

Run applicable format, lint, typecheck, unit tests and build checks. For web changes, build first and run the Chromium E2E smoke test when available. Do not claim completion with failing checks; state exactly why any check cannot run. Keep documentation honest about implemented versus planned behavior.
