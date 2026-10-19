import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";
import type { BrowserContext, Page } from "@playwright/test";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { shoppingListItemSchema, shoppingListSchema } from "@comprafino/core";
import { mutateUserShoppingList, readUserShoppingList } from "@comprafino/db";
import { fixtureDatabase } from "../../../packages/db/src/testing/fixture-client.ts";
import { closeLocalTestConnections } from "../../../packages/db/src/testing/test-query-client.ts";
import { authOptions } from "../src/server/auth-config.ts";
import { authTestEnv } from "../testing/auth-env.ts";

function item(index: number) {
  return shoppingListItemSchema.parse({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    intent: "generic",
    canonicalId: null,
    label: `Compra local ${index}`,
    query: `compra local ${index}`,
    quantity: { amount: 1, unit: "unit" },
    frequency: "weekly",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z",
  });
}

async function fixture(
  context: BrowserContext,
  page: Page,
  localOwner: "original" | "current" | "unclaimed" = "original",
) {
  test.skip(
    !process.env.TEST_DATABASE_URL || !process.env.COMPRAFINO_E2E_SCHEMA,
    "Requires owned PostgreSQL fixtures",
  );
  const db = fixtureDatabase();
  const auth = betterAuth({ ...authOptions(db, authTestEnv), plugins: [testUtils()] });
  const ctx = await auth.$context;
  const owner = await ctx.test.saveUser(
    ctx.test.createUser({
      id: randomUUID(),
      name: "Cuenta Original",
      email: `${randomUUID()}@example.com`,
    }),
  );
  const current = await ctx.test.saveUser(
    ctx.test.createUser({
      id: randomUUID(),
      name: "Cuenta Actual",
      email: `${randomUUID()}@example.com`,
    }),
  );
  // Separate synthetic browser clients without disabling the server's rate
  // limits. All fixture traffic goes to the owned local server; use RFC 3849 IPs.
  const address = current.id.replaceAll("-", "").slice(0, 24).match(/.{4}/gu)!.join(":");
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `2001:db8:${address}` });
  const local = shoppingListSchema.parse({ version: 2, items: [item(1), item(2)] });
  await mutateUserShoppingList(db, owner.id, {
    expectedRevision: 0,
    operation: { type: "save", item: item(1) },
  });
  await mutateUserShoppingList(db, current.id, {
    expectedRevision: 0,
    operation: { type: "save", item: item(99) },
  });
  await context.addCookies((await ctx.test.login({ userId: current.id })).cookies);
  let localOwnerId: string | null = owner.id;
  if (localOwner === "current") localOwnerId = current.id;
  if (localOwner === "unclaimed") localOwnerId = null;
  await page.addInitScript(
    ({ raw, userId }) => {
      if (sessionStorage.getItem("import-fixture-seeded")) return;
      localStorage.setItem("comprafino-shopping-list", raw);
      if (userId) localStorage.setItem("comprafino-shopping-list-import-owner", userId);
      else localStorage.removeItem("comprafino-shopping-list-import-owner");
      sessionStorage.setItem("import-fixture-seeded", "true");
    },
    { raw: JSON.stringify(local), userId: localOwnerId },
  );
  return {
    db,
    owner,
    current,
    local,
    login: async (id: string) => context.addCookies((await ctx.test.login({ userId: id })).cookies),
    dispose: async () => {
      try {
        await ctx.test.deleteUser(current.id);
        await ctx.test.deleteUser(owner.id);
      } finally {
        await closeLocalTestConnections();
      }
    },
  };
}

async function stored(page: Page) {
  return page.evaluate(() => ({
    raw: localStorage.getItem("comprafino-shopping-list"),
    owner: localStorage.getItem("comprafino-shopping-list-import-owner"),
  }));
}

