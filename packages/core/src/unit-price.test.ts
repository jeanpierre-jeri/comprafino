import { expect, it } from "vitest";
import {
  calculateUnitPrice,
  repriceUnitPrice,
  canonicalUnitPrice,
  compareUnitPrices,
  formatUnitPrice,
  genericOfferSort,
} from "./unit-price.ts";
import type { UnitPriceInput } from "./unit-price.ts";
import { normalizeCatalogListing } from "./catalog.ts";

const now = new Date("2026-10-03T10:00:00Z");

const input: UnitPriceInput = {
  currentPriceCents: 390,
  pricingBasis: "unit",
  totalQuantity: { value: 500, unit: "g" },
  issues: [],
  title: "Azúcar 500 g",
  observedAt: now,
};

function price(override: Partial<UnitPriceInput> = {}) {
  const result = calculateUnitPrice({ ...input, ...override }, now);

  if (!result.price) {
    throw new Error(result.reason);
  }

  return result.price;
}

it.each([
  [500, "g", 450, "S/ 9.00 / kg"],
  [1000, "g", 800, "S/ 8.00 / kg"],
  [1500, "g", 1200, "S/ 8.00 / kg"],
  [2340, "g", 2340, "S/ 10.00 / kg"],
  [500, "ml", 450, "S/ 9.00 / L"],
  [946, "ml", 590, "S/ 6.24 / L"],
  [1000, "ml", 800, "S/ 8.00 / L"],
  [1500, "ml", 1200, "S/ 8.00 / L"],
  [2838, "ml", 1590, "S/ 5.60 / L"],
  [15, "unit", 990, "S/ 0.66 / unidad"],
  [30, "unit", 1790, "S/ 0.60 / unidad"],
  [1, "unit", 90, "S/ 0.90 / unidad"],
] as const)("calculates %i %s at %i cents", (value, unit, currentPriceCents, expected) => {
  expect(formatUnitPrice(price({ totalQuantity: { value, unit }, currentPriceCents }))).toBe(
    expected,
  );
});

it("does not divide a direct KG quote by approximate package mass", () => {
  expect(
    formatUnitPrice(
      price({
        pricingBasis: "kg",
        currentPriceCents: 1890,
        totalQuantity: null,
        issues: ["approximate-quantity"],
      }),
    ),
  ).toBe("S/ 18.90 / kg");
});

it.each(["Huevos Bandeja 30un", "Huevos Bandeja 15un", "Leche 6 × 390 g", "Leche 3 × 946 ml"])(
  "uses total normalized content of %s",
  (title) => {
    const attrs = normalizeCatalogListing({ title, priceUnit: "UN" });
    const result = calculateUnitPrice({ ...input, ...attrs, title }, now);
    expect(result.price?.denominator).toBe(BigInt(attrs.totalQuantity!.value));
  },
);

it.each([
  [{ totalQuantity: null }, "missing-quantity"],
  [{ issues: ["ambiguous-quantity"] }, "ambiguous-quantity"],
  [{ title: "Twopack Detergente 3L" }, "ambiguous-quantity"],
  [{ totalQuantity: { value: 0, unit: "g" } }, "invalid-quantity"],
  [{ totalQuantity: { value: -1, unit: "g" } }, "invalid-quantity"],
  [{ totalQuantity: { value: 1.5, unit: "g" } }, "invalid-quantity"],
  [{ currentPriceCents: -1 }, "invalid-price"],
  [{ currentPriceCents: 3.9 }, "invalid-price"],
  [{ currentPriceCents: Number.NaN }, "invalid-price"],
  [{ available: false }, "unavailable"],
  [{ observedAt: new Date(now.getTime() - 36 * 3600000 - 1) }, "not-fresh"],
  [{ observedAt: new Date(now.getTime() + 1) }, "not-fresh"],
] satisfies [Partial<UnitPriceInput>, string][])(
  "withholds unsafe calculation %j",
  (override, reason) => {
    expect(calculateUnitPrice({ ...input, ...override }, now)).toEqual({ price: null, reason });
  },
);

it("admits the inclusive freshness boundary and rounds only for presentation", () => {
  expect(
    calculateUnitPrice({ ...input, observedAt: new Date(now.getTime() - 36 * 3600000) }, now).price,
  ).not.toBeNull();
  const a = price({ currentPriceCents: 1790, totalQuantity: { value: 30, unit: "unit" } });
  const b = price({ currentPriceCents: 1800, totalQuantity: { value: 30, unit: "unit" } });
  expect(formatUnitPrice(a)).toBe(formatUnitPrice(b));
  expect(compareUnitPrices(a, b)).toBe(-1);
  expect(compareUnitPrices(b, a)).toBe(1);
  expect(compareUnitPrices(a, a)).toBe(0);
  expect(() => compareUnitPrices(a, price())).toThrow("Incompatible");
});

