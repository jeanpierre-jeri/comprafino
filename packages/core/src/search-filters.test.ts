import { expect, it } from "vitest";
import { searchFilters, searchFilterQuery } from "./search-filters.ts";
it("parses defaults, invalid and repeated URL values safely", () => {
  const defaults = { sort: "relevance", retailer: null, unit: null, priceMode: "standard" };
  expect(searchFilters()).toEqual(defaults);
  expect(
    searchFilters({ sort: ["unit-price"], retailer: "unknown", unit: "g", priceMode: true }),
  ).toEqual(defaults);
});
it("retains supported retailer, sort, unit and benefit URL state", () => {
  for (const retailer of ["metro", "tottus", "plaza-vea"])
    for (const unit of ["kg", "L", "unit", "roll"])
      expect(searchFilters({ sort: "unit-price", retailer, unit, priceMode: "benefits" })).toEqual({
        sort: "unit-price",
        retailer,
        unit,
        priceMode: "benefits",
      });
  expect(searchFilters({ sort: "total-price" }).sort).toBe("total-price");
});
it("serializes shareable URL state, omitting defaults and escaping query text", () => {
  expect(searchFilterQuery("azúcar & arroz", searchFilters())).toBe("q=az%C3%BAcar%20%26%20arroz");
  expect(
    searchFilterQuery(
      "huevos",
      searchFilters({ sort: "unit-price", retailer: "metro", unit: "unit", priceMode: "benefits" }),
    ),
  ).toBe("q=huevos&sort=unit-price&retailer=metro&unit=unit&priceMode=benefits");
});
