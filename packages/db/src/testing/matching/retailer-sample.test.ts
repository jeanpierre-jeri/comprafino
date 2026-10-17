import { describe, expect, it } from "vitest";
import fixture from "./fixtures/retailer-sample-2026-10-16.json";
import calibration from "../../../../core/src/fixtures/matching.json";
import { parseRetailerSample, readRetailerSample } from "./retailer-sample.ts";
import { readIndependentAudit } from "../../matching-independent.ts";

describe("dated four-retailer sample boundaries", () => {
  it("accepts four distinct stores without replacing the historical corpus", () => {
    const sample = readRetailerSample();
    expect(sample.pairs).toHaveLength(26);
    expect(Object.values(sample.listings)).toHaveLength(34);
    expect(new Set(Object.values(sample.listings).map((row) => row.retailer)).size).toBe(4);
    expect(sample.canonicalGroups[0]?.members).toHaveLength(4);
    expect(sample.pairs.filter((pair) => pair.assurance === "ambiguous")).toHaveLength(3);
    const historical = readIndependentAudit();
    expect(historical.pairs).toHaveLength(105);
    expect(historical.canonicalGroups).toHaveLength(28);
    expect(new Set(Object.values(historical.listings).map((row) => row.retailer)).size).toBe(3);

    const pairKey = (
      a: { retailer: string; title: string },
      b: { retailer: string; title: string },
    ) => [`${a.retailer}:${a.title}`, `${b.retailer}:${b.title}`].sort().join("|");
    const calibrationListings: Record<string, { retailer: string; title: string }> =
      calibration.listings;
    const priorPairs = new Set([
      ...historical.pairs.map((pair) =>
        pairKey(historical.listings[pair.a]!, historical.listings[pair.b]!),
      ),
      ...calibration.pairs.map((pair) =>
        pairKey(calibrationListings[pair.a]!, calibrationListings[pair.b]!),
      ),
    ]);
    expect(
      sample.pairs.every(
        (pair) => !priorPairs.has(pairKey(sample.listings[pair.a]!, sample.listings[pair.b]!)),
      ),
    ).toBe(true);
  });

  it("rejects groups larger than the four registered stores", () => {
    const value = structuredClone(fixture);
    value.canonicalGroups[0]!.members.push("rice-makro");
    expect(() => parseRetailerSample(value)).toThrow(/Too big/u);
  });

  it("rejects two members of one retailer inside a group", () => {
    const value = structuredClone(fixture);
    value.canonicalGroups[0]!.members[0] = "rice-makro";
    expect(() => parseRetailerSample(value)).toThrow("Invalid reviewed canonical group");
  });

  it("rejects unknown group members", () => {
    const value = structuredClone(fixture);
    value.canonicalGroups[0]!.members[0] = "absent";
    expect(() => parseRetailerSample(value)).toThrow("Invalid reviewed canonical group");
  });

  it("rejects an unknown pair member before SQL evaluation", () => {
    const value = structuredClone(fixture);
    value.pairs[0]!.a = "absent";
    expect(() => parseRetailerSample(value)).toThrow("Invalid independent audit pair");
  });

  it("rejects same-retailer comparisons and reversed duplicate pairs", () => {
    const sameStore = structuredClone(fixture);
    sameStore.pairs[0]!.b = "rice-plaza-vea";
    expect(() => parseRetailerSample(sameStore)).toThrow("Invalid independent audit pair");
    const duplicate = structuredClone(fixture);
    const pair = duplicate.pairs[0]!;
    duplicate.pairs.push({ ...pair, a: pair.b, b: pair.a });
    expect(() => parseRetailerSample(duplicate)).toThrow("Duplicate independent audit pair");
  });

  it("requires a declared evidence source", () => {
    const value = structuredClone(fixture);
    value.listings["oats-makro"].evidence.source = "absent";
    expect(() => parseRetailerSample(value)).toThrow("Unknown sample evidence source");
  });

  it("cannot turn an ambiguous case into a truth label or omit a known label", () => {
    const labelledAmbiguity = structuredClone(fixture);
    labelledAmbiguity.pairs.find((pair) => pair.assurance === "ambiguous")!.expected = "match";
    expect(() => parseRetailerSample(labelledAmbiguity)).toThrow("no expected truth label");
    const missingLabel = structuredClone(fixture);
    missingLabel.pairs[0]!.expected = null;
    expect(() => parseRetailerSample(missingLabel)).toThrow("no expected truth label");
  });
});
