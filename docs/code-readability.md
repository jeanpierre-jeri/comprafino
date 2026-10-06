# Code readability and frontend state

The readability cleanup uses existing Oxlint/Oxfmt plus the explicitly requested Zustand and TanStack Query dependencies. It changes organization and state integration while preserving shopping, price, matching and storage contracts. No application migration is part of this work.

## Conventions and enforcement

Oxlint enforces `no-nested-ternary` and `curly: multi-line` across maintained code and tests. A short two-way ternary is fine; multi-way decisions use explicit branches, switches, lookup tables or named helpers. Opening braces follow the condition; block bodies and closing braces use separate lines. Short early returns may omit braces; throws and other actions retain blocks. Keep one blank line between independent declarations, methods and phases such as validation, request and state application. Keep related variables together. Spacing is a review convention; the installed linter has no dedicated declaration-padding rule.

Use descriptive names beyond small callbacks, and comments for reasons/safety invariants rather than narration. Split a component or function by responsibility, not a line-count quota. Pricing arithmetic, identity gates, normalization and tri-state availability remain domain behavior; a readability refactor must preserve them and run their regression tests.

Oxfmt remains the formatter with the existing 100-column default. No additional formatter/linter, broad import reordering or form library is introduced. Required format/lint/typecheck/test/build and Chromium checks remain documented in [local testing](local-testing.md).

These conventions follow [Oxlint's nested-ternary rule](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-nested-ternary), [Google's whitespace guidance](https://google.github.io/styleguide/jsguide.html), [Fowler's named function extraction](https://refactoring.com/catalog/extractFunction.html), and [React's component decomposition guidance](https://react.dev/learn/thinking-in-react). They are the repository's chosen conventions, not universal size limits.

Examples:

```ts
if (!Number.isInteger(limit) || limit < 1 || limit > discoveryRetailerLimit) {
  throw new Error("Retailer search limit must be 1..10");
}

if (!normalizedQuery) return false;
```

## Client/server state ownership and hydration

`ShoppingListProvider` in the root layout constructs a coordinator with its own vanilla Zustand store for anonymous data and local workflow flags, plus a TanStack Query client for server documents. There is no mutable module-level account store. Server rendering initializes an empty/checking snapshot without accessing browser storage or fetching account data. Zustand's `useStore` subscribes to client state; Query's `useQuery` subscribes to session-scoped remote documents. Client navigation retains the root provider and anonymous in-memory fallback.

The provider context exposes only its stable coordinator instance. Auth and store subscriptions live in the bridge and consumer hooks, so session updates do not rerender the surrounding streamed Server Component content during hydration.

`ShoppingListSessionBridge` explicitly owns session transitions and storage/focus/visibility listeners. Typed session variants distinguish checking, anonymous, authenticated and unavailable states; authenticated identity stores user and session IDs separately. The account menu handles account UI, not list lifecycle. Every asynchronous coordinator result still checks its generation before state application, anonymous clearing or write signaling. Typed sync error codes choose Spanish messages without matching message text.

The theme control creates its own Zustand instance. A browser effect connects it to the document theme preference, system media query and storage events; cleanup removes listeners. The existing bootstrap script keeps the initial document theme correct before hydration, and storage failures retain session-only selection. Simple local form/dialog interaction remains in React state.

This ownership follows the [Zustand Next.js guide](https://zustand.docs.pmnd.rs/learn/guides/nextjs) and [vanilla store API](https://zustand.docs.pmnd.rs/reference/apis/create-store.html). Remote list documents live only in Query, rather than being mirrored into Zustand. Query keys include user and session identity; account transitions/expiry/teardown cancel requests and clear the provider cache. Remote list reads use `fetchQuery` under explicit coordinator sequencing, and saves/removals use Query's mutation lifecycle with zero automatic retries and no offline queue. The coordinator retains the single 409 replay and safe first-login import. Its remote query observer is disabled for automatic fetching so tab refreshes cannot restart an import.

Public price evaluation uses `useQuery` keyed by session, list and price mode, with validated responses, consumed abort signals, visible-tab minute refresh and explicit retry. Previous quotes are hidden while fetching or after errors; no previous-list placeholder data is used. Inactive evaluation queries are discarded. Server Components keep their existing native async database boundaries; they do not read or populate the browser cache. This follows [TanStack Query's client API](https://tanstack.com/query/latest/docs/framework/react/reference/classes/QueryClient) and [SSR guidance](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr).

Account list documents are remote-authoritative; Zustand persistence middleware is intentionally absent. Anonymous data continues through the validated localStorage repository, not automatic store serialization.

## Organization

Shopping components/hooks are grouped under `apps/web/src/components/shopping-list`; HTTP synchronization, session/error types and anonymous storage live under `apps/web/src/lib/shopping-list`. Evaluation fetching, item cards, market status, editor defaults and submission are separate responsibilities. Search data loading stays in the Server Component route, while result rendering uses `search-results-content.tsx` with named grouping/quantity helpers.

Core retains framework-independent merge, unit conversion, price/eligibility, matching and history decisions. PostgreSQL/Drizzle and fixtures remain in `packages/db`, ingestion in `packages/scrapers`, and shared UI primitives in `packages/ui`. No package-boundary reorganization or circular dependency is introduced.
