import { maximumSearchLength, usefulSearchQuery } from "./public-products.ts";

/** Navigation taxonomy only. These departments never establish product equivalence. */
export const searchCategories = [
  {
    id: "abarrotes",
    label: "Abarrotes",
    description: "Arroz, pastas, aceites y más para tu despensa",
    departments: ["Abarrotes", "Desayunos", "Desayuno"],
  },
  {
    id: "lacteos-huevos",
    label: "Lácteos y huevos",
    description: "Leche, yogures y huevos para cada día",
    departments: ["Lácteos y Huevos", "Lácteos", "Lacteos y Huevos", "Lacteos", "Huevos"],
  },
  {
    id: "bebidas",
    label: "Bebidas",
    description: "Agua, jugos y otras bebidas",
    departments: ["Bebidas", "Aguas y Bebidas"],
  },
  {
    id: "limpieza",
    label: "Limpieza",
    description: "Detergentes y productos para tu casa",
    departments: ["Limpieza"],
  },
  {
    id: "cuidado-personal",
    label: "Cuidado personal",
    description: "Higiene y cuidado de todos los días",
    departments: ["Cuidado Personal y Salud", "Higiene, Salud y Belleza", "Belleza"],
  },
] as const;

export type SearchCategoryId = (typeof searchCategories)[number]["id"];

export function searchCategory(value: unknown) {
  return searchCategories.find((category) => category.id === value) ?? null;
}

/** A known category permits browsing without text; invalid nonempty text stays invalid. */
export function usefulSearchRequest(query: string, category: SearchCategoryId | null) {
  return (
    usefulSearchQuery(query) ||
    (query.length <= maximumSearchLength &&
      searchCategory(category) !== null &&
      query.trim() === "")
  );
}
