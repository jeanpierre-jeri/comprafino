import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  canonicalGroups,
  catalogInputSchema,
  generateCandidates,
  matchingListingSchema,
  matchingVersion,
  normalizeCatalogListing,
  retailerIdSchema,
} from "@comprafino/core";
import type { MatchingListing } from "@comprafino/core";
import { parseIndependentAudit } from "../../matching-independent.ts";
import { evaluatePairs } from "../../matching.ts";

const assuranceSchema = z.enum(["confirmed", "inferred", "ambiguous"]);
const sampleSchema = z.object({
  reviewedOn: z.iso.date(),
  matchingVersion: z.literal(1),
  reviewer: z.literal("development-agent"),
  method: z.string().min(1),
  sources: z.record(
    z.string(),
    z.object({
      path: z.string().min(1),
      sha256: z.string().regex(/^[a-f0-9]{64}$/u),
      capturedAt: z.string().min(1),
    }),
  ),
  listings: z.record(
    z.string(),
    z.object({
      retailer: retailerIdSchema,
      input: catalogInputSchema,
      evidence: z.object({
        source: z.string(),
        selector: z.string().min(1),
        listingId: z.uuid().optional(),
        externalId: z.string().optional(),
        url: z.url().optional(),
        assumptions: z.array(z.string().min(1)).min(1),
      }),
    }),
  ),
  pairs: z
    .array(
      z.object({
        a: z.string(),
        b: z.string(),
        expected: z.enum(["match", "review", "no_match"]).nullable(),
        assurance: assuranceSchema,
        rationale: z.string().min(1),
      }),
    )
    .min(1),
  canonicalGroups: z.array(
    z.object({
      members: z.array(z.string()).min(2).max(4),
      assurance: z.enum(["confirmed", "inferred"]),
      rationale: z.string().min(1),
    }),
  ),
});

export function parseRetailerSample(value: unknown) {
  const sample = sampleSchema.parse(value);
  const listings: Record<string, MatchingListing> = {};

  for (const [id, row] of Object.entries(sample.listings)) {
    if (!sample.sources[row.evidence.source]) {
      throw new Error("Unknown sample evidence source");
    }

    listings[id] = matchingListingSchema.parse({
      id,
      retailer: row.retailer,
      title: row.input.title,
      attributes: normalizeCatalogListing(row.input),
    });
  }

  const audit = parseIndependentAudit({
    matchingVersion: sample.matchingVersion,
    listings,
    pairs: sample.pairs.map((pair) => ({
      ...pair,
      expected: pair.expected ?? "review",
      stratum: "targeted",
    })),
    canonicalGroups: sample.canonicalGroups.map((group) => ({
      members: group.members,
      reviewed: true,
      outcome: "consistent_variant",
    })),
  });

  for (const pair of sample.pairs) {
    // Uncertain examples must never enter a truth-labelled metric through a default.
    if ((pair.assurance === "ambiguous") !== (pair.expected === null)) {
      throw new Error("Ambiguous pairs must have no expected truth label");
    }
  }

  return { ...sample, listings: audit.listings };
}

export function readRetailerSample() {
  return parseRetailerSample(
    JSON.parse(
      readFileSync(new URL("./fixtures/retailer-sample-2026-10-16.json", import.meta.url), "utf8"),
    ) as unknown,
  );
}

export async function evaluateRetailerSample(db: Parameters<typeof evaluatePairs>[0]) {
  const sample = readRetailerSample();
  if (sample.matchingVersion !== matchingVersion) {
    throw new Error("Retailer sample targets frozen matching version 1");
  }

  const rows = Object.values(sample.listings);
  const generated = generateCandidates(rows);
  const key = (a: string, b: string) => [a, b].sort().join("|");
  const generatedKeys = new Set(generated.map(([a, b]) => key(a.id, b.id)));
  const results = await evaluatePairs(
    db,
    sample.pairs.map((pair) => [sample.listings[pair.a]!, sample.listings[pair.b]!]),
  );
  const labelled = sample.pairs.map((pair, index) => ({
    ...pair,
    result: results[index]!.result,
    candidateGenerated: generatedKeys.has(key(pair.a, pair.b)),
    decisionAgrees: decisionAgrees(pair.expected, results[index]!.result.decision),
  }));
  const metrics = (["confirmed", "inferred"] as const).map((assurance) => {
    const pairs = labelled.filter((pair) => pair.assurance === assurance);
    return {
      assurance,
      pairs: pairs.length,
      expectedMatches: pairs.filter((pair) => pair.expected === "match").length,
      autoMatches: pairs.filter((pair) => pair.result.decision === "auto_match").length,
      falsePositives: pairs.filter(
        (pair) => pair.expected !== "match" && pair.result.decision === "auto_match",
      ).length,
      falseNegatives: pairs.filter(
        (pair) => pair.expected === "match" && pair.result.decision !== "auto_match",
      ).length,
      candidatesNotGenerated: pairs.filter((pair) => !pair.candidateGenerated).length,
      decisionDisagreements: pairs.filter((pair) => pair.decisionAgrees === false).length,
    };
  });
  // Group the actual generated decisions, not just the labelled sample edges.
  const generatedResults = await evaluatePairs(db, generated);
  const groups = canonicalGroups(rows, generatedResults);

  return {
    reviewedOn: sample.reviewedOn,
    matchingVersion,
    metrics,
    ambiguousExcluded: labelled.filter((pair) => pair.assurance === "ambiguous").length,
    generatedCandidates: generated.length,
    groups,
    expectedGroups: sample.canonicalGroups.map((group) => ({
      ...group,
      formed: groups.some(
        (members) => [...members].sort().join("|") === [...group.members].sort().join("|"),
      ),
    })),
    labelled,
  };
}

function decisionAgrees(
  expected: "match" | "review" | "no_match" | null,
  actual: "auto_match" | "review" | "incompatible" | "no_match",
) {
  if (expected === null) return null;
  if (expected === "match") return actual === "auto_match";
  if (expected === "review") return actual === "review";

  return actual === "incompatible" || actual === "no_match";
}
