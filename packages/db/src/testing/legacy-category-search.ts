// Frozen 03D composition: independent category/global reads. The readers retain
// their direct-call contract; this reference must not adopt the shared-scope path.
import {
  catalogPolicy,
  searchFilters,
  usefulSearchQuery,
  resolveProductFamilyQuery,
  retailerIdSchema,
  missingDiscoveryRetailers,
  classifyProductFamily,
} from "@comprafino/core";
import type { SearchFilters, GenericOfferSort, ProductFamily } from "@comprafino/core";
import type { createDatabase } from "../client.ts";
import type { ProductComparison } from "../public-products.ts";
import { searchCanonicalProducts, publicProduct } from "../public-products.ts";
import {
  searchGenericProductOffers,
  filterGenericOffers,
  limitGenericOffers,
} from "../generic-offers.ts";

export async function legacyCategorySearch(
  db: ReturnType<typeof createDatabase>,
  query: string,
  sort: GenericOfferSort = "relevance",
  now = new Date(),
  filters: SearchFilters = searchFilters({ sort }),
  page = 1,
  options: { includeComparisons?: boolean } = {},
) {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > Math.ceil(catalogPolicy.retainedListingCap / 20)
  ) {
    throw new Error("Invalid search page");
  }
  const [products, offers, underlyingProducts, underlyingOffers] = await Promise.all([
    options.includeComparisons === false
      ? []
      : searchCanonicalProducts(db, query, now, page, filters.category),
    searchGenericProductOffers(
      db,
      query,
      sort,
      now,
      searchFilters({ sort, priceMode: filters.priceMode, category: filters.category }),
      true,
    ),
    options.includeComparisons !== false && filters.category && usefulSearchQuery(query)
      ? searchCanonicalProducts(db, query, now, page)
      : null,
    filters.category && usefulSearchQuery(query)
      ? searchGenericProductOffers(
          db,
          query,
          sort,
          now,
          searchFilters({ sort, priceMode: filters.priceMode }),
          true,
        )
      : null,
  ]);
  // Exact comparison identity/routes remain unchanged. In a recognized family
  // search, an incidental ingredient in an exact group is not useful coverage.
  const interpretation = resolveProductFamilyQuery(query);
  const family = interpretation?.family ?? null;
  const relevantProducts = productsInQueryFamily(products, family);
  const filteredOffers = filterGenericOffers(offers, filters);

  return {
    products: relevantProducts
      .map((p) => publicProduct(p, now, filters.priceMode))
      .filter(
        (p) =>
          (!filters.retailer || p.offers.some((o) => o.retailerId === filters.retailer)) &&
          (!filters.unit || filteredOffers.some((o) => o.canonicalId === p.id)),
      ),
    offers: limitGenericOffers(filteredOffers, sort, page),
    page,
    hasMore: filteredOffers.length > page * 30 || products.length === 20,
    totalOffers: filteredOffers.length,
    discoveryRetailers: usefulSearchQuery(query)
      ? missingDiscoveryRetailers(
          Object.fromEntries(
            retailerIdSchema.options.map((retailer) => [
              retailer,
              (underlyingOffers ?? offers).filter((offer) => offer.retailerId === retailer).length,
            ]),
          ),
        )
      : [],
    refreshListingIds: offers.map((offer) => offer.id),
    availableUnits: [
      ...new Set(
        offers
          .filter((o) => !filters.retailer || o.retailerId === filters.retailer)
          .flatMap((o) =>
            o.unitPrice ? [o.unitPrice.displayUnit === "l" ? "L" : o.unitPrice.displayUnit] : [],
          ),
      ),
    ],
    usefulResultCount:
      productsInQueryFamily(underlyingProducts ?? products, family).length +
      (underlyingOffers ?? offers).length,
  };
}

function productsInQueryFamily(products: ProductComparison[], family: ProductFamily | null) {
  if (!family) return products;

  return products.filter((product) =>
    product.offers.some((offer) => classifyProductFamily({ title: offer.title }).family === family),
  );
}
