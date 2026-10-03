# Retailer ingestion

This workspace will own retailer adapters, external payload validation and ingestion orchestration. Tottus, Plaza Vea and Metro are planned, in that order; none is implemented.

Prefer legitimate publicly accessible JSON/data endpoints, then native `fetch` with HTML parsing, and browser automation only when demonstrated necessary. Use conservative request rates, honor applicable access restrictions, and never bypass authentication, CAPTCHAs, bot protection or access controls. Stealth tooling is prohibited.

Validate unknown external payloads at adapter boundaries with Zod when adapters exist. Keep retailer behavior isolated; share pure domain logic through `@comprafino/core` and persistence through `@comprafino/db` when actually needed. There are no dependencies yet because this bootstrap performs no ingestion.

GitHub Actions is the intended initial scheduler. Do not add cron workflows until an adapter and its operational requirements are proven. Playwright Test in the web workspace is application E2E tooling, not a scraper dependency.
