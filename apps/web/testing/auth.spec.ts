import { expect, test } from "@playwright/test";
import { betterAuth } from "better-auth";
import { getAuthTables } from "better-auth/db";
import { account, createDatabase, session, user, verification } from "@comprafino/db";
import { authOptions } from "../src/server/auth-config.ts";
import { authHandlers } from "../src/server/auth-handler.ts";
import { ownedTestDatabase } from "../../../packages/db/src/testing/database.ts";
import { authTestEnv as env } from "./auth-env.ts";
import { accountInitials, avatarUrl } from "../src/lib/account-identity.ts";

const db = createDatabase({ DATABASE_URL: "postgresql://unused@localhost/unused" });

test("account initials and image boundaries handle empty, Unicode and odd input", () => {
  for (const [name, expected] of [
    ["Jean Pierre", "JP"],
    ["Jean", "J"],
    ["  Jean   Pierre López ", "JP"],
    ["!!!", "AL"],
    ["", "AL"],
    ["éloïse 王", "É王"],
    ["ß", "SS"],
  ]) {
    const initials = accountInitials(name ?? "", "ana.lopez@example.com");
    expect(initials).toBe(expected);
    expect(Array.from(initials).length).toBeLessThanOrEqual(2);
  }
  expect(accountInitials("", "")).toBe("C");
  expect(avatarUrl("https://lh3.googleusercontent.com/avatar")).toBe(
    "https://lh3.googleusercontent.com/avatar",
  );
  for (const image of [
    null,
    "",
    "broken",
    "javascript:alert(1)",
    "data:image/png;base64,x",
    "http://example.com/a",
    "https://user:pass@example.com/a",
  ])
    expect(avatarUrl(image)).toBeUndefined();
});

test("auth configuration validates explicit secrets and exact origins", () => {
  for (const key of Object.keys(env)) {
    expect(() => authOptions(db, { ...env, [key]: "" })).toThrow(`Missing ${key}`);
  }
  expect(() => authOptions(db, { ...env, BETTER_AUTH_SECRET: "short" })).toThrow();
  for (const url of [
    "https://example.com/path",
    "https://example.com/",
    "http://example.com",
    "https://user:pass@example.com",
    "https://*.example.com",
  ]) {
    expect(() => authOptions(db, { ...env, BETTER_AUTH_URL: url })).toThrow();
  }
  const options = authOptions(db, env);
  expect(options.advanced.database.generateId).toBe("uuid");
  expect(options.account.encryptOAuthTokens).toBe(true);
  expect(options.emailAndPassword.enabled).toBe(false);
  expect(Object.keys(options.socialProviders)).toEqual(["google"]);
  expect(options.socialProviders.google).toMatchObject({
    scope: ["openid", "email", "profile"],
    disableDefaultScope: true,
    includeGrantedScopes: false,
    accessType: "online",
  });
  // Every required logical field comes from the installed 1.7.7 schema contract.
  const models = { user, session, account, verification };
  const tables = getAuthTables(options);
  expect(Object.keys(tables).sort()).toEqual(Object.keys(models).sort());
  for (const [name, model] of Object.entries(models)) {
    for (const field of Object.keys(tables[name]?.fields ?? {})) {
      expect(Object.hasOwn(model, field), `${name}.${field}`).toBe(true);
    }
  }
});

test("anonymous and malformed-cookie lookups use real Better Auth validation without a DB query", async () => {
  const auth = betterAuth(authOptions(db, env));
  const { GET } = authHandlers(() => auth);
  for (const cookie of ["", "better-auth.session_token=forged.unsigned"]) {
    const response = await GET(
      new Request(`${env.BETTER_AUTH_URL}/api/auth/get-session`, {
        headers: { cookie },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  }
});

test("auth initialization failures return a safe uncached response", async () => {
  const response = await authHandlers(() => {
    throw new Error("postgresql://secret@host/raw-driver-details");
  }).GET(new Request(`${env.BETTER_AUTH_URL}/api/auth/get-session`));
  expect(response.status).toBe(503);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({
    error: "Inicio de sesión no disponible. Intenta nuevamente.",
  });
});

test("auth test persistence requires explicit TEST_DATABASE_URL even when an application URL exists", () => {
  expect(() =>
    ownedTestDatabase({ DATABASE_URL: "postgresql://unused@localhost/application" }),
  ).toThrow();
});
