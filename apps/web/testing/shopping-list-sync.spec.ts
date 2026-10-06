import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createDatabase, ShoppingListDomainError } from "@comprafino/db";
import { shoppingListSyncHandlers } from "../src/server/shopping-list-sync-handler.ts";
import { shoppingListBodyBytes } from "../src/server/request-body.ts";

const origin = "http://127.0.0.1:3100";

const userId = randomUUID();

function post(body: string, extra: Record<string, string | undefined> = {}) {
  return new Request(`${origin}/api/list/sync`, {
    method: "POST",
    body,
    headers: Object.fromEntries(
      Object.entries({ origin, "content-type": "application/json", ...extra }).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  });
}

const body = JSON.stringify({
  expectedRevision: 0,
  operation: { type: "remove", id: randomUUID() },
});

const empty = () => ({ revision: 0, list: { version: 2 as const, items: [] } });

test("auth precedes body/security parsing and no rejected request accesses persistence", async () => {
  let calls = 0;
  const handlers = shoppingListSyncHandlers({
    session: async () => null,
    origin: () => origin,
    database: () => {
      calls++;

      throw new Error("Unexpected DB");
    },
  });

  for (const response of [
    await handlers.GET(new Request(`${origin}/api/list/sync`)),
    await handlers.POST(post("invalid", { origin: "https://attacker.invalid" })),
    await handlers.POST(post("x".repeat(shoppingListBodyBytes + 1))),
  ]) {
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }

  expect(calls).toBe(0);
});

test("session failures and invalid owner UUIDs fail closed with safe uncached 503", async () => {
  for (const session of [
    async () => {
      throw new Error("postgres://secret@host token payload");
    },
    async () => ({ user: { id: "not-uuid" } }),
  ]) {
    const handlers = shoppingListSyncHandlers({
      session,
      origin: () => origin,
      database: () => {
        throw new Error("Persistence must not be reached");
      },
    });

    for (const response of [
      await handlers.GET(new Request(`${origin}/api/list/sync`)),
      await handlers.POST(post(body)),
    ]) {
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "list_unavailable" });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  }
});

test("origin, content type, JSON, byte limits and strict envelopes reject before DB creation", async () => {
  let calls = 0;
  const handlers = shoppingListSyncHandlers({
    session: async () => ({ user: { id: userId } }),
    origin: () => origin,
    database: () => {
      calls++;

      throw new Error("Unexpected DB");
    },
  });

  for (const headers of [
    { origin: "" },
    { origin: "null" },
    { origin: "https://attacker.invalid" },
    { origin: `${origin}/path` },
  ]) {
    expect((await handlers.POST(post(body, headers))).status).toBe(403);
  }

  for (const contentType of ["text/plain", "application/xml", ""]) {
    const request = post(body, { "content-type": contentType });

    if (!contentType) {
      request.headers.delete("content-type");
    }

    const response = await handlers.POST(request);
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: "unsupported_media_type" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  }

  const missing = post(body);
  missing.headers.delete("origin");
  expect((await handlers.POST(missing)).status).toBe(403);

  for (const input of [
    "invalid",
    "null",
    JSON.stringify({ expectedRevision: -1, operation: { type: "remove", id: randomUUID() } }),
    JSON.stringify({
      expectedRevision: 0,
      userId: randomUUID(),
      operation: { type: "remove", id: randomUUID() },
    }),
    JSON.stringify({ expectedRevision: 0, operation: { type: "replace", list: empty().list } }),
  ]) {
    expect((await handlers.POST(post(input))).status).toBe(400);
  }

  expect((await handlers.POST(post("x".repeat(shoppingListBodyBytes + 1)))).status).toBe(413);
  expect(
    (await handlers.POST(post(body, { "content-length": String(shoppingListBodyBytes + 1) })))
      .status,
  ).toBe(413);
  expect(calls).toBe(0);
});

test("response validation, domain rejection and raw DB errors remain safe", async () => {
  const database = () => createDatabase({ DATABASE_URL: "postgresql://unused@localhost/unused" });
  const base = { session: async () => ({ user: { id: userId } }), origin: () => origin, database };
  const handlers = shoppingListSyncHandlers({
    ...base,
    read: async (_db, owner) => {
      expect(owner).toBe(userId);

      return empty();
    },
    mutate: async (_db, owner) => {
      expect(owner).toBe(userId);

      return { status: "conflict", current: empty() };
    },
  });
  expect(await (await handlers.GET(new Request(`${origin}/api/list/sync`))).json()).toEqual(
    empty(),
  );
  expect(
    (await handlers.POST(post(body, { "content-type": "application/json; charset=utf-8" }))).status,
  ).toBe(409);
  const conflict = await handlers.POST(post(body));
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toEqual({ error: "revision_conflict", current: empty() });

  for (const failure of [
    new ShoppingListDomainError(new Error("raw personal data")),
    new Error("postgres://secret query"),
  ]) {
    const result = await shoppingListSyncHandlers({
      ...base,
      mutate: async () => {
        throw failure;
      },
    }).POST(post(body));
    expect(result.status).toBe(failure instanceof ShoppingListDomainError ? 422 : 503);
    expect(await result.json()).toEqual({
      error: failure instanceof ShoppingListDomainError ? "mutation_rejected" : "list_unavailable",
    });
    expect(result.headers.get("cache-control")).toBe("no-store");
  }

  const invalid = shoppingListSyncHandlers({
    ...base,
    read: async () => {
      const state = empty();
      Reflect.deleteProperty(state, "list");

      return state;
    },
  });
  expect((await invalid.GET(new Request(`${origin}/api/list/sync`))).status).toBe(503);
});
