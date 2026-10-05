import {
  evaluateShoppingListItem,
  getSubstitutionProfile,
  searchFilters,
  shoppingQueryForTitle,
  shoppingMarketQuery,
} from "@comprafino/core";
import type { PriceMode, ShoppingCandidate, ShoppingListItem } from "@comprafino/core";
import type { createDatabase } from "./client.ts";
import { searchGenericProductOffers, getCanonicalCurrentProductOffers } from "./generic-offers.ts";
import { getCanonicalProductComparison } from "./public-products.ts";

/** Read-only current market boundary. Exact eligibility and generic quantity
 * evidence come from existing public queries; no list data is persisted. */
export async function evaluateCurrentShoppingItem(
  db: ReturnType<typeof createDatabase>,
  item: ShoppingListItem,
  mode: PriceMode,
  now = new Date(),
) {
  const candidates: ShoppingCandidate[] = [];
  const product =
    item.intent === "generic"
      ? null
      : await getCanonicalProductComparison(db, item.canonicalId, now, mode);
  if (product) {
    const exactOffers = await getCanonicalCurrentProductOffers(db, product.id, now, mode);
    for (const offer of exactOffers) candidates.push(shoppingCandidate(offer));
  }
  if (item.intent !== "strict") {
    // Derive the family from the current canonical identity, never a saved brand
    // query, so a preference cannot hide another brand's market opportunity.
    const query = product
      ? shoppingQueryForTitle(product.displayName)
      : item.intent === "generic"
        ? shoppingMarketQuery(item)
        : null;
    if (query) {
      const offers = await searchGenericProductOffers(
        db,
        query,
        "relevance",
        now,
        searchFilters({ priceMode: mode }),
        true,
      );
      for (const o of offers) {
        // Independent normalized offers are valid generic options. A null public
        // canonical ID must never become an exact-product/history association.
        if (product && o.canonicalId === product.id) continue;
        candidates.push(shoppingCandidate(o));
      }
    }
  }
  return evaluateShoppingListItem(item, candidates, mode, now, product?.displayName);
}

function shoppingCandidate(
  o: Awaited<ReturnType<typeof searchGenericProductOffers>>[number],
): ShoppingCandidate {
  const q = o.totalQuantity;
  return {
    id: o.id,
    canonicalId: o.canonicalId,
    title: o.title,
    retailerName: o.retailerName,
    url: o.url,
    ordinaryPriceCents: o.currentPriceCents,
    conditionalOffers: o.conditionalOffers,
    observedAt: o.observedAt,
    available: true,
    packageQuantity:
      q && o.pricingBasis === "unit"
        ? {
            amount: q.value / (q.unit === "unit" ? 1 : 1000),
            unit: q.unit === "g" ? "kg" : q.unit === "ml" ? "L" : "unit",
          }
        : null,
    strongQuantity: o.unitPrice?.quality === "strong",
    pricingBasis: o.pricingBasis,
    substitutionProfile: getSubstitutionProfile(o),
  };
}
