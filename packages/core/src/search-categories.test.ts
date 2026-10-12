import { expect, it } from "vitest";
import { searchCategories, searchCategory, usefulSearchRequest } from "./search-categories.ts";

it("allows known-category browsing while retaining text validation", () => {
  for (const category of searchCategories) {
    expect(searchCategory(category.id)).toBe(category);
    expect(usefulSearchRequest("", category.id)).toBe(true);
    expect(usefulSearchRequest("  ", category.id)).toBe(true);
    expect(usefulSearchRequest("gloria", category.id)).toBe(true);
    for (const query of ["a", "!!!", "a".repeat(121), " ".repeat(121)]) {
      expect(usefulSearchRequest(query, category.id)).toBe(false);
    }
  }
  expect(usefulSearchRequest("", null)).toBe(false);
  expect(usefulSearchRequest("gloria", null)).toBe(true);
  expect(searchCategory(["limpieza"])).toBeNull();
  expect(searchCategory("unknown")).toBeNull();
});
