# Direct dependency inventory

Exact direct versions are pinned in manifests; the lockfile pins the graph. This inventory describes installed ownership, not a claim about current registry latest versions. Milestone 19A added the two pinned auth dependencies. The 19A.1 consistency correction uses existing Base UI Toast and removes Sonner.

## comprafino

| Dependency        | Version    | Kind            | Purpose                                |
| ----------------- | ---------- | --------------- | -------------------------------------- |
| `oxfmt`           | `0.71.0`   | devDependencies | sole formatter and Tailwind sorting    |
| `oxlint`          | `1.86.0`   | devDependencies | correctness linting                    |
| `oxlint-tsgolint` | `7.0.2003` | devDependencies | type-aware lint analysis               |
| `turbo`           | `2.11.7`   | devDependencies | task ordering, parallelism and caching |
| `typescript`      | `7.0.2`    | devDependencies | authoritative strict type checker      |

## @comprafino/web

| Dependency                     | Version       | Kind            | Purpose                                                         |
| ------------------------------ | ------------- | --------------- | --------------------------------------------------------------- |
| `@comprafino/core`             | `workspace:*` | dependencies    | framework-independent domain validation and policy              |
| `@comprafino/db`               | `workspace:*` | dependencies    | persisted query and transactional write boundaries              |
| `@comprafino/ui`               | `workspace:*` | dependencies    | shared interactive/theme/history primitives                     |
| `better-auth`                  | `1.7.7`       | dependencies    | Google OAuth, PostgreSQL sessions and auth client               |
| `@better-auth/drizzle-adapter` | `1.7.7`       | dependencies    | Better Auth PostgreSQL/Drizzle integration                      |
| `next`                         | `16.3.8`      | dependencies    | App Router and production web build                             |
| `react`                        | `19.3.0`      | dependencies    | React rendering / UI peer                                       |
| `@tanstack/react-query`        | `5.104.1`     | dependencies    | browser server state, query cancellation and mutation lifecycle |
| `zustand`                      | `5.0.15`      | dependencies    | provider-scoped shopping lists and browser theme state          |
| `react-dom`                    | `19.3.0`      | dependencies    | DOM rendering / Base UI peer                                    |
| `@playwright/test`             | `1.63.0`      | devDependencies | application Chromium E2E testing                                |
| `@tailwindcss/postcss`         | `4.3.3`       | devDependencies | Next PostCSS integration                                        |
| `@types/node`                  | `24.19.1`     | devDependencies | native fetch and CLI types                                      |
| `@types/react`                 | `19.3.0`      | devDependencies | React types                                                     |
| `@types/react-dom`             | `19.3.0`      | devDependencies | React DOM types                                                 |
| `tailwindcss`                  | `4.3.3`       | devDependencies | Tailwind 4 CSS compilation                                      |

Zustand **5.0.15** is pinned in `apps/web` for anonymous shopping data, local synchronization status and theme selection. Stores are created per provider/control instance and initialized without browser reads during server rendering. TanStack Query **5.104.1** owns remote shopping documents and public evaluations, with one QueryClient per root provider. Account changes cancel and clear this cache; retries and offline mutation resumption are disabled. Anonymous storage keeps its existing validated repository boundary; Zustand persist middleware is not used. See [readability and frontend state](code-readability.md).

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

## Scoped esbuild remediation — prompt 09

Revalidated on **October 17, 2026**, from local `270d947`, using Node 24.3.0/pnpm 12.8.1. Before the change, `pnpm audit --json` reported one moderate finding, [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99). The primary advisory affects esbuild through 0.24.2 and identifies 0.25.0 as the first patched release. Its condition is esbuild's development `serve` feature exposing responses cross-origin; dependency presence alone does not demonstrate that condition in this application.

### Graph and decision

The affected path was `drizzle-kit@0.31.11 → @esbuild-kit/esm-loader@2.6.5 → @esbuild-kit/core-utils@3.3.2 → esbuild@0.18.20`. It appeared both through the DB development dependency and through Better Auth's installed optional Drizzle Kit peer in the web dependency graph; it was not solely a development-only audit entry.

Registry metadata confirmed 0.31.11 as Drizzle Kit's latest stable release at review time. Both esbuild-kit packages were already at their latest published versions and deprecated in favor of tsx; a routine stable parent upgrade did not remove this branch. No prerelease migration or broad dependency update was undertaken.

[pnpm-workspace.yaml](../pnpm-workspace.yaml) therefore pins only `"@esbuild-kit/core-utils@3.3.2>esbuild": 0.25.12`. This overrides that parent's old `~0.18.20` range, while retaining all direct manifest versions. The target is the same patched esbuild already used directly by Drizzle Kit. esbuild 0.28.2 used by tsx/Vite is unchanged. This is a tested compatibility override across esbuild minor versions, not an upstream compatibility promise or an audit suppression.

The regenerated [lockfile](../pnpm-lock.yaml) removes esbuild 0.18.20 and its platform packages. pnpm also deduplicated the DB Drizzle ORM peer context into the already-existing context with optional Kysely; Drizzle ORM remains 0.45.3 and Kysely remains 0.29.6. No application schema/migration, comparison policy, runtime source or public-request budget changed.

