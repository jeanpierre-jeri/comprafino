import { randomUUID } from "node:crypto";
import { shoppingCompatibilityKey, shoppingListItemSchema, searchFilters } from "@comprafino/core";
import { createDatabase } from "./client.ts";
import { searchGenericProductOffers } from "./generic-offers.ts";
import { evaluateCurrentShoppingItem } from "./shopping-list.ts";
// Read-only audit. No ingestion, discovery recording or refresh operations.
const needs = [
  { query: "huevos", amount: 30, unit: "unit" },
  { query: "arroz", amount: 5, unit: "kg" },
  { query: "aceite", amount: 3, unit: "L" },
  { query: "leche", amount: 6, unit: "unit" },
  { query: "detergente", amount: 3, unit: "kg" },
  { query: "detergente", amount: 3, unit: "L" },
];
try {
  const db = createDatabase();
  const now = new Date();
  const results = [];
  for (const need of needs) {
    const item = shoppingListItemSchema.parse({
      id: randomUUID(),
      intent: "generic",
      canonicalId: null,
      query: need.query,
      label: need.query,
      quantity: { amount: need.amount, unit: need.unit },
      frequency: "weekly",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    const offers = await searchGenericProductOffers(
      db,
      need.query,
      "relevance",
      now,
      searchFilters(),
      true,
    );
    const evaluation = await evaluateCurrentShoppingItem(db, item, "standard", now);
    results.push({
      need,
      currentSearchOptions: offers.map((o) => ({
        id: o.id,
        title: o.title,
        retailer: o.retailerName,
        canonicalId: o.canonicalId,
        priceCents: o.currentPriceCents,
        quantity: o.totalQuantity,
        quality: o.unitPrice?.quality ?? null,
        quantityReason: o.unitPriceUnavailableReason,
        compatibility: shoppingCompatibilityKey(o.title),
        observedAt: o.observedAt,
      })),
      evaluation,
    });
  }
  console.log(JSON.stringify({ observedAt: now.toISOString(), readOnly: true, results }, null, 2));
} catch {
  console.error("Read-only shopping-list audit could not query the configured database.");
  process.exitCode = 1;
}
