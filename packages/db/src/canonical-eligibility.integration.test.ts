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
import { catalogRecordSchema, persistCatalogNormalizations } from "./catalog.ts";
import { searchPublicProducts } from "./generic-offers.ts";
import {
  eligibleProductIdentities,
  eligibleProductIdentitiesWithCurrentPrices,
  eligibleProducts,
  getCanonicalProductComparison,
} from "./public-products.ts";
import { evaluateCurrentShoppingList } from "./shopping-list.ts";
import { ownedTestDatabase } from "./testing/database.ts";
import { closeLocalTestConnections } from "./testing/test-query-client.ts";
import { catalogBenchmarkObserver } from "./testing/catalog-benchmark-observer.ts";
import {
  seedCatalogBenchmark,
  growCatalogBenchmark,
} from "./testing/catalog-benchmark-fixtures.ts";
import { legacyEligibleProducts } from "./testing/legacy-public-eligibility.ts";

const identities = z.array(
  z.object({ id: z.uuid(), displayName: z.string(), retailerCount: z.number().int() }),
);
const scenarios = [
  "valid",
  "manual",
  "obsolete",
  "low",
  "invalidated",
  "single",
  "inactive",
  "zero",
  "closed",
  "unnormalized",
  "kilogram",
  "stale",
  "future",
  "unavailable",
  "threshold",
  "invalid-inactive",
] as const;

