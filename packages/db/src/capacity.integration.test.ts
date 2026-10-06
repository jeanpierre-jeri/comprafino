import { retailerIdSchema } from "@comprafino/core";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { closeLocalTestConnections } from "./testing/test-query-client.ts";

import { persistListings, persistListingsDetailed } from "./ingestion.ts";

import { catalogTestContext, observation, publicNow } from "./testing/catalog-fixtures.ts";

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)("PostgreSQL capacity (explicit TEST_DATABASE_URL)", () => {
  // Keep deliberate contention inside each case; cases start with independent data.
  const harness = catalogTestContext({
    ...process.env,
    TEST_DATABASE_URL: testUrl ?? "postgresql://unused@localhost/comprafino_test",
  });
  const { db, query } = harness;
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

  async function fillTo(total: number) {
    const count = z
      .object({ count: z.number() })
      .parse((await query("select count(*)::int as count from retailer_listings"))[0]).count;
    await query(
      `insert into retailer_listings(retailer_id,external_id,product_id,title,url,current_price_cents,currency,price_unit,first_seen_at,last_seen_at)
      select 'metro','capacity-fill-'||i,'capacity-fill-'||i,'Capacity fixture','https://www.metro.pe/fixture/p',500,'PEN','UN',$1::timestamptz,$1::timestamptz from generate_series(1,$2::int) i`,
      [publicNow.toISOString(), String(total - count)],
    );
  }

  it("admits only two new identities at 998 and refreshes known listings at full capacity", async () => {
    const initial = { ...observation("known", 0), available: true };
    await persistListings(db, "tottus", [initial]);
    await fillTo(998);
    const batch = [
      observation("new-first", 1),
      observation("new-second", 1),
      observation("new-skipped", 1),
      {
        ...initial,
        observedAt: observation("unused", 1).observedAt,
        currentPriceCents: 990,
        available: false,
      },
    ];
    expect(await persistListingsDetailed(db, "tottus", batch)).toEqual({
      persisted: 3,
      created: 2,
      changed: 3,
      skippedByCapacity: 1,
    });
    expect((await query("select count(*)::int as count from retailer_listings"))[0]).toEqual({
      count: 1000,
    });
    expect(
      await query(
        "select external_id from retailer_listings where external_id like 'new-%' order by external_id",
      ),
    ).toEqual([{ external_id: "new-first" }, { external_id: "new-second" }]);
    expect(
      (
        await query(
          "select current_price_cents,available from retailer_listings where external_id='known'",
        )
      )[0],
    ).toEqual({ current_price_cents: 990, available: false });
    expect(
      (
        await query(
          "select count(*)::int as count from price_history h join retailer_listings l on l.id=h.listing_id where l.external_id='known'",
        )
      )[0],
    ).toEqual({ count: 2 });
    expect(await persistListingsDetailed(db, "tottus", batch)).toEqual({
      persisted: 0,
      created: 0,
      changed: 0,
      skippedByCapacity: 1,
    });
    expect(
      await persistListingsDetailed(db, "tottus", [
        { ...observation("known", 2, 890), available: undefined },
        observation("still-skipped", 2),
      ]),
    ).toEqual({ persisted: 1, created: 0, changed: 1, skippedByCapacity: 1 });
    expect(
      (await query("select available from retailer_listings where external_id='known'"))[0],
    ).toEqual({ available: false });
    expect(await persistListingsDetailed(db, "tottus", [observation("only-skipped", 3)])).toEqual({
      persisted: 0,
      created: 0,
      changed: 0,
      skippedByCapacity: 1,
    });
  }, 30000);

  it("enforces catalog identity capacity atomically across retailers while permitting known refresh", async () => {
    const count = z
      .object({ count: z.number() })
      .parse((await query("select count(*)::int as count from retailer_listings"))[0]).count;

    try {
      await query(
        `insert into retailer_listings(retailer_id,external_id,product_id,title,url,current_price_cents,currency,price_unit,first_seen_at,last_seen_at)
        select 'metro','guard-fixture-'||i,'guard-fixture-'||i,'Catalog guard fixture','https://www.metro.pe/fixture/p',500,'PEN','UN',$1::timestamptz,$1::timestamptz from generate_series(1,$2::int) i`,
        [publicNow.toISOString(), String(999 - count)],
      );
      const values = ["metro", "plaza-vea"].map((retailer) => ({
        ...observation(`guard-fixture-${retailer}`, 0),
        retailer: retailerIdSchema.parse(retailer),
        title: "Catalog guard fixture",
        available: true,
      }));
      const results = await Promise.all(
        values.map((value) => persistListings(db, value.retailer, [value])),
      );
      expect(results.map((r) => r.persisted).sort((a, b) => a - b)).toEqual([0, 1]);
      expect(results.map((r) => r.skippedByCapacity).sort((a, b) => a - b)).toEqual([0, 1]);
      expect(
        (await query("select count(*)::int as count from retailer_listings"))[0],
      ).toMatchObject({ count: 1000 });
      const winner = values[results.findIndex((r) => r.persisted === 1)]!;
      expect(
        await persistListings(db, winner.retailer, [
          { ...winner, observedAt: observation("unused", 1).observedAt },
        ]),
      ).toMatchObject({ changed: 0, persisted: 1 });
    } finally {
      for (const table of [
        "price_history",
        "listing_observation_days",
        "retailer_listing_offers",
      ]) {
        await query(
          `delete from ${table} where listing_id in (select id from retailer_listings where title='Catalog guard fixture')`,
        );
      }

      await query("delete from retailer_listings where title='Catalog guard fixture'");
    }
  }, 30000);
});
