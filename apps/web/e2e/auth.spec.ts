import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { fixtureDatabase } from "../../../packages/db/src/testing/fixture-client.ts";
import { closeLocalTestConnections } from "../../../packages/db/src/testing/test-query-client.ts";
import { authOptions } from "../src/server/auth-config.ts";
import { authTestEnv } from "../testing/auth-env.ts";
import type { BrowserContext, Page } from "@playwright/test";

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

test("real persisted session imports anonymous items and logout does not expose the account list", async ({
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
    await page.addInitScript(
      (value) => localStorage.setItem("comprafino-shopping-list", value),
      list,
    );
    await page.goto("/");
    await expect(page.getByText("Ana", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cuenta de Ana Fixture" })).toBeEnabled();
    await page.getByRole("link", { name: "Mi lista", exact: true }).click();
    await expect(page.getByRole("article", { name: "Huevos", exact: true })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("comprafino-shopping-list")))
      .toBeNull();
    expect(await (await context.request.get("/api/list/sync")).json()).toMatchObject({
      revision: 1,
      list: { items: [{ label: "Huevos" }] },
    });
    const other = await context.newPage();
    await other.goto("/list");
    await expect(other.getByRole("article", { name: "Huevos", exact: true })).toBeVisible();
    await page
      .getByRole("article", { name: "Huevos", exact: true })
      .getByRole("button", { name: "Editar Huevos" })
      .click();
    await page.getByLabel("Cantidad", { exact: true }).fill("60");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(other.getByRole("article", { name: "Huevos", exact: true })).toContainText(
      "60 unidades",
    );
    await page
      .getByRole("article", { name: "Huevos", exact: true })
      .getByRole("button", { name: "Quitar Huevos" })
      .click();
    await expect(other.getByRole("article", { name: "Huevos", exact: true })).toHaveCount(0);
    await other.close();
    await page.getByRole("button", { name: "Cuenta de Ana Fixture" }).click();
    await page.getByRole("menuitem", { name: "Cerrar sesión", exact: true }).click();
    await expect(page.getByRole("button", { name: "Iniciar sesión", exact: true })).toBeEnabled();
    await expect(page.getByRole("article", { name: "Huevos", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("comprafino-shopping-list"))).toBeNull();
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

async function capture(page: Page, label: string) {
  await page.screenshot({
    path: test.info().outputPath(`${label}.png`),
    fullPage: true,
    animations: "disabled",
  });
}
async function expectFits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function signedIn(context: BrowserContext, name: string, image: string | null = null) {
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
    ctx.test.createUser({ id: randomUUID(), name, image, email: `${randomUUID()}@example.com` }),
  );
  const loggedIn = await ctx.test.login({ userId: user.id });
  await context.addCookies(loggedIn.cookies);
  return {
    user,
    dispose: async () => {
      try {
        await ctx.test.deleteUser(user.id);
      } finally {
        await closeLocalTestConnections();
      }
    },
  };
}

for (const width of [390, 1280]) {
  test(`login dialog, focus, shared Button affordance and local storage at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.route("https://accounts.google.com/**", (route) => route.abort());
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Iniciar sesión", exact: true });
    await expect(trigger).toBeEnabled();
    await expect(trigger).toHaveAttribute("data-slot", "button");
    await expect(trigger).toHaveCSS("cursor", "pointer");
    await expectFits(page);
    await capture(page, `anonymous-${width}`);
    const list = JSON.stringify({ version: 2, items: [] });
    await page.evaluate((value) => localStorage.setItem("comprafino-shopping-list", value), list);
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Inicia sesión en CompraFino" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Guarda tu lista y tenla disponible en tus dispositivos.");
    await expect(dialog).toContainText(
      "Al iniciar sesión, combinaremos la lista de este navegador con la de tu cuenta.",
    );
    await expect(dialog).toContainText("También puedes seguir usando CompraFino sin una cuenta.");
    const google = dialog.getByRole("button", { name: "Continuar con Google" });
    await expect(google).toBeFocused();
    await expect(google).toHaveAttribute("data-slot", "button");
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Cerrar diálogo" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(google).toBeFocused();
    const bounds = await dialog.boundingBox();
    expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width).toBeTruthy();
    await capture(page, `login-${width}`);
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    await capture(page, `login-dark-${width}`);
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await dialog.getByRole("button", { name: "Cerrar diálogo" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => localStorage.getItem("comprafino-shopping-list"))).toBe(list);
  });

  test(`real account initials, keyboard menu and viewport at ${width}px`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    const session = await signedIn(context, "Jean Pierre");
    try {
      await page.goto("/");
      const trigger = page.getByRole("button", { name: "Cuenta de Jean Pierre" });
      await expect(trigger).toBeVisible();
      await expect(trigger).toContainText("JP");
      await expect(page.getByRole("menuitem", { name: "Cerrar sesión" })).toHaveCount(0);
      await expectFits(page);
      await capture(page, `account-${width}`);
      await trigger.focus();
      await page.keyboard.press("ArrowDown");
      const menu = page.getByRole("menu");
      await expect(menu).toContainText("Jean Pierre");
      await expect(menu).toContainText(session.user.email);
      await expect(page.getByRole("menuitem", { name: "Cerrar sesión" })).toBeFocused();
      const bounds = await menu.boundingBox();
      expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width).toBeTruthy();
      await capture(page, `menu-${width}`);
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
      });
      await capture(page, `menu-dark-${width}`);
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "light";
      });
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await trigger.click();
      await expect(menu).toBeVisible();
      await page.getByRole("link", { name: "CompraFino, inicio" }).click();
      await expect(menu).toHaveCount(0);
    } finally {
      await session.dispose();
    }
  });
}

test("Google initiation is bounded, visibly pending, inline-retryable and never contacts Google", async ({
  page,
}) => {
  let calls = 0;
  let googleCalls = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("https://accounts.google.com/**", (route) => {
    googleCalls++;
    return route.abort();
  });
  await page.route("**/api/auth/sign-in/social", async (route) => {
    calls++;
    const body: unknown = route.request().postDataJSON();
    expect(body).toEqual({ provider: "google", callbackURL: "http://127.0.0.1:3100/" });
    await gate;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ code: "SERVER_ERROR", message: "Fixture failure" }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await page.getByRole("button", { name: "Continuar con Google" }).click();
  const pending = page.getByRole("button", { name: "Conectando con Google…" });
  await expect(pending).toBeDisabled();
  await expect(pending).toHaveAttribute("aria-busy", "true");
  await expect(pending).toHaveCSS("cursor", "not-allowed");
  await pending.evaluate((button) => {
    if (button instanceof HTMLButtonElement) {
      button.click();
      button.click();
    }
  });
  await expect.poll(() => calls).toBe(1);
  release();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText("No pudimos iniciar sesión con Google.");
  await expect(
    page.getByRole("dialog", { name: "No pudimos cerrar sesión. Intenta nuevamente." }),
  ).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Continuar con Google" })).toBeEnabled();
  await capture(page, "login-error");
  await dialog.getByRole("button", { name: "Continuar con Google" }).click();
  await expect.poll(() => calls).toBe(2);
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(googleCalls).toBe(0);
});

test("session loading reserves space without presenting the wrong identity", async ({ page }) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/get-session", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Cargando sesión" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Iniciar sesión" })).toHaveCount(0);
  release();
  await expect(page.getByRole("button", { name: "Iniciar sesión" })).toBeEnabled();
});

for (const image of [
  "https://avatar.example.com/valid.svg",
  "https://avatar.example.com/broken.svg",
]) {
  test(`avatar handles ${image.includes("broken") ? "broken" : "valid"} user image`, async ({
    page,
    context,
  }) => {
    await page.route("https://avatar.example.com/**", (route) =>
      image.includes("broken")
        ? route.fulfill({ status: 404, body: "" })
        : route.fulfill({
            contentType: "image/svg+xml",
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#4285f4"/></svg>',
          }),
    );
    const session = await signedIn(context, "Jean Pierre", image);
    try {
      await page.goto("/");
      const trigger = page.getByRole("button", { name: "Cuenta de Jean Pierre" });
      await expect(trigger).toBeVisible();
      if (image.includes("broken")) {
        await expect(trigger).toContainText("JP");
        await expect(trigger.locator("img")).toHaveCount(0);
      } else {
        await expect(trigger.locator("img")).toHaveAttribute("src", image);
        await expect(trigger.locator("img")).toHaveAttribute("alt", "");
      }
    } finally {
      await session.dispose();
    }
  });
}

test("logout failure retains the real session, shows themed Base UI toast feedback and supports pending retry", async ({
  page,
  context,
}) => {
  const session = await signedIn(context, "Jean Pierre");
  let calls = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/sign-out", async (route) => {
    calls++;
    if (calls === 1)
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"code":"SERVER_ERROR","message":"Fixture failure"}',
      });
    else {
      await gate;
      await route.continue();
    }
  });
  try {
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Cuenta de Jean Pierre" });
    await trigger.click();
    await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
    const toast = page.getByRole("dialog", {
      name: "No pudimos cerrar sesión. Intenta nuevamente.",
    });
    await expect(toast).toContainText("No pudimos cerrar sesión. Intenta nuevamente.");
    await expect(toast).toHaveCSS("opacity", "1");
    await expect(trigger).toBeVisible();
    expect(await (await context.request.get("/api/auth/get-session")).json()).toMatchObject({
      user: { id: session.user.id },
    });
    const lightBackground = await toast.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    await capture(page, "logout-error-light");
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    await expect(toast).toBeVisible();
    const darkBackground = await toast.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    expect(darkBackground).not.toBe(lightBackground);
    await capture(page, "logout-error-dark");
    await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
    await expect(page.getByRole("menuitem", { name: "Cerrando sesión…" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(trigger).toBeVisible();
    await expect(page.getByRole("button", { name: "Iniciar sesión" })).toHaveCount(0);
    release();
    await expect(page.getByRole("button", { name: "Iniciar sesión" })).toBeEnabled();
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect(calls).toBe(2);
  } finally {
    release();
    await session.dispose();
  }
});

test("backend sync route persists only the signed owner's list and leaves browser storage untouched", async ({
  page,
  context,
}) => {
  const session = await signedIn(context, "Sync Fixture");
  try {
    await page.goto("/");
    const local = JSON.stringify({ version: 2, items: [] });
    await page.evaluate((value) => localStorage.setItem("comprafino-shopping-list", value), local);
    const initial = await context.request.get("/api/list/sync");
    expect(initial.status()).toBe(200);
    expect(await initial.json()).toEqual({ revision: 0, list: { version: 2, items: [] } });
    const item = {
      id: randomUUID(),
      intent: "generic",
      label: "Huevos",
      query: "huevos",
      canonicalId: null,
      quantity: { amount: 30, unit: "unit" },
      frequency: "weekly",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const response = await context.request.post("/api/list/sync", {
      headers: { origin: authTestEnv.BETTER_AUTH_URL },
      data: { expectedRevision: 0, operation: { type: "save", item } },
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
      revision: 1,
      list: { version: 2, items: [{ id: item.id }] },
    });
    const conflict = await context.request.post("/api/list/sync", {
      headers: { origin: authTestEnv.BETTER_AUTH_URL },
      data: { expectedRevision: 0, operation: { type: "remove", id: item.id } },
    });
    expect(conflict.status()).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: "revision_conflict",
      current: { revision: 1 },
    });
    expect(await page.evaluate(() => localStorage.getItem("comprafino-shopping-list"))).toBe(local);
    const publicResponse = await context.request.post("/api/list/evaluate", {
      data: { version: 2, items: [] },
    });
    expect(publicResponse.status()).toBe(200);
  } finally {
    await session.dispose();
  }
});
