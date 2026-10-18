import { expect, test } from "@playwright/test";
import { shoppingListSchema } from "@comprafino/core";

test.describe("UX review with owned catalog fixtures", () => {
  test.skip(!process.env.PRICE_HISTORY_FIXTURE_IDS, "Requires the owned fixture harness");

  test("unconfirmed offers describe their individual destination honestly", async ({ page }) => {
    await page.goto("/search?q=huevos+auditexperiencia");
    const independent = page.locator("[data-product-id]").filter({ hasText: "Bandeja 15un" });
    await expect(independent).toHaveCount(1);
    await expect(independent.locator("a.comparison-link")).toHaveText("Ver producto");
    await independent.getByRole("link", { name: "Ver producto", exact: true }).click();
    await expect(page).toHaveURL(/\/listings\//u);
    await expect(
      page.getByRole("link", { name: "Comparar entre supermercados", exact: true }),
    ).toHaveCount(0);
  });

  test("an obsolete page offers a first-page recovery without dropping filters", async ({
    page,
  }) => {
    const filters =
      "q=auditpaginacion&category=limpieza&sort=total-price&retailer=metro&priceMode=benefits";
    await page.goto(`/search?${filters}&page=99`);
    await expect(
      page.getByRole("heading", { name: "Esta página ya no tiene productos." }),
    ).toBeVisible();
    await expect(page.getByText("No hay opciones con esta categoría y estos filtros.")).toHaveCount(
      0,
    );
    await page.getByRole("link", { name: "Volver a la primera página", exact: true }).click();
    await expect(page).toHaveURL(`/search?${filters}`);
    await expect(page.locator("[data-product-id]")).toHaveCount(30);
  });

  test("removing filters keeps keyboard focus on a visible control", async ({ page }) => {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/search?q=auditexperiencia&retailer=metro&priceMode=benefits");
      await page.getByRole("button", { name: "Quitar filtro: Metro", exact: true }).press("Enter");
      await expect(page).not.toHaveURL(/retailer=/u);
      await expect(page.getByRole("combobox", { name: "Ordenar", exact: true })).toBeFocused();
      await page.getByRole("button", { name: "Limpiar filtros", exact: true }).press("Enter");
      await expect(page).toHaveURL("/search?q=auditexperiencia");
      await expect(page.getByRole("combobox", { name: "Ordenar", exact: true })).toBeFocused();
    }
  });

  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      test(`complete journey retains search and saved identity ${theme} ${width}`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto("/");
        await page.getByLabel("¿Qué necesitas comprar?").fill("huevos auditexperiencia");
        await page.getByRole("button", { name: "Buscar", exact: true }).press("Enter");
        await expect(page.locator("[data-product-id]")).toHaveCount(4);
        if (width < 1024) {
          await page.getByRole("button", { name: /^Filtros/u }).press("Enter");
        }
        await page.getByRole("combobox", { name: "Supermercado", exact: true }).click();
        await page.getByRole("option", { name: "Metro", exact: true }).click();
        await expect(page).toHaveURL(/retailer=metro/u);
        const product = page.locator("[data-product-id]").filter({ hasText: "Bandeja 30un" });
        const canonicalId = await product.getAttribute("data-product-id");
        await expect(product).toContainText("1 supermercado · 1 oferta de tienda");
        await product.getByRole("link", { name: "Comparar precios", exact: true }).click();
        await expect(page).toHaveURL(/\/products\//u);
        const returnTo = new URL(page.url()).searchParams.get("returnTo");
        await expect(
          page.getByRole("region", { name: "Precios y registros en 4 supermercados" }),
        ).toContainText("2 ofertas vigentes");
        await expect(page.locator(".detail-best-price")).toContainText("S/ 60.00");
        await page.getByRole("button", { name: "Agregar a mi lista", exact: true }).press("Enter");
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByLabel("Paquetes", { exact: true })).toBeFocused();
        await dialog.getByRole("button", { name: "Ajustar sustituciones y frecuencia" }).click();
        await dialog.getByRole("radio", { name: "Solo quiero este producto", exact: true }).check();
        await dialog.getByRole("button", { name: "Agregar", exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await page.getByRole("link", { name: "Ver mi lista", exact: true }).click();
        const card = page.locator('article[id^="shopping-item-"]');
        await expect(card).toHaveCount(1);
        const before = shoppingListSchema.parse(
          JSON.parse(
            (await page.evaluate(() => localStorage.getItem("comprafino-shopping-list"))) ?? "null",
          ) as unknown,
        );
        const edit = card.getByRole("button", { name: /^Editar /u });
        await edit.press("Enter");
        await dialog.getByLabel("Paquetes", { exact: true }).fill("2");
        await dialog.getByRole("button", { name: "Guardar cambios", exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(edit).toBeFocused();
        await expect(card).toContainText("S/ 120.00");
        await page.screenshot({
          path: testInfo.outputPath(`list-${theme}-${width}.png`),
          fullPage: true,
        });
        await page.goBack();
        const back = page.getByRole("link", { name: "Volver a resultados", exact: true });
        await expect(back).toHaveAttribute("href", returnTo!);
        await back.click();
        await expect(page).toHaveURL(returnTo!);
        await expect(page.getByLabel("¿Qué necesitas comprar?")).toHaveValue(
          "huevos auditexperiencia",
        );
        await expect(
          page.getByRole("button", { name: "Quitar filtro: Metro", exact: true }),
        ).toBeVisible();
        await page.reload();
        const after = shoppingListSchema.parse(
          JSON.parse(
            (await page.evaluate(() => localStorage.getItem("comprafino-shopping-list"))) ?? "null",
          ) as unknown,
        );
        expect(after.items).toHaveLength(1);
        expect(after.items[0]).toMatchObject({
          id: before.items[0]?.id,
          canonicalId,
          intent: "strict",
          quantity: { amount: 2, unit: "unit" },
          quantityMode: "packages",
        });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect(errors).toEqual([]);
        await page.screenshot({
          path: testInfo.outputPath(`returned-${theme}-${width}.png`),
          fullPage: true,
        });
      });
    }
  }
});
