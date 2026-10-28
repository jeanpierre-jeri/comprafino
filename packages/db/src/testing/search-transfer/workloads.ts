import { searchFilters } from "@comprafino/core";
import type { SearchFilters } from "@comprafino/core";
import * as current from "../../generic-offers.ts";
import * as previous from "./legacy-generic-offers.ts";
import { transferId, transferNow } from "../transfer/fixture.ts";
import type { transferObserver } from "../transfer/observer.ts";

export type SearchTransferCase = {
  id: string;
  run: (db: ReturnType<typeof transferObserver>["db"], legacy: boolean) => Promise<unknown>;
};

export function groupedCase(
  id: string,
  query: string,
  params: Partial<SearchFilters> = {},
  page = 1,
): SearchTransferCase {
  const filters = searchFilters(params);
  return {
    id,
    run: (db, legacy) =>
      (legacy ? previous : current).searchGroupedPublicProducts(
        db,
        query,
        filters.sort,
        transferNow,
        filters,
        page,
      ),
  };
}

export function searchTransferCases(): SearchTransferCase[] {
  return [
    groupedCase("wide", "benchcatalogo"),
    groupedCase("page-2", "benchcatalogo", {}, 2),
    groupedCase("selective", "benchselect"),
    groupedCase("absent", "inexistente"),
    groupedCase("family", "arroz"),
    groupedCase("category-text", "benchcatalogo", { category: "lacteos-huevos" }),
    groupedCase("category-only", "", { category: "lacteos-huevos" }),
    groupedCase("filtered-benefits", "benchcatalogo", {
      retailer: "tottus",
      unit: "L",
      sort: "unit-price",
      priceMode: "benefits",
    }),
    groupedCase("weight-total", "benchcatalogo", { unit: "kg", sort: "total-price" }),
    groupedCase("units", "huevos", { unit: "unit", sort: "unit-price" }),
    groupedCase("last-page", "benchcatalogo", {}, 2500),
    groupedCase("unicode", "champú"),
    {
      id: "unlimited",
      run: (db, legacy) =>
        (legacy ? previous : current).searchGenericProductOffers(
          db,
          "benchcatalogo",
          "relevance",
          transferNow,
          searchFilters(),
          true,
        ),
    },
    {
      id: "canonical-benefits",
      run: (db, legacy) =>
        (legacy ? previous : current).getCanonicalCurrentProductOffers(
          db,
          transferId(2, 1),
          transferNow,
          "benefits",
        ),
    },
  ];
}
