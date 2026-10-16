import { expect, it } from "vitest";
import { normalizeCatalogListing } from "./catalog.ts";
import { canonicalIdentityKey } from "./matching.ts";
import type { MatchingListing } from "./matching.ts";

function listing(title: string, brand = "Gloria"): MatchingListing {
  return {
    id: title,
    retailer: "metro",
    title,
    attributes: normalizeCatalogListing({ title, sourceBrand: brand, priceUnit: "UN" }),
  };
}

const whole = listing("Leche Gloria Entera Caja 946ml");

it("keeps identity independent of membership, word order and equivalent unit syntax", () => {
  const reordered = listing("Gloria Leche Entera 0.946 L Caja");
  const key = canonicalIdentityKey([whole]);
  expect(key).not.toBeNull();
  expect(canonicalIdentityKey([whole, reordered])).toBe(key);
  expect(canonicalIdentityKey([reordered, whole, whole])).toBe(key);
});

it.each([
  ["Leche Gloria Descremada Caja 946ml", "Gloria"],
  ["Leche Gloria Entera Botella 946ml", "Gloria"],
  ["Leche Gloria Entera Caja 750ml", "Gloria"],
  ["Leche Gloria Entera Pack x2 Cajas 946ml", "Gloria"],
  ["Leche Gloria Entera Caja 946ml", "Otra"],
  ["Leche Gloria Entera Etapa 2 Caja 946ml", "Gloria"],
])("does not reuse evidence for %s / %s", (title, brand) => {
  const changed = listing(title, brand);
  expect(canonicalIdentityKey([changed])).not.toBe(canonicalIdentityKey([whole]));
});

it("rejects incomplete, conflicting and uncertain identity evidence", () => {
  expect(canonicalIdentityKey([])).toBeNull();
  expect(canonicalIdentityKey([listing("Leche Gloria Entera")])).toBeNull();
  expect(canonicalIdentityKey([whole, listing("Leche Gloria Light Caja 946ml")])).toBeNull();
  expect(
    canonicalIdentityKey([{ ...whole, attributes: { ...whole.attributes, soldByWeight: true } }]),
  ).toBeNull();
  expect(
    canonicalIdentityKey([
      { ...whole, attributes: { ...whole.attributes, issues: ["uncertain"] } },
    ]),
  ).toBeNull();
});
