# Authenticated shopping-list persistence (Milestone 19B)

This milestone provides backend capability only. The browser shopping-list hook still uses localStorage and its existing in-memory fallback, including for signed-in users. No client import, first-login merge, account/list switching, remote authoritative UI, retry/replay, storage clearing or authenticated cross-tab sync is implemented. Those belong to 19C. Public browsing and `/api/list/evaluate` remain public; persistence does not evaluate prices or invent product equivalence.

## Table and migration

`user_shopping_lists` stores one JSONB document per authenticated user. `user_id` is a UUID primary key and FK to Better Auth `user.id`, with `ON DELETE CASCADE`. `revision` is an integer with no default and CHECK >= 1. `data` is required JSONB with no default. `created_at` and `updated_at` are **timestamp with time zone**, using the repository `time()` helper and DB `now()` defaults. No secondary index, list UUID, version column or item table is added.

[0010_natural_switch.sql](../packages/db/migrations/0010_natural_switch.sql) was generated through the normal Drizzle workflow for review, with its journal entry and snapshot. It only adds this table/check/FK and does not alter Better Auth or catalog tables. It was not applied to any application/production database. Tests replay the journal only inside their owned disposable schemas. Enabling the backend against an application database requires a separately authorized application of the reviewed migration; build/startup does not migrate.

## API contracts

`GET /api/list/sync` and `POST /api/list/sync` require a real Better Auth session. The owner UUID comes only from that session; request bodies cannot select a user. Every response uses `Cache-Control: no-store` and excludes owner ID/row timestamps.

GET does not create rows. Absence is exactly:

```json
{ "revision": 0, "list": { "version": 2, "items": [] } }
```

An existing row returns `{ revision, list }` with revision >= 1, even if the list is empty.

POST accepts exactly one of:

```json
{
  "expectedRevision": 0,
  "operation": {
    "type": "save",
    "item": {
      "id": "00000000-0000-4000-8000-000000000001",
      "intent": "generic",
      "canonicalId": null,
      "label": "Huevos",
      "query": "huevos",
      "quantity": { "amount": 30, "unit": "unit" },
      "frequency": "weekly",
      "createdAt": "2026-10-06T00:00:00.000Z",
      "updatedAt": "2026-10-06T00:00:00.000Z"
    }
  }
}
```

```json
{ "expectedRevision": 1, "operation": { "type": "remove", "id": "the stored item UUID" } }
```

Save uses the existing domain item fields. Schemas derive from the existing domain objects/refinements/defaults and are strict at envelope, operation, item and quantity levels. There is no replacement, clear/reset or document-upload operation. Revisions are integers in [0, 2147483647].

Successful POST returns the resulting/current `{ revision, list }`. A stale/future revision, or a positive revision against an absent row, returns 409:

```json
{
  "error": "revision_conflict",
  "current": { "revision": 0, "list": { "version": 2, "items": [] } }
}
```

For an existing row `current` contains its validated revision/document. A lost CAS uses a separate fresh SELECT, not the write's snapshot. Other commits may advance it further before that read. No automatic backend retry occurs.

## Mutation semantics and concurrency

Save reuses `saveShoppingItem`: normalization, conservative substitution evidence, 50-item limits, deduplication and existing ID/createdAt preservation remain authoritative. Remove reuses `removeShoppingItem` and addresses the persisted item UUID, not its deduplication key.

Revision-zero saves mutate the empty domain list and execute `INSERT ... ON CONFLICT (user_id) DO NOTHING RETURNING`. There is no preliminary existence read. The primary key makes one concurrent first writer succeed; the loser separately reads current state.

Positive revisions first read/validate the row and compare revision. A mismatch returns conflict before domain mutation. A domain rejection then returns 422 without an extra revision read. A changing operation executes one `UPDATE ... WHERE user_id = ... AND revision = expectedRevision RETURNING`, incrementing revision and explicitly setting `updated_at = clock_timestamp()`. PostgreSQL rechecks the predicate after concurrent row updates, so one writer at the same expected revision wins. No interactive transaction, locks held across HTTP requests, queues or realtime are added.

**Missing-item removal is read-only and naturally idempotent.** It returns 200 with the current state after revision comparison, without any write, revision increment or timestamp change. At revision zero it reads absence and returns the canonical empty state without creating a row. An existing row makes expectedRevision zero stale, even if the target item is absent. Removing the final existing item increments revision and retains the persisted empty row. Saves intentionally have no deep-equality/no-op optimization.

The integer ceiling is checked before changing persistence: a changing mutation at 2147483647 fails safely with 503 and leaves the row unchanged. Missing-item removal still succeeds without writing. Revision is the concurrency token; row timestamps are server metadata, and item timestamps retain existing domain semantics. No row deletion/reset endpoint exists.

## Boundaries and error behavior

Authentication precedes body parsing. POST additionally requires `application/json` and an exact Origin matching the configured application origin from the validated auth instance. Missing/null/untrusted Origin returns 403. A media type other than `application/json` (including a missing Content-Type) returns 415 `unsupported_media_type`; optional charset parameters are accepted. No broad CORS support or global middleware is added; Better Auth's own endpoint protections are not assumed to cover this route.

The existing bounded JSON reader enforces 128 KiB declared/actual UTF-8 bytes. Malformed JSON/request/item returns 400; oversized input returns 413. Missing/invalid/tampered/revoked/expired sessions return 401. Domain rejection returns 422 `mutation_rejected`. Auth/DB failures, corrupt stored documents and revision exhaustion return 503 `list_unavailable`. Infrastructure diagnostics use the existing safe formatter with operation `list_sync`, without copying documents, SQL messages, tokens or credentials.

JSONB/revision values are validated on reads and returning rows, including conflict responses. Persisted documents and `RemoteShoppingListState.list` share `remoteShoppingListSchema`, derived from existing domain schemas with strict list/item/quantity boundaries; unknown stored keys fail closed rather than being stripped. Invalid/unsupported stored documents fail closed; they are not recovered to empty, silently migrated or overwritten. Browser `parseShoppingList` recovery is deliberately not used for remote state.

## Verification and next phase

Core tests cover strict contracts and preserved domain refinements. DB integration tests cover lifecycle, no-op writes/timestamps, FK/checks, corruption, capacity, revision ceiling and concurrent first/same-revision writers. Race barriers live only in test transport: first inserts synchronize before SQL execution, and both positive-revision readers receive the same base document before either updates. There are no race sleeps or production test hooks.

Web integration tests use Better Auth's test-only utilities to persist real users/sessions and signed cookies in explicit owned schemas. They test account isolation, revocation/expiry, Origin/body boundaries, safe corruption/exhaustion failures and public evaluation. Credential-free HTTP boundary tests cover safe auth infrastructure failure and response validation. A controlled production-route smoke verifies remote saves/conflicts leave browser localStorage untouched. No real Google request is required.

Run `pnpm test:integration:local` with the existing disposable database; the root integration command runs DB then web suites sequentially. Missing explicit `TEST_DATABASE_URL` clearly skips DB-dependent cases; it never falls back to application `DATABASE_URL`. Build before `pnpm test:e2e:fixtures:local`. See [local testing](local-testing.md).

19C will separately own first-login merge, newer-item/equal-time conflict rules, client authority, one replay after 409, account/logout transitions, late-request handling, cross-tab behavior and clearing anonymous storage only after a successful first remote save. None is enabled by these endpoints alone.
