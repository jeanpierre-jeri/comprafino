import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";
import type { BrowserContext, Page } from "@playwright/test";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { shoppingListItemSchema } from "@comprafino/core";
import { mutateUserShoppingList, readUserShoppingList } from "@comprafino/db";
import { fixtureDatabase } from "../../../packages/db/src/testing/fixture-client.ts";
import { closeLocalTestConnections } from "../../../packages/db/src/testing/test-query-client.ts";
import { authOptions } from "../src/server/auth-config.ts";
import { authTestEnv } from "../testing/auth-env.ts";

function item(label: string) {
  return shoppingListItemSchema.parse({
    id: randomUUID(),
    intent: "generic",
    canonicalId: null,
    label,
    query: label,
    quantity: { amount: 1, unit: "unit" },
    frequency: "weekly",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z",
  });
}

async function fixture(context: BrowserContext, page: Page) {
  test.skip(
    !process.env.TEST_DATABASE_URL || !process.env.COMPRAFINO_E2E_SCHEMA,
    "Requires owned PostgreSQL fixtures",
  );
  const db = fixtureDatabase();
  const auth = betterAuth({ ...authOptions(db, authTestEnv), plugins: [testUtils()] });
  const ctx = await auth.$context;
  const first = await ctx.test.saveUser(
    ctx.test.createUser({
      id: randomUUID(),
      name: "Cuenta A",
      email: `${randomUUID()}@example.com`,
    }),
  );
  const second = await ctx.test.saveUser(
    ctx.test.createUser({
      id: randomUUID(),
      name: "Cuenta B",
      email: `${randomUUID()}@example.com`,
    }),
  );
  for (const [user, label] of [
    [first, "Lista A"],
    [second, "Lista B"],
  ] as const) {
    await mutateUserShoppingList(db, user.id, {
      expectedRevision: 0,
      operation: { type: "save", item: item(label) },
    });
  }
  const address = first.id.replaceAll("-", "").slice(0, 24).match(/.{4}/gu)!.join(":");
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `2001:db8:${address}` });
  const loggedIn = await ctx.test.login({ userId: first.id });
  await context.addCookies(loggedIn.cookies);
  const local = JSON.stringify({ version: 2, items: [item("Copia local conservada")] });
  const owner = randomUUID();
  await page.addInitScript(
    ({ local: localRaw, owner: localOwner }) => {
      if (sessionStorage.getItem("deletion-seeded")) return;
      localStorage.setItem("comprafino-shopping-list", localRaw);
      localStorage.setItem("comprafino-shopping-list-import-owner", localOwner);
      sessionStorage.setItem("deletion-seeded", "true");
    },
    { local, owner },
  );
  return {
    db,
    ctx,
    first,
    second,
    loggedIn,
    local,
    owner,
    login: async (userId: string) => context.addCookies((await ctx.test.login({ userId })).cookies),
    dispose: async () => {
      try {
        await ctx.test.deleteUser(first.id);
        await ctx.test.deleteUser(second.id);
      } finally {
        await closeLocalTestConnections();
      }
    },
  };
}

async function openConfirmation(page: Page) {
  await page.getByRole("button", { name: "Cuenta de Cuenta A" }).click();
  await page.getByRole("menuitem", { name: "Eliminar cuenta…", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "¿Eliminar tu cuenta?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Conservar mi cuenta" })).toBeFocused();
  return dialog;
}
async function localCopy(page: Page) {
  return page.evaluate(() => ({
    raw: localStorage.getItem("comprafino-shopping-list"),
    owner: localStorage.getItem("comprafino-shopping-list-import-owner"),
  }));
}

test("11B cancels, exports with 11A and deletes only the confirmed account on mobile", async ({
  page,
  context,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 740 });
  const f = await fixture(context, page);
  try {
    await page.goto("/list");
    await expect(page.getByRole("article", { name: "Lista A", exact: true })).toBeVisible();
    const first = await readUserShoppingList(f.db, f.first.id);
    const second = await readUserShoppingList(f.db, f.second.id);
    await page.evaluate(
      (owner) => localStorage.setItem("comprafino-shopping-list-import-owner", owner),
      f.first.id,
    );
    let dialog = await openConfirmation(page);
    await dialog.getByRole("button", { name: "Conservar mi cuenta" }).click();
    await expect(dialog).toHaveCount(0);
    expect(await f.ctx.internalAdapter.findUserById(f.first.id)).not.toBeNull();
    dialog = await openConfirmation(page);
    const downloaded = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Descargar lista de cuenta", exact: true }).click();
    const file = await downloaded;
    expect(JSON.parse(await readFile(await file.path(), "utf8"))).toEqual(first.list);
    await page.screenshot({
      path: testInfo.outputPath("delete-confirmation-mobile.png"),
      animations: "disabled",
    });
    await expect(
      dialog.getByRole("button", { name: "Eliminar mi cuenta definitivamente" }),
    ).toBeEnabled();
    await dialog.getByRole("button", { name: "Eliminar mi cuenta definitivamente" }).click();
    await expect(page.getByRole("button", { name: "Iniciar sesión", exact: true })).toBeEnabled();
    await expect(
      page.getByText("Tu cuenta y su lista guardada se eliminaron. La copia local se conserva.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(await f.ctx.internalAdapter.findUserById(f.first.id)).toBeNull();
    expect((await readUserShoppingList(f.db, f.first.id)).list.items).toEqual([]);
    expect(await readUserShoppingList(f.db, f.second.id)).toEqual(second);
    expect(await localCopy(page)).toEqual({ raw: f.local, owner: f.first.id });
    await expect(page.getByRole("article", { name: "Lista A", exact: true })).toHaveCount(0);
  } finally {
    await f.dispose();
  }
});

test("11B rejects a confirmation whose cookie now belongs to another account", async ({
  page,
  context,
}) => {
  const f = await fixture(context, page);
  try {
    await page.goto("/list");
    await expect(page.getByRole("article", { name: "Lista A", exact: true })).toBeVisible();
    const second = await readUserShoppingList(f.db, f.second.id);
    const dialog = await openConfirmation(page);
    await f.login(f.second.id);
    await dialog.getByRole("button", { name: "Eliminar mi cuenta definitivamente" }).click();
    await expect(dialog.getByRole("alert")).toContainText("La cuenta o sesión cambió");
    expect(await f.ctx.internalAdapter.findUserById(f.first.id)).not.toBeNull();
    expect(await readUserShoppingList(f.db, f.second.id)).toEqual(second);
    await dialog.getByRole("button", { name: "Comprobar sesión" }).click();
    await expect(page.getByRole("button", { name: "Cuenta de Cuenta B" })).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("article", { name: "Lista B", exact: true })).toBeVisible();
  } finally {
    await f.dispose();
  }
});

