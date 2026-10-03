import { expect, it } from "vitest";
import {
  publicProduct,
  productImageUrl,
  retailerProductUrl,
  getCanonicalProductComparison,
  searchCanonicalProducts,
} from "./public-products.ts";
import { createDatabase } from "./client.ts";

const offer = {
  retailerId: "metro",
  retailerName: "Metro",
  title: "Leche Gloria Entera 946ml",
  url: "https://www.metro.pe/leche/p",
  imageUrl: "https://metroio.vteximg.com.br/arquivos/ids/1/milk.jpg",
  currentPriceCents: 590,
  regularPriceCents: 590,
  observedAt: "2026-10-03T09:00:00Z",
};
const raw = {
  id: "69c3625d-2d3e-8624-b483-2323e108f94b",
  displayName: "Leche Gloria Entera 946ml",
  brand: "Gloria",
  quantityValue: 946,
  quantityUnit: "ml",
  packageCount: 3,
  offers: [
    offer,
    {
      ...offer,
      retailerId: "plaza-vea",
      retailerName: "Plaza Vea",
      currentPriceCents: 620,
      regularPriceCents: 690,
      imageUrl: null,
    },
  ],
};
it("validates the public database boundary, orders prices and preserves retailer provenance", () => {
  const product = publicProduct(raw);
  expect(product.lowestPriceCents).toBe(590);
  expect(product.cheapestRetailers).toEqual(["Metro"]);
  expect(product.retailerCount).toBe(2);
  expect(product.offers[0]).toMatchObject({
    retailerId: "metro",
    retailerName: "Metro",
    regularPriceCents: null,
    observedAt: new Date(offer.observedAt),
  });
  expect(product.offers[1]!.regularPriceCents).toBe(690);
  expect(() => publicProduct({ ...raw, offers: [offer] })).toThrow(/Too small|Invalid option/u);
  expect(() => publicProduct({ ...raw, quantityUnit: "unknown" })).toThrow(
    /Too small|Invalid option/u,
  );
});
it("retains tied retailers, drops lower references, chooses images independently of prices", () => {
  const product = publicProduct({
    ...raw,
    offers: [
      offer,
      {
        ...raw.offers[1],
        currentPriceCents: 590,
        regularPriceCents: 580,
        imageUrl: "https://plazavea.vteximg.com.br/arquivos/ids/1/a.jpg",
      },
    ],
  });
  expect(product.cheapestRetailers).toEqual(["Metro", "Plaza Vea"]);
  expect(product.offers[1]!.regularPriceCents).toBeNull();
  expect(product.imageUrl).toBe(offer.imageUrl);
});
it("only exposes trusted HTTPS retailer sources and known images", () => {
  expect(retailerProductUrl({ retailerId: "metro", url: offer.url })).toBe(offer.url);
  for (const url of [
    "javascript:alert(1)",
    "https://www.metro.pe.evil.test/p",
    "https://user:pass@www.metro.pe/p",
    "http://www.metro.pe/p",
    "https://www.metro.pe:444/p",
    "invalid",
    "https://www.plazavea.com.pe/p",
  ]) {
    expect(retailerProductUrl({ retailerId: "metro", url })).toBeNull();
  }
  expect(productImageUrl("https://evil.test/image.jpg")).toBeNull();
  expect(productImageUrl(null)).toBeNull();
  expect(productImageUrl("https://metroio.vteximg.com.br/unrelated/image.jpg")).toBeNull();
});
it("blank, short, excessive queries and malformed IDs return without querying PostgreSQL", async () => {
  const db = createDatabase({ DATABASE_URL: "postgresql://unused@localhost/unused" });
  for (const q of ["", " ", "a", "gloria".repeat(30)])
    expect(await searchCanonicalProducts(db, q)).toEqual([]);
  expect(await getCanonicalProductComparison(db, "not-a-uuid")).toBeNull();
});
