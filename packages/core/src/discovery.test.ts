import { describe, expect, it } from "vitest";
import {
  discoveryQueryForSearch,
  matchesDiscoveryQuery,
  normalizeDiscoveryQuery,
  parseDiscoveryOptions,
  validDiscoveryQuery,
} from "./discovery.ts";

describe("discovery query boundary", () => {
  it.each(["Arroz Costeño", " arroz  costeño ", "ARROZ COSTEÑO", "Arroz Costen\u0303o"])(
    "deduplicates %s conservatively",
    (query) => {
      expect(normalizeDiscoveryQuery(query)).toBe("arroz costeño");
    },
  );
  it("retains accents, brands, variant terms, punctuation and numbers", () => {
    expect(normalizeDiscoveryQuery("GLORIA 946")).toBe("gloria 946");
    expect(normalizeDiscoveryQuery("gloria 1l")).toBe("gloria 1l");
    expect(normalizeDiscoveryQuery("Atún light 1.5L")).toBe("atún light 1.5l");
    expect(normalizeDiscoveryQuery("atun")).not.toBe(normalizeDiscoveryQuery("atún"));
  });
  it.each([
    "",
    "  ",
    "a",
    "??",
    "???",
    "a!!",
    "a b",
    "123",
    "a".repeat(81),
    "a".repeat(241),
    "arroz" + " ".repeat(33) + "gloria",
    "abc\u0000",
    "abc\u200b",
  ])("rejects %j", (query) => {
    expect(validDiscoveryQuery(query)).toBe(false);
    expect(discoveryQueryForSearch(query, 0)).toBeNull();
  });
  it.each(["arroz", "a".repeat(80), " arroz   costeño ", "atún florida", "aceite 1l"])(
    "accepts %s",
    (query) => expect(validDiscoveryQuery(query)).toBe(true),
  );
  it("records valid zero results only", () => {
    expect(discoveryQueryForSearch("Arroz", 0)).toBe("arroz");
    expect(discoveryQueryForSearch("Arroz", 1)).toBeNull();
    expect(discoveryQueryForSearch("Arroz", 20)).toBeNull();
    expect(discoveryQueryForSearch("Arroz", -1)).toBeNull();
  });
  it("validates bounded CLI options", () => {
    expect(parseDiscoveryOptions(["--", "--dry-run", "--limit=3"])).toEqual({
      dryRun: true,
      limit: 3,
    });

    for (const args of [
      ["--limit=0"],
      ["--limit=31"],
      ["--limit=3.5"],
      ["--limit=3", "--limit=4"],
      ["--dry-run", "--dry-run"],
      ["--unknown"],
    ]) {
      expect(() => parseDiscoveryOptions(args)).toThrow(/option|limit/iu);
    }
  });
});

it("bounds the retained original spelling before normalized admission", () => {
  // NFKC composes two code points into one: normalized length alone is insufficient.
  expect(validDiscoveryQuery("a\u0301".repeat(80))).toBe(false);
  expect(validDiscoveryQuery("a\u0301".repeat(60))).toBe(true);
});

describe("discovery acquisition relevance", () => {
  it("requires the requested brand, including structured brands absent from titles", () => {
    expect(
      matchesDiscoveryQuery("queso edam tottus", {
        title: "Queso Edam 400 g",
        sourceBrand: "TOTTUS",
      }),
    ).toBe(true);
    expect(
      matchesDiscoveryQuery("queso edam aro", {
        title: "Queso Edam Tottus 400 g",
        sourceBrand: "TOTTUS",
      }),
    ).toBe(false);
    expect(matchesDiscoveryQuery("queso edam", { title: "Queso Edam Vonk x Kg" })).toBe(true);
  });

  it("preserves quantities, accents and variant terms using public search semantics", () => {
    expect(matchesDiscoveryQuery("LECHE GLORIA 1L", { title: "Leche Gloria 1 L" })).toBe(true);
    expect(matchesDiscoveryQuery("leche gloria 1l", { title: "Leche Gloria 11 L" })).toBe(false);
    expect(matchesDiscoveryQuery("atún light", { title: "Atún en aceite" })).toBe(false);
    expect(matchesDiscoveryQuery("atún", { title: "Atun" })).toBe(false);
    expect(matchesDiscoveryQuery("???", { title: "Queso" })).toBe(false);
  });
});
