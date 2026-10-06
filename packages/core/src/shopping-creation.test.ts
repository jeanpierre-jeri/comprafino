import { describe, expect, it } from "vitest";
import { shoppingSeedForRetailerOffer } from "./shopping-creation.ts";
import {
  emptyShoppingList,
  evaluateShoppingListItem,
  saveShoppingItem,
  shoppingListItemSchema,
} from "./shopping-list.ts";
import type { ShoppingCandidate } from "./shopping-list.ts";

const now = new Date("2026-10-04T12:00:00Z");

const canonicalId = "00000000-0000-4000-8000-000000000001";

const offer = {
  title: "Huevos Bell's 30un",
  canonicalId: null,
  totalQuantity: { value: 30, unit: "unit" as const },
  unitPrice: { quality: "strong" },
  pricingBasis: "unit" as const,
};

const candidate: ShoppingCandidate = {
  id: "other",
  canonicalId: null,
  title: "Huevos Tottus 30un",
  retailerName: "Tottus",
  url: "https://www.tottus.com.pe/eggs",
  ordinaryPriceCents: 1490,
  conditionalOffers: [],
  observedAt: now,
  available: true,
  packageQuantity: { amount: 30, unit: "unit" },
  strongQuantity: true,
};

function makeItem(seed: ReturnType<typeof shoppingSeedForRetailerOffer>) {
  return shoppingListItemSchema.parse({
    ...seed,
    intent: "generic",
    id: "00000000-0000-4000-8000-000000000002",
    quantityMode: "normalized",
    frequency: "weekly",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
}

describe("retailer-option shopping creation evidence", () => {
  it("retains safely canonicalized identity for preferred/strict creation", () => {
    const seed = shoppingSeedForRetailerOffer({ ...offer, canonicalId });
    expect(seed).toEqual({ canonicalId, label: offer.title, query: "huevos" });

    for (const intent of ["preferred", "strict"] as const) {
      expect(
        shoppingListItemSchema.safeParse({
          ...makeItem(shoppingSeedForRetailerOffer(offer)),
          ...seed,
          intent,
          quantityMode: "packages",
          quantity: { amount: 1, unit: "unit" },
        }).success,
      ).toBe(true);
    }
  });
  it("saves an independent ordinary listing as a safe generic need", () => {
    const seed = shoppingSeedForRetailerOffer(offer);
    expect(seed).toMatchObject({
      canonicalId: null,
      query: "huevos",
      label: "Huevos",
      substitutionProfile: "eggs:regular",
      quantity: { amount: 30, unit: "unit" },
    });
    const list = saveShoppingItem(emptyShoppingList(), makeItem(seed));
    expect(evaluateShoppingListItem(list.items[0]!, [candidate], "standard", now).best?.id).toBe(
      "other",
    );

    for (const intent of ["preferred", "strict"] as const) {
      expect(shoppingListItemSchema.safeParse({ ...list.items[0], intent }).success).toBe(false);
    }
  });
  it.each([
    ["Arroz Blanco 5kg", "g", 5000, "rice:white", "kg", 5],
    ["Aceite de Girasol 900ml", "ml", 900, "oil:sunflower", "L", 0.9],
    ["Detergente en Polvo Matic 2kg", "g", 2000, "detergent:powder:machine", "kg", 2],
    ["Detergente Líquido Matic 3L", "ml", 3000, "detergent:liquid:machine", "L", 3],
  ] as const)(
    "preserves %s family/form and contained amount",
    (title, unit, value, profile, expectedUnit, amount) => {
      const seed = shoppingSeedForRetailerOffer({
        ...offer,
        title,
        totalQuantity: { value, unit },
      });
      expect(seed).toMatchObject({
        substitutionProfile: profile,
        quantity: { amount, unit: expectedUnit },
      });
      expect(
        saveShoppingItem(emptyShoppingList(), makeItem(seed)).items[0]?.substitutionProfile,
      ).toBe(profile);
    },
  );
  it.each(["Huevos de Codorniz 30un", "Leche Entera Gloria 1L"])(
    "keeps unsupported %s description with recommendations withheld",
    (title) => {
      const seed = shoppingSeedForRetailerOffer({ ...offer, title });
      expect(seed).toMatchObject({ label: title, canonicalId: null, substitutionProfile: null });
      const list = saveShoppingItem(emptyShoppingList(), makeItem(seed));
      expect(list.items[0]?.substitutionProfile).toBeNull();
      expect(
        evaluateShoppingListItem(list.items[0]!, [candidate], "standard", now).best,
      ).toBeNull();
    },
  );
  it("honors negative source evidence on save without merging a safe generic need", () => {
    const seed = shoppingSeedForRetailerOffer({
      ...offer,
      title: "Huevos",
      family: { family: null, origin: null, evidence: "category-mismatch" },
    });
    const withheld = makeItem(seed);
    let list = saveShoppingItem(emptyShoppingList(), withheld);
    list = saveShoppingItem(list, {
      ...makeItem(shoppingSeedForRetailerOffer(offer)),
      id: canonicalId,
    });
    expect(list.items).toHaveLength(2);
    expect(list.items[0]?.substitutionProfile).toBeNull();
    expect(evaluateShoppingListItem(withheld, [candidate], "standard", now).best).toBeNull();
  });
  it("does not infer desired contents from weak quantities or direct kg quotes", () => {
    for (const override of [{ unitPrice: null }, { pricingBasis: "kg" as const }]) {
      expect(
        shoppingSeedForRetailerOffer({
          ...offer,
          title: "Arroz Blanco 5kg",
          totalQuantity: { value: 5000, unit: "g" },
          ...override,
        }).quantity,
      ).toEqual({ amount: 1, unit: "kg" });
    }
  });
});
