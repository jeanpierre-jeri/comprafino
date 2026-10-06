# Direct dependency inventory

Exact direct versions are pinned in manifests; the lockfile pins the graph. This inventory describes installed ownership, not a claim about current registry latest versions. Milestone 19A adds only the two pinned auth dependencies below.

## comprafino

| Dependency        | Version    | Kind            | Purpose                                |
| ----------------- | ---------- | --------------- | -------------------------------------- |
| `oxfmt`           | `0.71.0`   | devDependencies | sole formatter and Tailwind sorting    |
| `oxlint`          | `1.86.0`   | devDependencies | correctness linting                    |
| `oxlint-tsgolint` | `7.0.2003` | devDependencies | type-aware lint analysis               |
| `turbo`           | `2.11.7`   | devDependencies | task ordering, parallelism and caching |
| `typescript`      | `7.0.2`    | devDependencies | authoritative strict type checker      |

## @comprafino/web

| Dependency                     | Version       | Kind            | Purpose                                            |
| ------------------------------ | ------------- | --------------- | -------------------------------------------------- |
| `@comprafino/core`             | `workspace:*` | dependencies    | framework-independent domain validation and policy |
| `@comprafino/db`               | `workspace:*` | dependencies    | persisted query and transactional write boundaries |
| `@comprafino/ui`               | `workspace:*` | dependencies    | shared interactive/theme/history primitives        |
| `better-auth`                  | `1.7.7`       | dependencies    | Google OAuth, PostgreSQL sessions and auth client  |
| `@better-auth/drizzle-adapter` | `1.7.7`       | dependencies    | Better Auth PostgreSQL/Drizzle integration         |
| `next`                         | `16.3.8`      | dependencies    | App Router and production web build                |
| `react`                        | `19.3.0`      | dependencies    | React rendering / UI peer                          |
| `react-dom`                    | `19.3.0`      | dependencies    | DOM rendering / Base UI peer                       |
| `@playwright/test`             | `1.63.0`      | devDependencies | application Chromium E2E testing                   |
| `@tailwindcss/postcss`         | `4.3.3`       | devDependencies | Next PostCSS integration                           |
| `@types/node`                  | `24.19.1`     | devDependencies | native fetch and CLI types                         |
| `@types/react`                 | `19.3.0`      | devDependencies | React types                                        |
| `@types/react-dom`             | `19.3.0`      | devDependencies | React DOM types                                    |
| `tailwindcss`                  | `4.3.3`       | devDependencies | Tailwind 4 CSS compilation                         |

## @comprafino/core

| Dependency | Version | Kind            | Purpose                                        |
| ---------- | ------- | --------------- | ---------------------------------------------- |
| `zod`      | `4.6.5` | dependencies    | external boundary and domain schema validation |
| `vitest`   | `5.0.3` | devDependencies | fixture and ingestion tests                    |

## @comprafino/db

| Dependency                 | Version       | Kind            | Purpose                                            |
| -------------------------- | ------------- | --------------- | -------------------------------------------------- |
| `@comprafino/core`         | `workspace:*` | dependencies    | framework-independent domain validation and policy |
| `@neondatabase/serverless` | `1.2.0`       | dependencies    | Neon serverless HTTP driver                        |
| `drizzle-orm`              | `0.45.3`      | dependencies    | typed PostgreSQL queries                           |
| `pg`                       | `8.23.1`      | devDependencies | explicit local PostgreSQL test transport           |
| `zod`                      | `4.6.5`       | dependencies    | external boundary and domain schema validation     |
| `@types/node`              | `24.19.1`     | devDependencies | native fetch and CLI types                         |
| `@types/pg`                | `8.23.1`      | devDependencies | local PostgreSQL driver types                      |
| `dotenv`                   | `18.0.5`      | devDependencies | root .env loading for migration CLI only           |
| `drizzle-kit`              | `0.31.11`     | devDependencies | SQL generation and migration CLI                   |
| `vitest`                   | `5.0.3`       | devDependencies | fixture and ingestion tests                        |

