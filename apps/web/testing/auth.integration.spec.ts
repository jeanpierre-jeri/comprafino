import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { parseSetCookieHeader } from "better-auth/cookies";
import { symmetricDecrypt } from "better-auth/crypto";
import { account as accountTable } from "@comprafino/db";
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

  async function login() {
    const ctx = await auth.$context;
    const user = await ctx.test.saveUser(
      ctx.test.createUser({ id: randomUUID(), name: "Ana Test", email: "ana@example.com" }),
    );

    return ctx.test.login({ userId: user.id });
  }

  function lookup(headers = new Headers()) {
    return handlers.GET(new Request(`${env.BETTER_AUTH_URL}/api/auth/get-session`, { headers }));
  }

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
