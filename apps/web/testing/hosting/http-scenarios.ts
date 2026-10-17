import { searchFilters, unitPriceBases } from "@comprafino/core";
import { searchFilterQuery } from "@comprafino/core/search-filters";
import { searchPublicProducts, evaluateCurrentShoppingList, formatPen } from "@comprafino/db";
import { openHostingFixtures } from "../../../../packages/db/src/testing/hosting/fixtures.ts";
import {
  hostingReferencesSchema,
  type HostingScenario,
} from "../../../../packages/db/src/testing/hosting/http-contract.ts";
import {
  catalogSearchCases,
  catalogBasketCases,
  makeCatalogList,
} from "../catalog-benchmark-workloads.ts";
import { evaluationDigest } from "../catalog-http-validation.ts";

export const concurrentHostingCases = [
  "search-wide-unit",
  "search-category-text",
  "basket-mixed-20-standard",
  "basket-generic-5-standard",
];

/** Uses the same production readers, fixtures and HTTP validators as prompt 03E. */
export async function hostingReferences(value: unknown) {
  const { state, db } = await openHostingFixtures(value);
  if (state.size === 80) {
    throw new Error("Scale fixtures before creating HTTP references");
  }
  const now = new Date(state.asOf);
  const scenarios: HostingScenario[] = [];
  for (const test of catalogSearchCases()) {
    const filters = searchFilters(test.params);
    const result = await searchPublicProducts(
      db,
      test.query,
      filters.sort,
      now,
      filters,
      test.page,
      { includeComparisons: false },
    );
    const offers = [...result.offers];
    if (filters.sort === "unit-price") {
      const groups = [...unitPriceBases, "unknown"];
      offers.sort(
        (left, right) =>
          groups.indexOf(left.unitPrice?.basis ?? "unknown") -
          groups.indexOf(right.unitPrice?.basis ?? "unknown"),
      );
    } else if (filters.sort === "total-price") {
      offers.sort(
        (left, right) => Number(left.pricingBasis === "kg") - Number(right.pricingBasis === "kg"),
      );
    }
    scenarios.push({
      kind: "search",
      id: test.id,
      path: `/search?${searchFilterQuery(test.query, filters)}&page=${test.page}`,
      expected: {
        ids: offers.map((offer) => offer.id),
        groups:
          filters.sort === "unit-price"
            ? [...unitPriceBases, "unknown"].map((basis) =>
                offers
                  .filter((offer) => (offer.unitPrice?.basis ?? "unknown") === basis)
                  .map((offer) => offer.id),
              )
            : [offers.map((offer) => offer.id)],
        prices: offers.map((offer) => ({
          id: offer.id,
          ordinary: formatPen(offer.currentPriceCents),
          conditional: offer.conditionalOffers.map((benefit) => formatPen(benefit.priceCents)),
        })),
        totalOffers: result.totalOffers,
        page: test.page,
        hasMore: result.hasMore,
      },
    });
  }
  for (const test of catalogBasketCases()) {
    const list = makeCatalogList(now, state.exactIds, test.count, test.composition);
    const evaluation = await evaluateCurrentShoppingList(db, list, test.mode, now);
    scenarios.push({
      kind: "basket",
      id: `basket-${test.composition}-${test.count}-${test.mode}`,
      path: `/api/list/evaluate?priceMode=${test.mode}`,
      body: JSON.stringify(list),
      expected: evaluationDigest(evaluation),
    });
  }
  return hostingReferencesSchema.parse({ state, scenarios });
}
