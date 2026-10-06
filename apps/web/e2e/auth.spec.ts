import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { fixtureDatabase } from "../../../packages/db/src/testing/fixture-client.ts";
import { closeLocalTestConnections } from "../../../packages/db/src/testing/test-query-client.ts";
import { authOptions } from "../src/server/auth-config.ts";
import { authTestEnv } from "../testing/auth-env.ts";

test("anonymous visitors retain public navigation and a minimal sign-in control", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Iniciar sesión", exact: true })).toBeEnabled();
  await page.getByRole("link", { name: "Mi lista", exact: true }).click();
  await expect(page).toHaveURL(/\/list$/u);
  expect(await (await request.get("/api/auth/get-session")).json()).toBeNull();
});

test("real persisted session displays identity, signs out and leaves browser list storage unchanged", async ({
  page,
  context,
  request,
}) => {
  test.skip(
    !process.env.TEST_DATABASE_URL || !process.env.COMPRAFINO_E2E_SCHEMA,
    "Requires owned controlled PostgreSQL fixtures",
  );
  const auth = betterAuth({
    ...authOptions(fixtureDatabase(), authTestEnv),
    plugins: [testUtils()],
  });
  const ctx = await auth.$context;
  const user = await ctx.test.saveUser(
    ctx.test.createUser({
      id: randomUUID(),
      name: "Ana Fixture",
      email: `${randomUUID()}@example.com`,
    }),
  );
  try {
    const loggedIn = await ctx.test.login({ userId: user.id });
    await context.addCookies(loggedIn.cookies);
    await page.goto("/");
    await expect(page.getByText("Ana", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cerrar sesión", exact: true })).toBeEnabled();
    const list = JSON.stringify({
      version: 2,
      items: [
        {
          id: randomUUID(),
          intent: "generic",
          label: "Huevos",
          query: "huevos",
          canonicalId: null,
          quantity: { amount: 30, unit: "unit" },
          frequency: "weekly",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    await page.evaluate((value) => localStorage.setItem("comprafino-shopping-list", value), list);
    await page.getByRole("link", { name: "Mi lista", exact: true }).click();
    await expect(page.getByRole("article", { name: "Huevos", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
    await expect(page.getByRole("button", { name: "Iniciar sesión", exact: true })).toBeEnabled();
    await expect(page.getByRole("article", { name: "Huevos", exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("comprafino-shopping-list"))).toBe(list);
    expect(await (await request.get("/api/auth/get-session")).json()).toBeNull();
    const response = await request.post("/api/list/evaluate", { data: { version: 2, items: [] } });
    expect(response.status()).toBe(200);
  } finally {
    try {
      await ctx.test.deleteUser(user.id);
    } finally {
      await closeLocalTestConnections();
    }
  }
});
