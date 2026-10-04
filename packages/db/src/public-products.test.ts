import { expect, it } from "vitest";
import {
  publicProduct as mapPublicProduct,
  productImageUrl,
  retailerProductUrl,
  getCanonicalProductComparison,
  searchCanonicalProducts,
} from "./public-products.ts";
import { createDatabase } from "./client.ts";

const now = new Date("2026-10-03T10:00:00Z");
const publicProduct = (raw: unknown) => mapPublicProduct(raw, now);
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

it("preserves products with all stale prices and excludes stale or unavailable cheapest candidates", () => {
  const old = { ...offer, observedAt: "2026-09-30T00:00:00Z", currentPriceCents: 1 };
  const current = publicProduct({ ...raw, offers: [old, raw.offers[1]] });
  expect(current.lowestPriceCents).toBe(620);
  expect(current.cheapestRetailers).toEqual(["Plaza Vea"]);
  expect(current.offers[0]!.freshness).toBe("too-stale");
  const stale = publicProduct({
    ...raw,
    offers: [old, { ...old, retailerId: "plaza-vea", retailerName: "Plaza Vea" }],
  });
  expect(stale.lowestPriceCents).toBeNull();
  expect(stale.cheapestRetailers).toEqual([]);
  const unavailable = publicProduct({
    ...raw,
    offers: [{ ...offer, available: false }, raw.offers[1]],
  });
  expect(unavailable.lowestPriceCents).toBe(620);
});

it("keeps the ordinary winner while explicitly selecting benefits, ties and program identity", () => {
  const cmr = {
    conditionType: "payment_card",
    programKey: "cmr",
    conditionLabel: "Requiere tarjeta CMR",
    priceCents: 550,
    observedAt: now,
  };
  const input = {
    ...raw,
    offers: [
      offer,
      { ...raw.offers[1], retailerId: "tottus", retailerName: "Tottus", conditionalOffers: [cmr] },
    ],
  };
  const standard = mapPublicProduct(input, now);
  expect(standard.lowestPriceCents).toBe(590);
  expect(standard.bestRanking?.retailers).toEqual(["Metro"]);
  const benefits = mapPublicProduct(input, now, "benefits");
  expect(benefits.lowestPriceCents).toBe(590);
  expect(benefits.bestRanking).toEqual({
    priceCents: 550,
    retailers: ["Tottus"],
    conditions: ["Requiere tarjeta CMR"],
  });
  const tied = mapPublicProduct(
    { ...input, offers: [{ ...offer, currentPriceCents: 550 }, input.offers[1]] },
    now,
    "benefits",
  );
  expect(tied.bestRanking?.retailers).toEqual(["Metro", "Tottus"]);
  const stale = mapPublicProduct(
    {
      ...input,
      offers: [
        offer,
        { ...input.offers[1], conditionalOffers: [{ ...cmr, observedAt: new Date("2026-09-01") }] },
      ],
    },
    now,
    "benefits",
  );
  expect(stale.bestRanking?.retailers).toEqual(["Metro"]);
});
