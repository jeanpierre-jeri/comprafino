import { readFileSync } from "node:fs";
import { z } from "zod";
import { matchingListingSchema, matchingVersion } from "@comprafino/core";
import { createDatabase } from "./client.ts";
import { evaluatePairs } from "./matching.ts";

export async function evaluateMatching(db = createDatabase()) {
  const fixture = z
    .object({
      listings: z.record(z.string(), matchingListingSchema),
      pairs: z.array(
        z.object({
          a: z.string(),
          b: z.string(),
          expected: z.enum(["match", "review", "no_match"]),
          split: z.enum(["calibration", "holdout"]),
        }),
      ),
    })
    .parse(
      JSON.parse(
        readFileSync(new URL("../../core/src/fixtures/matching.json", import.meta.url), "utf8"),
      ) as unknown,
    );
  const results = await evaluatePairs(
    db,
    fixture.pairs.map((p) => [fixture.listings[p.a]!, fixture.listings[p.b]!]),
  );
  const metrics = ["calibration", "holdout", "all"].map((split) => {
    const labels = fixture.pairs
      .map((p, i) => ({ ...p, result: results[i]!.result }))
      .filter((p) => split === "all" || p.split === split);
    const tp = labels.filter(
      (p) => p.expected === "match" && p.result.decision === "auto_match",
    ).length;
    const fp = labels.filter(
      (p) => p.expected !== "match" && p.result.decision === "auto_match",
    ).length;
    const fn = labels.filter(
      (p) => p.expected === "match" && p.result.decision !== "auto_match",
    ).length;
    const tn = labels.length - tp - fp - fn;

    return {
      split,
      pairs: labels.length,
      truePositives: tp,
      falsePositives: fp,
      trueNegatives: tn,
      falseNegatives: fn,
      autoMatchPrecision: tp + fp ? tp / (tp + fp) : null,
      recall: tp + fn ? tp / (tp + fn) : null,
    };
  });

  return { version: matchingVersion, metrics };
}
