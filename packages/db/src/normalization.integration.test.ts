import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeLocalTestConnections } from "./testing/test-query-client.ts";
import { persistCatalogNormalizations } from "./catalog.ts";

import { persistListings } from "./ingestion.ts";

import { catalogTestContext, observation } from "./testing/catalog-fixtures.ts";

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)("PostgreSQL normalization (explicit TEST_DATABASE_URL)", () => {
  // Keep deliberate contention inside each case; cases start with independent data.
  const harness = catalogTestContext({
    ...process.env,
    TEST_DATABASE_URL: testUrl ?? "postgresql://unused@localhost/comprafino_test",
  });
  const { db, query, states, catalogRows } = harness;
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
  it("persists derived attributes idempotently and recomputes after metadata changes without touching history", async () => {
    const input = {
      ...observation("catalog", 0),
      title: "Leche Gloria 390g Paquete 6un",
      sourceBrand: "GLORIA",
      sourceUnitMultiplier: 1,
    };
    await persistListings(db, "tottus", [input]);
    const before = await states("catalog");
    let rows = await catalogRows("catalog");
    expect(rows[0]).toMatchObject({ sourceBrand: "GLORIA", sourceUnitMultiplier: 1 });
    expect(await persistCatalogNormalizations(db, rows)).toEqual({
      changed: 1,
      unchanged: 0,
      stale: 0,
    });
    const initial = await query("select * from listing_normalizations where listing_id = $1", [
      rows[0]!.id,
    ]);
    expect(initial).toMatchObject([
      {
        brand: "Gloria",
        brand_source: "source",
        quantity_value: 390,
        package_count: 6,
        total_quantity_value: 2340,
        pricing_basis: "unit",
      },
    ]);
    expect(await persistCatalogNormalizations(db, rows)).toEqual({
      changed: 0,
      unchanged: 1,
      stale: 0,
    });
    expect(
      await query("select * from listing_normalizations where listing_id = $1", [rows[0]!.id]),
    ).toEqual(initial);
    await persistListings(db, "tottus", [
      {
        ...input,
        title: "Leche Gloria 946ml Paquete 3un",
        observedAt: observation("catalog", 1).observedAt,
      },
    ]);
    rows = await catalogRows("catalog");
    expect(await persistCatalogNormalizations(db, rows)).toEqual({
      changed: 1,
      unchanged: 0,
      stale: 0,
    });
    expect(
      await query(
        "select quantity_value, quantity_unit, package_count, total_quantity_value from listing_normalizations where listing_id = $1",
        [rows[0]!.id],
      ),
    ).toEqual([
      { quantity_value: 946, quantity_unit: "ml", package_count: 3, total_quantity_value: 2838 },
    ]);
    expect(await states("catalog")).toEqual(before);
  }, 30_000);
  it("refuses stale reads and serializes repeated normalization writers", async () => {
    const input = { ...observation("catalog-stale", 0), title: "Leche Gloria 390g" };
    await persistListings(db, "tottus", [input]);
    const stale = await catalogRows("catalog-stale");
    await persistListings(db, "tottus", [
      {
        ...input,
        title: "Leche Gloria 946ml",
        observedAt: observation("catalog-stale", 1).observedAt,
      },
    ]);
    expect(await persistCatalogNormalizations(db, stale)).toEqual({
      changed: 0,
      unchanged: 0,
      stale: 1,
    });
    const fresh = await catalogRows("catalog-stale");
    const results = await Promise.all([
      persistCatalogNormalizations(db, fresh),
      persistCatalogNormalizations(db, fresh),
    ]);
    expect(results.reduce((sum, r) => sum + r.changed, 0)).toBe(1);
    expect(
      await query("select quantity_value from listing_normalizations where listing_id = $1", [
        fresh[0]!.id,
      ]),
    ).toEqual([{ quantity_value: 946 }]);
    await query(
      "update listing_normalizations set normalization_version = 2 where listing_id = $1",
      [fresh[0]!.id],
    );
    expect((await persistCatalogNormalizations(db, fresh)).changed).toBe(1);
  }, 30_000);
  it("rolls back a normalization batch when one derived row fails a constraint", async () => {
    for (const externalId of ["catalog-good", "catalog-rejected"]) {
      await persistListings(db, "tottus", [
        {
          ...observation(externalId, 0),
          title: externalId === "catalog-good" ? "Leche Gloria 390g" : "Leche Gloria 946ml",
        },
      ]);
    }

    const rows = [
      ...(await catalogRows("catalog-good")),
      ...(await catalogRows("catalog-rejected")),
    ];
    const history = await query("select * from price_history order by id");
    await query(
      `alter table listing_normalizations add constraint test_reject_catalog check (listing_id <> '${rows[1]!.id}'::uuid)`,
    );

    try {
      await expect(persistCatalogNormalizations(db, rows)).rejects.toMatchObject({
        code: "23514",
        constraint: "test_reject_catalog",
      });
      expect(
        await query(
          "select * from listing_normalizations where listing_id in ($1, $2)",
          rows.map((r) => r.id),
        ),
      ).toEqual([]);
      expect(await query("select * from price_history order by id")).toEqual(history);
    } finally {
      await query("alter table listing_normalizations drop constraint test_reject_catalog");
    }
  }, 30_000);
  it("enforces quantity, count, total, brand and pricing invariants in PostgreSQL", async () => {
    await persistListings(db, "tottus", [
      { ...observation("catalog-constraints", 0), title: "Leche Gloria 390g" },
    ]);
    const rows = await catalogRows("catalog-constraints");
    await persistCatalogNormalizations(db, rows);

    for (const change of [
      "quantity_value = -1",
      "quantity_unit = null",
      "package_count = 0",
      "total_quantity_value = 391",
      "brand_source = null",
      "pricing_basis = 'kg', sold_by_weight = true",
    ]) {
      await expect(
        query(`update listing_normalizations set ${change} where listing_id = $1`, [rows[0]!.id]),
      ).rejects.toMatchObject({ code: "23514" });
    }
  }, 30_000);
});