it("retains precision beyond number multiplication and accepts zero ordinary price", () => {
  const a = price({
    currentPriceCents: 2147483647,
    totalQuantity: { value: 2147483647, unit: "g" },
  });
  expect(formatUnitPrice(a)).toBe("S/ 10.00 / kg");
  expect(formatUnitPrice(price({ currentPriceCents: 0 }))).toBe("S/ 0.00 / kg");
});

it("defaults malformed or repeated sort parameters to relevance", () => {
  expect(genericOfferSort(["unit-price"])).toBe("relevance");
  expect(genericOfferSort("invalid")).toBe("relevance");
  expect(genericOfferSort("unit-price")).toBe("unit-price");
});

it("withholds an ambiguous count multipack but calculates a validated total count", () => {
  const title = "Pack 3 x 15 unidades";
  const attrs = normalizeCatalogListing({ title, priceUnit: "UN" });
  expect(calculateUnitPrice({ ...input, ...attrs, title }, now).price).toBeNull();
  expect(
    formatUnitPrice(price({ totalQuantity: { value: 45, unit: "unit" }, currentPriceCents: 2700 })),
  ).toBe("S/ 0.60 / unidad");
});

it.each([15, 30])("a %i egg tray contains one package", (count) => {
  const attrs = normalizeCatalogListing({ title: `Huevos Bandeja ${count}un`, priceUnit: "UN" });
  expect(attrs.packageCount).toBe(1);
  expect(attrs.quantity).toEqual({ value: count, unit: "unit" });
});

it("withholds canned tuna mass comparison without confusing net and drained weight", () => {
  const tunaNow = new Date("2026-10-04T16:00:00Z");
  const result = calculateUnitPrice(
    {
      title: "Filete de Atún Florida Lata 140g",
      currentPriceCents: 650,
      pricingBasis: "unit",
      totalQuantity: { value: 140, unit: "g" },
      issues: [],
      observedAt: tunaNow,
    },
    tunaNow,
  );
  expect(result).toEqual({ price: null, reason: "ambiguous-semantics" });
});

it("withholds the observed one-gram flour source typo without repairing display quantity", () => {
  expect(
    calculateUnitPrice(
      {
        title: "Harina de Arroz Costeño 1 g",
        productFamily: "flour",
        pricingBasis: "unit",
        totalQuantity: { value: 1, unit: "g" },
        currentPriceCents: 500,
        issues: [],
        observedAt: now,
      },
      now,
    ),
  ).toEqual({ price: null, reason: "ambiguous-quantity" });
});

it.each([
  "Atún Lata 170 g",
  "Atún Peso neto 170 g",
  "Atún Peso escurrido 120 g",
  "Atún Peso neto 170 g Peso escurrido 120 g",
  "Filete de Atún Pack 3 Und",
])("withholds inconsistent tuna content semantics: %s", (title) => {
  const attrs = normalizeCatalogListing({ title, priceUnit: "UN" });
  expect(calculateUnitPrice({ ...input, ...attrs, title }, now)).toEqual({
    price: null,
    reason: "ambiguous-semantics",
  });
});

it.each([
  "Papel Higiénico 12un",
  "Papel Higiénico 65m 12un",
  "Papel Higiénico Doble Hoja 12un",
  "Papel Higiénico 200 hojas por rollo 12un",
])("keeps coarse roll comparison explicit: %s", (title) => {
  const attrs = normalizeCatalogListing({ title, priceUnit: "UN" });
  const result = calculateUnitPrice({ ...input, ...attrs, title, currentPriceCents: 1440 }, now);
  expect(result.price).toMatchObject({ basis: "roll", quality: "approximate", denominator: 12n });
  expect(formatUnitPrice(result.price!)).toBe("S/ 1.20 / rollo");
  expect(() =>
    compareUnitPrices(result.price!, price({ totalQuantity: { value: 12, unit: "unit" } })),
  ).toThrow("Incompatible");
});

