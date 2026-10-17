import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { parseSetCookieHeader } from "better-auth/cookies";
import { symmetricDecrypt } from "better-auth/crypto";
import {
  account as accountTable,
  mutateUserShoppingList,
  readUserShoppingList,
} from "@comprafino/db";
import { shoppingListItemSchema } from "@comprafino/core";
import { ownedTestDatabase } from "../../../packages/db/src/testing/database.ts";
import { closeLocalTestConnections } from "../../../packages/db/src/testing/test-query-client.ts";
import { authOptions } from "../src/server/auth-config.ts";
import { authHandlers } from "../src/server/auth-handler.ts";
import { authTestEnv as env } from "./auth-env.ts";

const testURL = process.env.TEST_DATABASE_URL;

test.describe("Better Auth with explicit TEST_DATABASE_URL and an owned schema", () => {
  test.skip(!testURL, "Requires explicit TEST_DATABASE_URL; never falls back to DATABASE_URL");
  const harness = ownedTestDatabase({
    ...process.env,
    TEST_DATABASE_URL: testURL ?? "postgresql://unused@localhost/comprafino_test",
  });
  // This privileged plugin exists only in test source; production has no plugin switch.
  const auth = betterAuth({ ...authOptions(harness.db, env), plugins: [testUtils()] });
  const handlers = authHandlers(() => auth);
  const originalFetch = globalThis.fetch;
  test.beforeAll(async () => {
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));

      if (url.hostname === "accounts.google.com" || url.hostname.endsWith(".googleapis.com")) {
        throw new Error("Real Google OAuth is forbidden in tests");
      }

      return originalFetch(input, init);
    };
    await harness.setup();
  });
  test.beforeEach(async () => {
    await harness.scoped.query('truncate "user", "verification" cascade');
  });
  test.afterAll(async () => {
    globalThis.fetch = originalFetch;

    try {
      await harness.dispose();
    } finally {
      await closeLocalTestConnections();
    }
  });

  async function login(email = "ana@example.com") {
    const ctx = await auth.$context;
    const user = await ctx.test.saveUser(
      ctx.test.createUser({ id: randomUUID(), name: "Ana Test", email }),
    );

    return ctx.test.login({ userId: user.id });
  }

  function lookup(headers = new Headers()) {
    return handlers.GET(new Request(`${env.BETTER_AUTH_URL}/api/auth/get-session`, { headers }));
  }

  function deletionHeaders(loggedIn: Awaited<ReturnType<typeof login>>) {
    const headers = new Headers(loggedIn.headers);
    headers.set("origin", env.BETTER_AUTH_URL);
    headers.set("content-type", "application/json");
    headers.set("x-comprafino-confirm-delete", "delete-own-account");
    headers.set("x-comprafino-delete-owner", loggedIn.user.id);
    headers.set("x-comprafino-delete-session", loggedIn.session.id);
    return headers;
  }

  function deleteRequest(headers: Headers, body: unknown = {}) {
    return new Request(`${env.BETTER_AUTH_URL}/api/auth/delete-user`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  const deletionItem = () =>
    shoppingListItemSchema.parse({
      id: randomUUID(),
      intent: "generic",
      canonicalId: null,
      label: "Compra protegida",
      query: "pan",
      quantity: { amount: 2, unit: "unit" },
      frequency: "weekly",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-06T00:00:00.000Z",
    });

  test("11B native deletion removes only its user, all sessions, provider links and saved list", async () => {
    const first = await login();
    const second = await login("other@example.com");
    const ctx = await auth.$context;
    await ctx.test.login({ userId: first.user.id });
    expect(ctx.sessionConfig.freshAge).toBe(86400);
    for (const loggedIn of [first, second]) {
      await ctx.internalAdapter.createAccount({
        providerId: "google",
        accountId: randomUUID(),
        userId: loggedIn.user.id,
      });
      await mutateUserShoppingList(harness.db, loggedIn.user.id, {
        expectedRevision: 0,
        operation: { type: "save", item: deletionItem() },
      });
    }
    const untouched = await readUserShoppingList(harness.db, second.user.id);
    const response = await handlers.POST(deleteRequest(deletionHeaders(first)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, message: "User deleted" });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    for (const table of ["session", "account", "user_shopping_lists"]) {
      expect(await harness.scoped.query(`select user_id from "${table}" order by user_id`)).toEqual(
        [{ user_id: second.user.id }],
      );
    }
    expect(await harness.scoped.query('select id from "user"')).toEqual([{ id: second.user.id }]);
    expect(await readUserShoppingList(harness.db, second.user.id)).toEqual(untouched);
    expect(await (await lookup(first.headers)).json()).toBeNull();
    expect((await (await lookup(second.headers)).json()).user.id).toBe(second.user.id);
  });

  test("11B rejects stale confirmation, origin, CSRF, alternate parameters and callback deletion", async () => {
    const first = await login();
    const second = await login("other@example.com");
    for (const field of [
      "origin",
      "x-comprafino-confirm-delete",
      "x-comprafino-delete-owner",
      "x-comprafino-delete-session",
    ]) {
      const headers = deletionHeaders(first);
      headers.delete(field);
      expect((await handlers.POST(deleteRequest(headers))).status).toBeGreaterThanOrEqual(400);
    }
    const foreign = deletionHeaders(first);
    foreign.set("origin", "https://attacker.invalid");
    expect((await handlers.POST(deleteRequest(foreign))).status).toBe(403);
    const changed = deletionHeaders(first);
    changed.set("cookie", second.headers.get("cookie")!);
    expect((await handlers.POST(deleteRequest(changed))).status).toBe(409);
    const ctx = await auth.$context;
    const renewed = await ctx.test.login({ userId: first.user.id });
    const sameAccountNewSession = deletionHeaders(first);
    sameAccountNewSession.set("cookie", renewed.headers.get("cookie")!);
    expect((await handlers.POST(deleteRequest(sameAccountNewSession))).status).toBe(409);
    for (const body of [
      null,
      [],
      { password: "fake" },
      { token: "fake" },
      { callbackURL: "/" },
      { userId: second.user.id },
      { confirm: true },
    ]) {
      expect((await handlers.POST(deleteRequest(deletionHeaders(first), body))).status).toBe(400);
    }
    for (const path of ["delete-user/", "/delete-user", "%64elete-user", "delete-user%2F"]) {
      const response = await handlers.POST(
        new Request(`${env.BETTER_AUTH_URL}/api/auth/${path}`, {
          method: "POST",
          headers: deletionHeaders(first),
          body: "{}",
        }),
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    // A real persisted verification token must not bypass our explicit flow.
    await ctx.internalAdapter.createVerificationValue({
      identifier: "delete-account-fixture-token",
      value: first.user.id,
      expiresAt: new Date(Date.now() + 60000),
    });
    expect(
      (
        await handlers.GET(
          new Request(`${env.BETTER_AUTH_URL}/api/auth/delete-user/callback?token=fixture-token`, {
            headers: first.headers,
          }),
        )
      ).status,
    ).toBe(403);
    expect(await harness.scoped.query('select id from "user" order by id')).toHaveLength(2);
    expect((await (await lookup(first.headers)).json()).user.id).toBe(first.user.id);
    expect((await (await lookup(second.headers)).json()).user.id).toBe(second.user.id);
  });

  test("11B rejects missing, revoked and old sessions before deletion", async () => {
    const loggedIn = await login();
    expect(
      (await handlers.POST(deleteRequest(new Headers({ "content-type": "application/json" }))))
        .status,
    ).toBe(403);
    const forged = deletionHeaders(loggedIn);
    forged.set("cookie", "better-auth.session_token=forged.unsigned");
    expect((await handlers.POST(deleteRequest(forged))).status).toBe(401);
    const missing = deletionHeaders(loggedIn);
    missing.delete("cookie");
    expect((await handlers.POST(deleteRequest(missing))).status).toBe(401);
    await harness.scoped.query('update "session" set created_at=$1 where id=$2', [
      new Date(Date.now() - 86400001),
      loggedIn.session.id,
    ]);
    const old = await handlers.POST(deleteRequest(deletionHeaders(loggedIn)));
    expect(old.status).toBe(400);
    expect((await old.json()).code).toBe("SESSION_EXPIRED");
    await auth.api.signOut({ headers: loggedIn.headers });
    expect((await handlers.POST(deleteRequest(deletionHeaders(loggedIn)))).status).toBe(401);
    expect(await harness.scoped.query('select id from "user"')).toEqual([{ id: loggedIn.user.id }]);
  });

  test("11B does not turn a post-commit Better Auth failure into confirmed success", async () => {
    const loggedIn = await login();
    const options = authOptions(harness.db, env);
    const failing = betterAuth({
      ...options,
      user: {
        deleteUser: {
          enabled: true,
          afterDelete: async () => {
            throw new Error("Controlled after-delete failure");
          },
        },
      },
    });
    const response = await authHandlers(() => failing).POST(
      deleteRequest(deletionHeaders(loggedIn)),
    );
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await harness.scoped.query('select id from "user"')).toEqual([]);
  });

  function post(path: string, headers: Headers, body: unknown = {}) {
    const requestHeaders = new Headers(headers);
    requestHeaders.set("origin", env.BETTER_AUTH_URL);
    requestHeaders.set("content-type", "application/json");

    return handlers.POST(
      new Request(`${env.BETTER_AUTH_URL}/api/auth/${path}`, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(body),
      }),
    );
  }

  test("persisted UUID user/session resolves through the real signed cookie and server API", async () => {
    expect(await (await lookup()).json()).toBeNull();
    const loggedIn = await login();
    expect(loggedIn.session.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(loggedIn.user.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(loggedIn.session.userId).toBe(loggedIn.user.id);
    expect(await harness.scoped.query('select user_id from "session"')).toEqual([
      { user_id: loggedIn.user.id },
    ]);
    const response = await lookup(loggedIn.headers);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      user: { id: loggedIn.user.id, email: "ana@example.com" },
      session: { userId: loggedIn.user.id },
    });
    const resolved = await auth.api.getSession({ headers: loggedIn.headers });
    expect(resolved?.user.id).toBe(loggedIn.user.id);
    const cookie = loggedIn.cookies[0];
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
  });

  test("tampered, revoked and expired cookies do not authenticate; sign-out removes the row", async () => {
    const loggedIn = await login();
    const tampered = new Headers(loggedIn.headers);
    tampered.set("cookie", `${loggedIn.headers.get("cookie")}x`);
    expect(await (await lookup(tampered)).json()).toBeNull();
    const response = await post("sign-out", loggedIn.headers);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await harness.scoped.query('select id from "session"')).toEqual([]);
    expect(await (await lookup(loggedIn.headers)).json()).toBeNull();
    const ctx = await auth.$context;
    const expired = await ctx.test.login({ userId: loggedIn.user.id });
    await harness.scoped.query('update "session" set expires_at = $1 where id = $2', [
      new Date(0),
      expired.session.id,
    ]);
    expect(await (await lookup(expired.headers)).json()).toBeNull();
  });

  test("Google initiation persists OAuth state and requests only identity scopes without calling Google", async () => {
    const response = await post("sign-in/social", new Headers(), {
      provider: "google",
      callbackURL: "/list",
      disableRedirect: true,
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();

    if (
      !result ||
      typeof result !== "object" ||
      !("url" in result) ||
      typeof result.url !== "string"
    ) {
      throw new Error("Missing authorization URL");
    }

    const url = new URL(result.url);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual([
      "email",
      "openid",
      "profile",
    ]);
    expect(url.searchParams.get("access_type")).toBe("online");
    expect(url.searchParams.get("include_granted_scopes")).not.toBe("true");
    expect(url.searchParams.get("redirect_uri")).toBe(
      `${env.BETTER_AUTH_URL}/api/auth/callback/google`,
    );
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    const state = await harness.scoped.query('select id, identifier from "verification"');
    expect(state).toHaveLength(1);
    expect(state[0]).toMatchObject({ identifier: `auth-state:${url.searchParams.get("state")}` });
    // Replace only the provider network boundary in this test. State parsing,
    // account/user persistence, encryption and session cookies are real Better Auth.
    const ctx = await auth.$context;
    const providers = ctx.socialProviders;
    ctx.socialProviders = providers.map((provider) => ({
      ...provider,
      validateAuthorizationCode: async () => ({
        accessToken: "fixture-access-token",
        idToken: "fixture-id-token",
        scopes: ["openid", "email", "profile"],
      }),
      getUserInfo: async () => ({
        user: { name: "Ana Test", email: "ana@example.com", emailVerified: true },
        data: { sub: "google-fixture-subject" },
      }),
    }));

    function cookieHeaders(cookieResponse: Response) {
      const cookies = parseSetCookieHeader(cookieResponse.headers.get("set-cookie") ?? "");

      return new Headers({
        cookie: [...cookies].map(([name, cookie]) => `${name}=${cookie.value}`).join("; "),
      });
    }

    try {
      const callback = await handlers.GET(
        new Request(
          `${env.BETTER_AUTH_URL}/api/auth/callback/google?code=fixture-code&state=${url.searchParams.get("state")}`,
          { headers: cookieHeaders(response) },
        ),
      );
      expect(callback.status).toBe(302);
      expect(callback.headers.get("location")).toBe("/list");
      const accounts = await harness.db.select().from(accountTable);
      expect(accounts).toHaveLength(1);
      const account = accounts[0];

      if (!account?.accessToken || !account.idToken) {
        throw new Error("OAuth tokens not persisted");
      }

      expect(account.accountId).toBe("google-fixture-subject");
      expect(account.accessToken).not.toBe("fixture-access-token");
      // 1.7.7 encrypts access/refresh tokens, but stores ID tokens unchanged.
      expect(account.idToken).toBe("fixture-id-token");
      expect(account.refreshToken).toBeNull();
      expect(
        await symmetricDecrypt({ key: env.BETTER_AUTH_SECRET, data: account.accessToken }),
      ).toBe("fixture-access-token");
      expect(await (await lookup(cookieHeaders(callback))).json()).toMatchObject({
        user: { id: account.userId, email: "ana@example.com" },
      });
      expect(await harness.scoped.query('select id from "verification"')).toEqual([]);
    } finally {
      ctx.socialProviders = providers;
    }
  });

  test("origin protection rejects cross-origin sign-out and external OAuth callback URLs", async () => {
    const loggedIn = await login();
    const headers = new Headers(loggedIn.headers);
    headers.set("origin", "https://attacker.invalid");
    headers.set("content-type", "application/json");
    const response = await handlers.POST(
      new Request(`${env.BETTER_AUTH_URL}/api/auth/sign-out`, {
        method: "POST",
        headers,
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
    expect((await auth.api.getSession({ headers: loggedIn.headers }))?.user.id).toBe(
      loggedIn.user.id,
    );
    expect(
      (
        await post("sign-in/social", new Headers(), {
          provider: "google",
          callbackURL: "https://attacker.invalid",
        })
      ).status,
    ).toBe(403);
  });

  test("callers cannot expand scopes or request offline/incremental access", async () => {
    for (const extra of [
      { scopes: ["https://www.googleapis.com/auth/drive"] },
      { additionalParams: { access_type: "offline" } },
      { additionalParams: { include_granted_scopes: "true" } },
    ]) {
      expect(
        (
          await post("sign-in/social", new Headers(), {
            provider: "google",
            callbackURL: "/list",
            ...extra,
          })
        ).status,
      ).toBe(400);
    }

    expect(await harness.scoped.query('select id from "verification"')).toEqual([]);
  });

  test("provider subjects remain text, identities are unique, and user deletion cascades", async () => {
    const loggedIn = await login();
    const ctx = await auth.$context;
    const account = await ctx.internalAdapter.createAccount({
      providerId: "google",
      accountId: "google-subject-not-a-uuid",
      userId: loggedIn.user.id,
    });
    expect(account?.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(account?.accountId).toBe("google-subject-not-a-uuid");
    await expect(
      ctx.internalAdapter.createAccount({
        providerId: "google",
        accountId: "google-subject-not-a-uuid",
        userId: loggedIn.user.id,
      }),
    ).rejects.toThrow();
    // Same subject on a different provider is a different identity at the schema boundary.
    await ctx.internalAdapter.createAccount({
      providerId: "test-provider",
      accountId: "google-subject-not-a-uuid",
      userId: loggedIn.user.id,
    });
    await expect(
      harness.scoped.query(
        'insert into "session" (expires_at, token, updated_at, user_id) select expires_at, token, updated_at, user_id from "session"',
      ),
    ).rejects.toThrow();
    await expect(
      harness.scoped.query('insert into "user" (name, email) values ($1, $2)', [
        "Duplicate",
        loggedIn.user.email,
      ]),
    ).rejects.toThrow();
    await expect(
      ctx.internalAdapter.createAccount({
        providerId: "google",
        accountId: "orphan",
        userId: randomUUID(),
      }),
    ).rejects.toThrow();
    // Direct SQL deletion tests database FKs, independently of Better Auth's cleanup.
    await harness.scoped.query('delete from "user" where id = $1', [loggedIn.user.id]);
    expect(await harness.scoped.query('select id from "session"')).toEqual([]);
    expect(await harness.scoped.query('select id from "account"')).toEqual([]);
    expect(await (await lookup(loggedIn.headers)).json()).toBeNull();
  });
});
