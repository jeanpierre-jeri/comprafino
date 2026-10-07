import { fixtureDatabase } from "../../../packages/db/src/testing/fixture-client.ts";
import { closeLocalTestConnections } from "../../../packages/db/src/testing/test-query-client.ts";
import { expect, test, type Page } from "@playwright/test";
import { shoppingListSchema } from "@comprafino/core";
import { restrictBasketFixtureRetailers } from "@comprafino/db/basket-fixtures";
import { persistListings } from "@comprafino/db";

// Catalog-mutation scenarios share the same isolated PostgreSQL fixture schema.
test.describe.configure({ mode: "serial" });

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
  const card = page.getByRole("article", { name: "Huevos", exact: true });
  await expect(card).toContainText("30 unidades");
  await page.reload();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Editar Huevos" }).click();
  await page.getByLabel("Cantidad", { exact: true }).fill("60");
  await page.getByLabel("Frecuencia", { exact: true }).selectOption("biweekly");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card).toContainText("60 unidades · Cada 2 semanas");
  await expect(
    page.getByRole("region", { name: "Cada 2 semanas", exact: true }).getByRole("article", {
      name: "Huevos",
      exact: true,
    }),
  ).toBeVisible();
  await expect(card.getByRole("button", { name: "Editar Huevos" })).toBeFocused();
  await card.getByRole("button", { name: "Editar Huevos" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Editar Huevos" })).toBeFocused();
  await openGeneric(page);
  await expect(page.getByRole("button", { name: "Actualizar existente" })).toBeVisible();
  await page.getByLabel("Cantidad", { exact: true }).fill("30");
  await page.getByRole("button", { name: "Actualizar existente" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Mi lista", exact: true }).click();
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("30 unidades");
  await card.getByRole("button", { name: "Quitar Huevos" }).click();
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
  await expect(page.getByRole("article", { name: "Huevos", exact: true })).toContainText(
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
  await expect(page.getByRole("article", { name: "Huevos", exact: true })).toBeVisible();
  await expect(
    page.getByText("No podemos guardar en este navegador. Tu lista durará esta sesión."),
  ).toBeVisible();
});

for (const operation of ["add", "edit", "remove"] as const) {
  test(`a transient storage read failure preserves the mounted session during ${operation}`, async ({
    page,
  }) => {
    await addGeneric(page);
    const eggs = page.getByRole("article", { name: "Huevos", exact: true });
    // Seed a second independent need while storage is still working.
    await openGeneric(page, "arroz");
    await page.getByRole("button", { name: "Agregar", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("link", { name: "Mi lista", exact: true }).click();
    const rice = page.getByRole("article", { name: "Arroz blanco", exact: true });
    await expect(eggs).toBeVisible();
    await expect(rice).toBeVisible();

    // In controlled runs load the old basket first so removal cannot race past
    // this regression. Credential-free storage smoke still needs no catalog.
    if (process.env.SHOPPING_LIST_FIXTURE_IDS) {
      await expect(
        page.getByRole("region", { name: "Comparación de canastas", exact: true }),
      ).toBeVisible();
    }

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    // Reads fail only after mount; writes still work so the read warning must survive.
    await page.evaluate(() => {
      Storage.prototype.getItem = () => {
        throw new Error("Transient read failure");
      };
    });

    if (operation === "add") {
      // Use client links: a full page.goto would reload and remove the failing
      // Storage prototype, so it would not exercise the mounted-session bug.
      await page.getByRole("link", { name: "CompraFino, inicio", exact: true }).click();
      await page.getByRole("link", { name: "Aceite", exact: true }).click();
      await page.getByRole("button", { name: "Agregar como necesidad" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(
        await page.evaluate(() => {
          try {
            localStorage.getItem("comprafino-shopping-list");

            return false;
          } catch {
            return true;
          }
        }),
      ).toBe(true);
      await page.getByRole("button", { name: "Agregar", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.getByRole("link", { name: "Mi lista", exact: true }).click();
      await expect(
        page.getByRole("article", { name: "Aceite vegetal", exact: true }),
      ).toBeVisible();
    } else if (operation === "edit") {
      await eggs.getByRole("button", { name: "Editar Huevos" }).click();
      await page.getByLabel("Cantidad", { exact: true }).fill("60");
      await page.getByRole("button", { name: "Guardar cambios" }).click();
      await expect(eggs).toContainText("60 unidades");
    } else {
      await eggs.getByRole("button", { name: "Quitar Huevos" }).click();
      await expect(eggs).toHaveCount(0);
    }

    await expect(rice).toBeVisible();

    if (operation !== "remove") {
      await expect(eggs).toBeVisible();
    }

    await expect(
      page.getByText("No podemos guardar en este navegador. Tu lista durará esta sesión."),
    ).toBeVisible();
    // Client navigation must also retain the latest session fallback.
    await page.getByRole("link", { name: "CompraFino, inicio", exact: true }).click();
    await page.getByRole("link", { name: "Mi lista", exact: true }).click();
    await expect(rice).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
}

test("working cross-tab storage synchronizes additions, edits and removal", async ({
  page,
  context,
}) => {
  await addGeneric(page);
  const other = await context.newPage();
  await other.goto("/list");
  const eggs = other.getByRole("article", { name: "Huevos", exact: true });
  await expect(eggs).toBeVisible();
  await page.getByRole("button", { name: "Editar Huevos" }).click();
  await page.getByLabel("Cantidad", { exact: true }).fill("60");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(eggs).toContainText("60 unidades");
  await openGeneric(other, "arroz");
  await other.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(other.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Arroz blanco", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Quitar Huevos" }).click();
  await other.getByRole("link", { name: "Mi lista", exact: true }).click();
  await expect(eggs).toHaveCount(0);
  await expect(other.getByRole("article", { name: "Arroz blanco", exact: true })).toBeVisible();
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

      if (!bounds) {
        throw new Error("Missing dialog bounds");
      }

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
  await expect(other.getByRole("article", { name: "Huevos", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Quitar Huevos" }).click();
  await expect(other.getByText("Todavía no tienes productos en tu lista.")).toBeVisible();
  await addGeneric(page);
  await expect(other.getByRole("article", { name: "Huevos", exact: true })).toBeVisible();
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
      await expect(page.getByRole("article", { name: "Huevos", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath(`list-${width}-${theme}.png`) });
      await page.getByRole("button", { name: "Editar Huevos" }).click();
      await expect(page.getByRole("dialog").getByRole("radio")).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`edit-generic-${width}-${theme}.png`) });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Editar Huevos" })).toBeFocused();
    }
  }
});

const fixtureIds: unknown = JSON.parse(process.env.SHOPPING_LIST_FIXTURE_IDS ?? "{}");

function fixture(name: string): string {
  if (typeof fixtureIds !== "object" || fixtureIds === null || !(name in fixtureIds)) {
    throw new Error("Missing shopping fixture");
  }

  const id: unknown = Reflect.get(fixtureIds, name);

  if (typeof id !== "string") {
    throw new Error("Invalid shopping fixture");
  }

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
        // Exit animation keeps the native dialog in the top layer until close.
        // Wait for dismissal/focus return before clicking through to the card.
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(add).toBeFocused();
        const title = card.locator(".product-title-link");
        // The stretched link intentionally covers noninteractive card content.
        // Use a real pointer click instead of forcing the underlying price node.
        await card.locator(".card-amount").scrollIntoViewIfNeeded();
        const background = await card.locator(".card-amount").boundingBox();

        if (!background) {
          throw new Error("Missing card background target");
        }

        const clickBackground = () =>
          page.mouse.click(
            background.x + background.width / 2,
            background.y + background.height / 2,
          );
        const href = await title.getAttribute("href");
        expect(href).toMatch(/^\/listings\/[0-9a-f-]{36}$/u);
        await clickBackground();
        await expect(page).toHaveURL(new RegExp(`${href}$`));
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
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
    await expect(
      page
        .getByRole("region", { name: /Cada semana|Cada 2 semanas|Cada mes/ })
        .getByRole("article")
        .first(),
    ).toContainText("Huevos Tottus");
    await expect(
      page
        .getByRole("region", { name: /Cada semana|Cada 2 semanas|Cada mes/ })
        .getByRole("article")
        .first(),
    ).not.toContainText("Codorniz");
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
    await expect(
      page
        .getByRole("region", { name: /Cada semana|Cada 2 semanas|Cada mes/ })
        .getByRole("article")
        .first(),
    ).toContainText("No encontramos alternativas suficientemente comparables");
  });
  test("preferred product exposes a cheaper compatible option and preserves its identity", async ({
    page,
  }, testInfo) => {
    await addSpecific(page, "preferred");
    const card = page
      .getByRole("region", { name: /Cada semana|Cada 2 semanas|Cada mes/ })
      .getByRole("article")
      .first();
    await expect(card).toContainText("Tu producto preferido");
    await expect(card).toContainText("Ahorra S/ 3.00");
    const notice = page.getByRole("region", { name: "Hay una oportunidad de ahorro hoy" });
    await expect(notice).toContainText("S/ 3.00 menos en Tottus");
    await notice.getByRole("link").click();
    await expect(card).toBeFocused();
    await expect(card.getByRole("note", { name: "Una alternativa más barata hoy" })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`savings-390-${theme}.png`),
        fullPage: true,
      });
    }
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
    const card = page
      .getByRole("region", { name: /Cada semana|Cada 2 semanas|Cada mes/ })
      .getByRole("article")
      .first();
    await expect(card).toContainText("S/ 17.90");
    await card.getByText("Ver producto y precio", { exact: true }).click();
    await expect(
      card.getByRole("note", { name: "El mismo producto, más barato en otra tienda" }),
    ).toContainText("Ahorra S/ 1.00");
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
    const card = page
      .getByRole("region", { name: /Cada semana|Cada 2 semanas|Cada mes/ })
      .getByRole("article")
      .first();
    await expect(card).toContainText("Huevos Tottus");
    await expect(card).toContainText("S/ 14.90");
    const prices = page.getByRole("combobox", { name: "Precios", exact: true });
    await prices.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("option", { name: "Incluir beneficios", exact: true }).click();
    await expect(prices).toContainText("Incluir beneficios");
    await expect(prices).toBeFocused();
    await expect(card).toContainText("Huevos Bell's");
    await expect(card).toContainText("S/ 12.90");
    await expect(card).toContainText("Requiere tarjeta CMR");
    await expect(
      page.getByRole("region", { name: "Hay una oportunidad de ahorro hoy" }),
    ).toContainText("Requiere tarjeta CMR");
    await expect(card).toContainText("Para todos: S/ 19.90");
    await prices.click();
    await page.getByRole("option", { name: "Para todos", exact: true }).click();
    await expect(card).toContainText("Huevos Tottus");
    await expect(card).toContainText("S/ 14.90");
  });
  test("savings notices disappear on refresh failure and return after a successful retry", async ({
    page,
  }) => {
    await addSpecific(page, "preferred");
    const summary = page.getByRole("region", { name: "Hay una oportunidad de ahorro hoy" });
    await expect(summary).toBeVisible();
    await page.route("**/api/list/evaluate*", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Unavailable" }),
      }),
    );
    await page.reload();
    await expect(
      page.getByText("No pudimos cargar los precios. Intenta nuevamente.", { exact: true }),
    ).toBeVisible();
    await expect(summary).toHaveCount(0);
    await expect(page.getByRole("note", { name: /más barata/ })).toHaveCount(0);
    await page.unroute("**/api/list/evaluate*");
    await page.getByRole("button", { name: "Reintentar", exact: true }).click();
    await expect(summary).toBeVisible();
  });
  test("generic winner changes after fresh fixture price observations", async ({ page }) => {
    await addGeneric(page);
    const card = page
      .getByRole("region", { name: /Cada semana|Cada 2 semanas|Cada mes/ })
      .getByRole("article")
      .first();
    await expect(card).toContainText("S/ 14.90");
    const db = fixtureDatabase();

    async function observe(increased: boolean) {
      for (const [index, retailer] of (["metro", "plaza-vea", "tottus"] as const).entries()) {
        await persistListings(db, retailer, [
          {
            retailer,
            externalId: `shopping-alternative-${retailer}`,
            productId: `shopping-alternative-${retailer}`,
            title: "Huevos Tottus Bandeja 30un",
            sourceBrand: "Tottus",
            url: {
              tottus: "https://www.tottus.com.pe/tottus-pe/articulo/1/test",
              metro: "https://www.metro.pe/eggs/p",
              "plaza-vea": "https://www.plazavea.com.pe/eggs/p",
            }[retailer],
            currentPriceCents: eggFixturePrice(increased, retailer, index),
            currency: "PEN",
            priceUnit: "UN",
            observedAt: new Date(),
          },
        ]);
      }
    }

    try {
      await observe(true);
      await page.reload();
      await expect(card).toContainText("Huevos Bell's");
      await expect(card).toContainText("S/ 17.90");
    } finally {
      try {
        await observe(false);
      } finally {
        await closeLocalTestConnections();
      }
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
            .getByRole("region", { name: /Cada semana|Cada 2 semanas|Cada mes/ })
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
    const card = page
      .getByRole("region", { name: /Cada semana|Cada 2 semanas|Cada mes/ })
      .getByRole("article")
      .first();
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

async function storeBasket(page: Page, count: number, unsupported = false) {
  await page.goto("/list");
  const now = new Date().toISOString();
  const items = Array.from({ length: count }, (_, i) => ({
    id: crypto.randomUUID(),
    intent: "strict",
    canonicalId: fixture(`basket-${i}`),
    label: `Leche para canasta ${i + 1}`,
    query: "leche",
    quantityMode: "packages",
    quantity: { amount: 1, unit: "unit" },
    frequency: "weekly",
    createdAt: now,
    updatedAt: now,
  }));
  const list = shoppingListSchema.parse({
    version: 2,
    items: unsupported
      ? [
          ...items,
          {
            id: crypto.randomUUID(),
            intent: "generic",
            canonicalId: null,
            label: "Leche sin perfil",
            query: "leche",
            quantityMode: "normalized",
            substitutionProfile: null,
            quantity: { amount: 6, unit: "unit" },
            frequency: "weekly",
            createdAt: now,
            updatedAt: now,
          },
        ]
      : items,
  });
  await page.evaluate(
    (value) => localStorage.setItem("comprafino-shopping-list", JSON.stringify(value)),
    list,
  );
  await page.reload();
  await expect(page.getByRole("region", { name: "Comparación de canastas" })).toBeVisible();
  await page.getByRole("button", { name: "Comparar supermercados", exact: true }).click();
}

test.describe("current basket optimization fixtures", () => {
  test.skip(
    !process.env.SHOPPING_LIST_FIXTURE_IDS,
    "Run pnpm test:e2e:list:local for isolated catalog fixtures",
  );
  test.describe.configure({ mode: "serial" });
  test("one product starts compact and reveals details by keyboard on mobile and desktop", async ({
    page,
  }, testInfo) => {
    await addGeneric(page);
    const comparison = page.getByRole("region", { name: "Comparación de canastas" });
    const card = page.getByRole("article", { name: "Huevos", exact: true });
    await expect(comparison).toBeVisible();
    await expect(card).toContainText("S/ 14.90");
    await expect(
      comparison.getByRole("button", { name: "Comparar supermercados", exact: true }),
    ).toHaveAttribute("aria-haspopup", "dialog");
    await expect(
      comparison.getByRole("button", { name: "Ver compras por supermercado", exact: true }),
    ).toHaveAttribute("aria-haspopup", "dialog");
    await expect(card.locator("details[open]")).toHaveCount(0);
    await expect(page.getByRole("article", { name: "Límite 1", exact: true })).toHaveCount(0);
    await expect(card.getByRole("link", { name: /Ver en Tottus/ })).toHaveCount(0);

    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const bounds = await card.boundingBox();
        expect(bounds?.height).toBeLessThan(360);
        await page.screenshot({
          path: testInfo.outputPath(`compact-list-${width}-${theme}.png`),
          fullPage: true,
          animations: "disabled",
        });
      }
    }

    const productDetails = card.getByText("Ver producto y precio", { exact: true });
    await productDetails.focus();
    await page.keyboard.press("Enter");
    await expect(card.getByRole("link", { name: /Ver en Tottus/ })).toBeVisible();
    await expect(card).toContainText("30 unidades en total");
    await page.getByText("Comparar supermercados", { exact: true }).click();
    await expect(page.getByRole("article", { name: "Límite 1", exact: true })).toBeVisible();
    await page.getByRole("article", { name: "Límite 2", exact: true }).getByRole("button").click();
    await expect(page.getByRole("region", { name: "Compras del plan seleccionado" })).toBeVisible();
  });
  test("basket dialogs animate without moving the list and restore keyboard focus", async ({
    page,
  }, testInfo) => {
    await addGeneric(page);
    const card = page.locator('article[id^="shopping-item-"]').first();
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme, reducedMotion: "no-preference" });
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        for (const view of [
          {
            trigger: "Comparar supermercados",
            title: "Comparar supermercados",
            name: "comparison",
          },
          {
            trigger: "Ver compras por supermercado",
            title: "Compras por supermercado",
            name: "purchases",
          },
        ]) {
          const trigger = page.getByRole("button", { name: view.trigger, exact: true });
          await trigger.scrollIntoViewIfNeeded();
          const before = await card.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return { x: bounds.x + scrollX, y: bounds.y + scrollY, width: bounds.width };
          });
          await trigger.focus();
          await page.keyboard.press("Enter");
          const dialog = page.getByRole("dialog", { name: view.title, exact: true });
          await expect(dialog).toBeVisible();
          await expect(dialog).not.toHaveCSS("animation-name", "none");
          const after = await card.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return { x: bounds.x + scrollX, y: bounds.y + scrollY, width: bounds.width };
          });
          expect(after).toEqual(before);
          expect(
            await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
          ).toBe(true);
          await page.screenshot({
            path: testInfo.outputPath(`basket-dialog-${view.name}-${width}-${theme}.png`),
            animations: "disabled",
          });
          await page.keyboard.press("Escape");
          await expect(dialog).toBeHidden();
          await expect(trigger).toBeFocused();
        }
      }
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Comparar supermercados", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Comparar supermercados", exact: true });
    await expect(dialog).toHaveCSS("animation-duration", "0s");
    await dialog.getByRole("button", { name: "Cerrar diálogo", exact: true }).click();
    await expect(dialog).toBeHidden();
  });
  test("shows every limit, defaults to one store, groups purchases and refreshes after editing", async ({
    page,
  }) => {
    await storeBasket(page, 3);
    const first = page.getByRole("article", { name: "Límite 1", exact: true });
    const second = page.getByRole("article", { name: "Límite 2", exact: true });
    const third = page.getByRole("article", { name: "Límite 3", exact: true });
    await expect(first).toContainText("S/ 60.00");
    await expect(first.getByRole("button")).toHaveAttribute("aria-pressed", "true");
    await expect(second).toContainText("S/ 45.00");
    await expect(second).toContainText("S/ 15.00 menos");
    await expect(third).toContainText("S/ 30.00");
    await third.getByRole("button").click();
    const details = page.getByRole("region", { name: "Compras del plan seleccionado" });
    await expect(details.getByRole("heading", { level: 4 })).toHaveCount(3);
    await expect(details).toContainText("1 paquete");
    await expect(details).toContainText("Disponibilidad no confirmada.");
    await page.keyboard.press("Escape");
    const card = page.getByRole("article", { name: "Leche para canasta 1", exact: true });
    await card.getByRole("button", { name: "Editar Leche para canasta 1" }).click();
    await page.getByLabel("Paquetes", { exact: true }).fill("2");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await page.getByRole("button", { name: "Comparar supermercados", exact: true }).click();
    await expect(first).toContainText("S/ 70.00");
    await expect(third.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });
  test("a higher maximum retains the actual one-store count and zero-saving explanation", async ({
    page,
  }) => {
    await storeBasket(page, 1);

    for (const limit of [1, 2, 3]) {
      const card = page.getByRole("article", { name: `Límite ${limit}`, exact: true });
      await expect(card.getByRole("heading")).toHaveText("1 supermercado");
      await expect(card).toContainText("Metro");
      await expect(card).toContainText("S/ 10.00");

      if (limit > 1) {
        await expect(card).toContainText("No ahorras más al añadir otra tienda.");
      }
    }
  });
  test("selects the first complete higher tier when a single store cannot fulfill the list", async ({
    page,
  }) => {
    await restrictBasketFixtureRetailers(true);

    try {
      await storeBasket(page, 2);
      const first = page.getByRole("article", { name: "Límite 1", exact: true });
      const second = page.getByRole("article", { name: "Límite 2", exact: true });
      await expect(first).toContainText("1 de 2 productos");
      await expect(first).toContainText("Subtotal de productos disponibles: S/ 10.00");
      await expect(second.getByRole("button")).toHaveAttribute("aria-pressed", "true");
      await expect(second).toContainText("Este límite permite completar la canasta.");
      await expect(second).not.toContainText("menos que");
      await storeBasket(page, 3);
      await expect(
        page.getByRole("article", { name: "Límite 3", exact: true }).getByRole("button"),
      ).toHaveAttribute("aria-pressed", "true");
    } finally {
      await restrictBasketFixtureRetailers(false);
    }
  });
  test("partial plans prominently show coverage, subtotal and missing needs without savings", async ({
    page,
  }) => {
    await restrictBasketFixtureRetailers(true);

    try {
      await storeBasket(page, 3, true);

      for (const limit of [1, 2, 3]) {
        const card = page.getByRole("article", { name: `Límite ${limit}`, exact: true });
        await expect(card).toContainText(`${limit} de 4 productos`);
        await expect(card).toContainText("Subtotal de productos disponibles:");
        await expect(card).toContainText("Faltan:");
        await expect(card).toContainText("Leche sin perfil");
        await expect(card).not.toContainText("menos que");
        await expect(card).not.toContainText("ahorras");
      }

      await expect(
        page.getByRole("article", { name: "Límite 3", exact: true }).getByRole("button"),
      ).toHaveAttribute("aria-pressed", "true");
      await page
        .getByRole("article", { name: "Límite 3", exact: true })
        .getByRole("button")
        .click();
      await expect(
        page.getByRole("region", { name: "Compras del plan seleccionado" }),
      ).toContainText("3 de 4 productos");
    } finally {
      await restrictBasketFixtureRetailers(false);
    }
  });
  test("shows benefit conditions, preferred substitutions, retry and mobile/desktop layouts", async ({
    page,
  }) => {
    await addSpecific(page, "preferred");
    const comparison = page.getByRole("region", { name: "Comparación de canastas" });
    await page.getByText("Ver compras por supermercado", { exact: true }).click();
    await expect(page.getByRole("region", { name: "Compras del plan seleccionado" })).toContainText(
      "Alternativa compatible a tu producto preferido",
    );
    await page.keyboard.press("Escape");
    await page.getByRole("combobox", { name: "Precios", exact: true }).click();
    await page.getByRole("option", { name: "Incluir beneficios", exact: true }).click();
    await expect(comparison).toContainText("Requiere tarjeta CMR");
    await expect(comparison).toContainText("Para todos, esta selección");

    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });

      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await page.screenshot({
          path: `test-results/basket-${width}-${theme}.png`,
          fullPage: true,
        });
      }
    }

    await page.route(
      "**/api/list/evaluate?*",
      (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "test failure" }),
        }),
      { times: 1 },
    );
    await page.reload();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "No pudimos cargar los precios",
    );
    await page.getByRole("button", { name: "Reintentar" }).click();
    await expect(comparison).toBeVisible();
  });
});

function eggFixturePrice(increased: boolean, retailer: string, index: number): number {
  if (increased) return 2090;

  return retailer === "tottus" ? 1490 : 1590 + index * 100;
}