## @comprafino/scrapers

| Dependency         | Version       | Kind            | Purpose                                            |
| ------------------ | ------------- | --------------- | -------------------------------------------------- |
| `@comprafino/core` | `workspace:*` | dependencies    | framework-independent domain validation and policy |
| `@comprafino/db`   | `workspace:*` | dependencies    | persisted query and transactional write boundaries |
| `zod`              | `4.6.5`       | dependencies    | external boundary and domain schema validation     |
| `@types/node`      | `24.19.1`     | devDependencies | native fetch and CLI types                         |
| `vitest`           | `5.0.3`       | devDependencies | fixture and ingestion tests                        |

## @comprafino/ui

| Dependency                 | Version   | Kind             | Purpose                                    |
| -------------------------- | --------- | ---------------- | ------------------------------------------ |
| `@base-ui/react`           | `1.8.0`   | dependencies     | shadcn accessible Base UI button primitive |
| `class-variance-authority` | `0.7.1`   | dependencies     | button variant/size classes                |
| `clsx`                     | `2.1.1`   | dependencies     | conditional class composition              |
| `lucide-react`             | `1.51.0`  | dependencies     | UI icons                                   |
| `recharts`                 | `3.10.1`  | dependencies     | ordinary history SVG charts                |
| `tailwind-merge`           | `3.7.0`   | dependencies     | Tailwind conflict resolution               |
| `@types/react`             | `19.3.0`  | devDependencies  | React types                                |
| `@types/react-dom`         | `19.3.0`  | devDependencies  | React DOM types                            |
| `react`                    | `19.3.0`  | devDependencies  | React rendering / UI peer                  |
| `react-dom`                | `19.3.0`  | devDependencies  | DOM rendering / Base UI peer               |
| `react`                    | `^19.3.0` | peerDependencies | React rendering / UI peer                  |
| `react-dom`                | `^19.3.0` | peerDependencies | DOM rendering / Base UI peer               |

## Tooling and database extension

Node 24.x and pnpm 12.8.1 are repository requirements. shadcn supplies source, not a runtime package. `allowImportingTsExtensions` supports Node's native TypeScript CLI execution. The workspace permits esbuild's required build script and version-specific Turbo release-age exceptions established during bootstrap; this is not permission for arbitrary install scripts.

Reviewed migrations enable PostgreSQL `pg_trgm`; isolated test databases preinstall it because test schema setup does not mutate shared extensions. Production uses Neon HTTP; `pg` belongs to explicit local test transport. Recharts and Lucide are implemented UI dependencies, not deferred choices. Additional form/cache/scraping infrastructure remains deferred. Original bootstrap references are in [engineering history](history/engineering-notes-2026-10-05.md#original-docsdependenciesmd).

## Next stream-cancellation patch

The exact patched package is **next@16.3.8**, declared in `pnpm-workspace.yaml`, with patch file [patches/next@16.3.8.patch](../patches/next@16.3.8.patch). Cleanup A backports the cancellation behavior recorded in [upstream PR #96715](https://github.com/vercel/next.js/pull/96715) to the Node helper and eight precompiled App Router runtime variants.

Canceled unfinished RSC responses previously emitted `The destination stream closed early.` during navigation, prefetch cancellation and browser teardown. The patch installs the close listener before piping and uses Next's existing `ResponseAborted` classification. It does not suppress genuine render errors: the browser-free regressions assert error reporting with a digest, successful completion and cancellation across every patched runtime variant. `pnpm test` includes these regressions; run alone with `pnpm --filter @comprafino/web test`.

Frozen-lockfile installation applies the patch locally and in CI. Rebuild/restart to avoid retaining unpatched compiled code. **Remove only after upgrading to a version containing the upstream fix and rerunning the stream regressions**, including genuine render failures, followed by production build and controlled Chromium validation. Then remove the version-specific patched-dependency entry/file and regenerate the lockfile. This cleanup retains the patch and all dependency versions. See [local testing](local-testing.md#canceled-react-streams).
