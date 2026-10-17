import { describe, expect, it } from "vitest";
import { groupSearchOffers, limitGenericOffers } from "./search-results.ts";
import { calculateUnitPrice } from "./unit-price.ts";

const now = new Date("2026-10-17T12:00:00Z");
function offer(id: string, canonicalId: string | null, cents = 600, retailerId = id) {
  return {
    id,
    canonicalId,
    retailerId,
    title: "Leche Gloria Light 390 g",
    currentPriceCents: cents,
    conditionalOffers: [],
    ranking: { priceCents: cents, condition: null },
    pricingBasis: "unit" as const,
    unitPrice: calculateUnitPrice(
      {
        currentPriceCents: cents,
        pricingBasis: "unit",
        totalQuantity: { value: 390, unit: "g" },
        issues: [],
        title: "Leche Gloria Light 390 g",
        observedAt: now,
      },
      now,
    ).price,
  };
}

describe("confirmed search product grouping", () => {
  it("groups only confirmed IDs and keeps identical unconfirmed names and other identities separate", () => {
    const results = groupSearchOffers([
      offer("a", "milk"),
      offer("b", null),
      offer("c", "other"),
      offer("d", "milk", 500),
      offer("e", null),
    ]);
    expect(results.map((product) => product.id)).toEqual(["milk", "b", "other", "e"]);
    expect(results[0]).toMatchObject({
      retailerCount: 2,
      ordinaryOffer: { id: "d", currentPriceCents: 500 },
    });
    expect(results.flatMap((product) => product.offers)).toHaveLength(5);
  });

  it("preserves all tied winners, stable provenance and distinct store coverage", () => {
    const members = [
      offer("z", "milk", 500, "tottus"),
      offer("a", "milk", 500, "metro"),
      offer("b", "milk", 700, "metro"),
    ];
    const [product] = groupSearchOffers(members);
    expect(product?.cheapestOffers.map((member) => member.id)).toEqual(["a", "z"]);
    expect(product?.bestOffers.map((member) => member.id)).toEqual(["a", "z"]);
    expect(product?.retailerCount).toBe(2);
    expect(groupSearchOffers([...members].reverse())[0]).toEqual(product);
  });

  it("paginates products, retains relevance ties and never splits a group across pages", () => {
    const members = Array.from({ length: 32 }, (_, index) => offer(`a${index}`, `product${index}`));
    // The second store would be on a later page if offers were limited first.
    const products = groupSearchOffers([
      ...members,
      ...members.map((member) => ({ ...member, id: `b${member.id}`, retailerId: "second" })),
    ]);
    for (const sort of ["relevance", "total-price", "unit-price"] as const) {
      const first = limitGenericOffers(products, sort);
      const second = limitGenericOffers(products, sort, 2);
      expect(first).toHaveLength(30);
      expect(second).toHaveLength(2);
      expect([...first, ...second].map((product) => product.id)).toEqual(
        products.map((product) => product.id),
      );
      expect(first.every((product) => product.offers.length === 2)).toBe(true);
      expect(limitGenericOffers(products, sort, 3)).toEqual([]);
    }
  });

  it("sorts product minima with exact unit ratios and retains separate unknown/KG blocks", () => {
    const small = offer("small", null, 500);
    const large = {
      ...offer("large", null, 600),
      unitPrice: { ...small.unitPrice!, numerator: 600000n, denominator: 1000n },
    };
    const direct = {
      ...offer("direct", null, 50),
      pricingBasis: "kg" as const,
      unitPrice: { ...small.unitPrice!, numerator: 50n, denominator: 1n },
    };
    const unknown = { ...offer("unknown", null, 1), unitPrice: null };
    const grouped = groupSearchOffers([small, large, direct, unknown]);
    expect(limitGenericOffers(grouped, "total-price").map((product) => product.id)).toEqual([
      "unknown",
      "small",
      "large",
      "direct",
    ]);
    expect(limitGenericOffers(grouped, "unit-price").map((product) => product.id)).toEqual([
      "direct",
      "large",
      "small",
      "unknown",
    ]);
  });
});
