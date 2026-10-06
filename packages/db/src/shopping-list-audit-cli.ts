import { randomUUID } from "node:crypto";
import {
  getSubstitutionProfile,
  areSafeSubstitutes,
  isListingCompatibleWithGenericNeed,
  shoppingListItemSchema,
  inferGenericSubstitutionProfile,
  searchFilters,
} from "@comprafino/core";
import { createDatabase } from "./client.ts";
import { searchGenericProductOffers } from "./generic-offers.ts";
import { getCanonicalProductComparison } from "./public-products.ts";
import { evaluateCurrentShoppingItem } from "./shopping-list.ts";

// Read-only audit. No ingestion, discovery recording or refresh operations.
const needs = [
  { query: "huevos", amount: 30, unit: "unit" },
  { query: "arroz", amount: 5, unit: "kg" },
  { query: "aceite", amount: 3, unit: "L" },
  { query: "leche", amount: 6, unit: "unit" },
  { query: "detergente", amount: 3, unit: "kg" },
  { query: "detergente", amount: 3, unit: "L" },
] as const;

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
      substitutionProfile: inferGenericSubstitutionProfile(need.query, need.unit),
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
    const eggsReference =
      need.query === "huevos"
        ? offers.find((o) => o.canonicalId && isListingCompatibleWithGenericNeed(item, o))
        : null;
    const eggsProduct = eggsReference?.canonicalId
      ? await getCanonicalProductComparison(db, eggsReference.canonicalId, now)
      : null;
    const preferredEggItem = eggsProduct
      ? shoppingListItemSchema.parse({
          ...item,
          intent: "preferred",
          canonicalId: eggsProduct.id,
          label: eggsProduct.displayName,
          quantityMode: "packages",
          quantity: { amount: 1, unit: "unit" },
          substitutionProfile: null,
        })
      : null;
    const preferredEggEvaluation = preferredEggItem
      ? await evaluateCurrentShoppingItem(db, preferredEggItem, "standard", now)
      : null;
    const quailRegression =
      need.query === "huevos"
        ? offers
            .filter((o) => /codorniz|codornices/iu.test(o.title))
            .map((o) => ({
              title: o.title,
              remainsInBroadSearch: true,
              genericCompatible: isListingCompatibleWithGenericNeed(item, o),
              preferredCompatible: eggsProduct
                ? areSafeSubstitutes({ title: eggsProduct.displayName }, o)
                : null,
            }))
        : null;

    if (quailRegression?.some((r) => r.genericCompatible || r.preferredCompatible === true)) {
      throw new Error("Unsafe quail substitution");
    }

    results.push({
      need,
      currentSearchOptions: offers.map((o) => {
        const compatibility = getSubstitutionProfile(o);
        const semanticCompatible = isListingCompatibleWithGenericNeed(item, o);
        let unit;

        if (o.totalQuantity?.unit === "g") {
          unit = "kg" as const;
        } else if (o.totalQuantity?.unit === "ml") {
          unit = "L" as const;
        } else {
          unit = "unit" as const;
        }

        let exclusionReason;

        if (!semanticCompatible) {
          if (compatibility === null) {
            exclusionReason = "Unsupported or specialty variant" as const;
          } else {
            exclusionReason = "Different family/form" as const;
          }
        } else if (
          o.unitPrice?.quality !== "strong" ||
          !o.totalQuantity ||
          o.pricingBasis !== "unit"
        ) {
          exclusionReason = "Insufficient quantity evidence" as const;
        } else if (unit !== item.quantity.unit) {
          exclusionReason = "Different quantity dimension" as const;
        } else {
          exclusionReason = null;
        }

        return {
          id: o.id,
          title: o.title,
          retailer: o.retailerName,
          canonicalId: o.canonicalId,
          priceCents: o.currentPriceCents,
          quantity: o.totalQuantity,
          quality: o.unitPrice?.quality ?? null,
          quantityReason: o.unitPriceUnavailableReason,
          compatibility,
          semanticCompatible,
          safeSubstitution: exclusionReason === null,
          exclusionReason,
          observedAt: o.observedAt,
        };
      }),
      evaluation,
      preferredEggEvaluation,
      quailRegression,
    });
  }

  console.log(JSON.stringify({ observedAt: now.toISOString(), readOnly: true, results }, null, 2));
} catch {
  console.error("Read-only shopping-list audit could not query the configured database.");
  process.exitCode = 1;
}