test("11B a committed deletion with lost reply stays uncertain without repeat", async ({
  page,
  context,
}) => {
  const f = await fixture(context, page);
  let posts = 0;
  try {
    await page.goto("/list");
    await expect(page.getByRole("article", { name: "Lista A", exact: true })).toBeVisible();
    await page.route("**/api/auth/delete-user", async (route) => {
      posts++;
      await route.fetch();
      await route.abort("failed");
    });
    const dialog = await openConfirmation(page);
    await dialog.getByRole("button", { name: "Eliminar mi cuenta definitivamente" }).click();
    await expect(dialog.getByRole("alert")).toContainText("No pudimos confirmar");
    expect(await f.ctx.internalAdapter.findUserById(f.first.id)).toBeNull();
    expect(posts).toBe(1);
    await expect(
      dialog.getByRole("button", { name: "Eliminar mi cuenta definitivamente" }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Tu cuenta y su lista guardada se eliminaron. La copia local se conserva.", {
        exact: true,
      }),
    ).toHaveCount(0);
    await dialog.getByRole("button", { name: "Comprobar sesión" }).click();
    await expect(page.getByRole("button", { name: "Iniciar sesión", exact: true })).toBeEnabled();
    expect(posts).toBe(1);
    expect(await localCopy(page)).toEqual({ raw: f.local, owner: f.owner });
    expect((await readUserShoppingList(f.db, f.second.id)).list.items).toHaveLength(1);
  } finally {
    await f.dispose();
  }
});

test("11B a delayed deletion reply cannot clear a different account's cookie", async ({
  page,
  context,
}) => {
  const f = await fixture(context, page);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  try {
    await page.goto("/list");
    await expect(page.getByRole("article", { name: "Lista A", exact: true })).toBeVisible();
    const second = await readUserShoppingList(f.db, f.second.id);
    await page.route("**/api/auth/delete-user", async (route) => {
      const response = await route.fetch();
      expect(response.headers()["set-cookie"]).toBeUndefined();
      entered();
      await gate;
      await route.fulfill({ response }).catch(() => {});
    });
    const dialog = await openConfirmation(page);
    await dialog.getByRole("button", { name: "Eliminar mi cuenta definitivamente" }).click();
    await waiting;
    await f.login(f.second.id);
    release();
    await expect(page.getByRole("button", { name: "Cuenta de Cuenta B" })).toBeVisible();
    expect(await f.ctx.internalAdapter.findUserById(f.first.id)).toBeNull();
    expect(await readUserShoppingList(f.db, f.second.id)).toEqual(second);
    expect((await (await page.request.get("/api/auth/get-session")).json()).user.id).toBe(
      f.second.id,
    );
    expect(await localCopy(page)).toEqual({ raw: f.local, owner: f.owner });
  } finally {
    release();
    await f.dispose();
  }
});

for (const state of ["old", "revoked"] as const) {
  test(`11B refuses a ${state} session and does not delete its list`, async ({ page, context }) => {
    const f = await fixture(context, page);
    try {
      await page.goto("/list");
      await expect(page.getByRole("article", { name: "Lista A", exact: true })).toBeVisible();
      const first = await readUserShoppingList(f.db, f.first.id);
      const dialog = await openConfirmation(page);
      if (state === "old") {
        await f.ctx.internalAdapter.updateSession(f.loggedIn.session.token, {
          createdAt: new Date(Date.now() - 86400001),
        });
      } else {
        await f.ctx.internalAdapter.deleteSession(f.loggedIn.session.token);
      }
      await dialog.getByRole("button", { name: "Eliminar mi cuenta definitivamente" }).click();
      await expect(dialog.getByRole("alert")).toContainText(
        state === "old" ? "inicia sesión nuevamente" : "Tu sesión ya no está disponible",
      );
      expect(await f.ctx.internalAdapter.findUserById(f.first.id)).not.toBeNull();
      expect(await readUserShoppingList(f.db, f.first.id)).toEqual(first);
      expect(await localCopy(page)).toEqual({ raw: f.local, owner: f.owner });
    } finally {
      await f.dispose();
    }
  });
}