it.each([
  ["Detergente polvo 800 g", "mass", 800n],
  ["Detergente líquido Doypack 3 L", "volume", 3000n],
  ["Detergente cápsulas 20 unidades", "item-count", 20n],
  ["Detergente líquido 3 x 800 ml", "volume", 2400n],
])("uses the correct detergent dimension for %s", (title, basis, denominator) => {
  const attrs = normalizeCatalogListing({ title, priceUnit: "UN" });
  expect(calculateUnitPrice({ ...input, ...attrs, title }, now).price).toMatchObject({
    basis,
    denominator,
    quality: "strong",
  });
});

it("distinguishes conflicting dimensions from missing or ambiguous content", () => {
  const title = "Detergente 800 g 3 L";
  const attrs = normalizeCatalogListing({ title, priceUnit: "UN" });
  expect(calculateUnitPrice({ ...input, ...attrs, title }, now).reason).toBe(
    "conflicting-dimensions",
  );
  expect(
    calculateUnitPrice(
      { ...input, title: "Detergente Pack 3 unidades", totalQuantity: { value: 3, unit: "unit" } },
      now,
    ).reason,
  ).toBe("ambiguous-semantics");
  expect(
    calculateUnitPrice({ ...input, title: "Papel Higiénico 65m", totalQuantity: null }, now).reason,
  ).toBe("missing-quantity");
});

it.each([
  [400, "g", 1890, 1790, "S/ 47.25 / kg", "S/ 44.75 / kg"],
  [180, "g", 990, 890, "S/ 55.00 / kg", "S/ 49.44 / kg"],
  [946, "ml", 640, 540, "S/ 6.77 / L", "S/ 5.71 / L"],
  [30, "unit", 1790, 1290, "S/ 0.60 / unidad", "S/ 0.43 / unidad"],
] as const)(
  "separates ordinary and CMR unit references for %i %s",
  (value, unit, ordinary, benefit, ordinaryLabel, benefitLabel) => {
    const basis = price({ currentPriceCents: ordinary, totalQuantity: { value, unit } });
    const conditional = repriceUnitPrice(basis, ordinary, benefit)!;
    expect(formatUnitPrice(basis)).toBe(ordinaryLabel);
    expect(formatUnitPrice(conditional)).toBe(benefitLabel);
    expect(formatUnitPrice(repriceUnitPrice(conditional, benefit, ordinary)!)).toBe(ordinaryLabel);
  },
);

it("keeps approximate roll metadata and direct KG quote semantics when repricing", () => {
  const paper = price({
    title: "Papel higiénico 12 rollos",
    productFamily: "toilet_paper",
    totalQuantity: { value: 12, unit: "unit" },
    currentPriceCents: 2400,
  });
  expect(repriceUnitPrice(paper, 2400, 1800)).toMatchObject({
    quality: "approximate",
    basis: "roll",
    displayUnit: "roll",
  });
  expect(formatUnitPrice(repriceUnitPrice(paper, 2400, 1800)!)).toBe("S/ 1.50 / rollo");
  const kg = price({ pricingBasis: "kg", totalQuantity: null, currentPriceCents: 5500 });
  expect(formatUnitPrice(repriceUnitPrice(kg, 5500, 5000)!)).toBe("S/ 50.00 / kg");
});

it("withholds conditional references when quantity semantics or payable amounts are invalid", () => {
  expect(repriceUnitPrice(null, 1890, 1790)).toBeNull();
  for (const invalid of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(repriceUnitPrice(price(), 390, invalid)).toBeNull();
    expect(repriceUnitPrice(price(), invalid, 290)).toBeNull();
  }
  expect(repriceUnitPrice({ ...price(), numerator: 0n }, 390, 290)).toBeNull();
});

it("uses full trusted canonical multipack contents without bypassing freshness or semantic gates", () => {
  const canonical = {
    title: "Leche 3 × 946 ml",
    quantityValue: 946,
    quantityUnit: "ml" as const,
    packageCount: 3,
    priceCents: 1390,
    observedAt: now,
  };
  expect(formatUnitPrice(canonicalUnitPrice(canonical, now)!)).toBe("S/ 4.90 / L");
  expect(
    canonicalUnitPrice({ ...canonical, title: "Atún escurrido 3 × 946 g", quantityUnit: "g" }, now),
  ).toBeNull();
  expect(canonicalUnitPrice({ ...canonical, available: false }, now)).toBeNull();
  expect(canonicalUnitPrice({ ...canonical, observedAt: new Date("2026-09-01") }, now)).toBeNull();
  expect(canonicalUnitPrice({ ...canonical, quantityValue: 0.5, packageCount: 2 }, now)).toBeNull();
});
