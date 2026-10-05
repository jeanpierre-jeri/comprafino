import { retailerIdSchema } from "@comprafino/core";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { closeLocalTestConnections } from "./testing/test-query-client.ts";

import { persistListings } from "./ingestion.ts";

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
      const results = await Promise.allSettled(
        values.map((value) => persistListings(db, value.retailer, [value])),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      expect(
        (await query("select count(*)::int as count from retailer_listings"))[0],
      ).toMatchObject({ count: 1000 });
      const winner = values[results.findIndex((r) => r.status === "fulfilled")]!;
      expect(
        await persistListings(db, winner.retailer, [
          { ...winner, observedAt: observation("unused", 1).observedAt },
        ]),
      ).toMatchObject({ changed: 0, persisted: 1 });
    } finally {
      for (const table of ["price_history", "listing_observation_days", "retailer_listing_offers"])
        await query(
          `delete from ${table} where listing_id in (select id from retailer_listings where title='Catalog guard fixture')`,
        );
      await query("delete from retailer_listings where title='Catalog guard fixture'");
    }
  }, 30000);
});
