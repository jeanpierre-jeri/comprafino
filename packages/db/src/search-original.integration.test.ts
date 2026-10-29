import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { z } from "zod";
import { searchFilters } from "@comprafino/core";
import * as current from "./generic-offers.ts";
import * as previous from "./testing/search-transfer/legacy-generic-offers.ts";
import { transferFixture, transferId, transferNow } from "./testing/transfer/fixture.ts";
import { transferObserver } from "./testing/transfer/observer.ts";
import { groupedCase, searchTransferCases } from "./testing/search-transfer/workloads.ts";
import type { SearchTransferCase } from "./testing/search-transfer/workloads.ts";
import { closeLocalTestConnections, validateLocalTestUrl } from "./testing/test-query-client.ts";

it("requires explicit local configuration even when an application URL exists", () => {
  expect(() => transferFixture({ DATABASE_URL: "postgresql://unused@localhost/app" })).toThrow(
    /explicit local/u,
  );
  expect(() =>
    transferFixture({
      TEST_DATABASE_URL: "postgresql://unused@remote.invalid/comprafino_test",
      COMPRAFINO_TEST_DATABASE_MODE: "local",
    }),
  ).toThrow(/loopback/u);
});

describe.skipIf(
  !process.env.TEST_DATABASE_URL || process.env.COMPRAFINO_TEST_DATABASE_MODE !== "local",
)("original search regression in local PostgreSQL without migrations", () => {
  const fixture = transferFixture({
    TEST_DATABASE_URL:
      process.env.TEST_DATABASE_URL ?? "postgresql://unused@localhost/comprafino_test",
    COMPRAFINO_TEST_DATABASE_MODE: "local",
  });
  beforeAll(async () => {
    await fixture.setup();
    // Extra comparison metadata belongs only to this owned test schema. The
    // shared transfer fixture and its measured table digests remain untouched.
    await fixture.scoped.query(`alter table canonical_products
      add column brand_key text not null default 'Benchcatalogo',
      add column quantity_value integer not null default 1000,
      add column quantity_unit text not null default 'g',
      add column package_count integer not null default 1`);
  }, 30_000);
  beforeEach(() => fixture.seed(320), 30_000);
  afterAll(async () => {
    try {
      await fixture.dispose();
    } finally {
      await closeLocalTestConnections();
    }
  }, 30_000);

  async function read(test: SearchTransferCase, legacy: boolean) {
    const batches: unknown[][] = [];
    const observer = transferObserver(fixture.scoped, (rows) => batches.push(rows));
    try {
      return {
        outcome: { result: await test.run(observer.db, legacy) },
        batches,
        metrics: observer.metrics,
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          outcome: { error: { name: error.name, issues: error.issues } },
          batches,
          metrics: observer.metrics,
        };
      }
      if (!(error instanceof Error)) {
        throw error;
      }
      return {
        outcome: { error: { name: error.name, message: error.message } },
        batches,
        metrics: observer.metrics,
      };
    }
  }

  async function compare(test = groupedCase("wide", "benchcatalogo")) {
    const before = await read(test, true);
    const after = await read(test, false);
    expect(after.outcome).toEqual(before.outcome);
    expect(after.batches).toEqual(before.batches);
    for (const key of ["calls", "statements", "rows", "candidates"] as const) {
      expect(after.metrics[key]).toBe(before.metrics[key]);
    }
    expect(after.metrics.logicalJsonBytes).toBe(before.metrics.logicalJsonBytes);
    return { before, after };
  }

  it("compares complete responses and each original object candidate in order across all workloads", async () => {
    const digest = await fixture.digest();
    for (const test of searchTransferCases()) {
      const { after } = await compare(test);
      expect(after.outcome).toHaveProperty("result");
      expect(after.metrics.calls).toBe(1);
      expect(after.metrics.statements).toBe(1);
    }
    expect(await fixture.digest()).toEqual(digest);
  }, 30_000);

  it("retains all sorts, units, retailers, price modes and paginated results", async () => {
    for (const sort of ["relevance", "total-price", "unit-price"] as const) {
      for (const unit of ["kg", "L", "unit", "roll"] as const) {
        for (const priceMode of ["standard", "benefits"] as const) {
          expect(
            (await compare(groupedCase("filters", "benchcatalogo", { sort, unit, priceMode }, 2)))
              .after.outcome,
          ).toHaveProperty("result");
        }
      }
    }
    for (const retailer of ["tottus", "plaza-vea", "metro", "makro"] as const) {
      await compare(groupedCase("retailer", "benchcatalogo", { retailer }));
    }
  }, 30_000);

  it("preserves numeric, prefix, accented, punctuation and family interpretation", async () => {
    for (const query of [
      "arroz 1",
      "benchcat",
      "champu",
      "champú",
      "papel higienico",
      "leche descremada",
      "aceite",
      "benchcatalogo' OR 1=1 --",
      "benchcatalogo 946",
    ]) {
      expect((await compare(groupedCase("text", query))).after.outcome).toHaveProperty("result");
    }
  });

  it("preserves invalid page and UUID errors and query-free short searches", async () => {
    for (const page of [0, -1, 1.5, 2501, NaN, Infinity]) {
      const { after } = await compare(groupedCase("invalid-page", "benchcatalogo", {}, page));
      expect(after.outcome).toHaveProperty("error.message", "Invalid search page");
      expect(after.metrics.calls).toBe(0);
    }
    for (const query of ["", " ", "a"]) {
      expect((await compare(groupedCase("short", query))).after.metrics.calls).toBe(0);
    }
    const invalidId: SearchTransferCase = {
      id: "invalid-id",
      run: (db, legacy) =>
        (legacy ? previous : current).getCanonicalCurrentProductOffers(db, "invalid", transferNow),
    };
    expect((await compare(invalidId)).after.metrics.calls).toBe(0);
  });

  it("retains category membership, global discovery and independent identical titles", async () => {
    await fixture.scoped.query("update catalog_sources set active=false where id=5");
    await fixture.scoped.query("delete from catalog_source_listings where listing_id=$1", [
      transferId(1, 25),
    ]);
    await fixture.scoped.query("delete from canonical_product_listings where listing_id=$1", [
      transferId(1, 26),
    ]);
    for (const category of ["lacteos-huevos", "abarrotes", "limpieza"] as const) {
      expect(
        (await compare(groupedCase("category", "benchcatalogo", { category }))).after.outcome,
      ).toHaveProperty("result");
      expect(
        (await compare(groupedCase("only-category", "", { category }))).after.outcome,
      ).toHaveProperty("result");
    }
  });

  it("keeps freshness, stock, normalization, currency, quote and URL safeguards", async () => {
    await fixture.scoped.query(
      `update retailer_listings set
        available=case when right(id::text,12)::int=1 then false else available end,
        active=right(id::text,12)::int<>2,
        last_seen_at=case right(id::text,12)::int when 3 then $1::timestamptz+interval '1 millisecond'
          when 4 then $1::timestamptz-interval '36 hours 1 millisecond'
          when 5 then $1::timestamptz-interval '36 hours' else last_seen_at end,
        url=case when right(id::text,12)::int=6 then 'https://untrusted.invalid/p' else url end,
        image_url=case when right(id::text,12)::int=7 then 'https://untrusted.invalid/image' else image_url end`,
      [transferNow.toISOString()],
    );
    await fixture.scoped.query(
      "update price_history set current_price_cents=0 where listing_id=$1 and valid_until is null",
      [transferId(1, 8)],
    );
    await fixture.scoped.query(
      "update listing_normalizations set input_fingerprint='stale' where listing_id=$1",
      [transferId(1, 9)],
    );
    await fixture.scoped.query(
      "update listing_normalizations set normalization_version=99 where listing_id=$1",
      [transferId(1, 10)],
    );
    await fixture.scoped.query("update price_history set currency='USD' where listing_id=$1", [
      transferId(1, 11),
    ]);
    await fixture.scoped.query("update price_history set price_unit='KG' where listing_id=$1", [
      transferId(1, 12),
    ]);
    for (const priceMode of ["standard", "benefits"] as const) {
      expect(
        (await compare(groupedCase("eligibility", "benchcatalogo", { priceMode }))).after.outcome,
      ).toHaveProperty("result");
    }
  });

  it("preserves withheld identity from manual, outdated and low-confidence links", async () => {
    await fixture.scoped.query(
      `update canonical_product_listings set
        method=case when listing_id=$1 then 'manual' else method end,
        confidence=case when listing_id=$2 then 0 else confidence end,
        matching_version=case when listing_id=$3 then 99 else matching_version end`,
      [transferId(1, 1), transferId(1, 5), transferId(1, 9)],
    );
    expect((await compare()).after.outcome).toHaveProperty("result");
    const test = searchTransferCases().find((entry) => entry.id === "canonical-benefits");
    expect(test).toBeDefined();
    await compare(test);
  });

  it("preserves benefit dates, ordinary quotes and condition order", async () => {
    await fixture.scoped.query(
      `update retailer_listing_offers set
        starts_at=case when listing_id=$1 then $3::timestamptz+interval '1 millisecond' else null end,
        ends_at=case when listing_id=$2 then $3::timestamptz-interval '1 millisecond' else null end`,
      [transferId(1, 1), transferId(1, 9), transferNow.toISOString()],
    );
    for (const priceMode of ["standard", "benefits"] as const) {
      expect(
        (
          await compare(
            groupedCase("benefit-validity", "benchcatalogo", { priceMode, sort: "unit-price" }),
          )
        ).after.outcome,
      ).toHaveProperty("result");
    }
  });

  it.each([
    "update retailers set name='' where id='tottus'",
    "update retailer_listings set title=' ' where retailer_id='tottus'",
    "update retailer_listings set source_unit_multiplier=0 where retailer_id='tottus'",
    "update retailer_listings set source_unit_multiplier='NaN' where retailer_id='tottus'",
    "update retailer_listings set source_unit_multiplier='Infinity' where retailer_id='tottus'",
    "update price_history set regular_price_cents=-1 where valid_until is null",
    "update retailer_listing_offers set condition_type='invalid'",
  ])("preserves original validation issues for invalid SQL data: %s", async (statement) => {
    await fixture.scoped.query(statement);
    expect((await compare()).after.outcome).toHaveProperty("error.name", "ZodError");
    // Global candidates outside a selected category still reach the original validator.
    expect(
      (
        await compare(
          groupedCase("invalid-global", "benchcatalogo", { category: "lacteos-huevos" }),
        )
      ).after.outcome,
    ).toHaveProperty("error.name", "ZodError");
  });

  it("preserves the older public search response including canonical comparisons", async () => {
    for (const filters of [
      searchFilters(),
      searchFilters({ category: "lacteos-huevos", priceMode: "benefits" }),
    ]) {
      const test: SearchTransferCase = {
        id: "legacy-public-api",
        run: (db, legacy) =>
          (legacy ? previous : current).searchPublicProducts(
            db,
            "benchcatalogo",
            filters.sort,
            transferNow,
            filters,
          ),
      };
      const before = await read(test, true);
      const after = await read(test, false);
      expect(after.outcome).toEqual(before.outcome);
      expect(after.outcome).toHaveProperty("result");
      expect(after.metrics.calls).toBe(before.metrics.calls);
    }
  });

  it("isolates concurrent requests with different scopes, pages and price modes", async () => {
    const tests = searchTransferCases().filter((test) =>
      ["wide", "page-2", "category-text", "filtered-benefits"].includes(test.id),
    );
    const before = await Promise.all(tests.map((test) => read(test, true)));
    const after = await Promise.all(tests.map((test) => read(test, false)));
    expect(after.map((entry) => entry.outcome)).toEqual(before.map((entry) => entry.outcome));
    for (let index = 0; index < tests.length; index++) {
      expect(after[index]!.outcome).toHaveProperty("result");
      expect(after[index]!.batches).toEqual(before[index]!.batches);
      expect(after[index]!.metrics.calls).toBe(1);
    }
  });

  it("reads a consistent snapshot across an atomic concurrent price/benefit update", async () => {
    const writer = new Client({
      connectionString: validateLocalTestUrl(process.env.TEST_DATABASE_URL!),
    });
    await writer.connect();
    const test = searchTransferCases().find((entry) => entry.id === "canonical-benefits")!;
    try {
      const initial = await compare(test);
      expect(initial.after.outcome).toHaveProperty("result");
      await writer.query("begin");
      await writer.query("select set_config('search_path',$1,true)", [fixture.schema]);
      await writer.query(
        "update price_history set current_price_cents=2000 where listing_id=$1 and valid_until is null",
        [transferId(1, 1)],
      );
      await writer.query(
        "update retailer_listing_offers set price_cents=1500 where listing_id=$1",
        [transferId(1, 1)],
      );
      expect((await compare(test)).after.outcome).toEqual(initial.after.outcome);
      await writer.query("commit");
      const committed = await compare(test);
      expect(committed.after.outcome).not.toEqual(initial.after.outcome);
    } finally {
      try {
        await writer.query("rollback");
      } finally {
        await writer.end();
      }
    }
  });

  // Two full catalog seeds and six full-scope reads share this test's budget.
  // Allow for measured CI overhead while retaining every row and comparison.
  it("retains all 50,000 candidates and the overflow error before invalid-data validation", async () => {
    await fixture.seed(50_000);
    const first = await compare();
    expect(first.after.metrics.candidates).toBe(50_000);
    expect(first.after.outcome).toHaveProperty("result");
    const second = await compare(groupedCase("page-2", "benchcatalogo", {}, 2));
    expect(second.after.metrics.candidates).toBe(50_000);
    expect(second.after.metrics.logicalJsonBytes).toBe(first.after.metrics.logicalJsonBytes);
    await fixture.seed(50_001);
    await fixture.scoped.query("update retailers set name='' where id='tottus'");
    const overflow = await compare();
    expect(overflow.after.metrics.candidates).toBe(50_001);
    expect(overflow.after.outcome).toHaveProperty(
      "error.message",
      "Generic search candidate bound exceeded",
    );
  }, 180_000);
});
