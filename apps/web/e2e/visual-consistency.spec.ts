import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "./fixtures";

const raw: unknown = process.env.PRICE_HISTORY_FIXTURE_IDS
  ? JSON.parse(process.env.PRICE_HISTORY_FIXTURE_IDS)
  : null;

function fixture(name: string): string {
  const value: unknown = typeof raw === "object" && raw !== null ? Reflect.get(raw, name) : null;
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/u.test(value)) {
    throw new Error("Run the owned visual fixtures after building");
  }
  return value;
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll("main *")]
      .filter((element) => element.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 8)
      .map((element) => ({
        tag: element.tagName,
        className: element.getAttribute("class"),
        right: element.getBoundingClientRect().right,
      })),
  }));
  expect(overflow.scroll, JSON.stringify({ url: page.url(), ...overflow })).toBeLessThanOrEqual(
    overflow.width + 1,
  );
}

async function keyboardDialog(page: Page) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName(/\S/u);
  await expect
    .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  for (let index = 0; index < 14; index++) {
    await page.keyboard.press("Tab");
    await expect
      .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
  }
  for (let index = 0; index < 4; index++) {
    await page.keyboard.press("Shift+Tab");
    await expect
      .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
  }
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [390, 1280]) {
    test(`visual consistency ${theme} ${width}`, async ({ page }) => {
      test.skip(!raw, "Requires isolated catalog fixtures");
      const stage = process.env.COMPRAFINO_VISUAL_STAGE ?? "after";
      const directory = resolve("../../.artifacts/visual-consistency", stage);
      await mkdir(directory, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.route("**/*", (route) => {
        if (route.request().resourceType() === "image") return route.abort();
        return route.continue();
      });
      async function capture(name: string) {
        await noOverflow(page);
        await page.screenshot({
          path: `${directory}/${name}-${width}-${theme}.png`,
          fullPage: !["editor", "basket", "login"].includes(name),
          animations: "disabled",
        });
      }
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Iniciar sesión", exact: true })).toBeEnabled();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();
      await page.keyboard.press("Enter");
      await page.getByRole("heading", { level: 1 }).click();
      await capture("home");
      await page.goto("/search?q=huevos+auditexperiencia");
      await expect(page.locator(".product-card").first()).toBeVisible();
      await capture("search");
      await page.goto(`/products/${fixture("rich")}`);
      await expect(page.locator(".detail-hero:not([aria-hidden])")).toBeVisible();
      await expect(page.locator(".recharts-surface")).toBeVisible();
      await capture("product");
      await page
        .locator('[aria-labelledby="history-title"]')
        .screenshot({ path: `${directory}/history-${width}-${theme}.png`, animations: "disabled" });
      const add = page.getByRole("button", { name: "Agregar a mi lista", exact: true });
      await add.focus();
      await add.press("Enter");
      await expect(page.getByRole("dialog")).toBeVisible();
      await keyboardDialog(page);
      await capture("editor");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(add).toBeFocused();
      await add.press("Enter");
      await page.getByRole("dialog").getByRole("button", { name: "Agregar", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.goto("/list");
      await expect(page.locator('article[id^="shopping-item-"]')).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Ver plan", exact: true })).toBeEnabled();
      await capture("list");
      await page.getByRole("button", { name: "Ver plan", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await keyboardDialog(page);
      await capture("basket");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await keyboardDialog(page);
      await capture("login");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Iniciar sesión", exact: true })).toBeFocused();
      await page.goto(`/listings/${fixture("independent")}`);
      await expect(page.locator(".detail-hero:not([aria-hidden])")).toBeVisible();
      await capture("listing");
      if (stage === "before") return;

      if (width === 390) {
        await page.setViewportSize({ width: 320, height: 568 });
        for (const path of [
          "/",
          "/search?q=huevos+auditexperiencia",
          `/products/${fixture("rich")}`,
          "/list",
        ]) {
          await page.goto(path);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          await noOverflow(page);
        }
        await page.getByRole("button", { name: /^Editar /u }).click();
        await keyboardDialog(page);
        await noOverflow(page);
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Guardar cambios", exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `${directory}/small-dialog-${theme}.png`,
          animations: "disabled",
        });
      }

      // CSS zoom exercises actual 200% text/control scaling; 640px viewport also
      // checks responsive reflow at the effective width of a 1280px browser zoom.
      if (width === 1280) {
        for (const path of [
          "/",
          "/search?q=huevos+auditexperiencia",
          `/products/${fixture("rich")}`,
          "/list",
        ]) {
          await page.goto(path);
          await page.evaluate(() => {
            document.documentElement.style.zoom = "2";
          });
          await noOverflow(page);
          await page.screenshot({
            path: `${directory}/zoom-${path.split("/")[1]?.split("?")[0] || "home"}-${theme}.png`,
            fullPage: true,
            animations: "disabled",
          });
        }
        await page.setViewportSize({ width: 640, height: 450 });
        await page.goto(`/products/${fixture("rich")}`);
        await page.getByRole("button", { name: "Agregar a mi lista", exact: true }).click();
        await keyboardDialog(page);
        await noOverflow(page);
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Actualizar existente", exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `${directory}/reflow-dialog-${theme}.png`,
          animations: "disabled",
        });
      }
      await writeFile(
        `${directory}/checks-${width}-${theme}.json`,
        JSON.stringify(
          {
            theme,
            width,
            keyboard: "Tab, Shift+Tab trapped; Escape closes; focus returns",
            overflow: false,
            zoom: width === 1280 ? "CSS 200% and 640px reflow" : "mobile",
          },
          null,
          2,
        ),
      );
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`visual contrast and feedback ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const measured = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      function luminance(hex: string) {
        const normalized = hex.length === 4 ? hex.replace(/[0-9a-f]/giu, "$&$&") : hex;
        const channels = normalized
          .replace("#", "")
          .match(/.{2}/gu)
          ?.map((value) => {
            const channel = Number.parseInt(value, 16) / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
        if (!channels || channels.length !== 3) throw new Error(`Expected hex color: ${hex}`);
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
      }
      const pairs: [string, string, number][] = [
        ["foreground", "background", 4.5],
        ["foreground", "surface", 4.5],
        ["muted-foreground", "background", 4.5],
        ["muted-foreground", "surface", 4.5],
        ["muted-foreground", "secondary", 4.5],
        ["muted-foreground", "benefit", 4.5],
        ["primary-foreground", "primary", 4.5],
        ["primary", "secondary", 4.5],
        ["primary", "surface", 4.5],
        ["primary", "background", 4.5],
        ["destructive", "destructive-surface", 4.5],
        ["disabled-foreground", "disabled", 4.5],
        ["control-border", "surface", 3],
        ["control-border", "background", 3],
        ["control-hover", "surface-hover", 3],
        ...["tottus", "plaza", "metro", "makro"].map((retailer): [string, string, number] => [
          `${retailer}-text`,
          `${retailer}-bg`,
          4.5,
        ]),
      ];
      return pairs.map(([foreground, background, minimum]) => {
        const text = styles.getPropertyValue(`--${foreground}`).trim();
        const surface = styles.getPropertyValue(`--${background}`).trim();
        const first = luminance(text),
          second = luminance(surface);
        const ratio = (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
        return { foreground, background, text, surface, ratio, minimum };
      });
    });
    for (const pair of measured) {
      expect(pair.ratio, `${pair.foreground}/${pair.background}`).toBeGreaterThanOrEqual(
        pair.minimum,
      );
    }
    const directory = resolve("../../.artifacts/visual-consistency/after");
    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/contrast-${theme}.json`, JSON.stringify(measured, null, 2));
    const login = page.getByRole("button", { name: "Iniciar sesión", exact: true });
    await expect(login).toBeEnabled();
    await login.click();
    let release: () => void = () => {};
    const pending = new Promise<void>((resolvePending) => {
      release = resolvePending;
    });
    await page.route("**/api/auth/sign-in/social", async (route) => {
      await pending;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Unavailable" }),
      });
    });
    const google = page
      .getByRole("dialog")
      .getByRole("button", { name: /Continuar con Google|Conectando con Google/u });
    await google.click();
    await expect(google).toBeDisabled();
    await expect(google).toHaveAttribute("aria-busy", "true");
    await page.screenshot({ path: `${directory}/loading-${theme}.png`, animations: "disabled" });
    release();
    await expect(page.getByRole("alert")).toContainText("No pudimos iniciar sesión");
    await expect(google).toBeEnabled();
    await noOverflow(page);
    await page.screenshot({ path: `${directory}/error-${theme}.png`, animations: "disabled" });
    for (const control of await page.getByRole("dialog").locator("button, input, select").all()) {
      await expect(control).toHaveAccessibleName(/\S/u);
      const bounds = await control.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
    }
  });
}
