import { expect, test } from "@playwright/test";

const raw: unknown = process.env.PRICE_HISTORY_FIXTURE_IDS
  ? JSON.parse(process.env.PRICE_HISTORY_FIXTURE_IDS)
  : null;

function fixture(name: string): string {
  const value: unknown = typeof raw === "object" && raw !== null ? Reflect.get(raw, name) : null;

  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/u.test(value)) {
    throw new Error("Run isolated listing fixtures");
  }

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
  test("buying actions sit beside the price, precede history, and have no duplicate or empty links", async ({
    page,
  }, testInfo) => {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [kind, id, comparison] of [
        ["listing", fixture("listing-rich-tottus"), true],
        ["independent", fixture("independent"), false],
        ["product", fixture("rich"), true],
      ] as const) {
        await page.goto(`/${kind === "product" ? "products" : "listings"}/${id}`);
        const actions = page.getByRole("group", { name: "Acciones de compra", exact: true });
        await expect(
          page.locator(".detail-hero").getByRole("group", { name: "Acciones de compra" }),
        ).toBeVisible();
        const add = actions.getByRole("button", { name: "Agregar a mi lista", exact: true });
        await expect(add).toHaveCount(1);
        await expect(add).toBeEnabled();
        const compare = actions.getByRole("link", {
          name: "Comparar entre supermercados",
          exact: true,
        });
        await expect(compare).toHaveCount(comparison ? 1 : 0);
        if (comparison) {
          expect(
            await compare.evaluate((element) => getComputedStyle(element).backgroundColor),
          ).not.toBe(await add.evaluate((element) => getComputedStyle(element).backgroundColor));
        }
        const external = actions.getByRole("link", { name: /^Ver producto en/ });
        await expect(external).toHaveCount(kind === "product" ? 4 : 1);
        for (const link of await external.all()) {
          await expect(link).toHaveAttribute("target", "_blank");
          await expect(link).toHaveAttribute("rel", "noopener noreferrer");
          await expect(link).toContainText("nueva pestaña");
        }
        const links = await page
          .locator('main a[target="_blank"]')
          .evaluateAll((elements) => elements.map((element) => element.getAttribute("href")));
        expect(links.every(Boolean)).toBe(true);
        expect(new Set(links).size).toBe(links.length);
        expect(
          await actions.evaluate((element) => {
            const history = document.querySelector('[aria-labelledby="history-title"]');
            return (
              !!history &&
              Boolean(element.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING)
            );
          }),
        ).toBe(true);
        await expect(
          page.getByRole("link", { name: "Buscar otro producto", exact: true }),
        ).toHaveAttribute("href", "/search");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page
          .locator(".detail-hero")
          .screenshot({ path: testInfo.outputPath(`actions-${kind}-${width}.png`) });
        await add.click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.keyboard.press("Escape");
      }
    }
  });

  test("return preserves query, filters, page and scroll through a reload and history range", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const search =
      "/search?q=auditpaginacion&retailer=metro&sort=total-price&priceMode=benefits&page=2";
    await page.goto(search);
    const card = page.locator("[data-offer-id]").last();
    const title = card.locator(".product-title-link");
    await title.scrollIntoViewIfNeeded();
    const position = await page.evaluate(() => Math.round(scrollY));
    expect(position).toBeGreaterThan(100);
    await title.click();
    await expect(page).toHaveURL(/\/listings\//);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const returnTo = new URL(page.url()).searchParams.get("returnTo");
    expect(returnTo).toBe(`${search}#scroll=${position}`);
    await page.reload();
    await page.getByRole("link", { name: "7 días", exact: true }).click();
    await expect(page).toHaveURL(/range=7d/);
    const back = page.getByRole("link", { name: "Volver a resultados", exact: true });
    await expect(back).toHaveAttribute("href", returnTo!);
    await back.click();
    await expect(page).toHaveURL(`${search}#scroll=${position}`);
    await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBe(position);
    await expect(page.getByLabel("¿Qué necesitas comprar?")).toHaveValue("auditpaginacion");
    await expect(page.getByText(/Página 2 ·/)).toBeVisible();
  });

  test("comparison and price controls keep the search return; external return destinations are rejected", async ({
    page,
  }) => {
    await page.goto("/search?q=gloria&priceMode=benefits");
    await page.locator(`[data-product-id="${fixture("rich")}"] .product-title-link`).click();
    const back = page.getByRole("link", { name: "Volver a resultados", exact: true });
    const destination = await back.getAttribute("href");
    await page.getByRole("combobox", { name: "Precios", exact: true }).click();
    await page.getByRole("option", { name: "Incluir beneficios", exact: true }).click();
    await expect(page).toHaveURL(/priceMode=benefits/);
    await page.getByRole("link", { name: "7 días", exact: true }).click();
    await expect(page).toHaveURL(/range=7d/);
    await expect(back).toHaveAttribute("href", destination!);
    await back.click();
    await expect(page).toHaveURL(new RegExp("/search\\?q=gloria&priceMode=benefits"));

    for (const path of [`/listings/${fixture("independent")}`, `/products/${fixture("rich")}`]) {
      for (const unsafe of [
        "https://evil.example/search",
        "//evil.example/search",
        "/list",
        "/search/../list",
      ]) {
        await page.goto(`${path}?returnTo=${encodeURIComponent(unsafe)}`);
        await expect(
          page.getByRole("link", { name: "Buscar otro producto", exact: true }),
        ).toHaveAttribute("href", "/search");
        await expect(
          page.getByRole("link", { name: "Volver a resultados", exact: true }),
        ).toHaveCount(0);
      }
    }
  });

  test("modified clicks preserve the results and scroll in a new detail tab", async ({
    page,
    context,
  }) => {
    await page.goto("/search?q=gloria&priceMode=benefits");
    await expect(
      page.getByRole("button", { name: "Agregar a mi lista", exact: true }).first(),
    ).toBeEnabled();
    for (const selector of [".product-title-link", "a.comparison-link"]) {
      const link = page.locator(selector).last();
      await link.scrollIntoViewIfNeeded();
      const position = await page.evaluate(() => Math.round(scrollY));
      const newTab = context.waitForEvent("page");
      await link.click({ modifiers: ["ControlOrMeta"] });
      const detail = await newTab;
      await detail.waitForLoadState();
      const back = detail.getByRole("link", { name: "Volver a resultados", exact: true });
      await expect(back).toHaveAttribute(
        "href",
        `/search?q=gloria&priceMode=benefits#scroll=${position}`,
      );
      await expect(page).toHaveURL(/\/search\?q=gloria&priceMode=benefits$/);
      await detail.close();
    }
  });

  test("independent card, add control, separate source and delayed internal navigation", async ({
    page,
  }) => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/listings/${fixture("independent")}*`, async (route) => {
      if (route.request().headers().rsc === "1") {
        await held;
      }

      await route.continue();
    });
    await page.goto("/search?q=huevos+pardos");
    const card = page.locator(`[data-offer-id="${fixture("independent")}"]`);
    await expect(
      card.getByRole("link").filter({ hasText: "Huevos Pardos Tottus Bandeja 30un" }),
    ).toHaveAttribute("href", new RegExp(`^/listings/${fixture("independent")}\\?returnTo=`));
    await expect(card.getByText("Disponibilidad no confirmada.", { exact: true })).toBeVisible();
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
    await page.getByRole("button", { name: "Ajustar sustituciones y frecuencia" }).click();
    await expect(page.getByRole("dialog").getByRole("radio")).toHaveCount(2);
    await expect(
      page.getByRole("radio", { name: "Prefiero este producto", exact: true }),
    ).toBeChecked();
    await expect(page.getByLabel("Paquetes", { exact: true })).toHaveValue("1");
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

    await expect(page).toHaveURL(new RegExp(`/listings/${fixture("independent")}\\?returnTo=`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Huevos Pardos Tottus Bandeja 30un",
    );
    await expect(
      page.getByText("Precio online sin tarjeta ni membresía", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("S/ 49.90", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Comparar entre/ })).toHaveCount(0);
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
    await expect(page.locator(".detail-best-price")).toContainText("Disponibilidad no confirmada.");
    await expect(
      page.getByRole("link", { name: "Comparar entre supermercados", exact: true }),
    ).toHaveAttribute("href", `/products/${fixture("rich")}`);
    await expect(page.getByText("S/ 5.40 con tarjeta CMR", { exact: true })).toBeVisible();
    const history = page.getByRole("region", {
      name: "Historial de precios sin tarjeta ni membresía",
    });
    await expect(history).not.toContainText("S/ 5.40");
    await expect(history.getByRole("article")).toHaveCount(1);
    await page.getByRole("button", { name: "Agregar a mi lista", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("region", { name: "Resumen de preferencias" })).toContainText(
      "Prefieres este producto",
    );
  });
  test("search shows one product grid without a comparison section in both themes", async ({
    page,
  }, testInfo) => {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await page.goto("/search?q=gloria");
        const section = page.getByRole("region", { name: "Opciones en supermercados" });
        await expect(
          section.getByRole("heading", { name: "Productos", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("region", { name: "Comparaciones del mismo producto" }),
        ).toHaveCount(0);
        await expect(page.getByRole("button", { name: /^Ver más comparaciones/ })).toHaveCount(0);
        await expect(section.locator("ul")).toHaveCount(1);
        await expect(section.locator("[data-offer-id]").first()).toBeVisible();
        await expect(section.locator(".product-title").first()).toContainText("Leche Gloria");
        await expect(section.locator(".card-amount").first()).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await section.screenshot({ path: testInfo.outputPath(`products-${width}-${theme}.png`) });
      }
    }
  });
  test("canonical comparisons disclose unknown stock beside ordinary prices", async ({ page }) => {
    await page.goto("/search?q=gloria");
    await expect(page.locator("[data-offer-id]").first()).toContainText(
      "Disponibilidad no confirmada.",
    );
    await page.goto(`/products/${fixture("rich")}`);
    const offers = page
      .getByRole("region", { name: /^Precios y registros en/ })
      .getByRole("article");
    await expect(offers.first()).toContainText("Disponibilidad no confirmada.");
    await expect(offers.first()).toContainText("Precio online sin tarjeta ni membresía");
    await page.goto(`/products/${fixture("old")}`);
    const historicalOffer = page
      .getByRole("region", { name: /^Precios y registros en/ })
      .getByRole("article")
      .first();
    await expect(historicalOffer).toContainText("Disponibilidad no confirmada.");
    await expect(historicalOffer).toContainText(
      "Último precio registrado · pendiente de actualización.",
    );
  });
  test("ordinary and CMR unit references stay separate in both search modes and details", async ({
    page,
  }) => {
    for (const mode of ["standard", "benefits"]) {
      await page.goto(`/search?q=leche+gloria&priceMode=${mode}`);
      const card = page.locator(`[data-product-id="${fixture("rich")}"]`);
      await expect(card.getByText("S/ 6.45 / L", { exact: true })).toBeVisible();
      await expect(card.locator(".benefit-surface")).toContainText("S/ 5.71 / L · con tarjeta CMR");
      await expect(card.locator(".benefit-surface")).toContainText("Requiere tarjeta CMR");
    }
    await page.goto(`/listings/${fixture("listing-rich-tottus")}`);
    await expect(page.locator(".detail-hero .benefit-surface")).toContainText(
      "S/ 5.71 / L · con tarjeta CMR",
    );
    await page.goto(`/products/${fixture("rich")}`);
    await expect(page.locator(".detail-hero .benefit-surface")).toContainText(
      "S/ 5.71 / L · con tarjeta CMR",
    );
    const tottus = page
      .getByRole("region", { name: /^Precios y registros en/ })
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: "Tottus", exact: true }) });
    await expect(tottus.locator(".benefit-surface")).toContainText("S/ 5.71 / L · con tarjeta CMR");
  });
  test("URL ranges clip multi-state history and retain browser navigation", async ({ page }) => {
    await page.goto(`/listings/${fixture("listing-rich-metro")}`);
    const history = page.getByRole("region", {
      name: "Historial de precios sin tarjeta ni membresía",
    });

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
      const paths = page.locator(".verified-segment-metro .recharts-scatter-line .recharts-curve");
      await expect(paths.first()).toHaveAttribute("stroke-width", "2.5");
      const boundaries = page.locator(".verified-segment-metro .coverage-boundary");
      await expect(boundaries).toHaveCount(segments * 2);
      await boundaries.nth(1).dispatchEvent("mouseover");
      await expect(page.getByRole("tooltip")).toContainText(
        "Inicio o fin de un tramo con consultas",
      );
      await expect(page.getByRole("tooltip")).toContainText("Metro · S/ 6.50");
      const tickPrices = await page
        .locator(".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value")
        .allTextContents();
      expect(tickPrices.length).toBeGreaterThanOrEqual(2);
      const amounts = tickPrices.map((label) => Number(label.replace("S/", "").trim()));
      // Constant prices must have a useful scale, rather than a few cents of artificial zoom.
      expect(Math.max(...amounts) - Math.min(...amounts)).toBeGreaterThanOrEqual(1);
      await page.getByRole("button", { name: "Metro", exact: true }).click();
      await expect(boundaries).toHaveCount(0);
      await expect(paths).toHaveCount(0);
      await expect(
        page.getByText("Selecciona un supermercado para ver sus registros."),
      ).toBeVisible();
    }
  });
  test("listing pages fit mobile and desktop in light and dark", async ({ page }, testInfo) => {
    for (const width of [390, 1440]) {
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
  await expect(page.locator(`[data-offer-id="${fixture("listing-recovered")}"]`)).toContainText(
    "Disponible en la última consulta.",
  );
  await page.goto(`/listings/${fixture("listing-unavailable")}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Huevos Availability unavailable Bandeja 30un",
  );
  await expect(
    page.locator(".detail-best-price").getByText("No disponible en la última consulta.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Precio online sin tarjeta ni membresía", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Historial de precios sin tarjeta ni membresía" }),
  ).toBeVisible();
  await page.goto(`/listings/${fixture("listing-recovered")}`);
  await expect(
    page.getByText("Precio online sin tarjeta ni membresía", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No disponible en la última consulta.", { exact: true })).toHaveCount(
    0,
  );
});
