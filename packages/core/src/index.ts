/** Remove duplicates while preserving insertion order; never mutates the input. */
export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export * from "./listing.ts";
export * from "./catalog.ts";
export * from "./matching.ts";
export * from "./public-products.ts";
export * from "./freshness.ts";
export * from "./discovery.ts";

export * from "./listing-refresh.ts";
export * from "./unit-price.ts";

export * from "./product-family.ts";

export * from "./conditional-pricing.ts";
export * from "./search-filters.ts";

export * from "./price-history.ts";
export * from "./observation-coverage.ts";

export * from "./shopping-list.ts";

export * from "./substitution-compatibility.ts";

export * from "./shopping-creation.ts";
export * from "./basket-optimization.ts";

export * from "./catalog-policy.ts";

export * from "./diagnostics.ts";
