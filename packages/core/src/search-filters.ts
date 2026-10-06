import { retailerIdSchema } from "./listing.ts";
import { genericOfferSort } from "./unit-price.ts";
import { priceMode } from "./conditional-pricing.ts";

export function searchFilters(params: Record<string, unknown> = {}) {
  const retailer = retailerIdSchema.safeParse(params.retailer);

  return {
    sort: genericOfferSort(params.sort),
    retailer: retailer.success ? retailer.data : null,
    unit:
      params.unit === "kg" ||
      params.unit === "L" ||
      params.unit === "unit" ||
      params.unit === "roll"
        ? params.unit
        : null,
    priceMode: priceMode(params.priceMode),
  };
}

export type SearchFilters = ReturnType<typeof searchFilters>;

export function searchFilterQuery(query: string, filters: SearchFilters) {
  const params: [string, string][] = [["q", query]];

  if (filters.sort !== "relevance") {
    params.push(["sort", filters.sort]);
  }

  if (filters.retailer) {
    params.push(["retailer", filters.retailer]);
  }

  if (filters.unit) {
    params.push(["unit", filters.unit]);
  }

  if (filters.priceMode !== "standard") {
    params.push(["priceMode", filters.priceMode]);
  }

  return params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
}
