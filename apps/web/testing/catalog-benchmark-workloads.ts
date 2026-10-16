import { randomUUID } from "node:crypto";
import { inferGenericSubstitutionProfile, shoppingListSchema } from "@comprafino/core";
import type { ShoppingListItem, PriceMode } from "@comprafino/core";

// Shared fixtures for reader/handler and production HTTP benchmarks.
export function makeCatalogList(
  now: Date,
  exactIds: string[],
  count: number,
  composition: "mixed" | "strict" | "generic" = "mixed",
) {
  const generics = [
    { query: "arroz", amount: 5, unit: "kg" },
    { query: "aceite", amount: 3, unit: "L" },
    { query: "huevos", amount: 30, unit: "unit" },
    { query: "detergente", amount: 3, unit: "kg" },
    { query: "leche", amount: 6, unit: "unit" },
  ] as const;
  const items = Array.from({ length: count }, (_, index) => {
    let intent: ShoppingListItem["intent"] = composition === "strict" ? "strict" : "generic";
    if (composition === "mixed" && (index === 3 || index === 4 || index >= 7)) {
      intent = index % 2 === 1 ? "strict" : "preferred";
    }
    const genericIndex = index < 3 || composition === "generic" ? index : index - 2;
    const generic = generics[genericIndex % generics.length]!;
    const common = {
      id: randomUUID(),
      label: intent === "generic" ? generic.query : "Producto exacto",
      query: generic.query,
      frequency: "weekly",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    if (intent === "generic") {
      return {
        ...common,
        intent,
        canonicalId: null,
        quantityMode: "normalized",
        quantity: { amount: generic.amount, unit: generic.unit },
        substitutionProfile: inferGenericSubstitutionProfile(generic.query, generic.unit),
      };
    }
    return {
      ...common,
      intent,
      canonicalId: exactIds[index]!,
      quantityMode: "packages",
      quantity: { amount: (index % 3) + 1, unit: "unit" },
    };
  });
  return shoppingListSchema.parse({ version: 2, items });
}

export function catalogSearchCases() {
  const cases: {
    id: string;
    query: string;
    params: Record<string, unknown>;
    page: number;
    plan: boolean;
  }[] = [];
  const search = (
    id: string,
    query: string,
    params: Record<string, unknown> = {},
    page = 1,
    plan = false,
  ) => {
    cases.push({ id, query, params, page, plan });
  };
  search("search-wide-relevance", "benchcatalogo", {}, 1, true);
  search("search-wide-unit", "benchcatalogo", { sort: "unit-price" });
  search("search-wide-total", "benchcatalogo", { sort: "total-price" });
  search("search-selective", "benchselect", {}, 1, true);
  search("search-absent", "inexistente");
  search("search-family", "arroz");
  search("search-category", "", { category: "lacteos-huevos" }, 1, true);
  search("search-category-text", "benchcatalogo", { category: "lacteos-huevos" }, 1, true);
  search("search-retailer-unit", "benchcatalogo", {
    retailer: "metro",
    unit: "L",
    sort: "unit-price",
  });
  search("search-page-2", "benchcatalogo", { sort: "unit-price" }, 2);
  search("search-page-10", "benchcatalogo", { sort: "unit-price" }, 10);
  search("search-benefits", "benchcatalogo", { sort: "total-price", priceMode: "benefits" });
  return cases;
}

export function catalogBasketCases() {
  const cases: { count: number; mode: PriceMode; composition: "mixed" | "strict" | "generic" }[] =
    [];
  for (const count of [5, 20, 50]) {
    for (const mode of ["standard", "benefits"] as const) {
      cases.push({ count, mode, composition: "mixed" });
    }
  }
  cases.push({ count: 50, mode: "standard", composition: "strict" });
  cases.push({ count: 5, mode: "standard", composition: "generic" });
  return cases;
}
