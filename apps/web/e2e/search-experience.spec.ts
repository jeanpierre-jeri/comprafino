import { searchCategories } from "@comprafino/core";
import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const raw: unknown = process.env.PRICE_HISTORY_FIXTURE_IDS
  ? JSON.parse(process.env.PRICE_HISTORY_FIXTURE_IDS)
  : null;

function fixture(name: string): string {
  const value: unknown = typeof raw === "object" && raw !== null ? Reflect.get(raw, name) : null;
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/u.test(value)) {
    throw new Error("Run the isolated search experience fixtures");
  }
  return value;
}

test.describe("search comparison scope (owned PostgreSQL fixtures)", () => {
  test.skip(!raw, "Run pnpm test:e2e:fixtures:local after build");

  test("category links browse without text and search retains category and retailer", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.locator(".search-chip").filter({ hasText: "Lácteos y huevos" }).click();
    await expect(page).toHaveURL(/category=lacteos-huevos/u);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lácteos y huevos");
    const cards = page.locator("[data-offer-id]");
    await expect(cards).toHaveCount(6);
    await expect(page.getByRole("heading", { name: "Compara el mismo producto" })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Agregar como necesidad", exact: true }),
    ).toHaveCount(0);
    const filterToggle = page.getByRole("button", { name: /^Filtros/u });
    if (await filterToggle.isVisible()) {
      await filterToggle.click();
    }
    await page.getByRole("combobox", { name: "Supermercado" }).click();
    await page.getByRole("option", { name: "Metro", exact: true }).click();
    await expect(cards).toHaveCount(5);
    await page.getByLabel("Buscar en Lácteos y huevos").fill("auditexperiencia");
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    await expect(page).toHaveURL(/q=auditexperiencia/u);
    await expect(page).toHaveURL(/category=lacteos-huevos/u);
    await expect(page).toHaveURL(/retailer=metro/u);
    await expect(cards).toHaveCount(4);
    await page.getByRole("combobox", { name: "Categoría" }).click();
    await page.getByRole("option", { name: "Limpieza", exact: true }).click();
    await expect(
      page.getByText("No hay opciones con esta categoría y estos filtros."),
    ).toBeVisible();
    await page.getByRole("link", { name: "Buscar en todas las categorías" }).click();
    await expect(page).not.toHaveURL(/category=/u);
    await expect(cards).toHaveCount(5);
    await page.goBack();
    await expect(page.getByRole("combobox", { name: "Categoría" })).toContainText("Limpieza");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

  test("category-only pagination preserves category and changing it resets the page", async ({
    page,
  }) => {
    await page.goto("/search?category=limpieza&sort=total-price");
    const cards = page.locator("[data-offer-id]");
    await expect(cards).toHaveCount(30);
    await page.getByRole("link", { name: "Siguiente", exact: true }).click();
    await expect(page).toHaveURL(/category=limpieza/u);
    await expect(page).toHaveURL(/page=2/u);
    await expect(cards).toHaveCount(7);
    await page.getByRole("combobox", { name: "Categoría" }).click();
    await page.getByRole("option", { name: "Lácteos y huevos", exact: true }).click();
    await expect(page).not.toHaveURL(/page=/u);
    await expect(cards).toHaveCount(6);
    await expect(page.getByRole("combobox", { name: "Ordenar" })).toContainText(
      "Menor precio total",
    );
  });

  test("search pagination exposes all current offers and filter changes reset the page", async ({
    page,
  }) => {
    await page.goto("/search?q=auditpaginacion");
    const cards = page.locator("[data-offer-id]");
    await expect(cards).toHaveCount(30);
    const firstPage = await cards.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-offer-id")),
    );
    const navigation = page.getByRole("navigation", { name: "Páginas de resultados" });
    await navigation.getByRole("link", { name: "Siguiente" }).click();
    await expect(page).toHaveURL(/page=2/u);
    await expect(cards).toHaveCount(7);
    const secondPage = await cards.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-offer-id")),
    );
    expect(new Set([...firstPage, ...secondPage]).size).toBe(37);
    await expect(navigation.getByRole("link", { name: "Siguiente" })).toHaveCount(0);
    await navigation.getByRole("link", { name: "Anterior" }).click();
    await expect(cards).toHaveCount(30);
    await navigation.getByRole("link", { name: "Siguiente" }).click();
    await page.getByRole("combobox", { name: "Ordenar" }).click();
    await page.getByRole("option", { name: "Menor precio total", exact: true }).click();
    await expect(page).not.toHaveURL(/page=/u);
    await expect(cards).toHaveCount(30);
  });

  test("egg quantities, variants and ordinary/CMR unit prices remain independent", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/search?q=huevos+auditexperiencia&sort=unit-price");
    const offers = page.getByRole("region", { name: "Opciones en supermercados" });
    const cards = offers.locator("[data-offer-id]");
    await expect(cards).toHaveCount(5);
    await expect(cards.nth(0)).toContainText("Bandeja 30un");
    await expect(cards.nth(1)).toContainText("Bandeja 30un");
    await expect(cards.nth(2)).toContainText("Blancos");
    const large = page.locator(`[data-offer-id="${fixture("search-tottus")}"]`);
    await expect(large).toContainText("S/ 60.00");
    await expect(large.getByText("S/ 2.00 / huevo", { exact: true })).toBeVisible();
    await expect(large.locator(".benefit-surface")).toContainText("S/ 1.80 / huevo · con CMR");
    const small = page.locator(`[data-offer-id="${fixture("search-15")}"]`);
    await expect(small).toContainText("S/ 45.00");
    await expect(small).toContainText("S/ 3.00 / huevo");
    await expect(page.locator(`[data-offer-id="${fixture("search-plaza-vea")}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-offer-id="${fixture("search-makro")}"]`)).toHaveCount(0);
    const missing = page.locator(`[data-offer-id="${fixture("search-missing")}"]`);
    await expect(missing).toContainText("Sin precio por unidad: la cantidad no está indicada.");
    await expect(page.locator(`[data-offer-id="${fixture("search-ambiguous")}"]`)).toContainText(
      "Sin precio por unidad: la cantidad no es suficientemente clara.",
    );
    await expect(offers).toContainText("Las marcas, variedades y calidades pueden diferir.");
    await expect(large).toContainText("Disponibilidad no confirmada.");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.goto(`/listings/${fixture("search-tottus")}`);
    await expect(page.locator(".detail-best-price")).toContainText("S/ 2.00 / huevo");
    await page.goto(`/listings/${fixture("search-missing")}`);
    await expect(page.locator(".detail-best-price")).toContainText("la cantidad no está indicada");
  });

  test("retailer filters affect the product list and card links retain full store comparisons", async ({
    page,
  }) => {
    await page.goto("/search?q=huevos+auditexperiencia&sort=total-price&retailer=plaza-vea");
    await expect(page.getByText("No hay opciones con estos filtros.")).toBeVisible();
    await expect(page.locator("[data-offer-id]")).toHaveCount(0);
    await expect(page.locator(".exact-card")).toHaveCount(0);
    await page.getByRole("combobox", { name: "Supermercado" }).click();
    await page.getByRole("option", { name: "Metro", exact: true }).click();
    const card = page.locator(`[data-offer-id="${fixture("search-metro")}"]`);
    await expect(card).toBeVisible();
    await card.getByRole("link", { name: "Ver comparación entre supermercados" }).click();
    await expect(page).toHaveURL(new RegExp(`/products/${fixture("search-product")}\\?`));
    const records = page.getByRole("region", { name: "Precios y registros en 4 supermercados" });
    await expect(records).toContainText("2 ofertas vigentes");
    await expect(page.locator(".detail-best-price")).toContainText(
      "Mejor precio para todos · Empate",
    );
    await expect(page.locator(".detail-best-price")).toContainText("S/ 60.00");
    for (const retailer of ["Makro", "Plaza Vea"]) {
      const historical = records
        .getByRole("article")
        .filter({ has: page.getByRole("heading", { name: retailer, exact: true }) });
      await expect(historical).toContainText("Último precio registrado para todos");
      await expect(historical).not.toContainText("Mejor precio");
    }
    await page.goto(`/products/${fixture("old")}`);
    await expect(
      page.getByRole("region", { name: "Precios y registros en 4 supermercados" }),
    ).toContainText("0 ofertas vigentes");
    await expect(page.locator(".detail-best-price")).toContainText(
      "Estamos actualizando este producto.",
    );
  });
  test("compact search shows the first milk title and price in both themes and widths", async ({
    page,
  }, testInfo) => {
    const screenshotDirectory = new URL("../../../.artifacts/search-ux/", import.meta.url);
    await mkdir(screenshotDirectory, { recursive: true });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://**/*", (route) => route.abort());

    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      for (const width of [390, 320, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        for (const category of [false, true]) {
          await page.goto(`/search?q=leche${category ? "&category=lacteos-huevos" : ""}`);
          const first = page.locator("[data-offer-id]").first();
          await expect(first).toBeVisible();
          await expect(page.getByRole("combobox", { name: "Ordenar", exact: true })).toBeVisible();
          await expect(
            page.getByLabel(category ? "Buscar en Lácteos y huevos" : "¿Qué necesitas comprar?"),
          ).toHaveValue("leche");
          await expect(
            page.getByRole("status").filter({ hasText: /\d+ resultado/u }),
          ).toBeVisible();
          if (width < 1024) {
            await expect(page.getByRole("button", { name: /^Filtros/u })).toHaveAttribute(
              "aria-expanded",
              "false",
            );
            await expect(page.getByRole("combobox", { name: "Supermercado" })).toBeHidden();
          } else {
            await expect(page.getByRole("combobox", { name: "Supermercado" })).toBeVisible();
          }
          const title = await first.getByRole("heading").boundingBox();
          const price = await first.locator(".card-amount").boundingBox();
          expect(title).not.toBeNull();
          expect(price).not.toBeNull();
          expect(title!.y + title!.height).toBeLessThan(844);
          expect(price!.y + price!.height).toBeLessThan(844);
          expect(await page.evaluate(() => scrollY)).toBe(0);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          const filename = `${width}-${theme}${category ? "-category" : ""}.png`;
          const path = new URL(filename, screenshotDirectory).pathname;
          await page.screenshot({ path });
          await testInfo.attach(filename, { path, contentType: "image/png" });
          if (width < 1024) {
            const toggle = page.getByRole("button", { name: /^Filtros/u });
            await toggle.press("Space");
            await expect(toggle).toHaveAttribute("aria-expanded", "true");
            await expect(page.getByRole("combobox", { name: "Categoría" })).toBeVisible();
            expect(
              await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            ).toBe(true);
            await toggle.press("Space");
            await expect(toggle).toHaveAttribute("aria-expanded", "false");
          }
          console.log(
            JSON.stringify({
              width,
              theme,
              category,
              titleBottom: title!.y + title!.height,
              priceBottom: price!.y + price!.height,
            }),
          );
        }
      }
    }
    expect(errors).toEqual([]);
  });

  test("all category variants retain search tools without overflow at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      for (const category of searchCategories) {
        await page.goto(`/search?category=${category.id}`);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(category.label);
        await expect(page.getByLabel(`Buscar en ${category.label}`)).toBeVisible();
        await expect(page.getByRole("combobox", { name: "Ordenar", exact: true })).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Filtros (1 activo)", exact: true }),
        ).toHaveAttribute("aria-expanded", "false");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
    }
  });

  test("mobile disclosure, removable filters, reset, reload and history keep URL state", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      "/search?q=auditexperiencia&category=lacteos-huevos&sort=total-price&retailer=metro&unit=unit&priceMode=benefits&page=2",
    );
    const toggle = page.getByRole("button", { name: /^Filtros/u });
    await expect(toggle).toHaveText("Filtros (4 activos)");
    await page.setViewportSize({ width: 320, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await toggle.focus();
    await toggle.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const retailer = page.getByRole("combobox", { name: "Supermercado", exact: true });
    await expect(retailer).toHaveText("Metro");
    await mkdir(new URL("../../../.artifacts/search-ux/", import.meta.url), { recursive: true });
    let releaseNavigation = () => {};
    const navigationGate = new Promise<void>((resolve) => {
      releaseNavigation = resolve;
    });
    await page.route("**/search?**", async (route) => {
      await navigationGate;
      await route.continue();
    });
    try {
      await retailer.click();
      await page.getByRole("option", { name: "Tottus", exact: true }).click();
      await expect(page.getByText("Actualizando resultados…", { exact: true })).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Ordenar", exact: true })).toBeDisabled();
      await expect(page.getByRole("listbox", { includeHidden: true })).toBeHidden();
      await page.screenshot({
        path: new URL("../../../.artifacts/search-ux/loading.png", import.meta.url).pathname,
        fullPage: true,
      });
    } finally {
      releaseNavigation();
      await page.unrouteAll({ behavior: "wait" });
    }
    await expect(page).not.toHaveURL(/page=/u);
    await expect(
      page.getByRole("button", { name: "Quitar filtro: Tottus", exact: true }),
    ).toBeVisible();
    await expect(retailer).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await page.getByRole("button", { name: "Quitar filtro: Tottus", exact: true }).click();
    await expect(page).not.toHaveURL(/retailer=/u);
    await expect(toggle).toHaveText("Filtros (3 activos)");
    await page.goBack();
    await expect(
      page.getByRole("button", { name: "Quitar filtro: Tottus", exact: true }),
    ).toBeVisible();
    await page.goForward();
    await expect(toggle).toHaveText("Filtros (3 activos)");
    await page.reload();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveText("Filtros (3 activos)");
    await toggle.click();
    await expect(page.getByRole("combobox", { name: "Comparar por" })).toHaveText("unidad");
    await expect(page.getByRole("combobox", { name: "Precios", exact: true })).toHaveText(
      "Incluir beneficios",
    );
    await expect(page.locator('[data-slot="collapsible-content"]:visible')).toHaveCSS(
      "opacity",
      "1",
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: new URL("../../../.artifacts/search-ux/filters-open.png", import.meta.url).pathname,
    });
    await toggle.click();
    await page.getByRole("button", { name: "Limpiar filtros", exact: true }).click();
    await expect(page).toHaveURL("/search?q=auditexperiencia&sort=total-price");
    await expect(toggle).toHaveText("Filtros");
    await page.goBack();
    await expect(toggle).toHaveText("Filtros (3 activos)");
    await page.goForward();
    await expect(toggle).toHaveText("Filtros");
    await page.getByLabel("¿Qué necesitas comprar?").fill("zzzzproductoausentezzzz");
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "No encontramos ese producto todavía." }),
    ).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "0 resultados" })).toBeVisible();
    await page.screenshot({
      path: new URL("../../../.artifacts/search-ux/empty.png", import.meta.url).pathname,
    });
    await testInfo.attach("empty", {
      path: new URL("../../../.artifacts/search-ux/empty.png", import.meta.url).pathname,
      contentType: "image/png",
    });
  });
});
