import { z } from "zod";
import { describe, expect, it } from "vitest";
import { normalizeCatalogListing } from "./catalog.ts";
import {
  matchingListingSchema,
  canonicalGroups,
  comparisonTitle,
  generateCandidates,
  hardConflicts,
  scoreMatch,
} from "./matching.ts";
import type { MatchingListing } from "./matching.ts";
import fixture from "./fixtures/matching.json";

const rows = z.record(z.string(), matchingListingSchema).parse(fixture.listings);

const listing = (
  id: string,
  title = "Leche Gloria Entera 946ml",
  retailer: MatchingListing["retailer"] = "metro",
): MatchingListing => ({
  id,
  title,
  retailer,
  attributes: normalizeCatalogListing({ title, priceUnit: "UN", sourceBrand: "Gloria" }),
});

describe("deterministic matching", () => {
  it.each(fixture.pairs.filter((p) => p.expected !== "match"))(
    "never auto-matches reviewed negative/uncertain $a / $b: $rationale",
    (p) => {
      expect(scoreMatch(rows[p.a]!, rows[p.b]!, 1).decision).not.toBe("auto_match");
    },
  );
  it.each([
    ["brand", "same_retailer"],
    ["dimension", "different_dimension"],
    ["quantity", "different_quantity"],
    ["count", "different_package_count"],
    ["total", "different_total_quantity"],
  ] as const)("hard %s conflict beats perfect similarity", (change, reason) => {
    const a = listing("a"),
      b = listing("b", undefined, "plaza-vea");

    if (change === "brand") {
      b.retailer = "metro";
    }

    if (change === "dimension") {
      b.attributes.quantity = { value: 946, unit: "g" };
    }

    if (change === "quantity") {
      b.attributes.quantity = { value: 1500, unit: "ml" };
    }

    if (change === "count") {
      b.attributes.packageCount = 3;
    }

    if (change === "total") {
      b.attributes.totalQuantity = { value: 2838, unit: "ml" };
    }

    expect(scoreMatch(a, b, 1)).toMatchObject({
      score: 0,
      decision: "incompatible",
      reasons: expect.arrayContaining([reason]),
    });
  });
  it("rejects different exact brands and containers", () => {
    const a = listing("a", "Leche Gloria Entera Caja 946ml"),
      b = listing("b", "Leche Gloria Entera Bolsa 946ml", "plaza-vea");
    expect(hardConflicts(a, b)).toContain("different_container");
    b.attributes.brandKey = "laive";
    expect(hardConflicts(a, b)).toContain("different_brand");
  });
  it("keeps missing brands uncertain, and excludes variable weight and diagnostics from automatic decisions", () => {
    const a = listing("a"),
      b = listing("b", undefined, "plaza-vea");
    b.attributes.brandKey = null;
    expect(scoreMatch(a, b, 1).decision).toBe("review");
    expect(scoreMatch(a, b, 1).reasons).toContain("missing_brand");
    b.attributes.brandKey = "gloria";
    b.attributes.soldByWeight = true;
    expect(scoreMatch(a, b, 1).decision).toBe("review");
    b.attributes.soldByWeight = false;
    b.attributes.issues = ["mixed-bundle"];
    expect(scoreMatch(a, b, 1).decision).toBe("review");
  });
  it("does not allow fuzzy identity tokens to auto-match", () => {
    const a = listing("a"),
      b = listing("b", "Leche Gloria Entera Sin Azúcar 946ml", "plaza-vea");
    expect(scoreMatch(a, b, 1).decision).toBe("review");
    expect(comparisonTitle(b)).toContain("sin azucar");
  });
  it("preserves unknown identity words and normalizes observed lactose aliases", () => {
    expect(comparisonTitle(rows["31"]!)).toContain("lactosafree");
    expect(comparisonTitle(rows["82"]!)).toContain("lactosafree");
    expect(comparisonTitle(rows["31"]!)).not.toContain("946");
  });
  it("preserves model/stage numbers while removing explicitly labelled pack counts", () => {
    const a = listing("a", "Leche Gloria Etapa 2 946ml"),
      b = listing("b", "Leche Gloria Etapa 3 946ml", "plaza-vea");
    expect(comparisonTitle(a)).toContain("2");
    expect(scoreMatch(a, b, 1).decision).toBe("review");
    expect(comparisonTitle(rows["45"]!)).not.toContain("x6");
  });
  it("uses brand blocks and missing-brand family blocks, never same-retailer pairs", () => {
    const a = listing("a"),
      b = listing("b", undefined, "plaza-vea"),
      c = listing("c"),
      d = listing("d", undefined, "tottus");
    d.attributes.brandKey = "laive";
    expect(generateCandidates([a, b, c, d]).map((p) => p.map((r) => r.id))).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
    d.attributes.brandKey = null;
    expect(generateCandidates([a, b, c, d])).toHaveLength(5);
    expect(generateCandidates([a, b, c, d].reverse())).toEqual(generateCandidates([a, b, c, d]));
  });
  it("explains exact evidence, score and the boundary of thresholds", () => {
    const a = listing("a"),
      b = listing("b", undefined, "plaza-vea");
    expect(scoreMatch(a, b, 1)).toMatchObject({
      score: 1,
      decision: "auto_match",
      reasons: expect.arrayContaining([
        "same_brand",
        "same_quantity",
        "same_package_count",
        "same_total_quantity",
      ]),
    });
    expect(scoreMatch(a, b, 0.75).decision).toBe("auto_match");
    expect(scoreMatch(a, b, 0.749).decision).toBe("review");
    expect(scoreMatch(a, b, 0).decision).toBe("no_match");
    expect(() => scoreMatch(a, b, NaN)).toThrow("Invalid similarity");
  });
  it("requires complete-link evidence and one member per retailer, with deterministic groups", () => {
    const a = listing("a"),
      b = listing("b", undefined, "plaza-vea"),
      c = listing("c", undefined, "tottus");
    const ab = { a: "a", b: "b", result: scoreMatch(a, b, 1) },
      bc = { a: "b", b: "c", result: scoreMatch(b, c, 1) };
    expect(canonicalGroups([a, b, c], [ab, bc])).toEqual([["a", "b"]]);
    const ac = { a: "a", b: "c", result: scoreMatch(a, c, 1) };
    expect(canonicalGroups([a, b, c], [ab, bc, ac])).toEqual([["a", "b", "c"]]);
    expect(canonicalGroups([c, b, a], [ac, bc, ab])).toEqual([["a", "b", "c"]]);
  });
});