describe.skipIf(!process.env.TEST_DATABASE_URL)("canonical eligibility SQL equivalence", () => {
  const harness = ownedTestDatabase();
  const current = catalogBenchmarkObserver(harness);
  const dialect = new PgDialect();
  const minimal = dialect.sqlToQuery(eligibleProductIdentities);
  const sharedPrices = dialect.sqlToQuery(eligibleProductIdentitiesWithCurrentPrices);
  const full = dialect.sqlToQuery(eligibleProducts);
  const legacy = dialect.sqlToQuery(legacyEligibleProducts);
  // Execute the frozen pre-03C query against the same fixture. All four policy
  // parameters keep their positions; no fake DB rows or production test switch.
  const referenceClient = new Proxy(harness.scoped, {
    get(target, property, receiver) {
      if (property !== "query") return Reflect.get(target, property, receiver);
      return (...[text, params, options]: Parameters<typeof target.query>) =>
        target.query(
          text
            .replace(sharedPrices.sql, legacy.sql)
            .replace(minimal.sql, legacy.sql)
            .replace(full.sql, legacy.sql)
            .replaceAll(
              "join current_prices h on h.listing_id=l.id",
              "join price_history h on h.listing_id=l.id and h.valid_until is null",
            )
            .replace(
              "join current_listings c on c.listing_id=a.listing_id",
              "join current_listings c on (c.listing->>'id')::uuid=a.listing_id",
            )
            .replaceAll("retailer_id=$", "listing->>'retailerId'=$")
            .replace("order by listing_id::text limit", "order by listing->>'id' limit")
            .replaceAll(
              'coalesce(p."retailerCount",0)',
              "coalesce(jsonb_array_length(p.offers),0)",
            ),
          params,
          options,
        );
    },
  });
  const reference = catalogBenchmarkObserver({ ...harness, scoped: referenceClient });
  const now = new Date();
  const groups = new Map<(typeof scenarios)[number], string>();
  let invalidatedListing = "";

  beforeAll(async () => {
    await harness.setup();
    await seedCatalogBenchmark(harness, now);
    const { exactIds } = await growCatalogBenchmark(harness, 80, 320);
    for (const [index, scenario] of scenarios.entries()) {
      groups.set(scenario, exactIds[index]!);
    }

    const mutate = (scenario: (typeof scenarios)[number], statement: string) =>
      harness.scoped.query(statement, [groups.get(scenario)]);
    const one =
      "select listing_id from canonical_product_listings where canonical_product_id=$1 order by retailer_id limit 1";
    const three =
      "select listing_id from canonical_product_listings where canonical_product_id=$1 order by retailer_id limit 3";
    await mutate(
      "manual",
      `update canonical_product_listings set method='manual' where listing_id in (${one})`,
    );
    await mutate(
      "obsolete",
      `update canonical_product_listings set matching_version=999 where listing_id in (${one})`,
    );
    await mutate(
      "low",
      `update canonical_product_listings set confidence=0.8999 where listing_id in (${one})`,
    );
    await mutate(
      "threshold",
      "update canonical_product_listings set confidence=0.90 where canonical_product_id=$1",
    );
    await mutate("single", `delete from canonical_product_listings where listing_id in (${three})`);
    await mutate("inactive", `update retailer_listings set active=false where id in (${three})`);
    await mutate(
      "zero",
      `update price_history set current_price_cents=0 where valid_until is null and listing_id in (${three})`,
    );
    await mutate(
      "closed",
      `update price_history set valid_until=valid_from+interval '1 second' where valid_until is null and listing_id in (${three})`,
    );
    await mutate(
      "unnormalized",
      `delete from listing_normalizations where listing_id in (${three})`,
    );
    await mutate(
      "kilogram",
      `update price_history set price_unit='KG' where valid_until is null and listing_id in (${three})`,
    );
    await mutate(
      "stale",
      "update retailer_listings set last_seen_at=last_seen_at-interval '48 hours' where id in (select listing_id from canonical_product_listings where canonical_product_id=$1)",
    );
    await mutate(
      "future",
      "update retailer_listings set last_seen_at=last_seen_at+interval '1 hour' where id in (select listing_id from canonical_product_listings where canonical_product_id=$1)",
    );
    await mutate(
      "unavailable",
      "update retailer_listings set available=false where id in (select listing_id from canonical_product_listings where canonical_product_id=$1)",
    );
    await mutate(
      "invalid-inactive",
      `update canonical_product_listings set confidence=0 where listing_id in (${one})`,
    );
    await mutate(
      "invalid-inactive",
      `update retailer_listings set active=false where id in (${one})`,
    );
    // Correcting a normalization through the real writer revokes exact identity.
    await mutate(
      "invalidated",
      `update listing_normalizations set normalization_version=999 where listing_id in (${one})`,
    );
    const records = z
      .array(catalogRecordSchema)
      .parse(
        await mutate(
          "invalidated",
          `select id,retailer_id as "retailerId",title,price_unit as "priceUnit",package_text as "packageText",source_brand as "sourceBrand",source_unit_multiplier::float8 as "sourceUnitMultiplier" from retailer_listings where id in (${one})`,
        ),
      );
    invalidatedListing = records[0]!.id;
    await persistCatalogNormalizations(harness.db, records);
    // A new link cannot inherit the 35 earlier observation days from its group.
    await harness.scoped.query(
      `update canonical_product_listings set linked_at=$2 where listing_id in (${one})`,
      [groups.get("valid"), now.toISOString()],
    );
  }, 60_000);

  afterAll(async () => {
    try {
      await harness.dispose();
    } finally {
      await closeLocalTestConnections();
    }
  }, 30_000);

  it("retains exactly the legacy public IDs, display names and offer counts", async () => {
    expect(minimal.params).toEqual(legacy.params);
    expect(sharedPrices.params).toEqual(legacy.params);
    expect(full.params).toEqual(legacy.params);
    const [actual] = await harness.db.batch([
      harness.db.execute(sql`${eligibleProductIdentities} select * from products order by id`),
    ]);
    const [previous] = await harness.db.batch([
      harness.db.execute(
        sql`${legacyEligibleProducts} select id,"displayName",jsonb_array_length(offers) as "retailerCount" from products order by id`,
      ),
    ]);
    const rows = identities.parse(actual.rows);
    expect(rows).toEqual(identities.parse(previous.rows));
    const [basketIdentities] = await harness.db.batch([
      harness.db.execute(
        sql`${eligibleProductIdentitiesWithCurrentPrices} select * from products order by id`,
      ),
    ]);
    expect(identities.parse(basketIdentities.rows)).toEqual(rows);
    const admitted = new Set(["valid", "stale", "future", "unavailable", "threshold"]);
    for (const scenario of scenarios) {
      expect({ scenario, admitted: rows.some((row) => row.id === groups.get(scenario)) }).toEqual({
        scenario,
        admitted: admitted.has(scenario),
      });
    }
    expect(
      rows
        .filter((row) => [...groups.values()].includes(row.id))
        .every((row) => row.retailerCount === 4),
    ).toBe(true);
    const revoked = await harness.scoped.query(
      "select confidence::float8 as confidence from canonical_product_listings where listing_id=$1",
      [invalidatedListing],
    );
    expect(revoked).toEqual([{ confidence: 0 }]);
  });

  it.each(["standard", "benefits"] as const)(
    "preserves full product comparisons and temporal/stock decisions in %s mode",
    async (mode) => {
      for (const scenario of scenarios) {
        const id = groups.get(scenario)!;
        const actual = await getCanonicalProductComparison(current.db, id, now, mode);
        expect(actual).toEqual(await getCanonicalProductComparison(reference.db, id, now, mode));
      }
    },
  );

  it.each(["stale", "future", "unavailable"] as const)(
    "retains identity without a current purchase for %s offers",
    async (scenario) => {
      const product = await getCanonicalProductComparison(
        current.db,
        groups.get(scenario)!,
        now,
        "benefits",
      );
      expect(product?.retailerCount).toBe(4);
      expect(product?.currentOfferCount).toBe(0);
      expect(product?.lowestPriceCents).toBeNull();
    },
  );

  it.each(["standard", "benefits"] as const)(
    "preserves search results, sorting, pages and category counts in %s mode",
    async (priceMode) => {
      const requests = [
        ...(["relevance", "unit-price", "total-price"] as const).flatMap((sort) =>
          [1, 2, 10].map((page) => ({
            query: "benchcatalogo",
            page,
            filters: searchFilters({ sort, priceMode }),
          })),
        ),
        ...["", "benchcatalogo"].map((query) => ({
          query,
          page: 1,
          filters: searchFilters({ category: "lacteos-huevos", priceMode }),
        })),
        ...["arroz", "benchselect", "missingzzz"].map((query) => ({
          query,
          page: 1,
          filters: searchFilters({ priceMode }),
        })),
        {
          query: "benchcatalogo",
          page: 1,
          filters: searchFilters({ retailer: "metro", unit: "L", priceMode }),
        },
      ];
      for (const { query, filters, page } of requests) {
        const run = (db: typeof current.db) =>
          searchPublicProducts(db, query, filters.sort, now, filters, page, {
            includeComparisons: false,
          });
        const actual = await current.observe(() => run(current.db), true);
        const previous = await reference.observe(() => run(reference.db), true);
        expect(actual.result).toEqual(previous.result);
        expect(actual.metrics.rows).toBe(previous.metrics.rows);
        expect(actual.metrics.jsonBytes).toBe(previous.metrics.jsonBytes);
      }
    },
    60_000,
  );

  it.each(["standard", "benefits"] as const)(
    "preserves basket choices, costs, eligibility and history in %s mode",
    async (mode) => {
      const item = (canonicalId: string | null, intent: "strict" | "preferred" | "generic") => ({
        id: randomUUID(),
        label: "arroz",
        query: "arroz",
        intent,
        canonicalId,
        quantityMode: intent === "generic" ? "normalized" : "packages",
        quantity: { amount: 1, unit: intent === "generic" ? "kg" : "unit" },
        substitutionProfile:
          intent === "generic" ? inferGenericSubstitutionProfile("arroz", "kg") : undefined,
        frequency: "weekly",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      const list = shoppingListSchema.parse({
        version: 2,
        items: [
          item(null, "generic"),
          ...[...groups.values()].flatMap((id) => [item(id, "strict"), item(id, "preferred")]),
        ],
      });
      const actual = await current.observe(
        () => evaluateCurrentShoppingList(current.db, list, mode, now),
        true,
      );
      const previous = await reference.observe(
        () => evaluateCurrentShoppingList(reference.db, list, mode, now),
        true,
      );
      const { timings: actualTimings, ...actualResult } = actual.result;
      const { timings: previousTimings, ...previousResult } = previous.result;
      expect(actualResult).toEqual(previousResult);
      expect(actualTimings.queryMs).toBeGreaterThan(0);
      expect(previousTimings.queryMs).toBeGreaterThan(0);
      expect(actual.metrics.candidateRows).toBe(previous.metrics.candidateRows);
      expect(actual.metrics.weekdayRows).toBe(previous.metrics.weekdayRows);
      expect(actual.metrics.weekdayRows).toBeGreaterThan(0);
      const readSnapshot = async (statement: { query: string; params: unknown[] }) => {
        const rows = z
          .array(
            z.object({
              snapshot: z.object({
                weekdayRows: z.array(
                  z.object({
                    listingId: z.uuid(),
                    date: z.string(),
                    priceCents: z.number().nullable(),
                  }),
                ),
                currentCount: z.number(),
                products: z.array(z.object({ id: z.uuid(), title: z.string() })),
                listings: z.array(z.unknown()),
              }),
            }),
          )
          .parse(await harness.scoped.query(statement.query, statement.params));
        const snapshot = rows[0]!.snapshot;
        return {
          ...snapshot,
          products: snapshot.products.sort((a, b) => a.id.localeCompare(b.id)),
          weekdayRows: snapshot.weekdayRows.sort(
            (a, b) => a.listingId.localeCompare(b.listingId) || a.date.localeCompare(b.date),
          ),
        };
      };
      expect(await readSnapshot(actual.metrics.statements[0]!)).toEqual(
        await readSnapshot(previous.metrics.statements[0]!),
      );
    },
    60_000,
  );
});
