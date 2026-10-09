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
  await expect(page.locator('.retailer-badge[data-retailer="makro"]')).toHaveText("Makro");
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
  const starter = page.getByRole("link", { name: "Huevos", exact: false });
  await expect(starter).toHaveAttribute("href", "/search?q=huevos");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // A short query keeps this smoke test database-independent.
  await page.getByLabel("¿Qué necesitas comprar?").fill("a");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByText("Escribe entre 2 y 120 caracteres", { exact: false })).toBeVisible();
});
