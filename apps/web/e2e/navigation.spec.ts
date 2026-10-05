import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function holdNavigation(page: Page, pathname: string, query?: string) {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = request.headers();
    if (
      url.pathname === pathname &&
      (query === undefined || url.searchParams.get("q") === query) &&
      headers.rsc === "1" &&
      !headers["next-router-prefetch"]
    ) {
      requests++;
      await held;
    }
    await route.continue();
  });
  return { release, count: () => requests };
}

test("search immediately responds, prevents repeated submits, and restores back/forward state", async ({
  page,
}) => {
  await page.goto("/");
  const held = await holdNavigation(page, "/search", "a");
  try {
    await page.getByLabel("¿Qué necesitas comprar?").fill("a");
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    await expect(
      page
        .locator('form[aria-busy="true"], [aria-label="Cargando resultados de búsqueda"]')
        .first(),
    ).toBeVisible({ timeout: 1000 });
    const form = page.locator('form[aria-busy="true"]');
    if (await form.isVisible()) {
      await expect(page.getByRole("button", { name: "Buscando…", exact: true })).toBeDisabled();
      await form.evaluate((element) => {
        if (!(element instanceof HTMLFormElement)) throw new Error("Expected search form");
        element.requestSubmit();
        element.requestSubmit();
      });
    }
    await expect.poll(held.count).toBe(1);
  } finally {
    held.release();
  }
  await expect(page).toHaveURL(/\/search\?q=a$/);
  await expect(page.getByRole("button", { name: "Buscar", exact: true })).toBeEnabled();
  await page.unrouteAll({ behavior: "wait" });
  const next = await holdNavigation(page, "/search", "b");
  try {
    await page.getByLabel("¿Qué necesitas comprar?").fill("b");
    await page.getByLabel("¿Qué necesitas comprar?").press("Enter");
    await expect(
      page
        .locator('form[aria-busy="true"], [aria-label="Cargando resultados de búsqueda"]')
        .first(),
    ).toBeVisible({ timeout: 1000 });
  } finally {
    next.release();
  }
  await expect(page).toHaveURL(/\/search\?q=b$/);
  await expect(page.getByRole("button", { name: "Buscar", exact: true })).toBeEnabled();
  await page.goBack();
  await expect(page.getByLabel("¿Qué necesitas comprar?")).toHaveValue("a");
  await page.goForward();
  await expect(page.getByLabel("¿Qué necesitas comprar?")).toHaveValue("b");
  await expect(page.getByRole("button", { name: "Buscar", exact: true })).toBeEnabled();
});

test("mobile keyboard chip navigation responds in either theme and respects reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const held = await holdNavigation(page, "/search", "huevos");
    const chip = page.locator('.search-chip[href="/search?q=huevos"]');
    try {
      await chip.focus();
      await chip.press("Enter");
      await expect(
        page
          .locator('.search-chip[aria-busy="true"], [aria-label="Cargando resultados de búsqueda"]')
          .first(),
      ).toBeVisible({ timeout: 1000 });
      // The loading boundary may replace the homepage between Playwright calls.
      // Inspect and exercise an attached chip in one browser task.
      const pendingState = await page.evaluate(() => {
        const link = document.querySelector('.search-chip[href="/search?q=huevos"]');
        const attributes =
          link instanceof HTMLAnchorElement
            ? { busy: link.getAttribute("aria-busy"), disabled: link.getAttribute("aria-disabled") }
            : null;
        if (link instanceof HTMLAnchorElement) {
          link.click();
          link.click();
        }
        const skeleton = document.querySelector(
          '[aria-label="Cargando resultados de búsqueda"] [aria-hidden="true"]',
        );
        return {
          attributes,
          animationName: skeleton ? getComputedStyle(skeleton).animationName : null,
        };
      });
      if (pendingState.attributes)
        expect(pendingState.attributes).toEqual({ busy: "true", disabled: "true" });
      if (pendingState.animationName !== null) expect(pendingState.animationName).toBe("none");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    } finally {
      held.release();
    }
    await expect(page).toHaveURL(/\/search\?q=huevos$/);
    await expect(page.getByRole("button", { name: "Buscar", exact: true })).toBeEnabled();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("exact comparison cards immediately respond while detail data is delayed", async ({
  page,
}) => {
  test.skip(!process.env.DATABASE_URL, "Requires the explicitly configured persisted catalog");
  await page.goto("/search?q=gloria+946");
  const card = page.locator(".exact-card a.navigation-link").first();
  await expect(card).toBeVisible();
  const href = await card.getAttribute("href");
  if (!href) throw new Error("Comparison URL missing");
  const pathname = new URL(href, page.url()).pathname;
  const held = await holdNavigation(page, pathname);
  try {
    await card.click();
    await expect(
      page
        .locator('.exact-card a[aria-busy="true"], [aria-label="Cargando comparación de producto"]')
        .first(),
    ).toBeVisible({ timeout: 1000 });
    if (await card.isVisible()) {
      await card.evaluate((element) => {
        if (!(element instanceof HTMLAnchorElement)) throw new Error("Expected comparison link");
        element.click();
        element.click();
      });
    }
  } finally {
    held.release();
  }
  await expect(page).toHaveURL(new RegExp(pathname, "u"));
  await expect(page.locator("#offers-title")).toBeVisible();
  await page.goBack();
  await expect(card).toHaveAttribute("aria-busy", "false");
});
