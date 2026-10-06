import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { shoppingListItemSchema, shoppingListRevisionMaximum } from "@comprafino/core";
import { ownedTestDatabase } from "../../../packages/db/src/testing/database.ts";
import { closeLocalTestConnections } from "../../../packages/db/src/testing/test-query-client.ts";
import { authOptions } from "../src/server/auth-config.ts";
import { authTestEnv as env } from "./auth-env.ts";
import { shoppingListSyncHandlers } from "../src/server/shopping-list-sync-handler.ts";
import { shoppingListPost } from "../src/server/shopping-list-handler.ts";
import { shoppingListBodyBytes } from "../src/server/request-body.ts";

const url = process.env.TEST_DATABASE_URL;

test.describe("sync HTTP with real Better Auth and explicit owned TEST_DATABASE_URL", () => {
  test.skip(!url, "Requires explicit TEST_DATABASE_URL; no application DATABASE_URL fallback");
  const harness = ownedTestDatabase({
    ...process.env,
    TEST_DATABASE_URL: url ?? "postgresql://unused@localhost/comprafino_test",
  });
  const auth = betterAuth({ ...authOptions(harness.db, env), plugins: [testUtils()] });
  const handlers = shoppingListSyncHandlers({
    session: (headers) => auth.api.getSession({ headers }),
    origin: () => env.BETTER_AUTH_URL,
    database: () => harness.db,
  });
  const originalFetch = globalThis.fetch;
  test.beforeAll(async () => {
    globalThis.fetch = (input, init) => {
      const hostname = new URL(input instanceof Request ? input.url : String(input)).hostname;

      if (hostname === "accounts.google.com" || hostname.endsWith(".googleapis.com")) {
        throw new Error("Google forbidden in sync tests");
      }

      return originalFetch(input, init);
    };
    await harness.setup();
  });
  test.beforeEach(async () => {
    await harness.scoped.query('truncate "user" cascade');
  });
  test.afterAll(async () => {
    globalThis.fetch = originalFetch;

    try {
      await harness.dispose();
    } finally {
      await closeLocalTestConnections();
    }
  });

  async function login() {
    const ctx = await auth.$context;
    const user = await ctx.test.saveUser(
      ctx.test.createUser({ id: randomUUID(), email: `${randomUUID()}@example.com` }),
    );

    return ctx.test.login({ userId: user.id });
  }

  const item = () =>
    shoppingListItemSchema.parse({
      id: randomUUID(),
      intent: "generic",
      canonicalId: null,
      label: "Huevos",
      query: "huevos",
      quantity: { amount: 30, unit: "unit" },
      frequency: "weekly",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

  function get(headers = new Headers()) {
    return handlers.GET(new Request(`${env.BETTER_AUTH_URL}/api/list/sync`, { headers }));
  }

  function post(
    headers: Headers,
    input: unknown,
    overrides: Record<string, string | undefined> = {},
  ) {
    const merged = new Headers(headers);
    merged.set("origin", env.BETTER_AUTH_URL);
    merged.set("content-type", "application/json");

    for (const [name, value] of Object.entries(overrides)) {
      if (value) {
        merged.set(name, value);
      } else {
        merged.delete(name);
      }
    }

    return handlers.POST(
      new Request(`${env.BETTER_AUTH_URL}/api/list/sync`, {
        method: "POST",
        headers: merged,
        body: JSON.stringify(input),
      }),
    );
  }

  const remove = (expectedRevision: number, id: string = randomUUID()) => ({
    expectedRevision,
    operation: { type: "remove", id },
  });
  test("anonymous, forged, revoked and expired cookies cannot read/write remote lists", async () => {
    const loggedIn = await login();
    const tampered = new Headers(loggedIn.headers);
    tampered.set("cookie", `${loggedIn.headers.get("cookie")}x`);

    for (const headers of [new Headers(), tampered]) {
      expect((await get(headers)).status).toBe(401);
      expect((await post(headers, remove(0))).status).toBe(401);
    }

    await auth.api.signOut({ headers: loggedIn.headers });
    expect((await get(loggedIn.headers)).status).toBe(401);
    expect((await post(loggedIn.headers, remove(0))).status).toBe(401);
    const expired = await (await auth.$context).test.login({ userId: loggedIn.user.id });
    await harness.scoped.query('update "session" set expires_at=$1 where id=$2', [
      new Date(0),
      expired.session.id,
    ]);
    expect((await get(expired.headers)).status).toBe(401);
    expect((await post(expired.headers, remove(0))).status).toBe(401);
    expect(await harness.scoped.query("select user_id from user_shopping_lists")).toEqual([]);
  });
  test("signed session reads absence, saves, conflicts and removes without writing no-ops", async () => {
    const loggedIn = await login();
    const response = await get(loggedIn.headers);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ revision: 0, list: { version: 2, items: [] } });
    expect(await (await post(loggedIn.headers, remove(0))).json()).toEqual({
      revision: 0,
      list: { version: 2, items: [] },
    });
    expect(await harness.scoped.query("select user_id from user_shopping_lists")).toEqual([]);
    const value = item();
    const saved = await post(loggedIn.headers, {
      expectedRevision: 0,
      operation: { type: "save", item: value },
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ revision: 1, list: { version: 2, items: [value] } });
    const before = await harness.scoped.query("select * from user_shopping_lists");
    const noop = await post(loggedIn.headers, remove(1));
    expect(noop.status).toBe(200);
    expect(await harness.scoped.query("select * from user_shopping_lists")).toEqual(before);
    const conflict = await post(loggedIn.headers, remove(0));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: "revision_conflict",
      current: { revision: 1, list: { version: 2, items: [value] } },
    });
    const removed = await post(loggedIn.headers, remove(1, value.id));
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ revision: 2, list: { version: 2, items: [] } });
  });
  test("each signed user owns only their row; supplied owner IDs are rejected", async () => {
    const a = await login();
    const b = await login();
    await post(b.headers, { expectedRevision: 0, operation: { type: "save", item: item() } });
    const bState = await (await get(b.headers)).json();
    expect(await (await get(a.headers)).json()).toEqual({
      revision: 0,
      list: { version: 2, items: [] },
    });
    expect((await post(a.headers, { ...remove(1), userId: b.user.id })).status).toBe(400);
    const attempt = await post(a.headers, remove(1));
    expect(attempt.status).toBe(409);
    expect(await attempt.json()).toEqual({
      error: "revision_conflict",
      current: { revision: 0, list: { version: 2, items: [] } },
    });
    expect(await (await get(b.headers)).json()).toEqual(bState);
    await post(a.headers, { expectedRevision: 0, operation: { type: "save", item: item() } });
    expect(await (await get(b.headers)).json()).toEqual(bState);
  });
  test("POST origin, content type, byte limit and strict payload boundaries protect actual persistence", async () => {
    const loggedIn = await login();

    for (const headers of [
      { origin: "" },
      { origin: "null" },
      { origin: "https://attacker.invalid" },
    ]) {
      expect((await post(loggedIn.headers, remove(0), headers)).status).toBe(403);
    }

    for (const contentType of ["text/plain", "application/xml", ""]) {
      const response = await post(loggedIn.headers, remove(0), { "content-type": contentType });
      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({ error: "unsupported_media_type" });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }

    expect(
      (
        await post(loggedIn.headers, remove(0), {
          "content-type": "application/json; charset=utf-8",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post(loggedIn.headers, remove(0), {
          "content-length": String(shoppingListBodyBytes + 1),
        })
      ).status,
    ).toBe(413);
    expect(
      (await post(loggedIn.headers, { padding: "x".repeat(shoppingListBodyBytes + 1) })).status,
    ).toBe(413);
    expect(
      (
        await post(loggedIn.headers, {
          expectedRevision: 0,
          operation: { type: "save", item: { ...item(), extra: true } },
        })
      ).status,
    ).toBe(400);
    expect(await harness.scoped.query("select user_id from user_shopping_lists")).toEqual([]);
  });
  test("corruption and revision exhaustion are safe 503 without modifying remote state", async () => {
    const loggedIn = await login();
    const value = item();
    await post(loggedIn.headers, { expectedRevision: 0, operation: { type: "save", item: value } });
    await harness.scoped.query("update user_shopping_lists set revision=$1", [
      shoppingListRevisionMaximum,
    ]);
    const before = await harness.scoped.query("select * from user_shopping_lists");
    expect(
      (await post(loggedIn.headers, remove(shoppingListRevisionMaximum, value.id))).status,
    ).toBe(503);
    expect(await harness.scoped.query("select * from user_shopping_lists")).toEqual(before);

    for (const data of [
      { version: 3, items: [] },
      { version: 2, items: [], extra: true },
      { version: 2, items: [{ ...value, extra: true }] },
      { version: 2, items: [{ ...value, quantity: { ...value.quantity, extra: true } }] },
    ]) {
      await harness.scoped.query("update user_shopping_lists set data=$1::jsonb", [
        JSON.stringify(data),
      ]);
      const corrupt = await harness.scoped.query("select * from user_shopping_lists");

      for (const response of [
        await get(loggedIn.headers),
        await post(loggedIn.headers, remove(shoppingListRevisionMaximum)),
        await post(loggedIn.headers, {
          expectedRevision: 0,
          operation: { type: "save", item: value },
        }),
      ]) {
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: "list_unavailable" });
      }

      expect(await harness.scoped.query("select * from user_shopping_lists")).toEqual(corrupt);
    }
  });
  test("public list evaluation uses the real handler without a session", async () => {
    const response = await shoppingListPost(() => harness.db)(
      new Request(`${env.BETTER_AUTH_URL}/api/list/evaluate`, {
        method: "POST",
        body: '{"version":2,"items":[]}',
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
