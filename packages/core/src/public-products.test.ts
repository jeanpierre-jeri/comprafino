import { describe, expect, it } from "vitest";
import {
  cheapestOffers,
  formatPen,
  meaningfulReferencePrice,
  normalizeSearchQuery,
  prioritizeWholeWordSearchResults,
  usefulSearchQuery,
} from "./public-products.ts";

describe("public search terms", () => {
  it.each([
    ["  GLORIA   946ml ", "gloria 946 ml"],
    ["Leche—Gloria; entera!", "leche gloria entera"],
    [
      "LAIVE light / zero lacto / sin lactosa / descremada",
      "laive light zero lacto sin lactosa descremada",
    ],
    ["Bonlé　９４６ＭＬ", "bonlé 946 ml"],
    ["%_'; drop table", "drop table"],
  ])("normalizes %s without erasing variant terms", (raw, expected) => {
    expect(normalizeSearchQuery(raw)).toBe(expected);
    expect(normalizeSearchQuery(expected)).toBe(expected);
  });
  it.each(["", "  ", "a", "!!!", "x".repeat(121)])("rejects unhelpful/bounded query %s", (q) => {
    expect(usefulSearchQuery(q)).toBe(false);
  });
  it("accepts two characters and the maximum length", () => {
    expect(usefulSearchQuery("ml")).toBe(true);
    expect(usefulSearchQuery("a".repeat(120))).toBe(true);
  });
});

describe("public whole-word relevance", () => {
  const partial = { title: "Shampoo Pantene 400ml" };
  const whole = { title: "Bolsa PAN Integral 500g" };
  const prefix = { title: "Panela Bolsa 500g" };
  const otherWhole = { title: "Pan 5un" };
  const results = [partial, whole, prefix, otherWhole];

  it("partitions stably without losing partial matches or mutating offers", () => {
    const ranked = prioritizeWholeWordSearchResults(results, "  ＰＡＮ!  ");
    expect(ranked).toEqual([whole, otherWhole, partial, prefix]);
    expect(ranked[0]).toBe(whole);
    expect(results).toEqual([partial, whole, prefix, otherWhole]);
  });

  it.each(["pan integral", "500", "pan500", "", "pante"])("preserves the order for %s", (query) =>
    expect(prioritizeWholeWordSearchResults(results, query)).toEqual(results),
  );

  it("keeps literal ambiguities and does not fold accents", () => {
    const ambiguous = [{ title: "Chocolate Lentejas" }, { title: "Lentejas Bolsa 1kg" }];
    expect(prioritizeWholeWordSearchResults(ambiguous, "lentejas")).toEqual(ambiguous);
    const accented = [{ title: "Cafe Molido" }, { title: "Café Molido" }];
    expect(prioritizeWholeWordSearchResults(accented, "café")).toEqual([accented[1], accented[0]]);
    expect(prioritizeWholeWordSearchResults([], "pan")).toEqual([]);
  });
});

describe("ordinary price presentation", () => {
  it.each([
    [620, "S/ 6.20"],
    [1290, "S/ 12.90"],
    [0, "S/ 0.00"],
    [1, "S/ 0.01"],
  ])("formats integer cents %i", (cents, expected) => {
    expect(formatPen(cents)).toBe(expected);
  });
  it.each([-1, 6.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid money %s",
    (cents) => expect(() => formatPen(cents)).toThrow("Invalid PEN cents"),
  );
  it("keeps only strictly higher references", () => {
    expect(meaningfulReferencePrice(620, 690)).toBe(690);
    expect(meaningfulReferencePrice(620, 620)).toBeNull();
    expect(meaningfulReferencePrice(620, 600)).toBeNull();
    expect(meaningfulReferencePrice(620, null)).toBeNull();
  });
  it("credits every tied cheapest retailer without mutating input", () => {
    const offers = [
      { retailer: "Tottus", currentPriceCents: 620 },
      { retailer: "Metro", currentPriceCents: 590 },
      { retailer: "Plaza Vea", currentPriceCents: 590 },
    ];
    expect(cheapestOffers(offers)).toEqual([offers[1], offers[2]]);
    expect(offers[0]!.retailer).toBe("Tottus");
    expect(cheapestOffers([])).toEqual([]);
    expect(cheapestOffers([offers[0]!])).toEqual([offers[0]]);
  });
});
