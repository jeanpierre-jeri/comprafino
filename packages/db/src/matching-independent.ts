import { readFileSync } from "node:fs";
import { z } from "zod";
import { generateCandidates, matchingListingSchema, matchingVersion } from "@comprafino/core";
import { createDatabase } from "./client.ts";
import { evaluatePairs } from "./matching.ts";

const independentFixtureSchema = z.object({
  matchingVersion: z.literal(1),
  listings: z.record(z.string(), matchingListingSchema),
  pairs: z.array(
    z.object({
      a: z.string(),
      b: z.string(),
      expected: z.enum(["match", "review", "no_match"]),
      stratum: z.enum(["new_auto", "high_review", "high_reject", "targeted"]),
      rationale: z.string().min(1),
    }),
  ),
  canonicalGroups: z.array(
    z.object({
      members: z.array(z.string()).min(2).max(3),
      reviewed: z.literal(true),
      outcome: z.literal("consistent_variant"),
    }),
  ),
});

export function readIndependentAudit() {
  const f = independentFixtureSchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../../core/src/fixtures/matching-independent.json", import.meta.url),
        "utf8",
      ),
    ) as unknown,
  );
  const seen = new Set<string>();

  for (const p of f.pairs) {
    const a = f.listings[p.a],
      b = f.listings[p.b];

    if (!a || !b || a.retailer === b.retailer) {
      throw new Error("Invalid independent audit pair");
    }

    const key = [p.a, p.b].sort().join("|");

    if (seen.has(key)) {
      throw new Error("Duplicate independent audit pair");
    }

    seen.add(key);
  }

  for (const g of f.canonicalGroups) {
    const members = g.members.map((id) => f.listings[id]);

    if (
      members.some((m) => !m) ||
      new Set(members.map((m) => m!.retailer)).size !== g.members.length
    ) {
      throw new Error("Invalid reviewed canonical group");
    }
  }

  return f;
}

export async function evaluateIndependentAudit(db = createDatabase()) {
  const f = readIndependentAudit();

  if (f.matchingVersion !== matchingVersion) {
    throw new Error("Independent audit targets frozen version 1");
  }

  const results = await evaluatePairs(
    db,
    f.pairs.map((p) => [f.listings[p.a]!, f.listings[p.b]!]),
  );
  const generated = new Set(
    generateCandidates(Object.values(f.listings)).map(([a, b]) => [a.id, b.id].sort().join("|")),
  );
  const labelled = f.pairs.map((p, i) => ({
    ...p,
    result: results[i]!.result,
    candidateGenerated: generated.has([p.a, p.b].sort().join("|")),
  }));
  const metrics = ["all", "new_auto", "high_review", "high_reject", "targeted"].map((stratum) => {
    const pairs = labelled.filter((p) => stratum === "all" || p.stratum === stratum);
    const tp = pairs.filter(
      (p) => p.expected === "match" && p.result.decision === "auto_match",
    ).length;
    const fp = pairs.filter(
      (p) => p.expected !== "match" && p.result.decision === "auto_match",
    ).length;
    const fn = pairs.filter(
      (p) => p.expected === "match" && p.result.decision !== "auto_match",
    ).length;
    const tn = pairs.length - tp - fp - fn;

    return {
      stratum,
      pairs: pairs.length,
      truePositives: tp,
      falsePositives: fp,
      trueNegatives: tn,
      falseNegatives: fn,
      autoMatchPrecision: tp + fp ? tp / (tp + fp) : null,
      recall: tp + fn ? tp / (tp + fn) : null,
      candidatesNotGenerated: pairs.filter((p) => !p.candidateGenerated).length,
    };
  });

  return {
    version: matchingVersion,
    canonicalGroupsReviewed: f.canonicalGroups.length,
    metrics,
    labelled,
  };
}
