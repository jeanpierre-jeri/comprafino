import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getHomeProductComparison } from "./public-products.ts";
import { catalogTestContext, publicNow } from "./testing/catalog-fixtures.ts";
import { closeLocalTestConnections } from "./testing/test-query-client.ts";

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)("home comparison in an owned PostgreSQL schema", () => {
  const harness = catalogTestContext({
    ...process.env,
    TEST_DATABASE_URL: testUrl ?? "postgresql://unused@localhost/comprafino_test",
  });
  const { db, query, seedPublicProduct } = harness;

  beforeAll(() => harness.setup(), 30_000);
  beforeEach(() => harness.reset(), 30_000);
  afterAll(async () => {
    try {
      await harness.dispose();
    } finally {
      await closeLocalTestConnections();
    }
  }, 30_000);

  it("returns no invented example for an empty catalog and selects a real exact product", async () => {
    expect(await getHomeProductComparison(db, publicNow)).toBeNull();
    const { id } = await seedPublicProduct("home", "Leche Gloria Entera Caja 946ml");
    const product = await getHomeProductComparison(db, publicNow);
    expect(product?.id).toBe(id);
    expect(product?.quantityValue).toBe(946);
    expect(product?.quantityUnit).toBe("ml");
    expect(product?.offers.map((offer) => offer.retailerId)).toEqual(["metro", "plaza-vea"]);
    expect(product?.offers.every((offer) => offer.currentPriceCents === 1290)).toBe(true);
  });

  it("requires two current positive ordinary prices, admitting unknown stock without confirming it", async () => {
    await seedPublicProduct("home", "Leche Gloria Entera Caja 946ml");
    await query("update retailer_listings set first_seen_at='2026-09-01T00:00:00Z'");
    await query("update retailer_listings set available=null");
    expect((await getHomeProductComparison(db, publicNow))?.currentOfferCount).toBe(2);
    await query("update retailer_listings set available=false where retailer_id='metro'");
    expect(await getHomeProductComparison(db, publicNow)).toBeNull();
    await query("update retailer_listings set available=true");
    await query(
      "update price_history set current_price_cents=0 where listing_id in (select id from retailer_listings where retailer_id='metro')",
    );
    expect(await getHomeProductComparison(db, publicNow)).toBeNull();
  });

  it("rejects stale/future observations and revoked, manual or obsolete identity evidence", async () => {
    await seedPublicProduct("home", "Leche Gloria Entera Caja 946ml");
    await query("update retailer_listings set first_seen_at='2026-09-01T00:00:00Z'");
    for (const age of [36, 36.001, -1]) {
      const observedAt = new Date(publicNow.getTime() - age * 3_600_000);
      await query("update retailer_listings set last_seen_at=$1 where retailer_id='metro'", [
        observedAt.toISOString(),
      ]);
      expect(Boolean(await getHomeProductComparison(db, publicNow))).toBe(age === 36);
    }
    await query("update retailer_listings set last_seen_at=$1", [publicNow.toISOString()]);
    for (const change of ["confidence=0", "method='manual'", "matching_version=999"]) {
      await query(`update canonical_product_listings set ${change} where retailer_id='metro'`);
      expect(await getHomeProductComparison(db, publicNow)).toBeNull();
      await query(
        "update canonical_product_listings set confidence=1, method='automatic', matching_version=1",
      );
    }
  });
});
