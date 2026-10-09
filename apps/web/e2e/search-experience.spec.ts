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
    await expect(page.locator(".exact-card")).toContainText("2 ofertas vigentes");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.goto(`/listings/${fixture("search-tottus")}`);
    await expect(page.locator(".detail-best-price")).toContainText("S/ 2.00 / huevo");
    await page.goto(`/listings/${fixture("search-missing")}`);
    await expect(page.locator(".detail-best-price")).toContainText("la cantidad no está indicada");
  });

  test("retailer and sorting controls disclose full exact comparisons while filtering independent offers", async ({
    page,
  }) => {
    await page.goto("/search?q=huevos+auditexperiencia&sort=total-price&retailer=plaza-vea");
    await expect(
      page.getByText(/El orden elegido se aplica a «Opciones en supermercados»/),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Opciones en supermercados" })).toHaveCount(0);
    const exact = page.locator(".exact-card");
    await expect(exact).toContainText("Ver registros en 4 supermercados");
    await expect(exact).toContainText("2 ofertas vigentes");
    await expect(exact).toContainText("S/ 60.00");
    await expect(exact).toContainText("Metro y Tottus");
    await expect(page.getByText(/El precio «Desde» considera sus ofertas vigentes/)).toBeVisible();
    await exact.getByRole("link").click();
    await expect(page).toHaveURL(`/products/${fixture("search-product")}`);
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
});
