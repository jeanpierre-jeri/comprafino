import { expect, it } from "vitest";
import fixture from "./fixtures/tottus-conditional.json";
import pv from "./fixtures/plaza-vea.json";
import metro from "./fixtures/metro.json";
import { normalizeTottusProduct } from "./tottus-parser.ts";
import { parsePlazaVeaPage } from "./plaza-vea.ts";
import { parseMetroPage } from "./metro.ts";

const now = new Date(fixture.observedAt);

it("extracts seven observed CMR prices separately from ordinary and reference amounts", () => {
  const listings = fixture.products.map((p) => normalizeTottusProduct(p, now));
  expect(listings.filter((l) => l.conditionalOffers?.length)).toHaveLength(7);
  expect(listings[0]).toMatchObject({
    currentPriceCents: 2190,
    regularPriceCents: 2460,
    conditionalOffers: [
      {
        priceCents: 2090,
        programKey: "cmr",
        conditionType: "payment_card",
        conditionLabel: "Requiere tarjeta CMR",
        observedAt: now,
      },
    ],
  });
  expect(listings.at(-1)?.conditionalOffers).toEqual([]);
});

it("ignores malformed, missing-program, crossed, duplicate or non-lower card prices without replacing ordinary price", () => {
  const product = fixture.products[0]!;
  const cmr = product.prices.find((p) => p.type === "cmrPrice")!;

  for (const prices of [
    [{ ...cmr, icons: undefined }],
    [{ ...cmr, crossed: true }],
    [{ ...cmr, price: [] }],
    [{ ...cmr, price: ["bad"] }],
    [{ ...cmr, price: ["0"] }],
    [{ ...cmr, price: ["25.00"] }],
    [cmr, cmr],
  ]) {
    const result = normalizeTottusProduct(
      { ...product, prices: [...product.prices.filter((p) => p.type !== "cmrPrice"), ...prices] },
      now,
    );
    expect(result.currentPriceCents).toBe(2190);
    expect(result.regularPriceCents).toBe(2460);
    expect(result.conditionalOffers).toEqual([]);
  }
});

it("does not invent payable prices from Plaza Vea or Metro promotion teasers", () => {
  for (const listings of [
    parsePlazaVeaPage(pv, now).listings,
    parseMetroPage(metro, now).listings,
  ]) {
    expect(listings.every((l) => !l.conditionalOffers?.length)).toBe(true);
  }

  expect(parseMetroPage(metro, now).listings[0]?.currentPriceCents).toBe(2150);
});
