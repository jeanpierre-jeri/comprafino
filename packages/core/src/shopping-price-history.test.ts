import { expect, it } from "vitest";
import { shoppingPriceHistories } from "./shopping-price-history.ts";
import { shoppingListItemSchema, shoppingOptionSchema } from "./shopping-list.ts";
import type { ShoppingEvaluation } from "./shopping-list.ts";

const now = new Date("2026-10-16T04:30:00Z"); // Still October 15 in Lima.
const listingId = "00000000-0000-4000-8000-000000000001";
const item = shoppingListItemSchema.options[1].parse({
  id: listingId,
  listingId,
  canonicalId: null,
  intent: "preferred",
  label: "Huevos Tottus 30un",
  query: "huevos",
  quantityMode: "packages",
  quantity: { amount: 2, unit: "unit" },
  frequency: "weekly",
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
});
const option = shoppingOptionSchema.parse({
  id: listingId,
  canonicalId: null,
  title: item.label,
  retailerName: "Tottus",
  url: "https://www.tottus.com.pe/eggs",
  available: null,
  packages: 2,
  countsPackages: true,
  quantityUnit: "unit",
  purchasedQuantity: 2,
  overbuy: 0,
  totalCostCents: 2000,
  ordinaryTotalCents: 4000,
  effectiveUnitCents: 1000,
  condition: "CMR",
});
const evaluation: ShoppingEvaluation = {
  itemId: item.id,
  best: option,
  preferred: option,
  alternative: null,
  savingsCents: 0,
  options: [option],
};
const list = { version: 2 as const, items: [item] };
const day = (date: string, priceCents: number, id = listingId) => ({
  listingId: id,
  date,
  priceCents,
  observedAt: new Date(`${date}T15:00:00Z`),
});

it("reports ordinary package minima, real coverage and Lima recency in each period", () => {
  const result = shoppingPriceHistories(
    list,
    [evaluation],
    [
      day("2026-10-15", 2000),
      day("2026-10-09", 1500),
      day("2026-10-08", 1200),
      day("2026-09-16", 1100),
      day("2026-09-15", 900),
      day("2026-07-17", 100),
    ],
    now,
  )[0]!;
  expect(result.periods).toMatchObject([
    { days: 7, minimumCents: 1500, coveredDays: 2, daysAgo: 6 },
    { days: 30, minimumCents: 1100, coveredDays: 4, daysAgo: 29 },
    { days: 90, minimumCents: 900, coveredDays: 5, daysAgo: 30 },
  ]);
});
it("ignores other SKUs, future samples and nonpositive prices; ties use the most recent observation", () => {
  const result = shoppingPriceHistories(
    list,
    [evaluation],
    [
      day("2026-10-10", 1500),
      day("2026-10-15", 1500),
      day("2026-10-16", 100),
      day("2026-10-15", 1, "other"),
      day("2026-10-14", 0),
    ],
    now,
  )[0]!;
  expect(result.periods[0]).toMatchObject({ minimumCents: 1500, daysAgo: 0, coveredDays: 2 });
});
it("withholds a substitute's history and generic history; never manufactures coverage", () => {
  expect(
    shoppingPriceHistories(
      list,
      [{ ...evaluation, preferred: null }],
      [day("2026-10-15", 100)],
      now,
    ),
  ).toEqual([]);
  const generic = shoppingListItemSchema.parse({
    ...item,
    intent: "generic",
    listingId: undefined,
    quantityMode: "normalized",
  });
  expect(
    shoppingPriceHistories(
      { ...list, items: [generic] },
      [evaluation],
      [day("2026-10-15", 100)],
      now,
    ),
  ).toEqual([]);
  expect(
    shoppingPriceHistories(list, [evaluation], [], now)[0]?.periods.every(
      (p) => p.coveredDays === 0 && p.minimumCents === null,
    ),
  ).toBe(true);
});
