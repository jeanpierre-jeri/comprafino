import { expect, test, type Page } from "@playwright/test";
import { shoppingListSchema } from "@comprafino/core";
import { createDatabase, persistListings } from "@comprafino/db";

async function openGeneric(page: Page, query = "huevos") {
  await page.goto(`/search?q=${query}`);
  await page.getByRole("button", { name: "Agregar como necesidad" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("radio")).toHaveCount(0);
  await expect(page.getByLabel("Búsqueda de productos")).toHaveCount(0);
  await expect(page.getByLabel("Nombre en tu lista")).toHaveCount(0);
}
async function addGeneric(page: Page) {
  await openGeneric(page);
  const quantity = page.getByLabel("Cantidad", { exact: true });
  await quantity.fill("30");
  expect(
    await quantity.evaluate((input) => input instanceof HTMLInputElement && input.validity.valid),
  ).toBe(true);
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Guardado en Mi lista.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Mi lista", exact: true }).click();
}

test("local generic need persists, edits, deduplicates and removes", async ({ page }) => {
  await addGeneric(page);
  const card = page.getByRole("article", { name: "huevos", exact: true });
  await expect(card).toContainText("30 unidades");
  await page.reload();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Editar huevos" }).click();
  await page.getByLabel("Cantidad", { exact: true }).fill("60");
  await page.getByLabel("Frecuencia", { exact: true }).selectOption("biweekly");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card).toContainText("60 unidades · Cada 2 semanas");
  await expect(
    page.getByRole("region", { name: "Cada 2 semanas", exact: true }).getByRole("article", {
      name: "huevos",
      exact: true,
    }),
  ).toBeVisible();
  await expect(card.getByRole("button", { name: "Editar huevos" })).toBeFocused();
  await card.getByRole("button", { name: "Editar huevos" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Editar huevos" })).toBeFocused();
  await openGeneric(page);
  await expect(page.getByRole("button", { name: "Actualizar existente" })).toBeVisible();
  await page.getByLabel("Cantidad", { exact: true }).fill("30");
  await page.getByRole("button", { name: "Actualizar existente" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Mi lista", exact: true }).click();
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("30 unidades");
  await card.getByRole("button", { name: "Quitar huevos" }).click();
  await expect(page.getByText("Todavía no tienes productos en tu lista.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Todavía no tienes productos en tu lista.")).toBeVisible();
});

test("quantity input supports whole units and fractional kg/L without a native step mismatch", async ({
  page,
}) => {
  await openGeneric(page);
  const quantity = page.getByLabel("Cantidad", { exact: true });
  const unit = page.getByLabel("Medida", { exact: true });
  await expect(unit).toHaveAccessibleName("Medida");
  await expect(page.getByLabel("Frecuencia", { exact: true })).toHaveAccessibleName("Frecuencia");
  for (const measure of ["kg", "L"]) {
    await unit.selectOption(measure);
    await quantity.fill("0.125");
    expect(
      await quantity.evaluate((input) => input instanceof HTMLInputElement && input.validity.valid),
    ).toBe(true);
  }
  await unit.selectOption("unit");
  await quantity.fill("1.5");
  expect(
    await quantity.evaluate(
      (input) => input instanceof HTMLInputElement && input.validity.stepMismatch,
    ),
  ).toBe(true);
  await quantity.fill("1");
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Mi lista", exact: true }).click();
  await expect(page.getByRole("article", { name: "huevos", exact: true })).toContainText(
    "1 unidades",
  );
});

test("malformed and unsupported storage recover; unavailable storage keeps session edits", async ({
  page,
}) => {
  for (const raw of ["{", '{"version":3,"items":[]}']) {
    await page.goto("/list");
    await page.evaluate((value) => localStorage.setItem("comprafino-shopping-list", value), raw);
    await page.reload();
    await expect(
      page.getByText("La lista guardada no es compatible. Puedes crear una nueva."),
    ).toBeVisible();
    await expect(page.getByText("Todavía no tienes productos en tu lista.")).toBeVisible();
  }
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage blocked");
      },
    });
  });
  await addGeneric(page);
  await expect(page.getByRole("article", { name: "huevos", exact: true })).toBeVisible();
  await expect(
    page.getByText("No podemos guardar en este navegador. Tu lista durará esta sesión."),
  ).toBeVisible();
});

