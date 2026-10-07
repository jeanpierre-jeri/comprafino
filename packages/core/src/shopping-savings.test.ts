import { describe, expect, it } from "vitest";
import { shoppingSavingsNotice } from "./shopping-savings.ts";
import { evaluateShoppingListItem, shoppingListItemSchema } from "./shopping-list.ts";
import type { ShoppingCandidate, ShoppingListItem } from "./shopping-list.ts";

const now = new Date("2026-10-06T22:00:00Z");
const canonicalId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000003";

function item(intent: ShoppingListItem["intent"] = "generic") {
  return shoppingListItemSchema.parse({
    id: "00000000-0000-4000-8000-000000000002",
    intent,
    canonicalId: intent === "generic" ? null : canonicalId,
    label: "Huevos",
    query: "huevos",
    substitutionProfile: "eggs:regular",
    quantity: { amount: 30, unit: "unit" },
    frequency: "weekly",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
}

function candidate(
  id: string,
  price: number,
  overrides: Partial<ShoppingCandidate> = {},
): ShoppingCandidate {
  return {
    id,
    canonicalId,
    retailerId: "metro",
    retailerName: "Metro",
    title: "Huevos Bell's Bandeja 30un",
    url: "https://www.metro.pe/huevos/p",
    ordinaryPriceCents: price,
    conditionalOffers: [],
    observedAt: now,
    available: true,
    strongQuantity: true,
    packageQuantity: { amount: 30, unit: "unit" },
    ...overrides,
  };
}

function evaluate(need: ShoppingListItem, candidates: ShoppingCandidate[]) {
  return evaluateShoppingListItem(need, candidates, "standard", now, "Huevos Bell's Bandeja 30un");
}

describe("current shopping savings notices", () => {
  it("discloses an approved cheaper substitute against the preferred purchase cost", () => {
    const need = item("preferred");
    const evaluation = evaluate(need, [
      candidate("preferred", 2000),
      candidate("other", 1600, { canonicalId: otherId, retailerName: "Tottus" }),
    ]);
    const original = JSON.stringify(evaluation);
    expect(shoppingSavingsNotice(need, evaluation)).toMatchObject({
      kind: "preferred-alternative",
      savingsCents: 400,
      option: { id: "other" },
      baseline: { id: "preferred" },
    });
    expect(JSON.stringify(evaluation)).toBe(original);
  });

  it("compares only the exact canonical product for strict needs", () => {
    const need = item("strict");
    const evaluation = evaluate(need, [
      candidate("metro", 1800),
      candidate("plaza", 1900, { retailerName: "Plaza Vea", retailerId: "plaza-vea" }),
      candidate("unrelated", 100, { canonicalId: otherId, retailerName: "Tottus" }),
    ]);
    expect(shoppingSavingsNotice(need, evaluation)).toMatchObject({
      kind: "same-product",
      savingsCents: 100,
      option: { id: "metro" },
      baseline: { id: "plaza" },
    });
  });

  it("uses compatible generic options without declaring independent identities the same product", () => {
    const need = item();
    const evaluation = evaluate(need, [
      candidate("a", 1400, { canonicalId: null }),
      candidate("b", 1650, { canonicalId: null, retailerName: "Tottus" }),
    ]);
    expect(shoppingSavingsNotice(need, evaluation)).toMatchObject({
      kind: "compatible-option",
      savingsCents: 250,
    });
  });

  it.each([
    [1901, null],
    [1900, 100],
    [9800, null],
  ] as const)("respects both the one-sol and five-percent gates for %i cents", (price, saving) => {
    const need = item();
    const baseline = price > 9000 ? 10000 : 2000;
    const evaluation = evaluate(need, [candidate("a", price), candidate("b", baseline)]);
    expect(shoppingSavingsNotice(need, evaluation)?.savingsCents ?? null).toBe(saving);
  });

  it("does not skip a tied lowest offer to manufacture a savings claim", () => {
    const need = item();
    const evaluation = evaluate(need, [
      candidate("a", 1400),
      candidate("b", 1400),
      candidate("c", 1700),
    ]);
    expect(shoppingSavingsNotice(need, evaluation)).toBeNull();
  });

  it("does not invent savings against an unavailable preferred product", () => {
    const need = item("preferred");
    const evaluation = evaluate(need, [
      candidate("preferred", 2000, { available: false }),
      candidate("other", 1500, { canonicalId: otherId }),
    ]);
    expect(evaluation.alternative).not.toBeNull();
    expect(shoppingSavingsNotice(need, evaluation)).toBeNull();
  });

  it("does not restore stale candidates or unsupported substitution evidence", () => {
    const need = item();
    expect(
      shoppingSavingsNotice(
        need,
        evaluate(need, [
          candidate("a", 1400),
          candidate("stale", 1700, { observedAt: new Date("2026-09-01") }),
        ]),
      ),
    ).toBeNull();
    const unsupported = { ...need, substitutionProfile: null };
    expect(
      shoppingSavingsNotice(
        unsupported,
        evaluate(unsupported, [candidate("a", 1400), candidate("b", 1700)]),
      ),
    ).toBeNull();
  });

  it("preserves conditional-price requirements and unknown availability", () => {
    const need = item();
    const evaluation = evaluateShoppingListItem(
      need,
      [
        candidate("cmr", 2000, {
          available: null,
          conditionalOffers: [
            {
              conditionType: "payment_card",
              programKey: "cmr",
              conditionLabel: "Requiere tarjeta CMR",
              priceCents: 1290,
              observedAt: now,
            },
          ],
        }),
        candidate("ordinary", 1600, { canonicalId: otherId }),
      ],
      "benefits",
      now,
    );
    expect(shoppingSavingsNotice(need, evaluation)).toMatchObject({
      savingsCents: 310,
      option: { condition: "Requiere tarjeta CMR", available: null },
    });
  });

  it("withholds mismatched evaluation identities and inconsistent preferred amounts", () => {
    const need = item("preferred");
    const evaluation = evaluate(need, [
      candidate("a", 2000),
      candidate("b", 1500, { canonicalId: otherId }),
    ]);
    expect(shoppingSavingsNotice(need, { ...evaluation, itemId: otherId })).toBeNull();
    expect(shoppingSavingsNotice(need, { ...evaluation, savingsCents: 1 })).toBeNull();
  });
});

it("does not present a zero placeholder as a cheaper purchase", () => {
  const need = item();
  const evaluation = evaluate(need, [candidate("a", 1400), candidate("b", 1700)]);
  expect(
    shoppingSavingsNotice(need, {
      ...evaluation,
      best: { ...evaluation.best!, totalCostCents: 0 },
    }),
  ).toBeNull();
});
