import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function holdNavigation(
  page: Page,
  pathname: string | RegExp,
  query?: string,
  includePrefetch = false,
) {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  let navigationRequests = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = request.headers();
    if (
      (typeof pathname === "string" ? url.pathname === pathname : pathname.test(url.pathname)) &&
      (query === undefined || url.searchParams.get("q") === query) &&
      headers.rsc === "1" &&
      (includePrefetch || !headers["next-router-prefetch"])
    ) {
      requests++;
      if (!headers["next-router-prefetch"]) navigationRequests++;
      await held;
    }
    await route.continue();
  });
  return { release, count: () => requests, navigationCount: () => navigationRequests };
}

test("search immediately responds, prevents repeated submits, and restores back/forward state", async ({
  page,
}) => {
  // Form and chip prefetches share the search route tree. Hold them before
  // loading the homepage so cached partial shells cannot bypass the delay.
  const held = await holdNavigation(page, "/search", undefined, true);
  await page.goto("/");
  try {
    await page.getByLabel("¿Qué necesitas comprar?").fill("a");
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    await expect(
      page
        .locator('form[aria-busy="true"], [aria-label="Cargando resultados de búsqueda"]')
        .first(),
    ).toBeVisible({ timeout: 1000 });
    // Loading can replace the form between Playwright calls. Read the attached
    // form and exercise repeated submits in one browser task.
    const pendingForm = await page.evaluate(() => {
      const form = document.querySelector('form[aria-busy="true"]');
      if (!(form instanceof HTMLFormElement)) return null;
      const button = form.querySelector('button[type="submit"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Expected search button");
      const state = { disabled: button.disabled, label: button.textContent };
      form.requestSubmit();
      form.requestSubmit();
      return state;
    });
    if (pendingForm) expect(pendingForm).toEqual({ disabled: true, label: "Buscando…" });
    await expect.poll(held.navigationCount).toBe(1);
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

for (const theme of ["light", "dark"] as const) {
  // Each theme gets a fresh context so the previous search cannot satisfy
  // navigation from the Next.js router cache before we observe feedback.
  test(`mobile keyboard chip navigation responds in either theme and respects reduced motion (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    // Hold prefetch as well as navigation before the chip enters the viewport.
    // Both requests still reach the real server once feedback is checked.
    const held = await holdNavigation(page, "/search", "huevos", true);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const chip = page.locator('.search-chip[href="/search?q=huevos"]');
    try {
      await chip.focus();
      expect(await chip.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe(
        "0s",
      );
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
      await expect.poll(held.count).toBeGreaterThan(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    } finally {
      held.release();
    }
    await expect(page).toHaveURL(/\/search\?q=huevos$/);
    // URL commit can precede the streamed catalog response. Retry readiness
    // within the test budget rather than treating ordinary query latency as failure.
    await expect(page.getByRole("button", { name: "Buscar", exact: true })).toBeEnabled({
      timeout: 15_000,
    });
    await page.unrouteAll({ behavior: "wait" });
  });
}

test("exact comparison cards immediately respond while detail data is delayed", async ({
  page,
}) => {
  test.skip(!process.env.DATABASE_URL, "Requires the explicitly configured persisted catalog");
  // The destination is only known after search renders. Hold every product RSC
  // request, including Link prefetches, before any card can populate the router cache.
  const held = await holdNavigation(page, /^\/products\/[^/]+$/u, undefined, true);
  await page.goto("/search?q=gloria+946");
  const card = page.locator(".exact-card a.navigation-link").first();
  await expect(card).toBeVisible();
  const href = await card.getAttribute("href");
  if (!href) throw new Error("Comparison URL missing");
  const pathname = new URL(href, page.url()).pathname;
  try {
    await card.click();
    await expect(
      page
        .locator('.exact-card a[aria-busy="true"], [aria-label="Cargando comparación de producto"]')
        .first(),
    ).toBeVisible({ timeout: 1000 });
    await page.evaluate((destination) => {
      const link = Array.from(document.querySelectorAll(".exact-card a.navigation-link")).find(
        (element) => element.getAttribute("href") === destination,
      );
      if (link instanceof HTMLAnchorElement) {
        link.click();
        link.click();
      }
    }, href);
    await expect.poll(held.count).toBeGreaterThan(0);
  } finally {
    held.release();
  }
  await expect(page).toHaveURL(new RegExp(pathname, "u"));
  await expect(page.locator("#offers-title")).toBeVisible();
  await page.unrouteAll({ behavior: "wait" });
  await page.goBack();
  await expect(card).toHaveAttribute("aria-busy", "false");
});
