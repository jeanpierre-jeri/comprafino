import { expect, test } from "@playwright/test";

test("theme follows system changes and persists an explicit choice across reload", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const theme = page.getByRole("combobox", { name: "Tema", exact: true });
  await expect(theme).toHaveText("Sistema");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await theme.click();
  await page.getByRole("option", { name: "Oscuro", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("comprafino-theme"))).toBe("dark");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(theme).toHaveText("Oscuro");
  await theme.click();
  await page.getByRole("option", { name: "Claro", exact: true }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await theme.click();
  await page.getByRole("option", { name: "Sistema", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("comprafino-theme"))).toBeNull();
});

test("theme popup supports Space, arrows, Enter, Escape and focus return on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const trigger = page.getByRole("combobox", { name: "Tema", exact: true });
  await trigger.focus();
  await trigger.press("Space");
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(page.getByRole("option", { name: "Sistema", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("option", { name: "Oscuro", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveText("Oscuro");
  await expect(trigger).toBeFocused();
  await trigger.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("unavailable storage falls back to system without breaking theme changes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage unavailable");
      },
    });
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("combobox", { name: "Tema", exact: true }).click();
  await page.getByRole("option", { name: "Claro", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("keyboard custom filters navigate immediately without native selects", async ({ page }) => {
  test.skip(
    !process.env.DATABASE_URL || !!process.env.COMPRAFINO_CONTROLLED_E2E,
    "Requires the persisted catalog",
  );
  await page.goto("/search?q=huevos");
  await expect(page.locator(".filter-surface select")).toHaveCount(0);
  const sort = page.getByRole("combobox", { name: "Ordenar", exact: true });
  await sort.focus();
  await sort.press("Enter");
  await expect(page.getByRole("option", { name: "Relevancia", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/sort=total-price/);
  await expect(sort).toHaveText("Menor precio total");
  await sort.press("Space");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(sort).toBeFocused();
  await page.goto("/search?q=leche&priceMode=benefits");
  await page.getByRole("combobox", { name: "Comparar por", exact: true }).click();
  await page.getByRole("option", { name: "litro", exact: true }).click();
  await expect(page).toHaveURL(/unit=L/);
  await expect(page.getByRole("combobox", { name: "Comparar por", exact: true })).toHaveText(
    "litro",
  );
});
