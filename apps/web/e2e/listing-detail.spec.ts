import { expect, test } from "@playwright/test";
const raw: unknown = process.env.PRICE_HISTORY_FIXTURE_IDS
  ? JSON.parse(process.env.PRICE_HISTORY_FIXTURE_IDS)
  : null;
function fixture(name: string): string {
  const value: unknown = typeof raw === "object" && raw !== null ? Reflect.get(raw, name) : null;
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/u.test(value))
    throw new Error("Run isolated listing fixtures");
  return value;
}
for (const id of ["invalid", "00000000-0000-4000-8000-000000000000"]) {
  test(`listing ID ${id} has safe not-found behavior`, async ({ page }) => {
    test.skip(
      !process.env.DATABASE_URL && id !== "invalid",
      "Unknown IDs require configured database",
    );
    await page.goto(`/listings/${id}`);
    await expect(page.getByRole("heading", { name: "No encontramos ese producto." })).toBeVisible();
  });
}
test.describe("isolated listing details", () => {
  test.skip(!raw, "Run pnpm test:e2e:history:local --listings after build");
  test("independent card, add control, separate source and delayed internal navigation", async ({
    page,
  }) => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/listings/${fixture("independent")}*`, async (route) => {
      if (route.request().headers().rsc === "1") await held;
      await route.continue();
    });
    await page.goto("/search?q=huevos+pardos");
    const card = page.locator(`[data-offer-id="${fixture("independent")}"]`);
    await expect(
      card.getByRole("link").filter({ hasText: "Huevos Pardos Tottus Bandeja 30un" }),
    ).toHaveAttribute("href", `/listings/${fixture("independent")}`);
    await expect(card.getByRole("link", { name: "Ver producto en Tottus" })).toHaveAttribute(
      "target",
      "_blank",
    );
    await page.context().route("https://www.tottus.com.pe/tottus-pe/articulo/1/test", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<title>Controlled retailer source</title>",
      }),
    );
    const sourceTab = page.waitForEvent("popup");
    await card.getByRole("link", { name: "Ver producto en Tottus" }).click();
    const popup = await sourceTab;
    await expect(popup).toHaveURL("https://www.tottus.com.pe/tottus-pe/articulo/1/test");
    await expect(page).toHaveURL(/\/search/);
    await popup.close();
    await card.getByRole("button", { name: "Agregar a mi lista", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).not.toContainText("Prefiero este producto");
    await expect(page).toHaveURL(/\/search/);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    try {
      await card.getByRole("link").filter({ hasText: "Huevos Pardos Tottus Bandeja 30un" }).click();
      await expect(
        page
          .locator(
            '.product-title-link[aria-busy="true"], [aria-label="Cargando detalle de producto"]',
          )
          .first(),
      ).toBeVisible();
    } finally {
      release();
    }
    await expect(page).toHaveURL(`/listings/${fixture("independent")}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Huevos Pardos Tottus Bandeja 30un",
    );
    await expect(page.getByText("Precio online para todos", { exact: true })).toBeVisible();
    await expect(page.getByText("S/ 49.90", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Comparar este producto entre/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Ver producto en Tottus/ })).toHaveAttribute(
      "href",
      "https://www.tottus.com.pe/tottus-pe/articulo/1/test",
    );
    await expect(
      page.getByText("Aún no tenemos suficiente historial para mostrar una tendencia.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.goBack();
    await expect(
      card.getByRole("link").filter({ hasText: "Huevos Pardos Tottus Bandeja 30un" }),
    ).toHaveAttribute("aria-busy", "false");
    await page.goForward();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
  test("safe canonical link and CMR are separate from single-retailer ordinary history", async ({
    page,
  }) => {
    await page.goto(`/listings/${fixture("listing-rich-tottus")}`);
    await expect(
      page.getByRole("link", { name: "Comparar este producto entre supermercados", exact: true }),
    ).toHaveAttribute("href", `/products/${fixture("rich")}`);
    await expect(page.getByText("S/ 5.40 con CMR", { exact: true })).toBeVisible();
    const history = page.getByRole("region", { name: "Historial del precio para todos" });
    await expect(history).not.toContainText("S/ 5.40");
    await expect(history.getByRole("article")).toHaveCount(1);
    await page.getByRole("button", { name: "Agregar a mi lista", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("Prefiero este producto");
  });
  test("URL ranges clip multi-state history and retain browser navigation", async ({ page }) => {
    await page.goto(`/listings/${fixture("listing-rich-metro")}`);
    const history = page.getByRole("region", { name: "Historial del precio para todos" });
    for (const [days, maximum] of [
      [7, "6.10"],
      [30, "6.20"],
      [90, "7.00"],
    ] as const) {
      await history.getByRole("link", { name: `${days} días`, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`range=${days}d`));
      await expect(history).toContainText(`Máximo registradoS/ ${maximum}`);
    }
    await page.goBack();
    await expect(history.getByRole("link", { name: "30 días", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
  test("listing history retains verified streaks and gaps", async ({ page }) => {
    for (const [kind, days, segments] of [
      ["continuous", 6, 1],
      ["gap", 2, 2],
    ] as const) {
      await page.goto(`/listings/${fixture(`listing-${kind}-metro`)}`);
      await expect(page.getByTestId("unchanged-insight")).toContainText(`${days} días`);
      await expect(
        page.locator(".verified-segment-metro .recharts-scatter-line .recharts-curve"),
      ).toHaveCount(segments);
    }
  });
  test("listing pages fit mobile and desktop in light and dark", async ({ page }, testInfo) => {
    for (const width of [390, 1440])
      for (const theme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: theme });
        await page.goto(`/listings/${fixture("listing-rich-metro")}`);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const fallback = page.getByText("Imagen no disponible", { exact: true });
        await expect(fallback).toBeVisible();
        // Product imagery keeps a white surface in either theme; its fallback
        // text must retain the image-specific dark color rather than page text.
        await expect(fallback).toHaveCSS("color", "rgb(89, 107, 96)");
        await expect(page.locator("[data-slot=chart]")).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: testInfo.outputPath(`listing-${width}-${theme}.png`),
          fullPage: true,
        });
      }
  });
});

test("explicit unavailable offer retains its listing history and recovery restores search", async ({
  page,
}) => {
  test.skip(!raw, "Run isolated listing fixtures after build");
  await page.goto("/search?q=huevos+availability");
  await expect(page.locator(`[data-offer-id="${fixture("listing-unavailable")}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-offer-id="${fixture("listing-recovered")}"]`)).toBeVisible();
  await page.goto(`/listings/${fixture("listing-unavailable")}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Huevos Availability unavailable Bandeja 30un",
  );
  await expect(
    page.locator(".detail-best-price").getByText("No disponible en la última consulta.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Precio online para todos", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Historial del precio para todos" })).toBeVisible();
  await page.goto(`/listings/${fixture("listing-recovered")}`);
  await expect(page.getByText("Precio online para todos", { exact: true })).toBeVisible();
  await expect(page.getByText("No disponible en la última consulta.", { exact: true })).toHaveCount(
    0,
  );
});
