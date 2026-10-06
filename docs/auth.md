# Auth foundation (Milestone 19A)

Google sign-in/sign-out is available in the public shell through Better Auth **1.7.7** and `@better-auth/drizzle-adapter` **1.7.7**. Browsing, `/list` and `/api/list/evaluate` remain public. Shopping lists remain localStorage-only with the existing in-memory fallback; sign-in/out does not transfer, claim, clear or synchronize them. No remote list persistence or account dashboard is implemented.

## Configuration and boundaries

Set these **server-only** variables in `apps/web/.env.local` for development, or the intended hosting environment after review:

| Variable               | Meaning                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | Existing application PostgreSQL URL                                                                   |
| `BETTER_AUTH_URL`      | Exact origin without trailing slash, path, wildcard or credentials; HTTPS except loopback development |
| `BETTER_AUTH_SECRET`   | Random secret of at least 32 characters; keep stable/private                                          |
| `GOOGLE_CLIENT_ID`     | Google OAuth web client ID                                                                            |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret                                                                            |

Generate a secret locally, for example with `node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64"))'`. Never commit the result. Google must allow the exact callback `${BETTER_AUTH_URL}/api/auth/callback/google`. Development defaults to `http://127.0.0.1:3000`; `localhost` is a different origin and requires consistent URL/callback configuration. This milestone does not change remote Google, Neon or deployment settings.

`server/auth.ts` initializes lazily on auth requests. Public rendering/builds need no auth credentials or session lookup. Invalid/missing configuration returns a safe uncached 503; the shell disables sign-in if session lookup is unavailable. The client uses same-origin requests without secrets. Sessions use PostgreSQL and Better Auth's default signed HttpOnly/SameSite=Lax cookie, secure on HTTPS; cookie caching and secondary storage are not enabled. Future account/sync operations must validate through `auth.api.getSession`, never mere cookie presence. No global middleware/proxy is added.

`auth-config.ts` configures PostgreSQL, supported `advanced.database.generateId: "uuid"`, password authentication disabled and Google only. Default scopes are disabled; explicit scopes are only `openid`, `email`, `profile`, with `includeGrantedScopes: false` and `accessType: "online"`. No Google API scopes or offline access are requested. A supported before hook rejects caller-supplied scopes/additional authorization parameters on sign-in/link endpoints, preventing expansion or offline/incremental overrides. Default CSRF, origin, OAuth state and PKCE protection remain enabled; no additional trusted origins are configured. Server Actions are not used, so `nextCookies` is unnecessary. Neon HTTP uses sequential adapter operations (`transaction: false`), without unsupported interactive transactions.

`account.encryptOAuthTokens: true` enables supported encryption. **Verified 1.7.7 limitation:** callback persistence encrypts access/refresh tokens but retains the ID token as supplied. Do not claim all token columns are encrypted. No custom storage hooks are added.

The implementation follows the official [Next.js integration](https://better-auth.com/docs/integrations/next), [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [UUID configuration](https://better-auth.com/docs/concepts/database#uuids) and [Google provider](https://better-auth.com/docs/authentication/google), verified against installed 1.7.7 source/types and local Next.js 16.3.8 documentation.

## Schema and migration review

Installed Better Auth `getAuthTables` supplies the core model contract; logical fields map to snake-case columns. Auth timestamps follow the recommended Drizzle `timestamp` shape without timezone; catalog timestamps are untouched. All IDs are UUID primary keys with `gen_random_uuid()` defaults, supported by the PostgreSQL UUID adapter configuration.

- `user`: required name/email, unique email, verification boolean, optional image and timestamps.
- `session`: unique text token, expiry/timestamps, optional IP/user agent, indexed UUID user FK with `ON DELETE CASCADE`.
- `account`: text provider ID/subject, UUID row/user IDs, indexed cascading user FK, nullable token/expiry/scope/password fields and timestamps. Added composite uniqueness on `(provider_id, account_id)` preserves provider identity. The subject is never coerced to UUID; the nullable password field preserves the core model without enabling password auth.
- `verification`: text identifier/value, expiry/timestamps and identifier lookup index; identifiers have no invented uniqueness requirement.

Generated with `pnpm db:generate`: [0009_grey_husk.sql](../packages/db/migrations/0009_grey_husk.sql), journal entry and snapshot. Reviewed SQL contains only four auth tables, two cascading FKs, email/token uniqueness and four lookup/identity indexes. No catalog alteration or shopping-list table is present. This migration is **generated for review, not applied to an application database**. Build/startup never applies it. Existing isolated tests replay the journal only in their owned disposable schemas.

## Deterministic verification

`pnpm test` includes credential-free configuration/schema/session tests with existing API/stream tests. `pnpm test:integration` runs DB suites followed by web auth integration tests. PostgreSQL cases clearly skip without explicit `TEST_DATABASE_URL`; they never fall back to `DATABASE_URL`. Prefer `pnpm test:integration:local` with the repository Docker test database. Auth tests own/reset/drop a random schema through the existing harness.

Better Auth `testUtils` is imported only by tests with fake Google credentials; there is no production plugin toggle or session-creation endpoint. Tests exercise real persistence, signed-cookie/handler/session validation, sign-out/revocation, expiry, uniqueness, FKs and rejection of caller scope/access overrides. The callback test stubs only provider token/profile responses: state/cookies, callback handling, encryption and SQL writes remain real, and Google fetches are forbidden. Live Google credentials, consent and Google's signature verification are not covered.

After `pnpm build`, `pnpm test:e2e:fixtures:local` covers anonymous navigation, authenticated identity/sign-out, unchanged localStorage, public evaluation and existing list/basket regressions. Playwright supplies fake auth configuration from test-only `testing/auth-env.ts`. Session creation attaches only to the fixture owner's explicit test schema. Tests make no real Google OAuth requests.
