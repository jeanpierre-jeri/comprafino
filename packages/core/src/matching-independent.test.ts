import { z } from "zod";
import { describe, expect, it } from "vitest";
import original from "./fixtures/matching.json";
import independent from "./fixtures/matching-independent.json";
import { matchingListingSchema, scoreMatch } from "./matching.ts";
const rows = z.record(z.string(), matchingListingSchema).parse(independent.listings);
const baseline = z.record(z.string(), matchingListingSchema).parse(original.listings);
const pairKey = (a: { retailer: string; title: string }, b: { retailer: string; title: string }) =>
  [`${a.retailer}:${a.title}`, `${b.retailer}:${b.title}`].sort().join("|");
describe("frozen independent audit", () => {
  it("keeps all audit pairs separate from the calibration fixture", () => {
    const used = new Set(original.pairs.map((p) => pairKey(baseline[p.a]!, baseline[p.b]!)));
    expect(independent.pairs).toHaveLength(105);
    expect(independent.pairs.filter((p) => p.stratum === "new_auto")).toHaveLength(34);
    expect(independent.pairs.every((p) => !used.has(pairKey(rows[p.a]!, rows[p.b]!)))).toBe(true);
  });
  it.each(independent.pairs.filter((p) => p.expected !== "match"))(
    "protects nonpositive $a/$b: $rationale",
    (p) => {
      expect(scoreMatch(rows[p.a]!, rows[p.b]!, 1).decision).not.toBe("auto_match");
    },
  );
  it("keeps reviewed groups compatible, with one listing per retailer", () => {
    expect(independent.canonicalGroups).toHaveLength(28);
    for (const group of independent.canonicalGroups) {
      const members = group.members.map((id) => rows[id]!);
      expect(new Set(members.map((m) => m.retailer)).size).toBe(members.length);
      const decisions = members.flatMap((a, i) =>
        members.slice(i + 1).map((b) => scoreMatch(a, b, 1).decision),
      );
      expect(decisions.every((d) => d === "auto_match")).toBe(true);
    }
  });
});
