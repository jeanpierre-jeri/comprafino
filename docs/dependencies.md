# Direct dependency inventory

Stable exact versions are pinned. Runtime ownership follows use; root owns repository tooling. React is a UI peer with development copies for independent checks; pnpm deduplicates compatible packages.

## comprafino

| Dependency        | Version    | Kind            | Purpose                                |
| ----------------- | ---------- | --------------- | -------------------------------------- |
| `turbo`           | `2.11.7`   | devDependencies | task ordering, parallelism and caching |
| `typescript`      | `7.0.2`    | devDependencies | authoritative strict type checker      |
| `oxlint`          | `1.86.0`   | devDependencies | correctness linting                    |
| `oxlint-tsgolint` | `7.0.2003` | devDependencies | type-aware lint analysis               |
| `oxfmt`           | `0.71.0`   | devDependencies | sole formatter and Tailwind sorting    |

## @comprafino/web

| Dependency             | Version       | Kind            | Purpose                                |
| ---------------------- | ------------- | --------------- | -------------------------------------- |
| `next`                 | `16.3.8`      | dependencies    | App Router and production web build    |
| `react`                | `19.3.0`      | dependencies    | React rendering / UI peer              |
| `react-dom`            | `19.3.0`      | dependencies    | DOM rendering / Base UI peer           |
| `@comprafino/core`     | `workspace:*` | dependencies    | pure history ranges and PEN formatting |
| `@comprafino/ui`       | `workspace:*` | dependencies    | shared button and theme                |
| `tailwindcss`          | `4.3.3`       | devDependencies | Tailwind 4 CSS compilation             |
| `@tailwindcss/postcss` | `4.3.3`       | devDependencies | Next PostCSS integration               |
| `@types/node`          | `24.19.1`     | devDependencies | Node 24 API types                      |
| `@types/react`         | `19.3.0`      | devDependencies | React types                            |
| `@types/react-dom`     | `19.3.0`      | devDependencies | React DOM types                        |
| `@playwright/test`     | `1.63.0`      | devDependencies | application Chromium E2E testing       |

## @comprafino/core

| Dependency | Version | Kind            | Purpose                            |
| ---------- | ------- | --------------- | ---------------------------------- |
| `vitest`   | `5.0.3` | devDependencies | unit tests                         |
| `zod`      | `4.6.5` | dependencies    | shared normalized listing boundary |

## @comprafino/db

| Dependency                 | Version   | Kind            | Purpose                                  |
| -------------------------- | --------- | --------------- | ---------------------------------------- |
| `drizzle-orm`              | `0.45.3`  | dependencies    | typed PostgreSQL queries                 |
| `@neondatabase/serverless` | `1.2.0`   | dependencies    | Neon serverless HTTP driver              |
| `zod`                      | `4.6.5`   | dependencies    | database environment boundary validation |
| `drizzle-kit`              | `0.31.11` | devDependencies | SQL generation and migration CLI         |
| `dotenv`                   | `18.0.5`  | devDependencies | root .env loading for migration CLI only |
| `@types/node`              | `24.19.1` | devDependencies | Node 24 API types                        |
| `vitest`                   | `5.0.3`   | devDependencies | unit tests                               |

## @comprafino/scrapers

| Dependency         | Version       | Kind            | Purpose                             |
| ------------------ | ------------- | --------------- | ----------------------------------- |
| `@comprafino/core` | `workspace:*` | dependencies    | listing schema and money helpers    |
| `@comprafino/db`   | `workspace:*` | dependencies    | persistence and run records         |
| `zod`              | `4.6.5`       | dependencies    | untrusted Tottus payload validation |
| `@types/node`      | `24.19.1`     | devDependencies | native fetch and CLI types          |
| `vitest`           | `5.0.3`       | devDependencies | fixture and ingestion tests         |

## @comprafino/ui

| Dependency                 | Version   | Kind             | Purpose                                    |
| -------------------------- | --------- | ---------------- | ------------------------------------------ |
| `@base-ui/react`           | `1.8.0`   | dependencies     | shadcn accessible Base UI button primitive |
| `class-variance-authority` | `0.7.1`   | dependencies     | button variant/size classes                |
| `clsx`                     | `2.1.1`   | dependencies     | conditional class composition              |
| `tailwind-merge`           | `3.7.0`   | dependencies     | Tailwind conflict resolution               |
| `react`                    | `19.3.0`  | devDependencies  | React rendering / UI peer                  |
| `react-dom`                | `19.3.0`  | devDependencies  | DOM rendering / Base UI peer               |
| `@types/react`             | `19.3.0`  | devDependencies  | React types                                |
| `@types/react-dom`         | `19.3.0`  | devDependencies  | React DOM types                            |
| `react`                    | `^19.3.0` | peerDependencies | React rendering / UI peer                  |
| `react-dom`                | `^19.3.0` | peerDependencies | DOM rendering / Base UI peer               |

pnpm 12.8.1 is pinned in `packageManager`, not an application dependency. shadcn distributes component source; no runtime shadcn package is needed. The button source was fetched from the official Base UI `base-nova` registry and its `cn` import adapted to this workspace. The Lucide CLI preference installs no icon dependency; the initial button needs none.

Verified sources: npm registry stable tags, engine and peer ranges; [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [shadcn monorepos](https://ui.shadcn.com/docs/monorepo), [Base UI button registry](https://ui.shadcn.com/r/styles/base-nova/button.json), [Oxlint type-aware linting](https://oxc.rs/docs/guide/usage/linter/type-aware.html), [Oxfmt configuration](https://oxc.rs/docs/guide/usage/formatter/config-file-reference), and official releases for [checkout](https://github.com/actions/checkout/releases), [setup-node](https://github.com/actions/setup-node/releases), [pnpm action](https://github.com/pnpm/action-setup/releases).

The pnpm workspace explicitly permits esbuild installation scripts (required platform-binary setup for Drizzle Kit tooling). Exact stable Turbo 2.11.7 packages are excluded from pnpm’s default release-age delay because their current stable release was verified during bootstrap. No arbitrary dependency scripts are allowed.

Milestone 1A also adds `@comprafino/db` (`workspace:*`) to web for developer inspection and `@comprafino/core` (`workspace:*`) to db for boundary validation and transition comparisons. All external additions reuse exact versions already installed in the workspace; no new external package/version or scraping library is introduced. The CLI uses Node 24 native TypeScript stripping and root `.env` loading. `allowImportingTsExtensions` supports explicit local `.ts` imports required by that runner with the existing no-emit TypeScript configuration.

## Matching database extension

Milestone 3 adds no npm packages. The reviewed canonical migration enables PostgreSQL `pg_trgm` in public for deterministic `similarity()` over generated candidate pairs. No external search service or trigram index is justified by the current bounded batch query. Integration databases require this extension before isolated-schema tests; the tests do not create/drop shared public extensions.

## Public price history

Milestone 13 adds exact `recharts@3.10.1` to shared UI for the requested historical event chart. The minimal shared ChartContainer comes from the official [shadcn base-nova registry](https://ui.shadcn.com/r/styles/base-nova/chart.json), adapted to CSS theme variables and strict types; unused tooltip/legend wrappers are omitted. Recharts v3 supplies responsive SVG, tooltips and marker shapes. Web imports these primitives through shared UI and gains `@comprafino/core` (`workspace:*`) for pure history helpers. No other chart library or infrastructure is added.