### Usage and exposure evidence

The repository invokes Drizzle Kit for generation/explicit migrations; auth config uses `@better-auth/drizzle-adapter` with existing ORM tables. The inspected legacy core-utils implementation uses esbuild transformations, while Drizzle Kit's current CLI registers tsx. No application call to esbuild `serve` was found. The local production build's auth and list-sync file traces contained no esbuild/Drizzle Kit entries; this is bounded build evidence, not proof about every possible bundle or the deployed environment. No production exploitation or current remote deployment state is asserted.

### Isolated compatibility verification

[drizzle-toolchain.integration.test.ts](../packages/db/src/drizzle-toolchain.integration.test.ts) runs only with explicit local test configuration. It passed before and after the override and verifies:

- The actual transitive ESM loader compiles TypeScript enums and TSX, resolves another TS module and executes a dynamic import on Node 24.
- Drizzle Kit generates a small migration, applies it in the harness-owned random schema, reads/writes its fixture table and reruns without duplicating the migration journal.
- Its temporary CLI config never loads root `.env` or falls back to application `DATABASE_URL`. The journal is scoped explicitly; a guard rejects an unexpected `search_path` before table DDL.
- Generation against the actual project schema and copied snapshots reports no changes and leaves the copied journal identical. Checked-in migration files remain unchanged; the harness applies their reviewed journal only inside its owned test schema.
- The owned schema and temporary files are removed. No application database is used.

The test follows Drizzle Kit's normal relative output-path convention. An initial fixture using an absolute snapshot output path exposed its existing `./` path-prefix behavior; the fixture was adjusted before comparing dependency versions, without changing Drizzle Kit or production configuration.

| Check                                   | Result on the corrected graph                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`        | Correct; existing packages reused, no direct upgrades.                                                                       |
| `pnpm audit --json`                     | Zero reported vulnerabilities; previously one moderate.                                                                      |
| `pnpm audit --prod --json`              | Zero reported vulnerabilities in the production dependency graph. This command queries the registry, not production hosting. |
| Isolated Drizzle/loader regression      | Passed before and after.                                                                                                     |
| `pnpm test`                             | 953 correct; one task reused cache, including all Next stream cancellation regressions.                                      |
| `pnpm lint`, `pnpm typecheck`           | Correct.                                                                                                                     |
| `pnpm build`                            | Correct, fresh local build.                                                                                                  |
| Full PostgreSQL + auth HTTP integration | 151 PostgreSQL cases in 25 files, including the new toolchain regression, plus 12 HTTP/auth cases; all correct.              |
| Controlled Chromium after build         | 95 correct; eight expected fixture omissions.                                                                                |
| Format and documentation references     | Checked at delivery.                                                                                                         |

Ignored evidence is under `.artifacts/dependency-review-2026-10-17/`: registry/advisory metadata, before/after audits, graph, frozen install, toolchain logs, test/build results and scoped build-trace inspection. These snapshots are not required to repeat the versioned test; see [local testing](local-testing.md).

### Remaining warnings and removal condition

The two deprecated esbuild-kit packages remain installed because stable Drizzle Kit still declares them; deprecation is distinct from the resolved advisory. No ignored advisory, audit severity filter or exception hides the finding. Audit results describe the registry's known findings at that date, not a runtime exploit assessment.

When Drizzle Kit/core-utils changes, recheck its graph and the advisory, then remove the override only if the upstream branch is gone or resolves a patched esbuild without it. Adapt the branch-specific loader regression deliberately if the upstream loader disappears; retain generation/migration, auth, stream, build and Chromium checks for a lockfile change. No new service, remote configuration or production migration was introduced. **04A remains deferred.**

## Next stream-cancellation patch

The exact patched package is **next@16.3.8**, declared in `pnpm-workspace.yaml`, with patch file [patches/next@16.3.8.patch](../patches/next@16.3.8.patch). Cleanup A backports the cancellation behavior recorded in [upstream PR #96715](https://github.com/vercel/next.js/pull/96715) to the Node helper and eight precompiled App Router runtime variants.

Canceled unfinished RSC responses previously emitted `The destination stream closed early.` during navigation, prefetch cancellation and browser teardown. The patch installs the close listener before piping and uses Next's existing `ResponseAborted` classification. It does not suppress genuine render errors: the browser-free regressions assert error reporting with a digest, successful completion and cancellation across every patched runtime variant. `pnpm test` includes these regressions; run alone with `pnpm --filter @comprafino/web test`.

Frozen-lockfile installation applies the patch locally and in CI. Rebuild/restart to avoid retaining unpatched compiled code. **Remove only after upgrading to a version containing the upstream fix and rerunning the stream regressions**, including genuine render failures, followed by production build and controlled Chromium validation. Then remove the version-specific patched-dependency entry/file and regenerate the lockfile. The scoped esbuild remediation above retains this patch and its pinned Next version unchanged. See [local testing](local-testing.md#canceled-react-streams).
