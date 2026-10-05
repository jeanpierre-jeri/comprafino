import { expect, test, type Page } from "@playwright/test";
import { shoppingListSchema } from "@comprafino/core";
import { createDatabase, persistListings } from "@comprafino/db";

async function openGeneric(page: Page, query = "huevos") {
  await page.goto(`/search?q=${query}`);
  await page.getByRole("button", { name: "Agregar como necesidad" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
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
  for (const raw of ["{", '{"version":2,"items":[]}']) {
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
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await openGeneric(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByRole("dialog").getByRole("radio").first()).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`add-390-${theme}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Agregar como necesidad" })).toBeFocused();
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
    expect(saved.items[0]?.canonicalId).toBe(fixture("preferred"));
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
  test("editing a generic need into a specific intent requires selecting a canonical product", async ({
    page,
  }) => {
    await addGeneric(page);
    await page.getByRole("button", { name: "Editar huevos" }).click();
    await page.getByRole("radio", { name: "Solo quiero este producto", exact: true }).check();
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByRole("alert")).toContainText("selecciona un producto");
    await page.getByRole("button", { name: "Buscar producto para seleccionar" }).click();
    await page.getByLabel("Producto exacto").selectOption(fixture("preferred"));
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByRole("article")).toContainText("Solo quiero este producto");
    await expect(page.getByRole("article")).toContainText("S/ 17.90");
  });
});
