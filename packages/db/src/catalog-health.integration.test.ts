import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inspectCatalogHealth } from "./catalog-health.ts";
import { ownedTestDatabase } from "./testing/database.ts";
import { closeLocalTestConnections } from "./testing/test-query-client.ts";
import { seedShoppingListFixtures } from "./shopping-list-e2e-fixtures.ts";

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)("catalog health with an explicit owned test database", () => {
  const harness = ownedTestDatabase({
    ...process.env,
    TEST_DATABASE_URL: testUrl ?? "postgresql://unused@localhost/comprafino_test",
  });

  beforeAll(async () => {
    await harness.setup();
  }, 30_000);
  beforeEach(async () => {
    await harness.reset();
    await seedShoppingListFixtures(harness.db, harness.scoped);
    await harness.scoped.query(
      "insert into ingestion_runs(retailer_id,status,started_at,ended_at) select id,'success',now()-interval '12 hours',now()-interval '11 hours' from retailers",
    );
  }, 30_000);
  afterAll(async () => {
    try {
      await harness.dispose();
    } finally {
      await closeLocalTestConnections();
    }
  });

  it("reports real search eligibility and operations without writing catalog data", async () => {
    const before = await harness.scoped.query(
      "select count(*)::int as runs,(select count(*)::int from price_history) as history from ingestion_runs",
    );
    const report = await inspectCatalogHealth(harness.db);
    expect(report.status).toBe("healthy");
    expect(report.retailers.every((row) => row.freshSearchableOffers > 0)).toBe(true);
    expect(report.skippedByCapacity).toBeNull();
    expect(
      await harness.scoped.query(
        "select count(*)::int as runs,(select count(*)::int from price_history) as history from ingestion_runs",
      ),
    ).toEqual(before);
    expect(JSON.stringify(report)).not.toContain("Huevos");
  });

  it("fails when recent successful attempts mask stale quotes or explicit unavailable stock", async () => {
    await harness.scoped.query(
      "update retailer_listings set first_seen_at=now()-interval '38 hours',last_seen_at=now()-interval '37 hours' where retailer_id='metro'",
    );
    await harness.scoped.query(
      "update retailer_listings set available=false where retailer_id='tottus'",
    );
    const report = await inspectCatalogHealth(harness.db, new Date(), 4);
    expect(report.status).toBe("attention");
    expect(report.issues).toEqual(
      expect.arrayContaining([
        { severity: "error", reason: "no_fresh_searchable_offers", retailer: "metro" },
        { severity: "error", reason: "no_fresh_searchable_offers", retailer: "tottus" },
        { severity: "error", reason: "capacity_skips", retailer: null },
      ]),
    );
  });
});
