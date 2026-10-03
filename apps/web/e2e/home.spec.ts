import { expect, test } from "@playwright/test";

test("homepage explains the product and honestly marks search as upcoming", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/CompraFino/);
  await expect(page.locator("html")).toHaveAttribute("lang", "es-PE");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Compra mejor.Paga menos.");
  await expect(page.getByLabel("¿Qué necesitas comprar?")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Buscar" })).toBeDisabled();
  await expect(page.getByText("Próximamente.", { exact: false })).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveText(["Tottus", "Plaza Vea", "Metro"]);
});
