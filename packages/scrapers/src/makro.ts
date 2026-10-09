import { createPlazaStorefrontAdapter, parsePlazaStorefrontPage } from "./plaza-storefront.ts";
import type { PlazaStorefront } from "./plaza-storefront.ts";
import type { VtexCategory } from "./staple-categories.ts";

// Public Makro homepage declares jssalesChannel=9; channel 1 is unavailable.
const storefront = {
  retailer: "makro",
  name: "Makro",
  origin: "https://www.makro.plazavea.com.pe",
  salesChannel: "9",
} as const satisfies PlazaStorefront;

export const makroCatalogUrl = `${storefront.origin}/api/catalog_system/pub/products/search`;

export function parseMakroPage(raw: unknown, observedAt: Date) {
  return parsePlazaStorefrontPage(raw, observedAt, storefront);
}

export function createMakroAdapter(
  fetchPage: typeof fetch = fetch,
  category: VtexCategory = "dairy",
) {
  return createPlazaStorefrontAdapter(storefront, fetchPage, category);
}
