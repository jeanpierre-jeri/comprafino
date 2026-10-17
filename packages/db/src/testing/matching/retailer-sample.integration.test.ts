import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  canonicalGroups,
  generateCandidates,
  matchingThresholds,
  normalizeCatalogListing,
} from "@comprafino/core";
import { evaluateIndependentAudit } from "../../matching-independent.ts";
import { evaluatePairs } from "../../matching.ts";
import { ownedTestDatabase } from "../database.ts";
import { closeLocalTestConnections } from "../test-query-client.ts";
import { evaluateRetailerSample, readRetailerSample } from "./retailer-sample.ts";

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)("08A sample with real PostgreSQL similarity in an owned schema", () => {
  const harness = ownedTestDatabase({
    // Collection still executes a skipped describe. This unused placeholder
    // permits collection only; setup never runs without the explicit test URL.
    TEST_DATABASE_URL: testUrl ?? "postgresql://unused@localhost/comprafino_test",
    COMPRAFINO_TEST_DATABASE_MODE: process.env.COMPRAFINO_TEST_DATABASE_MODE,
  });

  beforeAll(() => harness.setup(), 30_000);

  afterAll(async () => {
    try {
      await harness.dispose();
      assert.deepEqual(
        await harness.client.query("select to_regnamespace($1)::text as name", [harness.schema]),
        [{ name: null }],
      );
      process.stdout.write(
        `08A_CLEANUP ${JSON.stringify({ schema: harness.schema, removed: true })}\n`,
      );
    } finally {
      await closeLocalTestConnections();
    }
  }, 30_000);

  it("evaluates the sample separately, excludes ambiguity and writes no catalog associations", async () => {
    const countSchema = z.array(
      z.object({ listings: z.number(), products: z.number(), links: z.number() }),
    );
    const counts = async () =>
      countSchema.parse(
        await harness.scoped.query(
          `select (select count(*)::int from retailer_listings) as listings,
        (select count(*)::int from canonical_products) as products,
        (select count(*)::int from canonical_product_listings) as links`,
        ),
      );
    const before = await counts();
    const currentSchema = await harness.scoped.query("select current_schema() as name");
    expect(currentSchema).toEqual([{ name: harness.schema }]);
    const historical = await evaluateIndependentAudit(harness.db);
    expect(historical.canonicalGroupsReviewed).toBe(28);
    expect(historical.metrics.find((metric) => metric.stratum === "all")).toMatchObject({
      pairs: 105,
      truePositives: 34,
      falsePositives: 0,
      trueNegatives: 52,
      falseNegatives: 19,
    });
    const sample = await evaluateRetailerSample(harness.db);
    expect(sample.ambiguousExcluded).toBe(3);
    expect(sample.metrics.map((metric) => metric.pairs)).toEqual([8, 15]);
    expect(sample.metrics.find((metric) => metric.assurance === "confirmed")?.falsePositives).toBe(
      0,
    );
    expect(
      sample.metrics.find((metric) => metric.assurance === "confirmed")?.decisionDisagreements,
    ).toBe(4);
    expect(sample.metrics.find((metric) => metric.assurance === "inferred")).toMatchObject({
      expectedMatches: 15,
      autoMatches: 15,
      falseNegatives: 0,
      candidatesNotGenerated: 0,
    });
    expect(sample.expectedGroups.find((group) => group.members.length === 4)?.formed).toBe(true);
    expect(
      sample.labelled
        .filter((pair) => pair.assurance === "ambiguous")
        .every((pair) => pair.expected === null && pair.decisionAgrees === null),
    ).toBe(true);

    const inputs = readRetailerSample();
    const yopi = inputs.listings["yopi-makro"]!;
    const withoutAssumedBrand = {
      ...yopi,
      attributes: normalizeCatalogListing({ title: yopi.title, priceUnit: "UN" }),
    };
    const [brandSensitivity] = await evaluatePairs(harness.db, [
      [withoutAssumedBrand, inputs.listings["yopi-metro"]!],
    ]);
    expect(brandSensitivity?.result.decision).not.toBe("auto_match");

    // Four stores still require every cross-store edge, not a transitive chain.
    const oats = Object.values(inputs.listings).filter((row) =>
      inputs.canonicalGroups[0]!.members.includes(row.id),
    );
    const oatsPairs = await evaluatePairs(harness.db, generateCandidates(oats));
    expect(oatsPairs).toHaveLength(6);
    expect(canonicalGroups(oats, oatsPairs)).toHaveLength(1);
    expect(canonicalGroups(oats, oatsPairs.slice(1)).every((group) => group.length < 4)).toBe(true);
    expect(await counts()).toEqual(before);
    expect(before).toEqual([{ listings: 0, products: 0, links: 0 }]);
    const bytes = readFileSync(
      new URL("./fixtures/retailer-sample-2026-10-16.json", import.meta.url),
    );
    process.stdout.write(
      `08A_EVALUATION ${JSON.stringify({
        evaluatedAt: new Date().toISOString(),
        schema: harness.schema,
        sampleSha256: createHash("sha256").update(bytes).digest("hex"),
        thresholds: matchingThresholds,
        historical: { groups: historical.canonicalGroupsReviewed, metrics: historical.metrics },
        sample,
        brandSensitivity: {
          case: "yopi-makro/yopi-metro",
          omitted: "Reconstructed Makro sourceBrand only; titles and units unchanged",
          result: brandSensitivity!.result,
        },
        catalogBefore: before,
        catalogAfter: await counts(),
      })}\n`,
    );
  }, 30_000);
});
