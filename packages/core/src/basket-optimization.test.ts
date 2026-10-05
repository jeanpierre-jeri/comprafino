import { describe, expect, it } from "vitest";
import { basketOptionSchema, defaultBasketLimit, optimizeBasket } from "./basket-optimization.ts";
import type { BasketOption } from "./basket-optimization.ts";
import { evaluateShoppingFulfillment, shoppingListItemSchema } from "./shopping-list.ts";
import type { ShoppingCandidate } from "./shopping-list.ts";
const now = new Date("2026-10-04T12:00:00Z");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function option(
  retailerId: BasketOption["retailerId"],
  price: number,
  id: string = retailerId,
): BasketOption {
  return basketOptionSchema.parse({
    id,
    retailerId,
    retailerName: retailerId,
    canonicalId: null,
    title: "Huevos 30un",
    url: "https://www.metro.pe/eggs/p",
    packages: 1,
    countsPackages: false,
    quantityUnit: "unit",
    purchasedQuantity: 30,
    overbuy: 0,
    totalCostCents: price,
    ordinaryTotalCents: price,
    effectiveUnitCents: price / 30,
    condition: null,
  });
}
function need(n: number, options: BasketOption[]) {
  return { itemId: uuid(n), options };
}
function item(intent: "generic" | "preferred" | "strict" = "generic") {
  return shoppingListItemSchema.parse({
    id: uuid(1),
    canonicalId: intent === "generic" ? null : uuid(2),
    intent,
    label: "Huevos",
    query: "huevos",
    quantity: { amount: 30, unit: "unit" },
    substitutionProfile: "eggs:regular",
    frequency: "weekly",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
}
function candidate(overrides: Partial<ShoppingCandidate> = {}): ShoppingCandidate {
  return {
    id: "exact",
    retailerId: "metro",
    retailerName: "Metro",
    canonicalId: uuid(2),
    title: "Huevos Bell's 30un",
    url: "https://www.metro.pe/eggs/p",
    ordinaryPriceCents: 2000,
    observedAt: now,
    available: true,
    packageQuantity: { amount: 30, unit: "unit" },
    strongQuantity: true,
    conditionalOffers: [],
    ...overrides,
  };
}
const fulfillment = (
  candidates: ShoppingCandidate[],
  intent: "generic" | "preferred" | "strict" = "generic",
) => evaluateShoppingFulfillment(item(intent), candidates, "standard", now, "Huevos Bell's 30un");

describe("exact current basket optimization", () => {
  it("finds all three optima and marginal savings, with non-nested winners", () => {
    const plans = optimizeBasket([
      need(1, [option("metro", 100), option("plaza-vea", 400), option("tottus", 800)]),
      need(2, [option("metro", 800), option("plaza-vea", 400), option("tottus", 100)]),
      need(3, [option("metro", 250), option("plaza-vea", 100), option("tottus", 250)]),
    ]);
    expect(plans.map((p) => p.totalCostCents)).toEqual([900, 450, 300]);
    expect(plans.map((p) => p.marginalSavingsCents)).toEqual([null, 450, 150]);
    expect(plans[0].retailerIds).toEqual(["plaza-vea"]);
    expect(plans[1].retailerIds).toEqual(["metro", "tottus"]);
    expect(defaultBasketLimit(plans)).toBe(1);
  });
  it("matches independent exhaustive assignment costs across varied baskets", () => {
    const retailers = ["metro", "plaza-vea", "tottus"] as const;
    for (let seed = 0; seed < 30; seed++) {
      const needs = Array.from({ length: 3 }, (_, i) =>
        need(
          i,
          retailers.map((r, j) => option(r, 1 + ((seed * (i + 7) + j * 17 + i * j * 31) % 97))),
        ),
      );
      const assignments = needs[0]!.options.flatMap((a) =>
        needs[1]!.options.flatMap((b) => needs[2]!.options.map((c) => [a, b, c])),
      );
      const expected = [1, 2, 3].map((limit) =>
        Math.min(
          ...assignments
            .filter((a) => new Set(a.map((o) => o.retailerId)).size <= limit)
            .map((a) => a.reduce((sum, o) => sum + o.totalCostCents, 0)),
        ),
      );
      expect(optimizeBasket(needs).map((p) => p.totalCostCents)).toEqual(expected);
    }
  });
  it("considers a fourth-ranked listing needed for a complete one-store basket", () => {
    const plans = optimizeBasket([
      need(1, [
        option("tottus", 100, "a"),
        option("tottus", 110, "b"),
        option("tottus", 120, "c"),
        option("metro", 130, "d"),
      ]),
      need(2, [option("metro", 100)]),
    ]);
    expect(plans[0]).toMatchObject({
      status: "complete",
      totalCostCents: 230,
      retailerIds: ["metro"],
    });
  });
  it("higher limits retain a single retailer and zero savings without invented visits", () => {
    const plans = optimizeBasket([need(1, [option("metro", 100), option("tottus", 200)])]);
    expect(plans.map((p) => p.retailerIds)).toEqual([["metro"], ["metro"], ["metro"]]);
    expect(plans.map((p) => p.marginalSavingsCents)).toEqual([null, 0, 0]);
    expect(plans[1].assignments).toEqual(plans[0].assignments);
  });
  it("selects the first complete tier and does not compare partial subtotals", () => {
    const plans = optimizeBasket([
      need(1, [option("metro", 500)]),
      need(2, [option("tottus", 100)]),
    ]);
    expect(plans[0]).toMatchObject({
      status: "incomplete",
      totalCostCents: null,
      partialSubtotalCents: 100,
      missingItemIds: [uuid(1)],
    });
    expect(plans[1]).toMatchObject({
      status: "complete",
      totalCostCents: 600,
      marginalSavingsCents: null,
    });
    expect(defaultBasketLimit(plans)).toBe(2);
    const three = optimizeBasket([
      ...plans[1].assignments.map((a) => need(Number(a.itemId.slice(-12)), [a.option])),
      need(3, [option("plaza-vea", 50)]),
    ]);
    expect(defaultBasketLimit(three)).toBe(3);
    expect(three[2].marginalSavingsCents).toBeNull();
  });
  it("maximizes partial coverage before minimizing cost and selects the best partial", () => {
    const plans = optimizeBasket([
      need(1, [option("metro", 500)]),
      need(2, [option("metro", 500)]),
      need(3, [option("tottus", 1)]),
      need(4, []),
    ]);
    expect(plans[0].assignments).toHaveLength(2);
    expect(plans[1].assignments).toHaveLength(3);
    expect(defaultBasketLimit(plans)).toBe(2);
    expect(plans.every((p) => p.totalCostCents === null && p.marginalSavingsCents === null)).toBe(
      true,
    );
  });
  it("handles empty, entirely unsupported and maximum-size baskets", () => {
    expect(optimizeBasket([]).every((p) => p.status === "empty")).toBe(true);
    expect(optimizeBasket([need(1, [])])[0]).toMatchObject({
      status: "incomplete",
      partialSubtotalCents: 0,
    });
    const plans = optimizeBasket(
      Array.from({ length: 50 }, (_, i) => need(i, [option("metro", 123)])),
    );
    expect(plans[0].totalCostCents).toBe(6150);
    expect(() => optimizeBasket([need(1, []), need(1, [])])).toThrow("Invalid basket needs");
  });
  it("uses deterministic cost, retailer-count, retailer-ID and option tie-breakers", () => {
    const tied = option("metro", 100, "z");
    const lowOverbuy = { ...option("metro", 100, "b"), overbuy: 0 };
    const highOverbuy = { ...option("metro", 100, "a"), overbuy: 1 };
    const needs = [
      need(2, [option("tottus", 100), lowOverbuy, highOverbuy, tied]),
      need(1, [option("metro", 100), option("tottus", 100)]),
    ];
    const plans = optimizeBasket(needs);
    expect(plans[0].retailerIds).toEqual(["metro"]);
    expect(plans[0].assignments[1]?.option.id).toBe("b");
    expect(
      optimizeBasket(
        [...needs].reverse().map((n) => ({ ...n, options: [...n.options].reverse() })),
      ),
    ).toEqual(plans);
    expect(() =>
      optimizeBasket([
        need(1, [{ ...tied, totalCostCents: Number.MAX_SAFE_INTEGER }]),
        need(2, [{ ...tied, totalCostCents: Number.MAX_SAFE_INTEGER }]),
      ]),
    ).toThrow("overflow");
  });
});

describe("basket approval uses Milestone 15.1 fulfillment", () => {
  it("keeps every approved listing beyond the three display options", () => {
    const f = fulfillment(
      Array.from({ length: 6 }, (_, i) =>
        candidate({ id: `offer-${i}`, ordinaryPriceCents: 1000 + i }),
      ),
    );
    expect(f.evaluation.options).toHaveLength(3);
    expect(f.approved).toHaveLength(6);
  });
  it("applies the global preference threshold to every alternative before restricting stores", () => {
    const f = fulfillment(
      [
        candidate(),
        candidate({
          id: "weak",
          retailerId: "tottus",
          canonicalId: null,
          ordinaryPriceCents: 1901,
        }),
        candidate({
          id: "safe",
          retailerId: "plaza-vea",
          canonicalId: null,
          ordinaryPriceCents: 1900,
        }),
      ],
      "preferred",
    );
    expect(f.approved.map((o) => o.id)).toEqual(["safe", "exact"]);
    const plans = optimizeBasket([
      need(
        1,
        f.approved.map((o) => basketOptionSchema.parse(o)),
      ),
    ]);
    expect(plans[0].assignments[0]?.option.id).toBe("safe");
    expect(f.evaluation.best?.id).toBe("exact");
    const cheap = fulfillment(
      [
        candidate({ ordinaryPriceCents: 500 }),
        candidate({ id: "only-5-percent", canonicalId: null, ordinaryPriceCents: 450 }),
      ],
      "preferred",
    );
    expect(cheap.approved).toHaveLength(1);
  });
  it("strict products retain exact identity and independent options keep null canonical IDs", () => {
    expect(fulfillment([candidate({ canonicalId: null })], "strict").approved).toEqual([]);
    expect(fulfillment([candidate({ canonicalId: null })]).approved[0]?.canonicalId).toBeNull();
  });
  it("never promotes relevance, unsupported intent or negative family evidence", () => {
    for (const title of [
      "Huevos de Codorniz 30un",
      "Arroz integral 1kg",
      "Aceite de oliva 1L",
      "Huevos orgánicos 30un",
    ])
      expect(fulfillment([candidate({ title, ordinaryPriceCents: 1 })]).approved).toEqual([]);
    expect(fulfillment([candidate({ substitutionProfile: null })]).approved).toEqual([]);
    expect(
      evaluateShoppingFulfillment(
        { ...item(), substitutionProfile: null },
        [candidate()],
        "standard",
        now,
      ).approved,
    ).toEqual([]);
    expect(
      evaluateShoppingFulfillment(
        { ...item(), substitutionProfile: "unknown" },
        [candidate()],
        "standard",
        now,
      ).approved,
    ).toEqual([]);
  });
  it("withholds preferred package alternatives without fresh exact contents", () => {
    const i = shoppingListItemSchema.parse({
      ...item("preferred"),
      quantityMode: "packages" as const,
      quantity: { amount: 2, unit: "unit" as const },
    });
    expect(
      evaluateShoppingFulfillment(
        i,
        [
          candidate({ observedAt: new Date(now.getTime() - 37 * 3600000) }),
          candidate({ id: "other", canonicalId: null, ordinaryPriceCents: 100 }),
        ],
        "standard",
        now,
        "Huevos Bell's 30un",
      ).approved,
    ).toEqual([]);
  });
  it("whole packages, quantity/freshness safeguards and CMR amounts survive into basket totals", () => {
    const i = { ...item(), quantity: { amount: 60, unit: "unit" as const } };
    const c = candidate({
      conditionalOffers: [
        {
          conditionType: "payment_card",
          programKey: "cmr",
          conditionLabel: "Requiere tarjeta CMR",
          priceCents: 1500,
          observedAt: now,
        },
      ],
    });
    const f = evaluateShoppingFulfillment(
      i,
      [
        c,
        candidate({ id: "weak", strongQuantity: false }),
        candidate({ id: "future", observedAt: new Date(now.getTime() + 1) }),
        candidate({ id: "unavailable", available: false }),
        candidate({ id: "kg", pricingBasis: "kg" }),
        candidate({ id: "bulk", packageQuantity: { amount: 200, unit: "unit" } }),
      ],
      "benefits",
      now,
    );
    expect(f.approved).toHaveLength(1);
    const basket = optimizeBasket([
      need(
        1,
        f.approved.map((o) => basketOptionSchema.parse(o)),
      ),
    ])[0];
    expect(basket).toMatchObject({ totalCostCents: 3000, ordinarySubtotalCents: 4000 });
    expect(basket.assignments[0]?.option).toMatchObject({
      packages: 2,
      condition: "Requiere tarjeta CMR",
    });
    c.conditionalOffers[0]!.endsAt = now;
    expect(evaluateShoppingFulfillment(i, [c], "benefits", now).approved[0]?.totalCostCents).toBe(
      4000,
    );
  });
});

it("zero ordinary candidates cannot enter approved basket options", () => {
  for (const intent of ["generic", "preferred", "strict"] as const) {
    const result = fulfillment(
      [candidate({ ordinaryPriceCents: 0 }), candidate({ id: "paid" })],
      intent,
    );
    expect(result.approved.map((o) => o.id)).toEqual(["paid"]);
  }
});

it("a zero ordinary option cannot win even when passed directly to the basket optimizer", () => {
  const plans = optimizeBasket([need(1, [option("metro", 0), option("tottus", 100)])]);
  expect(plans.every((p) => p.totalCostCents === 100)).toBe(true);
  expect(plans.every((p) => p.retailerIds.join(",") === "tottus")).toBe(true);
});
