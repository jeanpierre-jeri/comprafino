import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  inferGenericSubstitutionProfile,
  searchFilters,
  shoppingListSchema,
} from "@comprafino/core";
import {
  genericOfferProjection,
  genericFamilyCandidatePredicate,
  genericProductOffer,
  searchPublicProducts,
} from "./generic-offers.ts";
import { evaluateCurrentShoppingList } from "./shopping-list.ts";
import { shoppingSnapshotRows } from "./shopping-snapshot-transport.ts";
import { evaluateCurrentShoppingList as previousShopping } from "./testing/transfer/legacy-shopping-list.ts";
import { ownedTestDatabase } from "./testing/database.ts";
import { closeLocalTestConnections } from "./testing/test-query-client.ts";
import { catalogBenchmarkObserver } from "./testing/catalog-benchmark-observer.ts";
import {
  seedCatalogBenchmark,
  growCatalogBenchmark,
} from "./testing/catalog-benchmark-fixtures.ts";

const searchHelpers = [
  "title_text",
  "identity_text",
  "search_identity",
  "search_vector",
  "folded_title",
];
const helpers = [...searchHelpers, "listing_id", "retailer_id"];
const rawRows = z.array(z.record(z.string(), z.unknown()));

function withoutSqlHelpers(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !helpers.includes(key)));
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("offer transport projection equivalence", () => {
  const harness = ownedTestDatabase();
  const current = catalogBenchmarkObserver(harness);
  const projection = new PgDialect().sqlToQuery(genericOfferProjection).sql;
  // Recreate the former SELECT * only at the two transport boundaries. Both
  // clients execute real SQL in the same owned fixture. Search uses its original
  // object envelope; the frozen shopping reader preserves the object reference.
  // Only shopping snapshot tuples need reconstruction for raw comparisons.
  const referenceClient = new Proxy(harness.scoped, {
    get(target, property, receiver) {
      if (property !== "query") return Reflect.get(target, property, receiver);

      return (...[text, params, options]: Parameters<typeof target.query>) =>
        target.query(
          text
            .replace(
              `select ${projection}, "matchesCategory" from generic where`,
              "select * from generic where",
            )
            .replace(`select ${projection} from generic where`, "select * from generic where")
            .replace(
              `select ${projection} from current_listings where`,
              "select * from current_listings where",
            ),
          params,
          options,
        );
    },
  });
  const reference = catalogBenchmarkObserver({ ...harness, scoped: referenceClient });
  const now = new Date();
  let exactIds: string[] = [];
  let invalidCanonicalId: string;
  let invalidListingId: string;
  let unavailableIds: string[] = [];

  beforeAll(async () => {
    await harness.setup();
    await seedCatalogBenchmark(harness, now);
    exactIds = (await growCatalogBenchmark(harness, 80, 320)).exactIds;
    invalidCanonicalId = exactIds[0]!;
    await harness.scoped.query(
      "update canonical_product_listings set confidence=0.1 where canonical_product_id=$1",
      [invalidCanonicalId],
    );
    const invalid = z
      .array(z.object({ id: z.uuid() }))
      .parse(
        await harness.scoped.query(
          "update retailer_listings set title='Fideos identity changed 250g' where external_id='scale-template-13' and retailer_id='tottus' returning id",
        ),
      );
    invalidListingId = invalid[0]!.id;
    unavailableIds = z
      .array(z.object({ id: z.uuid() }))
      .parse(await harness.scoped.query("select id from retailer_listings where available=false"))
      .map((row) => row.id);
  }, 60_000);

  afterAll(async () => {
    try {
      await harness.dispose();
    } finally {
      await closeLocalTestConnections();
    }
  }, 30_000);

  it("preserves retailer-scoped category evidence and title-only family candidates", async () => {
    // The same category string belongs to different families across stores.
    // Missing category evidence must still allow a title match, not every row.
    const [result] = await harness.db.batch([
      harness.db.execute(sql`with candidates(id,retailer_id,"sourceCategory",folded_title) as (
        values (1,'plaza-vea','439','neutro'), (2,'makro','439','neutro'),
          (3,'tottus','J0101010203','neutro'), (4,'metro','J0101010203','neutro'),
          (5,'makro',null,'arrozextra'), (6,'makro',null,'neutro'),
          (7,'plaza-vea','839','neutro'), (8,'metro',null,'huevosblancos')
      ), offers as (
        select *,jsonb_build_object('retailerId',retailer_id) as listing from candidates
      ) select id,
        (${genericFamilyCandidatePredicate("rice", sql`retailer_id`)}) is true as rice,
        (${genericFamilyCandidatePredicate("rice")}) is true as "previousRice",
        (${genericFamilyCandidatePredicate("eggs", sql`retailer_id`)}) is true as eggs,
        (${genericFamilyCandidatePredicate("eggs")}) is true as "previousEggs"
        from offers order by id`),
    ]);
    const rows = z
      .array(
        z.object({
          id: z.number(),
          rice: z.boolean(),
          previousRice: z.boolean(),
          eggs: z.boolean(),
          previousEggs: z.boolean(),
        }),
      )
      .parse(result.rows);
    expect(rows.filter((row) => row.rice).map((row) => row.id)).toEqual([1, 3, 5]);
    expect(rows.filter((row) => row.eggs).map((row) => row.id)).toEqual([7, 8]);
    expect(
      rows.every((row) => row.rice === row.previousRice && row.eggs === row.previousEggs),
    ).toBe(true);
  });

  it.each(["standard", "benefits"] as const)(
    "preserves complete search results in %s mode",
    async (priceMode) => {
      const scenarios = [
        ...(["relevance", "unit-price", "total-price"] as const).flatMap((sort) =>
          [1, 2, 10].map((page) => ({
            query: "benchcatalogo",
            filters: searchFilters({ sort, priceMode }),
            page,
          })),
        ),
        { query: "", filters: searchFilters({ category: "lacteos-huevos", priceMode }), page: 1 },
        {
          query: "benchcatalogo",
          filters: searchFilters({ category: "lacteos-huevos", priceMode }),
          page: 1,
        },
        { query: "arroz", filters: searchFilters({ priceMode }), page: 1 },
        { query: "benchselect", filters: searchFilters({ priceMode }), page: 1 },
        { query: "missingzzz", filters: searchFilters({ priceMode }), page: 1 },
        {
          query: "benchcatalogo",
          filters: searchFilters({ retailer: "metro", unit: "L", priceMode }),
          page: 1,
        },
      ];

      for (const { query, filters, page } of scenarios) {
        const run = (db: typeof current.db) =>
          searchPublicProducts(db, query, filters.sort, now, filters, page, {
            includeComparisons: false,
          });
        const actual = await current.observe(() => run(current.db), true);
        const previous = await reference.observe(() => run(reference.db), true);
        expect(actual.result).toEqual(previous.result);
        expect(actual.metrics.rows).toBe(previous.metrics.rows);
        expect(actual.metrics.statements).toHaveLength(previous.metrics.statements.length);
        expect(
          previous.metrics.statements.every((statement) =>
            statement.query.includes("select * from generic where"),
          ),
        ).toBe(true);

        expect(actual.metrics.jsonBytes < previous.metrics.jsonBytes).toBe(actual.metrics.rows > 0);
      }

      const actual = await searchPublicProducts(
        current.db,
        "benchcatalogo",
        "relevance",
        now,
        searchFilters({ priceMode }),
      );
      const previous = await searchPublicProducts(
        reference.db,
        "benchcatalogo",
        "relevance",
        now,
        searchFilters({ priceMode }),
      );
      expect(actual).toEqual(previous);
      expect(actual.products.length).toBeGreaterThan(0);
      expect(actual.refreshListingIds).not.toContain(invalidListingId);
      expect(actual.refreshListingIds.some((id) => unavailableIds.includes(id))).toBe(false);
      expect(actual.availableUnits).toEqual(expect.arrayContaining(["kg", "L", "unit"]));
    },
    60_000,
  );

  it("removes only SQL helpers from raw rows, preserving unknown quantities, KG/UN, benefits and nullable identity", async () => {
    const run = (db: typeof current.db) =>
      searchPublicProducts(db, "benchcatalogo", "relevance", now, searchFilters(), 1, {
        includeComparisons: false,
      });
    const actual = await current.observe(() => run(current.db), true);
    const previous = await reference.observe(() => run(reference.db), true);
    const statement = actual.metrics.statements[0]!;
    const previousStatement = previous.metrics.statements[0]!;
    expect(statement.params).toEqual(previousStatement.params);
    const rows = rawRows.parse(await harness.scoped.query(statement.query, statement.params));
    const fullRows = rawRows.parse(
      await harness.scoped.query(previousStatement.query, previousStatement.params),
    );
    expect(rows).toEqual(fullRows.map(withoutSqlHelpers));
    expect(rows.length).toBeGreaterThan(300);
    expect(fullRows.every((row) => searchHelpers.every((key) => key in row))).toBe(true);
    expect(rows.every((row) => helpers.every((key) => !(key in row)))).toBe(true);
    expect(rows.some((row) => row.available === null)).toBe(true);
    expect(rows.some((row) => row.available === true)).toBe(true);
    expect(rows.some((row) => row.available === false)).toBe(false);
    expect(rows.some((row) => row.canonicalId === null)).toBe(true);
    expect(
      rows.some((row) => z.object({ priceUnit: z.string() }).parse(row.listing).priceUnit === "KG"),
    ).toBe(true);
    expect(rows.some((row) => z.array(z.unknown()).parse(row.conditionalOffers).length > 0)).toBe(
      true,
    );
    const offers = rows
      .map((row) => genericProductOffer(row, now))
      .filter((offer) => offer !== null);
    expect(offers.some((offer) => offer.unitPrice === null)).toBe(true);
    expect(offers.every((offer) => offer.currentPriceCents > 0)).toBe(true);
  });

  it.each(["standard", "benefits"] as const)(
    "preserves basket assignments, history, costs and invalid-identity rejection in %s mode",
    async (mode) => {
      const item = (
        intent: "generic" | "strict" | "preferred",
        canonicalId: string | null,
        query: string,
      ) => ({
        id: randomUUID(),
        label: query,
        query,
        intent,
        canonicalId,
        quantityMode: intent === "generic" ? "normalized" : "packages",
        quantity: { amount: 1, unit: intent === "generic" ? "kg" : "unit" },
        substitutionProfile:
          intent === "generic" ? inferGenericSubstitutionProfile(query, "kg") : undefined,
        frequency: "weekly",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      const list = shoppingListSchema.parse({
        version: 2,
        items: [
          item("generic", null, "arroz"),
          item("strict", exactIds[1]!, "Producto exacto"),
          item("preferred", exactIds[2]!, "Producto preferido"),
          item("strict", invalidCanonicalId, "Identidad inválida"),
          item("preferred", invalidCanonicalId, "Preferencia inválida"),
        ],
      });
      const actual = await current.observe(
        () => evaluateCurrentShoppingList(current.db, list, mode, now),
        true,
      );
      const previous = await reference.observe(
        () => previousShopping(reference.db, list, mode, now),
        true,
      );
      const { timings: actualTimings, ...actualResult } = actual.result;
      const { timings: previousTimings, ...previousResult } = previous.result;
      expect(actualResult).toEqual(previousResult);
      expect(actual.result.evaluations[0]!.best).not.toBeNull();
      expect(actualTimings.queryMs).toBeGreaterThan(0);
      expect(previousTimings.queryMs).toBeGreaterThan(0);
      expect(
        actual.result.evaluations.slice(-2).every((evaluation) => evaluation.best === null),
      ).toBe(true);
      expect(actual.metrics.candidateRows).toBe(previous.metrics.candidateRows);
      expect(actual.metrics.weekdayRows).toBe(previous.metrics.weekdayRows);
      expect(actual.metrics.weekdayRows).toBeGreaterThan(0);
      expect(actual.metrics.jsonBytes).toBeLessThan(previous.metrics.jsonBytes);
      const statement = actual.metrics.statements[0]!;
      const previousStatement = previous.metrics.statements[0]!;
      expect(previousStatement.query).toContain("select * from current_listings where");
      expect(statement.params).toEqual(previousStatement.params);
      const snapshots = z.array(
        z.object({ snapshot: z.object({ listings: rawRows }).passthrough() }),
      );
      const compactSnapshots = z.array(
        z.object({
          snapshot: z
            .object({
              listings: z.array(z.unknown()),
              historyRows: z.unknown(),
              weekdayRows: z.unknown(),
            })
            .passthrough(),
        }),
      );
      const rows = compactSnapshots
        .parse(await harness.scoped.query(statement.query, statement.params))
        .map(({ snapshot }) => ({
          snapshot: {
            ...snapshot,
            listings: shoppingSnapshotRows("offer", snapshot.listings),
            historyRows: shoppingSnapshotRows("history", snapshot.historyRows),
            weekdayRows: shoppingSnapshotRows("weekday", snapshot.weekdayRows),
          },
        }));
      const fullRows = snapshots.parse(
        await harness.scoped.query(previousStatement.query, previousStatement.params),
      );
      for (const { snapshot } of fullRows) {
        for (const row of snapshot.listings) {
          expect(row.listing_id).toBe(z.object({ id: z.uuid() }).parse(row.listing).id);
          expect(row.retailer_id).toBe(
            z.object({ retailerId: z.string() }).parse(row.listing).retailerId,
          );
        }
      }
      expect(rows).toEqual(
        fullRows.map(({ snapshot }) => ({
          snapshot: { ...snapshot, listings: snapshot.listings.map(withoutSqlHelpers) },
        })),
      );
    },
    60_000,
  );
});
