import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { persistListings } from "./ingestion.ts";
import { normalizeCatalog } from "./catalog.ts";
import { inspectCatalogHealth } from "./catalog-health.ts";
import { auditCatalogCoverage } from "./catalog-coverage.ts";
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
    await persistListings(harness.db, "makro", [
      {
        retailer: "makro",
        externalId: "health-makro",
        productId: "health-makro",
        title: "Azúcar Rubia ARO Bolsa 5Kg",
        sourceBrand: "ARO",
        category: "444",
        url: "https://www.makro.plazavea.com.pe/azucar/p",
        currentPriceCents: 1779,
        currency: "PEN",
        priceUnit: "UN",
        available: true,
        observedAt: new Date(),
      },
    ]);
    await normalizeCatalog(harness.db, 2000);
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
    const coverage = await auditCatalogCoverage(harness.db);
    expect(report.retainedListings).toBe(coverage.totals.known);
    expect(report.retailers.map((row) => row.freshSearchableOffers)).toEqual(
      report.retailers.map((row) => coverage.retailers[row.retailer]!.publicGeneric),
    );
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

  it("counts the same eligible offers as the complete audit across multiple pages", async () => {
    await persistListings(
      harness.db,
      "makro",
      Array.from({ length: 501 }, (_, index) => ({
        retailer: "makro" as const,
        externalId: `health-page-${index}`,
        productId: `health-page-${index}`,
        title: "Arroz ARO Bolsa 1Kg",
        sourceBrand: "ARO",
        category: "444",
        url: "https://www.makro.plazavea.com.pe/arroz/p",
        currentPriceCents: 1000,
        currency: "PEN" as const,
        priceUnit: "UN" as const,
        available: true,
        observedAt: new Date(),
      })),
    );
    await normalizeCatalog(harness.db, 50_000);
    const now = new Date();
    const report = await inspectCatalogHealth(harness.db, now);
    const coverage = await auditCatalogCoverage(harness.db, now);
    expect(report.retainedListings).toBe(coverage.totals.known);
    expect(report.retailers.map((row) => row.freshSearchableOffers)).toEqual(
      report.retailers.map((row) => coverage.retailers[row.retailer]!.publicGeneric),
    );
    expect(
      report.retailers.find((row) => row.retailer === "makro")!.freshSearchableOffers,
    ).toBeGreaterThan(500);
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

  it("reads explicit partial markers as warnings while retaining access errors and complete-cycle age", async () => {
    await harness.scoped.query(
      "update ingestion_runs set started_at=now()-interval '40 hours',ended_at=now()-interval '39 hours' where retailer_id='tottus'",
    );
    await harness.scoped
      .query(`insert into ingestion_runs(retailer_id,status,started_at,ended_at,listings_fetched,listings_persisted,listings_changed,error)
      values('tottus','failed',now()-interval '1 minute',now(),1,1,0,'catalog_partial_source')`);
    const report = await inspectCatalogHealth(harness.db);
    expect(report.status).toBe("warning");
    expect(report.retailers.find((row) => row.retailer === "tottus")).toMatchObject({
      freshness: "stale",
      priceFreshness: "fresh_offers_present",
      latestAttemptFailureKind: "partial_source",
    });
    await harness.scoped.query(
      "update ingestion_runs set error='catalog_access_restricted' where retailer_id='tottus' and status='failed'",
    );
    expect((await inspectCatalogHealth(harness.db)).status).toBe("attention");
  });
});
