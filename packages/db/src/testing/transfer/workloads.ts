import {
  inferGenericSubstitutionProfile,
  searchFilters,
  shoppingListSchema,
} from "@comprafino/core";
import type { PriceMode, ShoppingList } from "@comprafino/core";
import { searchGroupedPublicProducts } from "../../generic-offers.ts";
import { evaluateCurrentShoppingList } from "../../shopping-list.ts";
import { evaluateCurrentShoppingList as legacyShoppingList } from "./legacy-shopping-list.ts";
import { transferId, transferNow } from "./fixture.ts";
import type { transferObserver } from "./observer.ts";

export function transferList(
  composition: "generic" | "mixed" | "strict" | "direct",
  count: number,
) {
  const generics = [
    { query: "arroz", unit: "kg" },
    { query: "aceite", unit: "L" },
    { query: "huevos", unit: "unit" },
    { query: "detergente", unit: "kg" },
    { query: "leche", unit: "unit" },
  ] as const;
  const items = Array.from({ length: count }, (_, index) => {
    const generic = generics[index % 5]!;
    const common = {
      id: transferId(4, index + 1),
      label: generic.query,
      query: generic.query,
      frequency: "weekly",
      createdAt: transferNow.toISOString(),
      updatedAt: transferNow.toISOString(),
    };
    if (composition === "generic" || (composition === "mixed" && index < 5)) {
      return {
        ...common,
        intent: "generic",
        canonicalId: null,
        quantityMode: "normalized",
        quantity: { amount: 3, unit: generic.unit },
        substitutionProfile: inferGenericSubstitutionProfile(generic.query, generic.unit),
      };
    }
    const group = Math.floor(index / 14) * 20 + (index % 14) + 1;
    return {
      ...common,
      intent: composition === "mixed" && index % 2 ? "preferred" : "strict",
      canonicalId: composition === "direct" ? null : transferId(2, group),
      ...(composition === "direct" ? { listingId: transferId(1, 1 + index * 4) } : {}),
      quantityMode: "packages",
      quantity: { amount: 1 + (index % 3), unit: "unit" },
    };
  });
  return shoppingListSchema.parse({ version: 2, items });
}

type Db = ReturnType<typeof transferObserver>["db"];
export type TransferCase = {
  id: string;
  kind: "search" | "shopping";
  run: (db: Db, legacy: boolean) => Promise<unknown>;
};

export function transferCases(): TransferCase[] {
  const result: TransferCase[] = [];
  const search = (id: string, query: string, params: Record<string, unknown> = {}, page = 1) => {
    const filters = searchFilters(params);
    result.push({
      id,
      kind: "search",
      run: (db) => searchGroupedPublicProducts(db, query, filters.sort, transferNow, filters, page),
    });
  };
  search("search-wide", "benchcatalogo");
  search("search-page-2", "benchcatalogo", {}, 2);
  search("search-selective", "benchselect");
  search("search-absent", "inexistente");
  search("search-family", "arroz");
  search("search-category-text", "benchcatalogo", { category: "lacteos-huevos" });
  search("search-filtered-benefits", "benchcatalogo", {
    retailer: "tottus",
    unit: "L",
    sort: "unit-price",
    priceMode: "benefits",
  });
  const shopping = (id: string, list: ShoppingList, mode: PriceMode = "standard") => {
    result.push({
      id,
      kind: "shopping",
      run: (db, legacy) =>
        (legacy ? legacyShoppingList : evaluateCurrentShoppingList)(db, list, mode, transferNow),
    });
  };
  shopping("list-generic-5", transferList("generic", 5));
  shopping("list-mixed-20", transferList("mixed", 20), "benefits");
  shopping("list-strict-50", transferList("strict", 50));
  shopping("list-direct-3", transferList("direct", 3));
  shopping("list-empty", { version: 2, items: [] });
  return result;
}

/** All functional fields remain compared, including full alternatives/history.
 * Timings are nondeterministic measurements, checked separately by the runner. */
export function functionalResult(result: unknown) {
  if (typeof result !== "object" || result === null || !("timings" in result)) return result;
  const { timings: _timings, ...functional } = result;
  return functional;
}
