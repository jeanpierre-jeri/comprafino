import { expect, test } from "@playwright/test";

test("developer discovery tooling is blocked in production", async ({ page }) => {
  const response = await page.goto("/dev/discovery");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Developer discovery inspection" })).toHaveCount(
    0,
  );
});

test("homepage offers an accessible product search", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/CompraFino/);
  await expect(page.locator("html")).toHaveAttribute("lang", "es-PE");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Compra mejor.Paga menos.");
  await expect(page.locator('.retailer-strip .retailer-badge[data-retailer="makro"]')).toHaveText(
    "Makro",
  );
  await expect(page.getByLabel("¿Qué necesitas comprar?")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Buscar" })).toBeEnabled();
  await expect(
    page.getByText("Nuestra cobertura sigue creciendo.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("¿Qué necesitas comprar?").fill("g");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page).toHaveURL(/\/search\?q=g$/);
  await expect(page.getByText("Escribe entre 2 y 120 caracteres", { exact: false })).toBeVisible();
});

test("developer ingestion tooling is blocked in production", async ({ page }) => {
  const response = await page.goto("/dev/ingestion");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Developer ingestion inspection" })).toHaveCount(
    0,
  );
});

test("developer catalog tooling is blocked in production", async ({ page }) => {
  const response = await page.goto("/dev/catalog");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Developer catalog inspection" })).toHaveCount(0);
});

test("developer matching tooling is blocked in production", async ({ page }) => {
  const response = await page.goto("/dev/matching");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Developer matching inspection" })).toHaveCount(0);
});

test("mobile starter links and keyboard skip link lead to useful content", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);
  const starter = page.locator(".browse-link").filter({ hasText: "Lácteos y huevos" });
  await expect(starter).toHaveAttribute("href", "/search?category=lacteos-huevos");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // A short query keeps this smoke test database-independent.
  await page.getByLabel("¿Qué necesitas comprar?").fill("a");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByText("Escribe entre 2 y 120 caracteres", { exact: false })).toBeVisible();
});

for (const { width, theme } of [
  { width: 320, theme: "light" },
  { width: 390, theme: "light" },
  { width: 768, theme: "light" },
  { width: 1280, theme: "light" },
  { width: 320, theme: "dark" },
  { width: 390, theme: "dark" },
] as const) {
  test(`home prioritizes search and list without overflow at ${width}px (${theme})`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const navigation = page.getByRole("navigation", { name: "Navegación principal" });
    await expect(navigation.getByRole("link", { name: "Productos", exact: true })).toHaveAttribute(
      "href",
      "/search",
    );
    await expect(navigation.getByRole("link", { name: "Mi lista", exact: true })).toHaveAttribute(
      "href",
      "/list",
    );
    const input = page.getByLabel("¿Qué necesitas comprar?");
    const bounds = await input.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThanOrEqual(220);
    expect(bounds!.y + bounds!.height).toBeLessThan(568);
    const brand = await page.getByRole("link", { name: "CompraFino, inicio" }).boundingBox();
    const themeControl = await page
      .getByRole("combobox", { name: "Tema", exact: true })
      .boundingBox();
    expect(brand!.x + brand!.width).toBeLessThanOrEqual(themeControl!.x);
    await expect(page.locator(".home-comparison")).not.toHaveAttribute("aria-busy", "true");
    const sample = await page.locator(".home-comparison").boundingBox();
    expect(sample!.y).toBeGreaterThan(bounds!.y + bounds!.height);
    await expect(page.locator('a[href="/search?category=lacteos-huevos"]')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`home-${width}-${theme}.png`),
      fullPage: true,
    });
    await navigation.getByRole("link", { name: "Mi lista", exact: true }).click();
    await expect(page).toHaveURL(/\/list$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Mi lista de compras" }),
    ).toBeVisible();
    await navigation.getByRole("link", { name: "Productos", exact: true }).click();
    await expect(page).toHaveURL(/\/search$/);
    await expect(page.getByLabel("¿Qué necesitas comprar?")).toBeEnabled();
  });
}

test("home sample leads to the same real catalog comparison", async ({ page }) => {
  test.skip(!process.env.PRICE_HISTORY_FIXTURE_IDS, "Requires the isolated catalog fixtures");
  await page.goto("/");
  const sample = page.getByRole("region", { name: "Una comparación del catálogo" });
  await expect(sample).toBeVisible();
  await expect(sample.getByText("Presentación:", { exact: false })).toBeVisible();
  const title = await sample.getByRole("heading", { level: 3 }).innerText();
  const prices = await sample.locator("li").evaluateAll((rows) =>
    rows.map((row) => ({
      retailer: row.querySelector(".retailer-badge")?.textContent,
      price: row.querySelector("p")?.textContent,
      observedAt: row.querySelector("time")?.getAttribute("datetime"),
    })),
  );
  expect(prices.length).toBeGreaterThanOrEqual(2);
  for (const price of prices) {
    expect(price.observedAt).toBeTruthy();
    expect(price.price).toMatch(/^S\/\s*\d/u);
  }
  await sample.getByRole("link", { name: "Ver comparación", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  for (const price of prices) {
    const row = page.locator(".comparison-row").filter({ hasText: price.retailer ?? "missing" });
    await expect(row).toContainText(price.price ?? "missing");
    await expect(row.locator("time")).toHaveAttribute("datetime", price.observedAt!);
  }
});

test("home without a comparison offers useful links without price claims", async ({ page }) => {
  test.skip(!!process.env.DATABASE_URL, "Run without a catalog to exercise the fallback");
  await page.goto("/");
  const sample = page.getByRole("region", { name: "El mismo producto, tienda por tienda" });
  await expect(sample).toHaveAttribute("aria-busy", "false");
  await expect(sample).not.toContainText("S/");
  await expect(sample.getByRole("link", { name: "Explorar productos" })).toHaveAttribute(
    "href",
    "/search",
  );
  await expect(page.getByLabel("¿Qué necesitas comprar?")).toBeEnabled();
});
