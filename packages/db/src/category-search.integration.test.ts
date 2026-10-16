import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { searchFilters } from "@comprafino/core";
import { searchPublicProducts } from "./generic-offers.ts";
import { legacyCategorySearch } from "./testing/legacy-category-search.ts";
import { ownedTestDatabase } from "./testing/database.ts";
import { catalogBenchmarkObserver } from "./testing/catalog-benchmark-observer.ts";
import {
  seedCatalogBenchmark,
  growCatalogBenchmark,
} from "./testing/catalog-benchmark-fixtures.ts";
import { closeLocalTestConnections } from "./testing/test-query-client.ts";

describe.skipIf(!process.env.TEST_DATABASE_URL)("category/global search equivalence", () => {
  const harness = ownedTestDatabase();
  const observer = catalogBenchmarkObserver(harness);
  const now = new Date();
  let multipleMembershipId: string;
  let missingMembershipId: string;
  let invalidFingerprintId: string;

  beforeAll(async () => {
    await harness.setup();
    await seedCatalogBenchmark(harness, now);
    await growCatalogBenchmark(harness, 80, 2000);
    const ids = z
      .array(z.object({ id: z.uuid(), external_id: z.string() }))
      .parse(
        await harness.scoped.query(
          "select id,external_id from retailer_listings where retailer_id='tottus' and external_id in ('scale-template-0','scale-template-6','scale-template-13')",
        ),
      );
    multipleMembershipId = ids.find((row) => row.external_id === "scale-template-0")!.id;
    missingMembershipId = ids.find((row) => row.external_id === "scale-template-6")!.id;
    invalidFingerprintId = ids.find((row) => row.external_id === "scale-template-13")!.id;
    // One rice listing belongs to three acquired paths, including two dairy
    // paths. EXISTS must retain it once without inferring membership from title.
    await harness.scoped.query(
      `insert into catalog_source_listings(source_id,listing_id)
       select id,$1::uuid from catalog_sources where retailer_id='tottus'
       and name in ('Lácteos y Huevos / Huevos','Lácteos y Huevos / Leches')`,
      [multipleMembershipId],
    );
    await harness.scoped.query("delete from catalog_source_listings where listing_id=$1", [
      missingMembershipId,
    ]);
    await harness.scoped.query(
      "update retailer_listings set title='Fideos changed identity 250g' where id=$1",
      [invalidFingerprintId],
    );
    await harness.scoped.query(
      "update catalog_sources set active=false where retailer_id='metro' and name='Lácteos y Huevos / Huevos'",
    );
    await harness.scoped.query(
      "update canonical_product_listings set confidence=0.1 where listing_id=$1",
      [multipleMembershipId],
    );
    await harness.scoped.query(
      "update retailer_listings set last_seen_at=last_seen_at-interval '40 hours',first_seen_at=first_seen_at-interval '40 hours' where retailer_id='makro' and external_id='scale-template-7'",
    );
  }, 60_000);

  afterAll(async () => {
    try {
      await harness.dispose();
    } finally {
      await closeLocalTestConnections();
    }
  }, 30_000);

  it.each(["standard", "benefits"] as const)(
    "preserves complete category and global responses with one offer query in %s mode",
    async (priceMode) => {
      for (const sort of ["relevance", "unit-price", "total-price"] as const) {
        for (const page of [1, 2, 10]) {
          for (const extra of [
            {},
            { retailer: "tottus" },
            { unit: "L" },
            { retailer: "metro", unit: "unit" },
          ]) {
            const filters = searchFilters({
              category: "lacteos-huevos",
              sort,
              priceMode,
              ...extra,
            });
            const run = (read: typeof searchPublicProducts) =>
              read(observer.db, "benchcatalogo", sort, now, filters, page, {
                includeComparisons: false,
              });
            const previous = await observer.observe(() => run(legacyCategorySearch), true);
            const actual = await observer.observe(() => run(searchPublicProducts), true);
            expect(actual.result).toEqual(previous.result);
            expect(previous.metrics.statements).toHaveLength(2);
            expect(actual.metrics.statements).toHaveLength(1);
            expect(actual.metrics.rows).toBeLessThan(previous.metrics.rows);
            expect(actual.metrics.jsonBytes).toBeLessThan(previous.metrics.jsonBytes);
          }
        }
      }
    },
    120_000,
  );

  it("preserves family ordering, empty categories, discovery, membership and the optional comparison path", async () => {
    for (const includeComparisons of [false, true]) {
      const resultsByQuery = new Map<string, Awaited<ReturnType<typeof searchPublicProducts>>>();
      for (const query of [
        "arroz",
        "huevos",
        "leche",
        "benchselect",
        "inexistente",
        "946",
        "benchcatalogo",
      ]) {
        const filters = searchFilters({ category: "lacteos-huevos", priceMode: "benefits" });
        const actual = await searchPublicProducts(
          observer.db,
          query,
          "relevance",
          now,
          filters,
          1,
          { includeComparisons },
        );
        const previous = await legacyCategorySearch(
          observer.db,
          query,
          "relevance",
          now,
          filters,
          1,
          { includeComparisons },
        );
        expect(actual).toEqual(previous);
        resultsByQuery.set(query, actual);
      }
      const emptyCategory = resultsByQuery.get("benchselect")!;
      expect(emptyCategory.offers).toEqual([]);
      expect(emptyCategory.usefulResultCount).toBeGreaterThan(0);
      expect(emptyCategory.discoveryRetailers).toEqual([]);

      const rice = resultsByQuery.get("arroz")!;
      expect(rice.refreshListingIds).toEqual([multipleMembershipId]);
      expect(rice.offers[0]?.canonicalId).toBeNull();

      const all = resultsByQuery.get("benchcatalogo")!;
      expect(all.refreshListingIds.filter((id) => id === multipleMembershipId)).toHaveLength(1);
      expect(all.refreshListingIds).not.toContain(missingMembershipId);
      expect(all.refreshListingIds).not.toContain(invalidFingerprintId);
    }
  }, 60_000);

  it("keeps category browsing and searches without category on their single-read path", async () => {
    for (const [query, category] of [
      ["", "lacteos-huevos"],
      ["a", "lacteos-huevos"],
      ["!!!", "lacteos-huevos"],
      ["benchcatalogo", null],
    ] as const) {
      const filters = searchFilters({ category });
      const run = (read: typeof searchPublicProducts) =>
        read(observer.db, query, "relevance", now, filters, 1, { includeComparisons: false });
      const actual = await observer.observe(() => run(searchPublicProducts), true);
      const previous = await observer.observe(() => run(legacyCategorySearch), true);
      expect(actual.result).toEqual(previous.result);
      expect(actual.metrics.statements).toEqual(previous.metrics.statements);
    }
  });

  it("rejects invalid membership and global overflow even when the category has no results", async () => {
    const queryWith = (transform: (query: string) => string) => {
      const client = new Proxy(harness.scoped, {
        get(target, property, receiver) {
          if (property !== "query") return Reflect.get(target, property, receiver);
          return (...[text, params, options]: Parameters<typeof target.query>) =>
            target.query(transform(text), params, options);
        },
      });
      const observed = catalogBenchmarkObserver({ ...harness, scoped: client });
      return searchPublicProducts(
        observed.db,
        "benchselect",
        "relevance",
        now,
        searchFilters({ category: "lacteos-huevos" }),
        1,
        { includeComparisons: false },
      );
    };
    await expect(
      queryWith((query) =>
        query.replace(
          ', "matchesCategory" from generic where',
          ', null as "matchesCategory" from generic where',
        ),
      ),
    ).rejects.toThrow(/matchesCategory/u);
    // Exercise the transport overflow boundary with real SQL rows from the owned
    // fixture, without creating or truncating an application-sized catalogue.
    await expect(
      queryWith(
        (query) =>
          `select candidates.* from (${query}) candidates cross join generate_series(1,1000) overflow_rows limit 50001`,
      ),
    ).rejects.toThrow("Generic search candidate bound exceeded");
  }, 60_000);
});
