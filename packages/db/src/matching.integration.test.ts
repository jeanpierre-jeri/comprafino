import { getPublicRetailerListingDetail } from "./listing-detail.ts";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { getCanonicalProductPriceHistory } from "./price-history.ts";

import type { NormalizedRetailerListing } from "@comprafino/core";
import { closeLocalTestConnections } from "./testing/test-query-client.ts";
import { persistCatalogNormalizations } from "./catalog.ts";
import { evaluateIndependentAudit } from "./matching-independent.ts";
import { evaluateMatching } from "./matching-evaluate.ts";
import { evaluatePairs, persistMatching } from "./matching.ts";

import { persistListings } from "./ingestion.ts";

import { searchGenericProductOffers } from "./generic-offers.ts";
import { catalogTestContext, observation, publicNow } from "./testing/catalog-fixtures.ts";

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)("PostgreSQL matching (explicit TEST_DATABASE_URL)", () => {
  // Keep deliberate contention inside each case; cases start with independent data.
  const harness = catalogTestContext({
    ...process.env,
    TEST_DATABASE_URL: testUrl ?? "postgresql://unused@localhost/comprafino_test",
  });
  const {
    db,
    query,
    catalogRows,
    matchingRows,
    seedMatch,
    cleanupIdentity,
    getCanonicalProductComparison,
  } = harness;
  beforeAll(async () => {
    await harness.setup();
  }, 30_000);
  beforeEach(async () => {
    await harness.reset();
  }, 30_000);
  afterAll(async () => {
    try {
      await harness.dispose();
    } finally {
      await closeLocalTestConnections();
    }
  }, 30_000);
  it.each([
    ["title", { title: "Leche Gloria Descremada Caja 946ml" }],
    ["quantity", { title: "Leche Gloria Entera Caja 750ml" }],
    ["unit", { priceUnit: "KG" as const }],
    ["brand", { sourceBrand: "Otra" }],
    ["package", { packageText: "Pack 2 Cajas 946ml" }],
    ["multiplier", { sourceUnitMultiplier: 2 }],
  ])(
    "withholds changed %s identity before and after normalization until matching",
    async (kind, patch) => {
      const prefix = `identity-${kind}`;
      const { rows, pairs } = await seedMatch(prefix);
      await persistMatching(db, rows, pairs);
      const id =
        rows[0]!.priorGroupId ??
        z
          .array(z.object({ id: z.uuid() }))
          .parse(
            await query(
              "select canonical_product_id as id from canonical_product_listings where listing_id=$1",
              [rows[0]!.id],
            ),
          )[0]!.id;
      expect(await getCanonicalProductComparison(db, id)).not.toBeNull();
      const changed: NormalizedRetailerListing = {
        ...observation(`${prefix}-metro`, 1),
        retailer: "metro",
        title: "Leche Gloria Entera Caja 946ml",
        sourceBrand: "Gloria",
        url: "https://www.metro.pe/leche/p",
        ...patch,
      };
      await persistListings(db, "metro", [changed]);
      // Interrupted/failed normalization cannot leave the old exact claim public.
      await expect(
        persistCatalogNormalizations(db, [
          {
            ...(await catalogRows(changed.externalId))[0]!,
            sourceUnitMultiplier: 0,
          },
        ]),
      ).rejects.toThrow(/Too small/u);
      expect(await getCanonicalProductComparison(db, id)).toBeNull();
      expect(await getCanonicalProductPriceHistory(db, id, { now: publicNow })).toBeNull();
      const links = await query(
        "select listing_id from canonical_product_listings where canonical_product_id=$1",
        [id],
      );
      expect(links).toHaveLength(2);
      await persistCatalogNormalizations(db, await catalogRows(changed.externalId));
      expect(await getCanonicalProductComparison(db, id)).toBeNull();
      const listingId = z
        .array(z.object({ id: z.uuid() }))
        .parse(
          await query("select id from retailer_listings where external_id=$1", [
            changed.externalId,
          ]),
        )[0]!.id;
      const detail = await getPublicRetailerListingDetail(db, listingId, { now: publicNow });
      expect(detail?.canonicalId).toBeNull();
      expect(detail?.history).not.toBeNull();
      const independent = await searchGenericProductOffers(
        db,
        "leche gloria",
        "relevance",
        publicNow,
      );
      expect(independent.find((offer) => offer.id === listingId)?.canonicalId).toBeNull();
      // Restore the identity: normalization alone still must not renew confidence.
      await persistListings(db, "metro", [
        {
          ...changed,
          title: "Leche Gloria Entera Caja 946ml",
          sourceBrand: "Gloria",
          priceUnit: "UN",
          packageText: undefined,
          sourceUnitMultiplier: undefined,
          observedAt: observation("unused", 2).observedAt,
        },
      ]);
      await persistCatalogNormalizations(db, await catalogRows(changed.externalId));
      expect(await getCanonicalProductComparison(db, id)).toBeNull();
      const current = await matchingRows([`${prefix}-metro`, `${prefix}-plaza-vea`]);
      const validated = await evaluatePairs(db, [[current[0]!, current[1]!]]);
      expect((await persistMatching(db, current, validated)).stale).toBe(false);
      expect(await getCanonicalProductComparison(db, id)).not.toBeNull();
      await cleanupIdentity(prefix);
    },
  );

  it("preserves automatic confidence for price-only/replayed updates and preserves manual decisions", async () => {
    const prefix = "identity-manual";
    const { rows, pairs } = await seedMatch(prefix);
    await persistMatching(db, rows, pairs);
    const value: NormalizedRetailerListing = {
      ...observation(`${prefix}-metro`, 1),
      retailer: "metro",
      title: "Leche Gloria Entera Caja 946ml",
      sourceBrand: "Gloria",
    };
    await persistListings(db, "metro", [{ ...value, currentPriceCents: 1400 }]);
    await persistListings(db, "metro", [
      { ...value, title: "Old replay", observedAt: observation("unused", 0).observedAt },
    ]);
    expect(
      await query(
        "select confidence::float8 as confidence from canonical_product_listings where listing_id=$1",
        [rows.find((r) => r.retailer === "metro")!.id],
      ),
    ).toEqual([{ confidence: 1 }]);
    await query("update canonical_product_listings set method='manual' where listing_id=$1", [
      rows.find((r) => r.retailer === "metro")!.id,
    ]);
    const before = await query("select * from canonical_product_listings where listing_id=$1", [
      rows.find((r) => r.retailer === "metro")!.id,
    ]);
    await persistListings(db, "metro", [
      {
        ...value,
        title: "Leche Gloria Descremada Caja 946ml",
        observedAt: observation("unused", 2).observedAt,
      },
    ]);
    await persistCatalogNormalizations(db, await catalogRows(value.externalId));
    const current = await matchingRows([`${prefix}-metro`, `${prefix}-plaza-vea`]);
    expect(
      (await persistMatching(db, current, await evaluatePairs(db, [[current[0]!, current[1]!]])))
        .stale,
    ).toBe(true);
    expect(
      await query("select * from canonical_product_listings where listing_id=$1", [
        rows.find((r) => r.retailer === "metro")!.id,
      ]),
    ).toEqual(before);
    await cleanupIdentity(prefix);
  });

  it("changed normalization evidence requires rematching even without a new raw observation", async () => {
    const prefix = "identity-derived";
    const { rows, pairs } = await seedMatch(prefix);
    await persistMatching(db, rows, pairs);
    const id = z
      .array(z.object({ id: z.uuid() }))
      .parse(
        await query(
          "select canonical_product_id as id from canonical_product_listings where listing_id=$1",
          [rows[0]!.id],
        ),
      )[0]!.id;
    // Simulate a prior derived correction awaiting the current normalizer.
    await query(
      "update listing_normalizations set normalized_title=normalized_title || ' old' where listing_id=$1",
      [rows[0]!.id],
    );
    await persistCatalogNormalizations(db, await catalogRows(`${prefix}-${rows[0]!.retailer}`));
    expect(await getCanonicalProductComparison(db, id)).toBeNull();
    const current = await matchingRows([`${prefix}-metro`, `${prefix}-plaza-vea`]);
    await persistMatching(db, current, await evaluatePairs(db, [[current[0]!, current[1]!]]));
    expect(await getCanonicalProductComparison(db, id)).not.toBeNull();
    // Idempotent normalization does not revoke freshly validated evidence.
    await persistCatalogNormalizations(db, await catalogRows(`${prefix}-${rows[0]!.retailer}`));
    expect(await getCanonicalProductComparison(db, id)).not.toBeNull();
    await cleanupIdentity(prefix);
  });

  it("creates canonical links with real pg_trgm, idempotent concurrent reruns and SQL constraints", async () => {
    const { rows, pairs } = await seedMatch("matching");
    expect(pairs[0]!.result).toMatchObject({ decision: "auto_match", similarity: 1 });
    const results = await Promise.all([
      persistMatching(db, rows, pairs),
      persistMatching(db, rows, pairs),
    ]);
    expect(results.reduce((sum, r) => sum + r.productsCreated, 0)).toBe(1);
    expect(results.reduce((sum, r) => sum + r.linksCreated, 0)).toBe(2);
    const products = await query("select * from canonical_products order by id");
    const links = await query("select * from canonical_product_listings order by listing_id");
    expect(await persistMatching(db, rows, pairs)).toMatchObject({
      productsCreated: 0,
      linksCreated: 0,
      linksRemoved: 0,
      stale: false,
    });
    expect(await query("select * from canonical_products order by id")).toEqual(products);
    expect(await query("select * from canonical_product_listings order by listing_id")).toEqual(
      links,
    );
    await expect(
      query(
        "insert into canonical_product_listings select * from canonical_product_listings limit 1",
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      query("update canonical_product_listings set retailer_id='tottus' where listing_id=$1", [
        rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: "23503" });
    await persistListings(db, rows[0]!.retailer, [
      { ...observation("matching-duplicate-retailer", 0), retailer: rows[0]!.retailer },
    ]);
    const duplicate = (await catalogRows("matching-duplicate-retailer"))[0]!;
    await expect(
      query(
        `insert into canonical_product_listings(listing_id,canonical_product_id,retailer_id,confidence,matching_version,method,reasons)
      select $1::uuid,canonical_product_id,retailer_id,confidence,matching_version,method,reasons from canonical_product_listings where listing_id=$2`,
        [duplicate.id, rows[0]!.id],
      ),
    ).rejects.toMatchObject({ code: "23505", constraint: "canonical_one_retailer" });
    await expect(
      query("update canonical_product_listings set confidence=1.1 where listing_id=$1", [
        rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await query(
      "update retailer_listings set title='Leche Entera Gloria Caja 946ml' where id=$1 or id=$2",
      rows.map((r) => r.id),
    );

    for (const externalId of ["matching-metro", "matching-plaza-vea"]) {
      await persistCatalogNormalizations(db, await catalogRows(externalId));
    }

    const renamed = await matchingRows(["matching-metro", "matching-plaza-vea"]);
    const renamedPairs = await evaluatePairs(db, [[renamed[0]!, renamed[1]!]]);
    expect(await persistMatching(db, renamed, renamedPairs)).toMatchObject({
      productsCreated: 0,
      productsUpdated: 1,
      linksCreated: 2,
      linksRemoved: 2,
    });
  }, 30_000);
  it("refuses stale snapshots and scopes splitting groups; protects manual decisions and rebuilds obsolete links", async () => {
    const { rows, pairs } = await seedMatch("matching-rebuild");
    await persistMatching(db, rows, pairs);
    const fresh = await matchingRows(["matching-rebuild-metro", "matching-rebuild-plaza-vea"]);
    expect(await persistMatching(db, [fresh[0]!], [])).toMatchObject({
      stale: true,
      linksRemoved: 0,
    });
    await query("update canonical_product_listings set method='manual' where listing_id=$1", [
      fresh[0]!.id,
    ]);
    expect(await persistMatching(db, fresh, [])).toMatchObject({ stale: true, linksRemoved: 0 });
    await query("update canonical_product_listings set method='automatic' where listing_id=$1", [
      fresh[0]!.id,
    ]);
    await query(
      "update retailer_listings set title='Leche Gloria Entera Caja 1500ml' where id=$1",
      [fresh[0]!.id],
    );
    expect(await persistMatching(db, fresh, pairs)).toMatchObject({
      stale: true,
      linksCreated: 0,
      linksRemoved: 0,
    });
    await persistCatalogNormalizations(
      db,
      await catalogRows(
        fresh[0]!.retailer === "metro" ? "matching-rebuild-metro" : "matching-rebuild-plaza-vea",
      ),
    );
    const updated = await matchingRows(["matching-rebuild-metro", "matching-rebuild-plaza-vea"]);
    const rejected = await evaluatePairs(db, [[updated[0]!, updated[1]!]]);
    expect(rejected[0]!.result.decision).toBe("incompatible");
    expect(await persistMatching(db, updated, rejected)).toMatchObject({
      stale: false,
      linksRemoved: 2,
      productsRemoved: 1,
    });
  }, 30_000);
  it("rolls back the whole canonical assignment when an association constraint fails", async () => {
    const { rows, pairs } = await seedMatch("matching-rollback");
    const before = await query("select * from canonical_products order by id");
    await query(
      `alter table canonical_product_listings add constraint test_reject_match check(listing_id<>'${rows[0]!.id}'::uuid)`,
    );

    try {
      await expect(persistMatching(db, rows, pairs)).rejects.toMatchObject({ code: "23514" });
      expect(await query("select * from canonical_products order by id")).toEqual(before);
      expect(
        await query(
          "select * from canonical_product_listings where listing_id=$1 or listing_id=$2",
          rows.map((r) => r.id),
        ),
      ).toEqual([]);
    } finally {
      await query("alter table canonical_product_listings drop constraint test_reject_match");
    }
  }, 30_000);

  it("evaluates every reviewed real pair with PostgreSQL similarity and preserves automatic precision", async () => {
    const evaluated = await evaluateMatching(db);
    const metrics = evaluated.metrics.find((m) => m.split === "all")!;
    expect(metrics.pairs).toBe(66);
    expect(metrics.falsePositives).toBe(0);
    expect(metrics.truePositives).toBeGreaterThanOrEqual(11);
    expect(metrics.autoMatchPrecision).toBe(1);
  }, 30_000);
  it("reports independent-audit precision separately without modifying the frozen matcher", async () => {
    const audit = await evaluateIndependentAudit(db);
    expect(audit.canonicalGroupsReviewed).toBe(28);
    expect(audit.metrics.find((m) => m.stratum === "all")).toMatchObject({
      pairs: 105,
      truePositives: 34,
      falsePositives: 0,
      trueNegatives: 52,
      falseNegatives: 19,
      autoMatchPrecision: 1,
    });
    expect(audit.metrics.find((m) => m.stratum === "new_auto")).toMatchObject({
      pairs: 34,
      truePositives: 34,
      falsePositives: 0,
      autoMatchPrecision: 1,
    });
  }, 30_000);
});
