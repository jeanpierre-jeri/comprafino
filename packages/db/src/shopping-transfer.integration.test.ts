import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { searchFilters, shoppingListEvaluationSchema } from "@comprafino/core";
import type { PriceMode, ShoppingList } from "@comprafino/core";
import { searchGroupedPublicProducts } from "./generic-offers.ts";
import { evaluateCurrentShoppingList } from "./shopping-list.ts";
import { shoppingSnapshotRow, shoppingSnapshotRows } from "./shopping-snapshot-transport.ts";
import { shoppingHistoryRows } from "./shopping-price-history.ts";
import { shoppingWeekdayRows } from "./weekday-recommendation.ts";
import { shoppingHistoryRows as legacyHistoryRows } from "./testing/transfer/legacy-shopping-price-history.ts";
import { shoppingWeekdayRows as legacyWeekdayRows } from "./testing/transfer/legacy-weekday-recommendation.ts";
import { transferFixture, transferId, transferNow } from "./testing/transfer/fixture.ts";
import { transferObserver } from "./testing/transfer/observer.ts";
import { evaluateCurrentShoppingList as legacyShoppingList } from "./testing/transfer/legacy-shopping-list.ts";
import { functionalResult, transferList } from "./testing/transfer/workloads.ts";
import { closeLocalTestConnections, validateLocalTestUrl } from "./testing/test-query-client.ts";

it("refuses implicit application URLs and all non-local targets", () => {
  expect(() => transferFixture({ DATABASE_URL: "postgresql://unused@localhost/app" })).toThrow(
    /explicit local/u,
  );
  for (const url of [
    "postgresql://unused@remote.invalid/comprafino_test",
    "postgresql://unused@localhost/application",
  ]) {
    expect(() =>
      transferFixture({ TEST_DATABASE_URL: url, COMPRAFINO_TEST_DATABASE_MODE: "local" }),
    ).toThrow(/comprafino_test/u);
  }
});

