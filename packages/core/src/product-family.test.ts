import { expect, it } from "vitest";
import { z } from "zod";
import fixture from "./fixtures/staple-relevance.json";
import {
  classifyProductFamily,
  resolveProductFamilyQuery,
  selectFamilyOffers,
} from "./product-family.ts";
import { retailerIdSchema } from "./listing.ts";
const cases = z
  .array(
    z.object({
      retailerId: retailerIdSchema.nullable(),
      sourceCategory: z.string().nullable(),
      title: z.string(),
      expected: z.string().nullable(),
    }),
  )
  .parse(fixture);
it.each(cases)("reviewed staple: $title → $expected", (row) => {
  expect(classifyProductFamily({ ...row, retailerId: row.retailerId ?? undefined }).family).toBe(
    row.expected,
  );
});
it("structured leaf evidence wins over an incidental title noun; mixed parent categories do not", () => {
  expect(
    classifyProductFamily({
      retailerId: "metro",
      sourceCategory: "1000766",
      title: "Avena molida 400g",
    }),
  ).toMatchObject({ family: "flour", origin: "source-category" });
  expect(
    classifyProductFamily({
      retailerId: "plaza-vea",
      sourceCategory: "349",
      title: "Polvo para hornear 100g",
    }).family,
  ).toBeNull();
  expect(classifyProductFamily({ title: "Azúcar blanca 1kg" })).toMatchObject({
    family: "sugar",
    origin: "title",
  });
});
it.each([
  ["huevo", "eggs", ""],
  ["azucar rubia 1kg", "sugar", "rubia 1 kg"],
  ["arroz costeño 5kg", "rice", "costeño 5 kg"],
  ["aceite primor 1l", "cooking_oil", "primor 1 l"],
  ["fideo don vittorio", "pasta", "don vittorio"],
  ["pasta molitalia 950g", "pasta", "molitalia 950 g"],
  ["papel higienico suave", "toilet_paper", "suave"],
])("preserves specificity for %s", (query, family, remainingQuery) => {
  expect(resolveProductFamilyQuery(query)).toEqual({ family, remainingQuery });
});
it.each(["leche gloria", "bebida sin azúcar", "coca cola zero"])(
  "unknown or property query %s retains lexical behavior",
  (query) => {
    expect(resolveProductFamilyQuery(query)).toBeNull();
  },
);
it("strong family evidence beats incidental lexical occurrence and preserves lexical order within a tier", () => {
  const offers = [
    { id: "incidental", family: classifyProductFamily({ title: "Gaseosa sin azúcar 1L" }) },
    { id: "fallback", family: classifyProductFamily({ title: "Azúcar 1kg" }) },
    {
      id: "source-1",
      family: classifyProductFamily({
        title: "Dulfina blanca 1kg",
        retailerId: "metro",
        sourceCategory: "1001260",
      }),
    },
    {
      id: "source-2",
      family: classifyProductFamily({
        title: "Metro blanca 2kg",
        retailerId: "metro",
        sourceCategory: "1001260",
      }),
    },
  ];
  expect(selectFamilyOffers(offers, "sugar").map((o) => o.id)).toEqual([
    "source-1",
    "source-2",
    "fallback",
  ]);
});

it("tuna in oil resolves the product noun instead of the ingredient", () => {
  expect(resolveProductFamilyQuery("atun en aceite")).toEqual({
    family: "canned_tuna",
    remainingQuery: "en aceite",
  });
});

it.each(["pasta dental colgate", "aceite corporal", "arroz con pollo", "avena bebida 1l"])(
  "ambiguous specific query %s retains lexical behavior",
  (query) => {
    expect(resolveProductFamilyQuery(query)).toBeNull();
  },
);
it("an oat beverage product noun is insufficient evidence for dry oats", () => {
  expect(classifyProductFamily({ title: "Avena bebida 1L" }).family).toBeNull();
});
