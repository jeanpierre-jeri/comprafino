import { describe, expect, it } from "vitest";
import { shoppingSeedForRetailerOffer } from "./shopping-creation.ts";
import {
  evaluateShoppingListItem,
  shoppingListItemSchema,
  saveShoppingItem,
  emptyShoppingList,
  parseShoppingList,
  serializeShoppingList,
} from "./shopping-list.ts";
import type { ShoppingCandidate } from "./shopping-list.ts";
import { remoteShoppingListSchema } from "./shopping-list-sync.ts";
import { shoppingSavingsNotice } from "./shopping-savings.ts";

const now = new Date("2026-10-16T15:00:00Z");
const id = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const canonicalId = "00000000-0000-4000-8000-000000000003";
const selected: ShoppingCandidate = {
  id,
  canonicalId: null,
  title: "Huevos Tottus Bandeja 30un",
  retailerId: "tottus",
  retailerName: "Tottus",
  imageUrl: "https://media.tottus.com.pe/tottusPE/eggs.jpg",
  url: "https://www.tottus.com.pe/eggs",
  ordinaryPriceCents: 2000,
  conditionalOffers: [],
  observedAt: now,
  available: null,
  packageQuantity: { amount: 30, unit: "unit" },
  strongQuantity: true,
  substitutionProfile: "eggs:regular",
};
const alternative: ShoppingCandidate = {
  ...selected,
  id: otherId,
  title: "Huevos Metro 15un",
  retailerId: "metro" as const,
  retailerName: "Metro",
  ordinaryPriceCents: 800,
  packageQuantity: { amount: 15, unit: "unit" },
};
const item = shoppingListItemSchema.options[1].parse({
  id: otherId,
  label: selected.title,
  query: "huevos",
  intent: "preferred",
  canonicalId: null,
  listingId: id,
  quantityMode: "packages",
  quantity: { amount: 2, unit: "unit" },
  frequency: "weekly",
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
});

describe("saved retailer product selection", () => {
  it("keeps an independent SKU through creation, edits, storage and account validation", () => {
    const seed = shoppingSeedForRetailerOffer({
      ...selected,
      totalQuantity: { value: 30, unit: "unit" },
      unitPrice: { quality: "strong" },
      pricingBasis: "unit",
    });
    expect(seed).toMatchObject({ listingId: id, canonicalId: null, label: selected.title });
    const saved = saveShoppingItem(emptyShoppingList(), item);
    expect(parseShoppingList(serializeShoppingList(saved)).list).toEqual(saved);
    expect(remoteShoppingListSchema.parse(saved)).toEqual(saved);
    expect(
      saveShoppingItem(saved, { ...item, quantity: { amount: 3, unit: "unit" } }).items[0],
    ).toMatchObject({ listingId: id, label: selected.title });
    expect(
      saveShoppingItem(saved, { ...item, id: canonicalId, listingId: otherId }).items,
    ).toHaveLength(2);
    expect(shoppingListItemSchema.safeParse({ ...item, listingId: undefined }).success).toBe(false);
    expect(
      shoppingListItemSchema.safeParse({ ...item, intent: "generic", quantityMode: "normalized" })
        .success,
    ).toBe(false);
  });
  it("keeps the selected quote and image while comparing whole equivalent amounts", () => {
    const result = evaluateShoppingListItem(item, [alternative, selected], "standard", now);
    expect(result.best).toMatchObject({
      id,
      totalCostCents: 4000,
      imageUrl: selected.imageUrl,
      available: null,
    });
    expect(result.alternative).toMatchObject({ id: otherId, packages: 4, totalCostCents: 3200 });
    expect(result.alternatives).toHaveLength(1);
    expect(shoppingSavingsNotice(item, result)?.savingsCents).toBe(800);
  });
  it("keeps a selected store even when the same canonical product is cheaper elsewhere", () => {
    const same = {
      ...alternative,
      canonicalId,
      packageQuantity: selected.packageQuantity,
      title: selected.title,
    };
    const result = evaluateShoppingListItem(
      item,
      [{ ...selected, canonicalId }, same],
      "standard",
      now,
    );
    expect(result.best?.id).toBe(id);
    expect(result.alternative?.id).toBe(otherId);
    expect(shoppingSavingsNotice(item, result)?.kind).toBe("same-product");
  });
  it("never equates two null identities or revives a revoked canonical association", () => {
    expect(
      evaluateShoppingListItem(
        { ...item, intent: "strict" },
        [selected, alternative],
        "standard",
        now,
      ).options.map((o) => o.id),
    ).toEqual([id]);
    const result = evaluateShoppingListItem(
      { ...item, intent: "strict", canonicalId },
      [selected, { ...alternative, canonicalId }],
      "standard",
      now,
    );
    expect(result.options.map((o) => o.id)).toEqual([id]);
  });
  it("does not suggest substitutions without fresh quantity or source family evidence", () => {
    for (const override of [
      { available: false },
      { ordinaryPriceCents: 0 },
      { observedAt: new Date("2025-01-01") },
      { strongQuantity: false },
      { substitutionProfile: null },
    ]) {
      const result = evaluateShoppingListItem(
        item,
        [{ ...selected, ...override }, alternative],
        "standard",
        now,
      );
      expect(result.alternative).toBeNull();
    }
    expect(evaluateShoppingListItem(item, [alternative], "standard", now).best).toBeNull();
  });
});
