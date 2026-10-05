import { expect, test } from "@playwright/test";
const raw: unknown = process.env.PRICE_HISTORY_FIXTURE_IDS
  ? JSON.parse(process.env.PRICE_HISTORY_FIXTURE_IDS)
  : null;
function fixture(name: string): string {
  if (typeof raw !== "object" || raw === null || !(name in raw))
    throw new Error("History fixtures unavailable");
  const value: unknown = Reflect.get(raw, name);
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/u.test(value))
    throw new Error("Invalid fixture ID");
  return value;
}
test.describe("isolated ordinary-history fixtures", () => {
  test.skip(!raw, "Run pnpm test:e2e:history with explicit TEST_DATABASE_URL after build");
  test("history follows offers, exposes ordinary transitions and keeps CMR separate", async ({
    page,
  }) => {
    await page.goto(`/products/${fixture("rich")}`);
    const section = page.getByRole("region", { name: "Historial del precio para todos" });
    await expect(section).toBeVisible();
    const metro = section.getByRole("article", { name: "Historial de Metro", exact: true });
    await expect(metro).toContainText("S/ 6.10");
    await expect(metro).toContainText("Mínimo registradoS/ 5.90");
    await expect(metro).toContainText("Máximo registradoS/ 6.10");
    await expect(metro).toContainText("subió de S/ 5.90 a S/ 6.10");
    await expect(page.getByText("S/ 5.40 con CMR").first()).toBeVisible();
    await expect(section).not.toContainText("S/ 5.40");
    await expect(section.locator("[data-slot=chart] svg")).toBeVisible();
    expect(
      await page
        .locator("#offers-title")
        .evaluate(
          (e) =>
            e.compareDocumentPosition(document.querySelector("#history-title")!) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
    ).toBeTruthy();
    for (const name of ["Metro", "Plaza Vea", "Tottus"])
      await expect(section.getByRole("button", { name, exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    await section.getByRole("button", { name: "Metro", exact: true }).click();
    await expect(section.getByRole("button", { name: "Metro", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
  test("URL range changes metrics and preserves benefits in both directions", async ({ page }) => {
    await page.goto(`/products/${fixture("rich")}?range=7d&priceMode=benefits`);
    const section = page.getByRole("region", { name: "Historial del precio para todos" });
    const metro = section.getByRole("article", { name: "Historial de Metro", exact: true });
    await section.getByRole("link", { name: "30 días", exact: true }).click();
    await expect(page).toHaveURL(/range=30d&priceMode=benefits/);
    await expect(metro).toContainText("Máximo registradoS/ 6.20");
    await section.getByRole("link", { name: "90 días", exact: true }).click();
    await expect(page).toHaveURL(/range=90d/);
    await expect(metro).toContainText("Máximo registradoS/ 7.00");
    await page.getByRole("combobox", { name: "Precios", exact: true }).click();
    await page.getByRole("option", { name: "Para todos", exact: true }).click();
    await expect(page).toHaveURL(/range=90d/);
    await section.getByRole("link", { name: "7 días", exact: true }).click();
    await expect(metro).toContainText("Máximo registradoS/ 6.10");
    await page.goBack();
    await expect(section.getByRole("link", { name: "90 días", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
  test("sparse and outside-range history show honest empty states", async ({ page }) => {
    await page.goto(`/products/${fixture("sparse")}`);
    await expect(
      page.getByText("Aún no tenemos suficiente historial para mostrar una tendencia.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator("[data-slot=chart]")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Compara en 3 supermercados" })).toBeVisible();
    await page.goto(`/products/${fixture("old")}`);
    await expect(
      page.getByText("No tenemos registros de precio en este rango.", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("[data-slot=chart]")).toHaveCount(0);
  });
  test("daily evidence connects steps, breaks gaps and supports safe retailer insights", async ({
    page,
  }) => {
    await page.goto(`/products/${fixture("continuous")}`);
    await expect(
      page.locator(".verified-segment-metro .recharts-scatter-line .recharts-curve"),
    ).toHaveCount(1);
    const metro = page.getByRole("article", { name: "Historial de Metro", exact: true });
    await expect(metro.getByTestId("unchanged-insight")).toHaveText(
      "Sin cambios observados durante 6 días.",
    );
    await page.goto(`/products/${fixture("gap")}`);
    await expect(
      page.locator(".verified-segment-metro .recharts-scatter-line .recharts-curve"),
    ).toHaveCount(2);
    await expect(metro.getByTestId("unchanged-insight")).toHaveText(
      "Sin cambios observados durante 2 días.",
    );
    await page.goto(`/products/${fixture("decrease")}`);
    await expect(metro.getByTestId("price-change-insight")).toContainText("Bajó S/ 1.50");
    await expect(metro.getByTestId("price-change-insight")).toContainText("20%");
    await expect(
      page.getByRole("region", { name: "Historial del precio para todos" }),
    ).not.toContainText("S/ 5.40");
  });
  test("coverage charts fit desktop and mobile in light and dark themes", async ({
    page,
  }, testInfo) => {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        for (const kind of ["continuous", "gap", "decrease"]) {
          await page.goto(`/products/${fixture(kind)}`);
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          const section = page.getByRole("region", { name: "Historial del precio para todos" });
          await section.scrollIntoViewIfNeeded();
          await expect(section.locator("[data-slot=chart]")).toBeVisible();
          // A flat SVG path has zero height, so Playwright's box-based visibility
          // check reports hidden even when its stroke is drawn.
          await expect
            .poll(() =>
              section
                .locator(".verified-segment .recharts-scatter-line .recharts-curve")
                .first()
                .evaluate(
                  (element) => element instanceof SVGPathElement && element.getBBox().width > 0,
                ),
            )
            .toBe(true);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          await section.screenshot({ path: testInfo.outputPath(`${kind}-${width}-${theme}.png`) });
        }
      }
    }
  });
  test("mobile history works in both themes with touch targets, tooltips and no overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`/products/${fixture("rich")}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.locator("[data-slot=chart]").scrollIntoViewIfNeeded();
      await expect(page.locator(".recharts-scatter-symbol").first()).toBeVisible();
      await page.locator(".recharts-scatter-symbol").first().dispatchEvent("mouseover");
      await expect(page.getByRole("tooltip")).toContainText("S/");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const toggle = page.getByRole("button", { name: "Metro", exact: true });
      expect((await toggle.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
  });
});