test("11A downloads only the account list from the keyboard on mobile", async ({
  page,
  context,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 740 });
  const f = await fixture(context, page);
  try {
    await page.goto("/list");
    await expect(page.getByRole("article", { name: "Compra local 99", exact: true })).toBeVisible();
    const before = await readUserShoppingList(f.db, f.current.id);
    await page.getByRole("button", { name: "Cuenta de Cuenta Actual" }).press("Enter");
    const action = page.getByRole("menuitem", { name: "Descargar lista de cuenta", exact: true });
    await expect(action).toBeVisible();
    await action.focus();
    await expect(action).toBeFocused();
    const downloaded = page.waitForEvent("download");
    await action.press("Enter");
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe("comprafino-lista-cuenta.json");
    expect(JSON.parse(await readFile(await download.path(), "utf8"))).toEqual(before.list);
    expect(await stored(page)).toEqual({ raw: JSON.stringify(f.local), owner: f.owner.id });
    expect(await readUserShoppingList(f.db, f.current.id)).toEqual(before);
    expect((await readUserShoppingList(f.db, f.owner.id)).list.items).toEqual([item(1)]);
    await expect(page.getByText("Lista de cuenta descargada.", { exact: true })).toBeVisible();
    await expect(action).toBeEnabled();
    await page.screenshot({
      path: testInfo.outputPath("account-export-mobile.png"),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Cuenta de Cuenta Actual" })).toBeFocused();
  } finally {
    await f.dispose();
  }
});

test("11A distinguishes empty, expired and failed downloads and allows recovery", async ({
  page,
  context,
}) => {
  const f = await fixture(context, page);
  const downloads: string[] = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  try {
    await page.goto("/list");
    await expect(page.getByRole("article", { name: "Compra local 99", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cuenta de Cuenta Actual" }).click();
    const action = page.getByRole("menuitem", { name: "Descargar lista de cuenta", exact: true });
    for (const scenario of ["network", "empty", "expired"] as const) {
      await page.route("**/api/list/export", (route) => {
        if (scenario === "network") return route.abort("failed");
        if (scenario === "expired") {
          return route.fulfill({ status: 401, json: { error: "unauthenticated" } });
        }
        return route.fulfill({ json: { version: 2, items: [] } });
      });
      await action.click();
      let message = "No pudimos descargar tu lista. Intenta nuevamente.";
      if (scenario === "empty") {
        message = "Tu lista sincronizada está vacía. No se descargó ningún archivo.";
      }
      if (scenario === "expired") {
        message =
          "Tu sesión venció o fue cerrada. Inicia sesión nuevamente para descargar tu lista.";
      }
      await expect(page.getByText(message, { exact: true })).toBeVisible();
      await expect(action).toBeEnabled();
      expect(downloads).toEqual([]);
      await page.unroute("**/api/list/export");
    }
    const downloaded = page.waitForEvent("download");
    await action.click();
    await downloaded;
    expect(downloads).toEqual(["comprafino-lista-cuenta.json"]);
    expect((await readUserShoppingList(f.db, f.current.id)).list.items).toEqual([item(99)]);
  } finally {
    await f.dispose();
  }
});

test("11A rejects a delayed response after another account replaces the cookie", async ({
  page,
  context,
}) => {
  const f = await fixture(context, page);
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const downloads: string[] = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  try {
    await page.goto("/list");
    await expect(page.getByRole("article", { name: "Compra local 99", exact: true })).toBeVisible();
    await page.route("**/api/list/export", async (route) => {
      const response = await route.fetch();
      entered();
      await gate;
      await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "Cuenta de Cuenta Actual" }).click();
    await page.getByRole("menuitem", { name: "Descargar lista de cuenta", exact: true }).click();
    await waiting;
    await f.login(f.owner.id);
    release();
    await expect(
      page.getByText("La cuenta o sesión cambió. Vuelve a descargar desde tu cuenta actual.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(downloads).toEqual([]);
    expect((await readUserShoppingList(f.db, f.current.id)).list.items).toEqual([item(99)]);
  } finally {
    release();
    await f.dispose();
  }
});

test("11A cancels an in-flight download before logout completes", async ({ page, context }) => {
  const f = await fixture(context, page);
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const downloads: string[] = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  try {
    await page.goto("/list");
    await expect(page.getByRole("article", { name: "Compra local 99", exact: true })).toBeVisible();
    await page.route("**/api/list/export", async (route) => {
      const response = await route.fetch();
      entered();
      await gate;
      await route.fulfill({ response }).catch(() => {});
    });
    await page.getByRole("button", { name: "Cuenta de Cuenta Actual" }).click();
    await page.getByRole("menuitem", { name: "Descargar lista de cuenta", exact: true }).click();
    await waiting;
    await page.getByRole("menuitem", { name: "Cerrar sesión", exact: true }).click();
    await expect(page.getByRole("button", { name: "Iniciar sesión", exact: true })).toBeEnabled();
    release();
    expect(downloads).toEqual([]);
    expect((await readUserShoppingList(f.db, f.current.id)).list.items).toEqual([item(99)]);
  } finally {
    release();
    await f.dispose();
  }
});

test("07 recovery exports the anonymous copy, rejects another tab's edits and discards only after confirmation", async ({
  page,
  context,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 740 });
  const f = await fixture(context, page);
  let syncWrites = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/list/sync") && request.method() === "POST") syncWrites++;
  });
  try {
    await page.goto("/list");
    await expect(
      page.getByText(
        "La copia de este navegador está pendiente de importación en otra cuenta. Tu lista actual no se modificó.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByRole("article", { name: "Compra local 99", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reintentar sincronización" }).click();
    await expect(page.getByRole("button", { name: "Revisar copia local" })).toBeEnabled();
    expect(syncWrites).toBe(0);
    await page.getByRole("button", { name: "Revisar copia local" }).click();
    const dialog = page.getByRole("dialog", { name: "Recuperar la copia local" });
    await expect(dialog).toBeVisible();
    const downloaded = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Descargar copia local", exact: true }).click();
    const file = await downloaded;
    const path = await file.path();
    expect(path).not.toBeNull();
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(f.local);
    expect((await stored(page)).owner).toBe(f.owner.id);
    await expect(dialog.getByRole("button", { name: "Descartar copia local…" })).toBeEnabled();
    await dialog.getByRole("button", { name: "Descartar copia local…" }).click();
    const confirm = page.getByRole("alertdialog", { name: "¿Descartar la copia local?" });
    await expect(
      confirm.getByRole("button", { name: "Conservar copia", exact: true }),
    ).toBeFocused();
    await confirm.getByRole("button", { name: "Conservar copia", exact: true }).click();
    expect(JSON.parse((await stored(page)).raw!)).toEqual(f.local);

    const other = await context.newPage();
    await other.route("**/api/auth/get-session", (route) => route.fulfill({ json: null }));
    await other.goto("/list");
    await other.getByRole("button", { name: "Editar Compra local 1", exact: true }).click();
    await other.getByLabel("Cantidad", { exact: true }).fill("2");
    await other.getByRole("button", { name: "Guardar cambios", exact: true }).click();
    await expect(other.getByRole("dialog")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Descartar copia local…" }).click();
    await confirm.getByRole("button", { name: "Confirmar descarte local" }).click();
    await expect(confirm.getByRole("alert")).toContainText("cambió");
    expect(
      shoppingListSchema.parse(JSON.parse((await stored(page)).raw!)).items[0]?.quantity.amount,
    ).toBe(2);
    expect((await stored(page)).owner).toBe(f.owner.id);
    await page.screenshot({
      path: testInfo.outputPath("changed-copy-mobile.png"),
      animations: "disabled",
    });
    await other.close();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Revisar copia local" })).toBeFocused();
    await page.getByRole("button", { name: "Revisar copia local" }).click();
    await dialog.getByRole("button", { name: "Descartar copia local…" }).click();
    await confirm.getByRole("button", { name: "Confirmar descarte local" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    expect(await stored(page)).toEqual({ raw: null, owner: null });
    expect(syncWrites).toBe(0);
    expect((await readUserShoppingList(f.db, f.owner.id)).list.items).toEqual([item(1)]);
    expect((await readUserShoppingList(f.db, f.current.id)).list.items).toEqual([item(99)]);
  } finally {
    await f.dispose();
  }
});

test("07 recovery returns to the original account after partial import and resumes without duplicate items", async ({
  page,
  context,
}) => {
  const f = await fixture(context, page);
  try {
    await f.login(f.owner.id);
    let interrupted = false;
    await page.route("**/api/list/sync", (route) => {
      if (route.request().method() === "POST") interrupted = true;
      return interrupted
        ? route.fulfill({ status: 503, json: { error: "fixture" } })
        : route.continue();
    });
    await page.goto("/list");
    await expect(
      page.getByText("No pudimos confirmar si el cambio se guardó.", { exact: false }),
    ).toBeVisible();
    expect(JSON.parse((await stored(page)).raw!)).toEqual(f.local);
    await page.getByRole("button", { name: "Revisar copia local" }).click();
    const pendingCopy = page.getByRole("dialog", { name: "Recuperar la copia local" });
    await expect(pendingCopy.getByRole("button", { name: "Descargar copia local" })).toBeEnabled();
    await expect(
      pendingCopy.getByRole("button", { name: "Descartar copia local…" }),
    ).toBeDisabled();
    await pendingCopy.getByRole("button", { name: "Conservar copia y cerrar" }).click();
    await page.unroute("**/api/list/sync");
    await f.login(f.current.id);
    await page.reload();
    await page.getByRole("button", { name: "Revisar copia local" }).click();
    await page
      .getByRole("button", { name: "Cerrar sesión para volver a la cuenta original" })
      .click();
    await expect(page.getByRole("button", { name: "Iniciar sesión", exact: true })).toBeEnabled();
    expect((await stored(page)).owner).toBe(f.owner.id);
    await f.login(f.owner.id);
    await page.reload();
    await expect.poll(() => stored(page)).toEqual({ raw: null, owner: null });
    await expect(page.getByRole("article", { name: "Compra local 2", exact: true })).toBeVisible();
    expect((await readUserShoppingList(f.db, f.owner.id)).list.items).toEqual(f.local.items);
    expect((await readUserShoppingList(f.db, f.current.id)).list.items).toEqual([item(99)]);
  } finally {
    await f.dispose();
  }
});

for (const failure of ["access", "quota", "coordination"] as const) {
  test(`07 recovery distinguishes ${failure} and preserves a local copy`, async ({
    page,
    context,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 740 });
    await page.emulateMedia({ colorScheme: "dark" });
    const f = await fixture(context, page, "unclaimed");
    try {
      await page.addInitScript((mode) => {
        const get: unknown = Reflect.get(Storage.prototype, "getItem");
        const set: unknown = Reflect.get(Storage.prototype, "setItem");
        if (typeof get !== "function" || typeof set !== "function") {
          throw new Error("Missing browser storage methods");
        }
        const getDescriptor = Object.getOwnPropertyDescriptor(Storage.prototype, "getItem")!;
        const setDescriptor = Object.getOwnPropertyDescriptor(Storage.prototype, "setItem")!;
        if (mode === "coordination") {
          Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
        } else if (mode === "access") {
          Storage.prototype.getItem = function (key) {
            if (key.startsWith("comprafino-shopping-list")) {
              throw new DOMException("Blocked", "SecurityError");
            }
            const result: unknown = Reflect.apply(get, this, [key]);
            if (typeof result === "string" || result === null) return result;
            throw new Error("Unexpected browser storage value");
          };
        } else {
          Storage.prototype.setItem = function (key, value) {
            if (key === "comprafino-shopping-list-import-owner") {
              throw new DOMException("Full", "QuotaExceededError");
            }
            Reflect.apply(set, this, [key, value]);
          };
        }
        window.addEventListener(
          "restore-import-storage",
          () => {
            Object.defineProperty(Storage.prototype, "getItem", getDescriptor);
            Object.defineProperty(Storage.prototype, "setItem", setDescriptor);
            Reflect.deleteProperty(navigator, "locks");
          },
          { once: true },
        );
      }, failure);
      await page.goto("/list");
      const message =
        failure === "coordination"
          ? "Este navegador no permite coordinar"
          : "No podemos confirmar la copia local";
      await expect(page.getByText(message, { exact: false }).first()).toBeVisible();
      await expect(
        page.getByText("La copia de este navegador está pendiente de importación en otra cuenta.", {
          exact: false,
        }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Revisar copia local" }).click();
      if (failure === "access") {
        await expect(page.getByRole("dialog")).toHaveCount(0);
      } else {
        const dialog = page.getByRole("dialog", { name: "Recuperar la copia local" });
        await expect(dialog.getByRole("button", { name: "Descargar copia local" })).toBeEnabled();
        if (failure === "coordination") {
          await expect(
            dialog.getByRole("button", { name: "Descartar copia local…" }),
          ).toBeDisabled();
        }
      }
      await page.screenshot({
        path: testInfo.outputPath(`recovery-${failure}-390-dark.png`),
        animations: "disabled",
      });
      await page.evaluate(() => window.dispatchEvent(new Event("restore-import-storage")));
      expect(JSON.parse((await stored(page)).raw!)).toEqual(f.local);
      expect((await readUserShoppingList(f.db, f.current.id)).list.items).toEqual([item(99)]);
    } finally {
      await f.dispose();
    }
  });
}

test("07 recovery keeps the complete snapshot at capacity, retries partial progress and clears only after confirmation", async ({
  page,
  context,
}) => {
  const f = await fixture(context, page, "current");
  try {
    for (let index = 101; index < 150; index++) {
      await mutateUserShoppingList(f.db, f.current.id, {
        expectedRevision: index - 100,
        operation: { type: "save", item: item(index) },
      });
    }
    await page.goto("/list");
    await expect(
      page.getByText("No pudimos importar todas las necesidades.", { exact: false }),
    ).toBeVisible();
    expect(JSON.parse((await stored(page)).raw!)).toEqual(f.local);
    await mutateUserShoppingList(f.db, f.current.id, {
      expectedRevision: 50,
      operation: { type: "remove", id: item(149).id },
    });
    await page.getByRole("button", { name: "Reintentar sincronización" }).click();
    await expect(page.getByRole("button", { name: "Revisar copia local" })).toBeEnabled();
    await expect
      .poll(async () => (await readUserShoppingList(f.db, f.current.id)).revision)
      .toBe(52);
    expect(JSON.parse((await stored(page)).raw!)).toEqual(f.local);
    expect((await stored(page)).owner).toBe(f.current.id);
    await mutateUserShoppingList(f.db, f.current.id, {
      expectedRevision: 52,
      operation: { type: "remove", id: item(148).id },
    });
    await page.getByRole("button", { name: "Reintentar sincronización" }).click();
    await expect.poll(() => stored(page)).toEqual({ raw: null, owner: null });
    const remote = await readUserShoppingList(f.db, f.current.id);
    expect(remote.list.items).toHaveLength(50);
    expect(
      remote.list.items.filter((saved) => saved.id === item(1).id || saved.id === item(2).id),
    ).toHaveLength(2);
  } finally {
    await f.dispose();
  }
});