test("dialogs animate, close with X/outside/Escape, and respect reduced motion", async ({
  page,
}) => {
  test.setTimeout(60_000);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      await page.emulateMedia({ reducedMotion });
      await openGeneric(page);
      const dialog = page.getByRole("dialog");
      const trigger = page.getByRole("button", { name: "Agregar como necesidad", exact: true });
      expect(await dialog.evaluate((element) => getComputedStyle(element).animationDuration)).toBe(
        reducedMotion === "reduce" ? "0s" : "0.18s",
      );
      await expect(page.getByLabel("Cantidad", { exact: true })).toBeFocused();
      await page.getByRole("button", { name: "Cerrar diálogo", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await trigger.click();
      await expect(dialog).toBeVisible();
      // A click inside the content must not dismiss it.
      await dialog.getByRole("heading").click();
      await expect(dialog).toBeVisible();
      const bounds = await dialog.boundingBox();
      if (!bounds) throw new Error("Missing dialog bounds");
      // Ending a content-origin drag on the backdrop must not discard edits.
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(2, 2);
      await page.mouse.up();
      await expect(dialog).toBeVisible();
      await page.mouse.click(2, 2);
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await trigger.click();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
  }
});

test("version-one local items retain all intents, custom labels and original amounts", async ({
  page,
}) => {
  await page.goto("/list");
  await page.evaluate(() => {
    const now = new Date().toISOString();
    localStorage.setItem(
      "comprafino-shopping-list",
      JSON.stringify({
        version: 1,
        items: ["generic", "preferred", "strict"].map((intent, index) => ({
          id: `00000000-0000-4000-8000-00000000000${index + 1}`,
          intent,
          canonicalId: intent === "generic" ? null : "00000000-0000-4000-8000-000000000004",
          label: `Mis huevos ${intent}`,
          query: "huevos",
          quantity: { amount: 30, unit: "unit" },
          frequency: "weekly",
          createdAt: now,
          updatedAt: now,
        })),
      }),
    );
  });
  await page.reload();
  for (const intent of ["generic", "preferred", "strict"]) {
    const card = page.getByRole("article", { name: `Mis huevos ${intent}`, exact: true });
    await expect(card).toContainText("30 unidades");
    await card.getByRole("button", { name: `Editar Mis huevos ${intent}`, exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("radio")).toHaveCount(
      intent === "generic" ? 0 : 2,
    );
    await page.getByRole("button", { name: "Guardar cambios" }).click();
  }
  const saved = shoppingListSchema.parse(
    JSON.parse(
      (await page.evaluate(() => localStorage.getItem("comprafino-shopping-list"))) ?? "null",
    ) as unknown,
  );
  expect(saved.version).toBe(2);
  expect(saved.items.map((item) => item.quantityMode)).toEqual([
    "normalized",
    "normalized",
    "normalized",
  ]);
  expect(saved.items.map((item) => item.label)).toEqual([
    "Mis huevos generic",
    "Mis huevos preferred",
    "Mis huevos strict",
  ]);
});

test("list updates across tabs and clears when storage is cleared", async ({ page, context }) => {
  await addGeneric(page);
  const other = await context.newPage();
  await other.goto("/list");
  await expect(other.getByRole("article", { name: "huevos", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Quitar huevos" }).click();
  await expect(other.getByText("Todavía no tienes productos en tu lista.")).toBeVisible();
  await addGeneric(page);
  await expect(other.getByRole("article", { name: "huevos", exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.clear());
  await expect(other.getByText("Todavía no tienes productos en tu lista.")).toBeVisible();
  await other.close();
});

test("keyboard dialog cancels and returns focus; list and editor fit both themes at 390px", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await openGeneric(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByLabel("Cantidad", { exact: true })).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath(`add-${width}-${theme}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Agregar como necesidad" })).toBeFocused();
    }
  }
  await addGeneric(page);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.getByRole("article", { name: "huevos", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath(`list-${width}-${theme}.png`) });
      await page.getByRole("button", { name: "Editar huevos" }).click();
      await expect(page.getByRole("dialog").getByRole("radio")).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`edit-generic-${width}-${theme}.png`) });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Editar huevos" })).toBeFocused();
    }
  }
});

const fixtureIds: unknown = JSON.parse(process.env.SHOPPING_LIST_FIXTURE_IDS ?? "{}");
function fixture(name: string): string {
  if (typeof fixtureIds !== "object" || fixtureIds === null || !(name in fixtureIds))
    throw new Error("Missing shopping fixture");
  const id: unknown = Reflect.get(fixtureIds, name);
  if (typeof id !== "string") throw new Error("Invalid shopping fixture");
  return id;
}
async function addSpecific(page: Page, intent: "preferred" | "strict") {
  await page.goto(`/products/${fixture("preferred")}`);
  await page.getByRole("button", { name: "Agregar a mi lista", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("radio")).toHaveCount(2);
  await expect(page.getByLabel("Búsqueda de productos")).toHaveCount(0);
  await expect(page.getByLabel("Nombre en tu lista")).toHaveCount(0);
  await expect(page.getByLabel("Medida", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Paquetes", { exact: true })).toHaveValue("1");
  await page
    .getByRole("radio", {
      name: intent === "preferred" ? "Prefiero este producto" : "Solo quiero este producto",
      exact: true,
    })
    .check();
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Mi lista", exact: true }).click();
}

test.describe("shopping market fixtures (isolated PostgreSQL)", () => {
  test.skip(
    !process.env.SHOPPING_LIST_FIXTURE_IDS,
    "Run pnpm test:e2e:list:local after a production build",
  );
  test.describe.configure({ mode: "serial" });
  test("card links preserve their destinations while add buttons never navigate", async ({
    page,
    context,
  }) => {
    await context.route("https://www.metro.pe/shopping-independent/p", (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>Retailer fixture</title>" }),
    );
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const linked of [true, false]) {
        await page.goto("/search?q=huevos");
        const card = linked
          ? page
              .getByRole("region", { name: "Opciones en supermercados", exact: true })
              .getByRole("article")
              .filter({ hasText: "Huevos Bell's Bandeja 30un" })
              .first()
          : page.locator(`[data-offer-id="${fixture("independent")}"]`);
        const add = card.getByRole("button", { name: "Agregar a mi lista", exact: true });
        await add.scrollIntoViewIfNeeded();
        expect(
          await add.evaluate((button) => {
            const bounds = button.getBoundingClientRect();
            return (
              document
                .elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
                ?.closest("button") === button
            );
          }),
        ).toBe(true);
        const url = page.url();
        const tabs = context.pages().length;
        await add.click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await expect(page).toHaveURL(url);
        expect(context.pages()).toHaveLength(tabs);
        await page.keyboard.press("Escape");
        await expect(add).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("dialog")).toBeVisible();
        await expect(page).toHaveURL(url);
        expect(context.pages()).toHaveLength(tabs);
        await page.keyboard.press("Escape");
        const title = card.locator(".product-title-link");
        // The stretched link intentionally covers noninteractive card content.
        // Use a real pointer click instead of forcing the underlying price node.
        await card.locator(".card-amount").scrollIntoViewIfNeeded();
        const background = await card.locator(".card-amount").boundingBox();
        if (!background) throw new Error("Missing card background target");
        const clickBackground = () =>
          page.mouse.click(
            background.x + background.width / 2,
            background.y + background.height / 2,
          );
        if (linked) {
          await expect(title).toHaveAttribute("href", `/products/${fixture("preferred")}`);
          await clickBackground();
          await expect(page).toHaveURL(new RegExp(`/products/${fixture("preferred")}$`));
        } else {
          await expect(title).toHaveAttribute(
            "href",
            "https://www.metro.pe/shopping-independent/p",
          );
          const popupPromise = page.waitForEvent("popup");
          await clickBackground();
          const popup = await popupPromise;
          await expect(popup).toHaveURL("https://www.metro.pe/shopping-independent/p");
          await popup.close();
        }
      }
    }
  });
  test("canonicalized retailer-option card offers preferred/strict package saving", async ({
    page,
  }) => {
    await page.goto("/search?q=huevos");
    const card = page
      .getByRole("region", { name: "Opciones en supermercados", exact: true })
      .getByRole("article")
      .filter({ hasText: "Huevos Bell's Bandeja 30un" })
      .first();
    await card.getByRole("button", { name: "Agregar a mi lista", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Huevos Bell's Bandeja 30un");
    await expect(page.getByRole("dialog").getByRole("radio")).toHaveCount(2);
    await page.getByRole("radio", { name: "Solo quiero este producto", exact: true }).check();
    await expect(page.getByLabel("Paquetes", { exact: true })).toHaveValue("1");
    await page.getByRole("button", { name: "Agregar", exact: true }).click();
    const saved = shoppingListSchema.parse(
      JSON.parse(
        (await page.evaluate(() => localStorage.getItem("comprafino-shopping-list"))) ?? "null",
      ) as unknown,
    );
    expect(saved.items[0]).toMatchObject({
      canonicalId: fixture("preferred"),
      intent: "strict",
      quantityMode: "packages",
    });
  });
  test("unmatched retailer-option card saves a supported generic need without strict identity", async ({
    page,
  }) => {
    await page.goto("/search?q=huevos");
    const card = page.locator(`[data-offer-id="${fixture("independent")}"]`);
    await expect(card.getByRole("link", { name: /Comparar este producto/ })).toHaveCount(0);
    const add = card.getByRole("button", { name: "Agregar a mi lista", exact: true });
    await add.click();
    await expect(page.getByRole("dialog").getByRole("radio")).toHaveCount(0);
    await expect(
      page.getByRole("radio", { name: "Solo quiero este producto", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("dialog")).toContainText("Compararemos opciones equivalentes");
    await expect(page.getByLabel("Cantidad", { exact: true })).toHaveValue("30");
    await page.keyboard.press("Escape");
    await expect(add).toBeFocused();
    await add.click();
    await page.getByRole("button", { name: "Agregar", exact: true }).click();
    const saved = shoppingListSchema.parse(
      JSON.parse(
        (await page.evaluate(() => localStorage.getItem("comprafino-shopping-list"))) ?? "null",
      ) as unknown,
    );
    expect(saved.items[0]).toMatchObject({
      canonicalId: null,
      intent: "generic",
      label: "Huevos",
      substitutionProfile: "eggs:regular",
      quantityMode: "normalized",
      quantity: { amount: 30, unit: "unit" },
    });
    await page.getByRole("link", { name: "Mi lista", exact: true }).click();
    await expect(page.getByRole("article").first()).toContainText("Huevos Tottus");
    await expect(page.getByRole("article").first()).not.toContainText("Codorniz");
  });
  test("unsupported independent retailer-option card retains its description and withholds alternatives", async ({
    page,
  }) => {
    await page.goto("/search?q=huevos");
    const card = page.locator(`[data-offer-id="${fixture("unsupported")}"]`);
    await card.getByRole("button", { name: "Agregar a mi lista", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("radio")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toContainText(
      "No encontramos alternativas suficientemente comparables",
    );
    await page.getByRole("button", { name: "Agregar", exact: true }).click();
    const saved = shoppingListSchema.parse(
      JSON.parse(
        (await page.evaluate(() => localStorage.getItem("comprafino-shopping-list"))) ?? "null",
      ) as unknown,
    );
    expect(saved.items[0]).toMatchObject({
      canonicalId: null,
      intent: "generic",
      label: "Huevos de Codorniz Independientes Bandeja 30un",
      substitutionProfile: null,
    });
    await page.getByRole("link", { name: "Mi lista", exact: true }).click();
    await expect(page.getByRole("article").first()).toContainText(
      "No encontramos alternativas suficientemente comparables",
    );
  });
  test("preferred product exposes a cheaper compatible option and preserves its identity", async ({
    page,
  }) => {
    await addSpecific(page, "preferred");
    const card = page.getByRole("article").first();
    await expect(card).toContainText("Tu producto preferido");
    await expect(card).toContainText("Ahorra S/ 3.00");
    await expect(card).toContainText("Huevos Tottus");
    const saved = shoppingListSchema.parse(
      JSON.parse(
        (await page.evaluate(() => localStorage.getItem("comprafino-shopping-list"))) ?? "null",
      ) as unknown,
    );
    expect(saved.items[0]).toMatchObject({
      canonicalId: fixture("preferred"),
      quantityMode: "packages",
      quantity: { amount: 1, unit: "unit" },
    });
  });
  test("strict product has retailer offers and history links without substitutes", async ({
    page,
  }) => {
    await addSpecific(page, "strict");
    const card = page.getByRole("article").first();
    await expect(card).toContainText("S/ 17.90");
    await expect(card).not.toContainText("Huevos Tottus");
    await expect(card.getByRole("link", { name: "Comparar e historial" }).first()).toHaveAttribute(
      "href",
      `/products/${fixture("preferred")}`,
    );
    await card.getByText("Otras tiendas del mismo producto").click();
    await expect(card).toContainText("Plaza Vea");
  });
  test("generic need selects a supported CMR benefit only after changing price mode", async ({
    page,
  }) => {
    await addGeneric(page);
    const card = page.getByRole("article").first();
    await expect(card).toContainText("Huevos Tottus");
    await expect(card).toContainText("S/ 14.90");
    await page.getByLabel("Precios", { exact: true }).selectOption("benefits");
    await expect(card).toContainText("Huevos Bell's");
    await expect(card).toContainText("S/ 12.90");
    await expect(card).toContainText("Requiere tarjeta CMR");
    await expect(card).toContainText("Para todos: S/ 19.90");
  });
  test("generic winner changes after fresh fixture price observations", async ({ page }) => {
    await addGeneric(page);
    const card = page.getByRole("article").first();
    await expect(card).toContainText("S/ 14.90");
    const db = createDatabase();
    async function observe(increased: boolean) {
      for (const [index, retailer] of (["metro", "plaza-vea", "tottus"] as const).entries())
        await persistListings(db, retailer, [
          {
            retailer,
            externalId: `shopping-alternative-${retailer}`,
            productId: `shopping-alternative-${retailer}`,
            title: "Huevos Tottus Bandeja 30un",
            sourceBrand: "Tottus",
            url:
              retailer === "tottus"
                ? "https://www.tottus.com.pe/tottus-pe/articulo/1/test"
                : retailer === "metro"
                  ? "https://www.metro.pe/eggs/p"
                  : "https://www.plazavea.com.pe/eggs/p",
            currentPriceCents: increased ? 2090 : retailer === "tottus" ? 1490 : 1590 + index * 100,
            currency: "PEN",
            priceUnit: "UN",
            observedAt: new Date(),
          },
        ]);
    }
    try {
      await observe(true);
      await page.reload();
      await expect(card).toContainText("Huevos Bell's");
      await expect(card).toContainText("S/ 17.90");
    } finally {
      await observe(false);
    }
  });
  test("specific creation and editing fit desktop/mobile in both themes", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        for (const intent of ["preferred", "strict"] as const) {
          await page.goto("/list");
          await page.evaluate(() => localStorage.removeItem("comprafino-shopping-list"));
          await page.goto(`/products/${fixture("preferred")}`);
          await page.getByRole("button", { name: "Agregar a mi lista", exact: true }).click();
          await page
            .getByRole("radio", {
              name: intent === "preferred" ? "Prefiero este producto" : "Solo quiero este producto",
              exact: true,
            })
            .check();
          await page.screenshot({
            path: testInfo.outputPath(`create-${intent}-${width}-${theme}.png`),
          });
          await page.getByRole("button", { name: "Agregar", exact: true }).click();
          await page.getByRole("link", { name: "Mi lista", exact: true }).click();
          const edit = page
            .getByRole("article")
            .first()
            .getByRole("button", { name: /^Editar/ });
          await edit.click();
          await expect(page.getByLabel("Paquetes", { exact: true })).toHaveValue("1");
          await expect(page.getByRole("dialog").getByRole("radio")).toHaveCount(2);
          await page.screenshot({
            path: testInfo.outputPath(`edit-${intent}-${width}-${theme}.png`),
          });
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          await page.keyboard.press("Escape");
          await expect(edit).toBeFocused();
        }
      }
    }
  });
  test("specific edits use package counts and retain preferred/strict choices", async ({
    page,
  }) => {
    await addSpecific(page, "preferred");
    const card = page.getByRole("article").first();
    await expect(card).toContainText("1 paquete · Cada semana");
    await card.getByRole("button", { name: /^Editar/ }).click();
    await page.getByLabel("Paquetes", { exact: true }).fill("2");
    await page.getByRole("radio", { name: "Solo quiero este producto", exact: true }).check();
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(card).toContainText("2 paquetes · Cada semana");
    await expect(card).toContainText("Producto exacto");
    await expect(card).toContainText("S/ 35.80");
    const saved = shoppingListSchema.parse(
      JSON.parse(
        (await page.evaluate(() => localStorage.getItem("comprafino-shopping-list"))) ?? "null",
      ) as unknown,
    );
    expect(saved.items[0]).toMatchObject({
      intent: "strict",
      quantityMode: "packages",
      quantity: { amount: 2, unit: "unit" },
    });
  });
});