describe.skipIf(
  !process.env.TEST_DATABASE_URL || process.env.COMPRAFINO_TEST_DATABASE_MODE !== "local",
)("shopping snapshot transport equivalence without migrations", () => {
  const fixture = transferFixture({
    TEST_DATABASE_URL:
      process.env.TEST_DATABASE_URL ?? "postgresql://unused@localhost/comprafino_test",
    COMPRAFINO_TEST_DATABASE_MODE: "local",
  });
  beforeAll(() => fixture.setup(), 30_000);
  beforeEach(() => fixture.seed(320), 30_000);
  afterAll(async () => {
    try {
      await fixture.dispose();
    } finally {
      await closeLocalTestConnections();
    }
  }, 30_000);

  async function read(list: ShoppingList, mode: PriceMode, legacy: boolean) {
    const batches: unknown[][] = [];
    const observer = transferObserver(fixture.scoped, (rows) => batches.push(rows));
    let result: Awaited<ReturnType<typeof evaluateCurrentShoppingList>>;
    try {
      result = await (legacy ? legacyShoppingList : evaluateCurrentShoppingList)(
        observer.db,
        list,
        mode,
        transferNow,
      );
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
    // Assertion failures are test failures, not equivalent application errors.
    expect(shoppingListEvaluationSchema.safeParse(result).success).toBe(true);
    expect(result.timings.queryMs).toBeGreaterThanOrEqual(0);
    expect(result.timings.totalMs).toBeGreaterThanOrEqual(result.timings.queryMs);
    return { outcome: { result: functionalResult(result) }, batches, metrics: observer.metrics };
  }

  async function compare(list: ShoppingList, mode: PriceMode = "standard") {
    const before = await read(list, mode, true);
    const after = await read(list, mode, false);
    expect(after.outcome).toEqual(before.outcome);
    for (const field of [
      "calls",
      "statements",
      "rows",
      "candidates",
      "historyRows",
      "weekdayRows",
    ] as const) {
      expect(after.metrics[field]).toBe(before.metrics[field]);
    }
    const restored = after.batches.map((batch) =>
      batch.map((raw) => {
        const { snapshot } = z
          .object({
            snapshot: z
              .object({
                listings: z.array(z.unknown()),
                historyRows: z.unknown(),
                weekdayRows: z.unknown(),
              })
              .passthrough(),
          })
          .parse(raw);
        return {
          snapshot: {
            ...snapshot,
            listings: snapshot.listings.map((row) => shoppingSnapshotRow("offer", row)),
            historyRows: shoppingSnapshotRows("history", snapshot.historyRows),
            weekdayRows: shoppingSnapshotRows("weekday", snapshot.weekdayRows),
          },
        };
      }),
    );
    expect(restored).toEqual(before.batches);
    expect(after.metrics.logicalJsonBytes).toBeLessThanOrEqual(before.metrics.logicalJsonBytes);
    return { before, after };
  }

  it("compares every output and reconstructed SQL value for all intents and price modes", async () => {
    const beforeData = await fixture.digest();
    for (const mode of ["standard", "benefits"] as const) {
      for (const [composition, count] of [
        ["generic", 5],
        ["mixed", 20],
        ["strict", 50],
        ["direct", 3],
      ] as const) {
        const { after } = await compare(transferList(composition, count), mode);
        expect(after.outcome).toHaveProperty("result");
        expect(after.metrics.calls).toBe(1);
        expect(after.metrics.statements).toBe(1);
      }
    }
    expect(await fixture.digest()).toEqual(beforeData);
  }, 30_000);

  it("keeps empty lists query-free and missing identities/history withheld", async () => {
    expect((await compare({ version: 2, items: [] })).after.metrics.calls).toBe(0);
    const list = transferList("strict", 1);
    list.items[0]!.canonicalId = transferId(2, 999999);
    const { after } = await compare(list);
    expect(after.metrics.candidates).toBe(0);
    expect(after.metrics.historyRows).toBe(0);
  });

  it("keeps the default object projections compatible with existing history callers", async () => {
    const ids = [transferId(2, 1)];
    const reads = [
      [shoppingHistoryRows, shoppingWeekdayRows],
      [legacyHistoryRows, legacyWeekdayRows],
    ] as const;
    const results = [];
    for (const [history, weekday] of reads) {
      const response = await fixture.db.execute(sql`with current_listings as (
        select l.id as listing_id,a.canonical_product_id as "canonicalId" from retailer_listings l
        left join canonical_product_listings a on a.listing_id=l.id
      ) select (${history(ids, [], transferNow)}) as history,(${weekday(ids, transferNow)}) as weekdays`);
      results.push(response.rows);
    }
    expect(results[0]).toEqual(results[1]);
  });

  it("retains freshness, stock, normalizations, zero prices and trusted URL boundaries", async () => {
    await fixture.scoped.query(
      `update retailer_listings set
        available=case when right(id::text,12)::int=1 then false else available end,
        active=right(id::text,12)::int<>2,
        last_seen_at=case right(id::text,12)::int when 3 then $1::timestamptz+interval '1 millisecond'
          when 4 then $1::timestamptz-interval '36 hours 1 millisecond'
          when 5 then $1::timestamptz-interval '36 hours' else last_seen_at end,
        url=case when right(id::text,12)::int=6 then 'https://untrusted.invalid/p' else url end,
        image_url=case when right(id::text,12)::int=7 then 'https://untrusted.invalid/p.jpg' else image_url end`,
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
    for (const mode of ["standard", "benefits"] as const) {
      expect((await compare(transferList("mixed", 20), mode)).after.outcome).toHaveProperty(
        "result",
      );
    }
  });

  it("keeps manual, obsolete and low-confidence associations from authorizing exact purchases", async () => {
    await fixture.scoped.query(
      `update canonical_product_listings set
        method=case when listing_id=$1 then 'manual' else method end,
        confidence=case when listing_id=$2 then 0 else confidence end,
        matching_version=case when listing_id=$3 then 99 else matching_version end`,
      [transferId(1, 1), transferId(1, 5), transferId(1, 9)],
    );
    const { after } = await compare(transferList("strict", 3));
    expect(after.metrics.candidates).toBe(0);
    expect(after.metrics.historyRows).toBe(0);
    await compare(transferList("mixed", 20));
  });

  it("preserves 7/30/90 day evidence, association cutoffs, gaps, changes and future samples", async () => {
    await fixture.scoped.query(
      "update canonical_product_listings set linked_at=$1::timestamptz-interval '10 days' where canonical_product_id=$2",
      [transferNow.toISOString(), transferId(2, 1)],
    );
    await fixture.scoped.query(
      "delete from listing_observation_days where listing_id=$1 and observation_date=$2::date-7",
      [transferId(1, 5), transferNow.toISOString().slice(0, 10)],
    );
    await fixture.scoped.query(
      "update listing_observation_days set last_observed_at=$1::timestamptz+interval '1 day' where listing_id=$2 and observation_date=$1::timestamptz::date",
      [transferNow.toISOString(), transferId(1, 9)],
    );
    await fixture.scoped.query(
      "update price_history set valid_until=valid_until-interval '1 hour' where listing_id=$1 and valid_until is not null",
      [transferId(1, 13)],
    );
    // An intraday cheaper state changes the daily minimum and withholds a constant weekday quote.
    await fixture.scoped.query(
      "update price_history set valid_until=valid_from+interval '2 hours' where id=$1",
      [transferId(3, 105)],
    );
    await fixture.scoped.query(
      `insert into price_history select $1,listing_id,99,regular_price_cents,currency,price_unit,
        valid_from+interval '2 hours',valid_from+interval '1 day' from price_history where id=$2`,
      [transferId(3, 9999999), transferId(3, 105)],
    );
    expect((await compare(transferList("strict", 20), "benefits")).after.outcome).toHaveProperty(
      "result",
    );
    expect((await compare(transferList("direct", 3))).after.outcome).toHaveProperty("result");
  });

  it.each([
    "update retailers set name='' where id='tottus'",
    "update retailer_listings set title=' ' where retailer_id='tottus'",
    "update retailer_listings set source_unit_multiplier=0 where retailer_id='tottus'",
    "update price_history set regular_price_cents=-1 where valid_until is null",
    "update retailer_listing_offers set condition_type='invalid'",
  ])("preserves the same validation error: %s", async (statement) => {
    await fixture.scoped.query(statement);
    expect((await compare(transferList("mixed", 20))).after.outcome).toHaveProperty(
      "error.name",
      "ZodError",
    );
  });

  it("keeps benefit validity and ordinary historical prices separate", async () => {
    await fixture.scoped.query(
      `update retailer_listing_offers set starts_at=case when listing_id=$1 then $3::timestamptz+interval '1 day' else null end,
        ends_at=case when listing_id=$2 then $3::timestamptz-interval '1 millisecond' else null end`,
      [transferId(1, 1), transferId(1, 9), transferNow.toISOString()],
    );
    expect((await compare(transferList("mixed", 20), "standard")).after.outcome).toHaveProperty(
      "result",
    );
    expect((await compare(transferList("mixed", 20), "benefits")).after.outcome).toHaveProperty(
      "result",
    );
  });

  it("isolates four concurrent requests with different scopes and modes", async () => {
    const inputs = [
      transferList("generic", 5),
      transferList("mixed", 20),
      transferList("strict", 50),
      transferList("direct", 3),
    ];
    const expected = await Promise.all(
      inputs.map((list, index) => read(list, index % 2 ? "benefits" : "standard", true)),
    );
    const actual = await Promise.all(
      inputs.map((list, index) => read(list, index % 2 ? "benefits" : "standard", false)),
    );
    expect(actual.map((entry) => entry.outcome)).toEqual(expected.map((entry) => entry.outcome));
    for (const entry of actual) {
      expect(entry.outcome).toHaveProperty("result");
    }
    expect(actual.map((entry) => entry.metrics.calls)).toEqual([1, 1, 1, 1]);
  }, 30_000);

  it("keeps one-statement snapshots consistent across an atomic concurrent price/benefit update", async () => {
    const url = validateLocalTestUrl(process.env.TEST_DATABASE_URL!);
    const writer = new Client({ connectionString: url });
    await writer.connect();
    const list = transferList("direct", 1);
    try {
      const initial = await compare(list, "benefits");
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
      const concurrent = await compare(list, "benefits");
      expect(concurrent.after.outcome).toEqual(initial.after.outcome);
      await writer.query("commit");
      const committed = await compare(list, "benefits");
      expect(committed.after.outcome).not.toEqual(initial.after.outcome);
    } finally {
      try {
        await writer.query("rollback");
      } finally {
        await writer.end();
      }
    }
  });

  it("preserves four concurrent evaluations at 50,000 listings without sharing request data", async () => {
    await fixture.seed(50_000);
    const inputs = [
      transferList("mixed", 20),
      transferList("generic", 5),
      transferList("strict", 50),
      transferList("direct", 3),
    ];
    const before = await Promise.all(
      inputs.map((list, index) => read(list, index % 2 ? "standard" : "benefits", true)),
    );
    const after = await Promise.all(
      inputs.map((list, index) => read(list, index % 2 ? "standard" : "benefits", false)),
    );
    expect(after.map((entry) => entry.outcome)).toEqual(before.map((entry) => entry.outcome));
    for (const entry of after) {
      expect(entry.outcome).toHaveProperty("result");
      expect(entry.metrics.calls).toBe(1);
      expect(entry.metrics.statements).toBe(1);
    }
  }, 60_000);

  it("retains the full current catalog bound and unchanged full-scope search pagination", async () => {
    await fixture.seed(50_000);
    const { after } = await compare(transferList("generic", 5));
    expect(after.outcome).toHaveProperty("result");
    const filters = searchFilters({ sort: "unit-price" });
    const first = transferObserver(fixture.scoped);
    const second = transferObserver(fixture.scoped);
    const page1 = await searchGroupedPublicProducts(
      first.db,
      "benchcatalogo",
      filters.sort,
      transferNow,
      filters,
      1,
    );
    const page2 = await searchGroupedPublicProducts(
      second.db,
      "benchcatalogo",
      filters.sort,
      transferNow,
      filters,
      2,
    );
    expect(first.metrics.candidates).toBe(50_000);
    expect(first.metrics.logicalJsonBytes).toBe(second.metrics.logicalJsonBytes);
    expect(page1.products).toHaveLength(30);
    expect(page2.products).toHaveLength(30);
    expect(page1.totalProducts).toBe(page2.totalProducts);
    expect(page1.products.some((p) => page2.products.some((q) => p.id === q.id))).toBe(false);
    await fixture.seed(50_001);
    expect((await compare(transferList("strict", 1))).after.outcome).toHaveProperty(
      "error.message",
      "Shopping catalog snapshot bound exceeded",
    );
    await expect(
      searchGroupedPublicProducts(fixture.db, "benchcatalogo", "relevance", transferNow),
    ).rejects.toThrow("Generic search candidate bound exceeded");
  }, 60_000);
});
