import { expect, test, type Page } from "@playwright/test";
import {
  createDatabase,
  formatPen,
  getCanonicalProductComparison,
  searchCanonicalProducts,
} from "@comprafino/db";

async function choose(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("missing and blank searches explain how to start", async ({ page }) => {
  for (const path of ["/search", "/search?q=%20%20", "/search?q=g", "/search?q=%25%25"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Encuentra y compara" })).toBeVisible();
    await expect(
      page.getByText("Escribe entre 2 y 120 caracteres", { exact: false }),
    ).toBeVisible();
  }
});

test("malformed product IDs show public not-found behavior", async ({ page }) => {
  await page.goto("/products/not-a-product");
  await expect(page.getByRole("heading", { name: "No encontramos ese producto." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Buscar productos" })).toBeVisible();
});

// The credential-free CI smoke tests above need no database. The existing E2E
// harness has no database fixture lifecycle. Opt in explicitly with DATABASE_URL;
// expected values come from persistence, never retailer requests or invented data.
test.describe("persisted public catalog (explicit DATABASE_URL)", () => {
  test.skip(
    !process.env.DATABASE_URL || !!process.env.COMPRAFINO_CONTROLLED_E2E,
    "Requires an explicitly supplied persisted database",
  );
  test("homepage → search → comparison agrees with persisted ordinary offers on mobile", async ({
    page,
  }) => {
    const db = createDatabase();
    const results = await searchCanonicalProducts(db, "gloria 946");
    expect(results.length).toBeGreaterThan(0);
    const product = await getCanonicalProductComparison(db, results[0]!.id);
    expect(product).not.toBeNull();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByLabel("¿Qué necesitas comprar?").fill("gloria 946");
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(page).toHaveURL(/\/search\?q=gloria\+946$/);
    await page
      .getByRole("link")
      .filter({ has: page.getByRole("heading", { name: product!.displayName, exact: true }) })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(product!.displayName);
    await expect(page).toHaveTitle(`${product!.displayName} – precios | CompraFino`);
    await expect(
      page.getByRole("heading", { name: `Compara en ${product!.retailerCount} supermercados` }),
    ).toBeVisible();
    for (const offer of product!.offers) {
      const row = page
        .getByRole("region", { name: `Compara en ${product!.retailerCount} supermercados` })
        .getByRole("article")
        .filter({ has: page.getByRole("heading", { name: offer.retailerName, exact: true }) });
      await expect(
        row.getByText(formatPen(offer.currentPriceCents), { exact: true }),
      ).toBeVisible();
      await expect(row.locator("time")).toHaveAttribute("datetime", offer.observedAt.toISOString());
      await expect(
        row.getByRole("link", { name: `Ver producto en ${offer.retailerName}`, exact: false }),
      ).toHaveAttribute("href", offer.url);
      await expect(row.locator("s")).toHaveCount(offer.regularPriceCents === null ? 0 : 1);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(
      page.getByText("Precios ordinarios observados en línea", { exact: false }),
    ).toBeVisible();
  });
  test("no results and nonexistent products give honest empty states", async ({ page }) => {
    await page.goto("/search?q=zzzzproductoausentezzzz");
    await expect(
      page.getByRole("heading", { name: "No encontramos ese producto todavía." }),
    ).toBeVisible();
    await page.goto("/products/00000000-0000-4000-8000-000000000000");
    await expect(page.getByRole("heading", { name: "No encontramos ese producto." })).toBeVisible();
  });
});

test.describe("generic persisted offers (explicit DATABASE_URL)", () => {
  test.skip(
    !process.env.DATABASE_URL || !!process.env.COMPRAFINO_CONTROLLED_E2E,
    "Requires an explicitly supplied persisted database",
  );
  test("eggs show independent options and unit-price sorting agrees with persisted exact fractions", async ({
    page,
  }) => {
    const { searchGenericProductOffers, formatUnitPrice } = await import("@comprafino/db");
    const offers = await searchGenericProductOffers(createDatabase(), "huevos", "unit-price");
    expect(offers.length).toBeGreaterThan(0);
    const countOffers = offers.filter((o) => o.unitPrice?.dimension === "count");
    expect(countOffers.length).toBeGreaterThan(0);
    await page.goto("/search?q=huevos");
    const section = page.getByRole("region", { name: "Opciones en supermercados" });
    await expect(section).toBeVisible();
    await choose(page, "Ordenar", "Menor por unidad");
    await expect(page.getByRole("button", { name: "Aplicar" })).toHaveCount(0);
    await expect(page).toHaveURL(/sort=unit-price/);
    const first = section.locator("article[data-offer-id]").first();
    await expect(first).toHaveAttribute("data-offer-id", countOffers[0]!.id);
    await expect(
      first.getByText(formatUnitPrice(countOffers[0]!.unitPrice!), { exact: true }),
    ).toBeVisible();
    const independent = offers.find((o) => !o.canonicalId);
    expect(independent).toBeDefined();
    const independentCard = section.locator(`article[data-offer-id="${independent!.id}"]`);
    await expect(independentCard).toBeVisible();
    await expect(independentCard.getByRole("link", { name: /Comparar este producto/ })).toHaveCount(
      0,
    );
    await expect(first.locator("time")).toHaveAttribute(
      "datetime",
      countOffers[0]!.observedAt.toISOString(),
    );
    await expect(first.locator("time")).toHaveText(/^hace /);
    const linked = offers.find((offer) => offer.canonicalId);
    expect(linked).toBeDefined();
    const linkedCard = section.locator(`article[data-offer-id="${linked!.id}"]`);
    await expect(linkedCard.getByRole("link", { name: /Ver producto en/ })).toHaveAttribute(
      "href",
      linked!.url,
    );
    await expect(linkedCard.getByRole("link", { name: /Ver producto en/ })).toHaveAttribute(
      "target",
      "_blank",
    );
    await linkedCard.click({ position: { x: 12, y: 12 } });
    await expect(page).toHaveURL(new RegExp(`/listings/${linked!.id}$`));
  });
});

test.describe("staple persisted relevance (explicit DATABASE_URL)", () => {
  test.skip(
    !process.env.DATABASE_URL || !!process.env.COMPRAFINO_CONTROLLED_E2E,
    "Requires the refreshed persisted staple catalog",
  );
  test("sugar has packaged staples and a specific oil brand stays specific", async ({ page }) => {
    await page.goto("/search?q=az%C3%BAcar");
    const cards = page
      .getByRole("region", { name: "Opciones en supermercados" })
      .locator("article[data-offer-id]");
    await expect(cards.first()).toBeVisible();
    const titles = await cards.getByRole("heading").allTextContents();
    expect(titles.length).toBeGreaterThanOrEqual(10);
    expect(titles.slice(0, 10).every((title) => /^azúcar /iu.test(title))).toBe(true);
    expect(titles.some((title) => /sin azúcar/iu.test(title))).toBe(false);
    await page.goto("/search?q=aceite+primor");
    const oil = page
      .getByRole("region", { name: "Opciones en supermercados" })
      .locator("article[data-offer-id]");
    await expect(oil.first()).toBeVisible();
    expect(
      (await oil.getByRole("heading").allTextContents()).every(
        (title) => /aceite/iu.test(title) && /primor/iu.test(title) && !/atún/iu.test(title),
      ),
    ).toBe(true);
  });
});

test.describe("immediate filters and CMR (explicit DATABASE_URL)", () => {
  test.skip(
    !process.env.DATABASE_URL || !!process.env.COMPRAFINO_CONTROLLED_E2E,
    "Requires migrated persisted catalog",
  );
  test("retailer, sort, benefits and browser back restore URL controls on mobile", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/search?q=huevos");
    await choose(page, "Ordenar", "Menor por unidad");
    await expect(page).toHaveURL(/sort=unit-price/);
    await choose(page, "Supermercado", "Metro");
    await expect(page).toHaveURL(/retailer=metro/);
    const { searchPublicProducts, searchFilters } = await import("@comprafino/db");
    const expected = await searchPublicProducts(
      createDatabase(),
      "huevos",
      "unit-price",
      new Date(),
      searchFilters({ retailer: "metro", sort: "unit-price" }),
    );
    await expect(page.locator("article[data-offer-id]")).toHaveCount(expected.offers.length);
    await choose(page, "Precios", "Incluir beneficios");
    await expect(page).toHaveURL(/priceMode=benefits/);
    await page.goBack();
    await expect(page.getByRole("combobox", { name: "Precios", exact: true })).toHaveText(
      "Para todos",
    );
    await page.goBack();
    await expect(page.getByRole("combobox", { name: "Supermercado", exact: true })).toHaveText(
      "Todos",
    );
    await page.goForward();
    await expect(page.getByRole("combobox", { name: "Supermercado", exact: true })).toHaveText(
      "Metro",
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
  test("CMR product detail shows ordinary, reference and conditional prices separately", async ({
    page,
  }) => {
    const products = await searchCanonicalProducts(createDatabase(), "gloria");
    const product = products.find((p) =>
      p.offers.some((o) => o.retailerId === "tottus" && o.conditionalOffers.length),
    );
    expect(product, "At least one freshly ingested exact CMR product is required").toBeDefined();
    await page.goto(`/products/${product!.id}`);
    const row = page
      .getByRole("region", { name: /^Compara en \d+ supermercados$/u })
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: "Tottus", exact: true }) });
    const offer = product!.offers.find((o) => o.retailerId === "tottus")!;
    await expect(row.getByText(formatPen(offer.currentPriceCents), { exact: true })).toBeVisible();
    if (offer.regularPriceCents === null) {
      await expect(row.locator("s")).toHaveCount(0);
    } else {
      await expect(row.locator("s")).toHaveText(formatPen(offer.regularPriceCents));
    }
    await expect(
      row.getByText(`${formatPen(offer.conditionalOffers[0]!.priceCents)} con CMR`, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(row.getByText("Requiere tarjeta CMR", { exact: true })).toBeVisible();
    await choose(page, "Precios", "Incluir beneficios");
    await expect(page).toHaveURL(/priceMode=benefits/);
    await expect(row.getByText("Precio online para todos", { exact: true })).toBeVisible();
  });
});
