import { expect, test } from "@playwright/test";
import {
  createDatabase,
  formatPen,
  getCanonicalProductComparison,
  searchCanonicalProducts,
} from "@comprafino/db";

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
  test.skip(!process.env.DATABASE_URL, "Requires an explicitly supplied persisted database");
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
