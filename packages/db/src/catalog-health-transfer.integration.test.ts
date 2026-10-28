import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { catalogFingerprint } from "./catalog.ts";
import { inspectCatalogHealth } from "./catalog-health.ts";
import { CatalogHealthReadError } from "./catalog-health-read.ts";
import { healthFixture, healthFixtureNow } from "./testing/health/fixture.ts";
import { legacyCatalogHealth } from "./testing/health/legacy-catalog-health.ts";
import { healthObserver } from "./testing/health/observer.ts";
import { closeLocalTestConnections } from "./testing/test-query-client.ts";

it("requires explicit local test configuration, without an application URL fallback", () => {
  expect(() =>
    healthFixture({ DATABASE_URL: "postgresql://unused@localhost/comprafino_test" }),
  ).toThrow(/explicit local/u);
  expect(() =>
    healthFixture({
      TEST_DATABASE_URL: "postgresql://unused@remote.invalid/comprafino_test",
      COMPRAFINO_TEST_DATABASE_MODE: "local",
    }),
  ).toThrow(/loopback/u);
  expect(() =>
    healthFixture({
      TEST_DATABASE_URL: "postgresql://unused@localhost/application",
      COMPRAFINO_TEST_DATABASE_MODE: "local",
    }),
  ).toThrow(/comprafino_test/u);
});

describe.skipIf(
  !process.env.TEST_DATABASE_URL || process.env.COMPRAFINO_TEST_DATABASE_MODE !== "local",
)("health transfer equivalence on local PostgreSQL without migrations", () => {
  const fixture = healthFixture({
    TEST_DATABASE_URL:
      process.env.TEST_DATABASE_URL ?? "postgresql://unused@localhost/comprafino_test",
    COMPRAFINO_TEST_DATABASE_MODE: "local",
  });

  beforeAll(() => fixture.setup(), 30_000);
  afterAll(async () => {
    try {
      await fixture.dispose();
    } finally {
      await closeLocalTestConnections();
    }
  });

  async function observe(reader: typeof legacyCatalogHealth, skipped: number | null = null) {
    const pages: unknown[][] = [];
    const progress: unknown[] = [];
    const observed = healthObserver(fixture.scoped, (rows) => pages.push(rows));
    try {
      const report = await reader(observed.db, healthFixtureNow, skipped, (...event) =>
        progress.push(event),
      );
      return {
        outcome: { report },
        pages,
        progress,
        trace: observed.trace,
        metrics: observed.metrics,
      };
    } catch (error) {
      let detail: unknown;
      if (error instanceof CatalogHealthReadError) {
        detail = {
          name: error.name,
          message: error.message,
          stage: error.stage,
          code: error.code,
          attempts: error.attempts,
        };
      } else if (error instanceof z.ZodError) {
        detail = { name: error.name, issues: error.issues };
      } else if (error instanceof Error) {
        detail = { name: error.name, message: error.message };
      } else {
        throw error;
      }
      return {
        outcome: { error: detail },
        pages,
        progress,
        trace: observed.trace,
        metrics: observed.metrics,
      };
    }
  }

  async function compare(skipped: number | null = null) {
    const before = await observe(legacyCatalogHealth, skipped);
    const after = await observe(inspectCatalogHealth, skipped);
    expect(after.outcome).toEqual(before.outcome);
    expect(after.progress).toEqual(before.progress);
    expect(after.trace.map(({ stage, rows }) => ({ stage, rows }))).toEqual(
      before.trace.map(({ stage, rows }) => ({ stage, rows })),
    );
    expect(after.metrics.calls).toBe(before.metrics.calls);
    expect(after.metrics.statements).toBe(before.metrics.statements);
    expect(after.metrics.candidateRows).toBe(before.metrics.candidateRows);
    expect(
      after.pages.map((page) =>
        page.map((row) => ({
          ...z.record(z.string(), z.unknown()).parse(row),
          imageUrl: null,
          conditionalOffers: [],
          canonicalId: null,
          retailerCount: 0,
        })),
      ),
    ).toEqual(before.pages);
    for (const page of after.pages) {
      for (const raw of page) {
        const row = z.record(z.string(), z.unknown()).parse(raw);
        expect(Object.keys(row)).toHaveLength(10);
        expect(row).not.toHaveProperty("imageUrl");
        expect(row).not.toHaveProperty("conditionalOffers");
        expect(row).not.toHaveProperty("canonicalId");
        expect(row).not.toHaveProperty("retailerCount");
      }
    }
    expect(after.metrics.logicalJsonBytes).toBeLessThanOrEqual(before.metrics.logicalJsonBytes);
    return after;
  }

  it.each([0, 499, 500, 501, 1000])(
    "preserves complete reports and pagination for %i candidates",
    async (size) => {
      await fixture.seed(size);
      const result = await compare();
      expect(result.metrics.candidateRows).toBe(size);
      expect(result.metrics.pages).toBe(Math.floor(size / 500) + 1);
      expect(result.metrics.statements).toBe(9 + Math.floor(size / 500) + 1);
      expect(result.outcome).toHaveProperty("report.retainedListings", size);
    },
  );

  it("retains SQL admission and domain rejection, including exact freshness boundaries and ambiguous quantity", async () => {
    await fixture.seed(16);
    await fixture.scoped.query(
      `update retailer_listings set
      available=case when right(id::text,12)::int=1 then false else available end,
      active=right(id::text,12)::int<>2,
      last_seen_at=case right(id::text,12)::int
        when 3 then $1::timestamptz+interval '1 millisecond'
        when 4 then $1::timestamptz-interval '36 hours 1 millisecond'
        when 12 then $1::timestamptz-interval '36 hours' else last_seen_at end,
      url=case when right(id::text,12)::int=11 then 'https://untrusted.invalid/p' else url end`,
      [healthFixtureNow.toISOString()],
    );
    await fixture.scoped.query(
      "delete from listing_normalizations where right(listing_id::text,12)::int=6",
    );
    await fixture.scoped.query(`update listing_normalizations set
      input_fingerprint=case when right(listing_id::text,12)::int=9 then '' else input_fingerprint end,
      normalization_version=case when right(listing_id::text,12)::int=10 then 99 else normalization_version end`);
    await fixture.scoped.query(
      `update price_history set
      current_price_cents=case when right(listing_id::text,12)::int=5 then 0 else current_price_cents end,
      valid_until=case when right(listing_id::text,12)::int=7 then $1::timestamptz else null end,
      price_unit=case when right(listing_id::text,12)::int=8 then 'KG' else price_unit end,
      regular_price_cents=null`,
      [healthFixtureNow.toISOString()],
    );
    const attributes = {
      title: "Harina de Arroz Costeño 1 g",
      priceUnit: "UN" as const,
      sourceBrand: "Costeño",
      packageText: "Bolsa",
      sourceUnitMultiplier: 1.25,
    };
    await fixture.scoped.query(
      "update retailer_listings set package_text='Bolsa',source_unit_multiplier=1.25 where right(id::text,12)::int=16",
    );
    await fixture.scoped.query(
      "update listing_normalizations set input_fingerprint=$1 where right(listing_id::text,12)::int=16",
      [catalogFingerprint(attributes)],
    );
    const result = await compare(4);
    expect(result.metrics.candidateRows).toBe(8);
    expect(result.outcome).toHaveProperty("report");
    if (!result.outcome.report) {
      throw new Error("Expected a successful report");
    }
    expect(
      result.outcome.report.retailers.reduce(
        (sum, retailer) => sum + retailer.freshSearchableOffers,
        0,
      ),
    ).toBe(5);
    expect(result.outcome.report.issues).toContainEqual({
      severity: "error",
      reason: "capacity_skips",
      retailer: null,
    });
  });

  it("preserves empty-candidate reports and all operational failure classifications", async () => {
    await fixture.seed(8);
    await fixture.scoped.query(
      "update retailer_listings set last_seen_at=$1::timestamptz-interval '37 hours'",
      [healthFixtureNow.toISOString()],
    );
    await fixture.scoped.query(`update ingestion_runs set status='failed',error=case retailer_id
      when 'tottus' then 'catalog_partial_source' when 'plaza-vea' then 'catalog_access_restricted'
      when 'metro' then 'catalog_persistence_failed' else 'catalog_capacity_skips' end`);
    const result = await compare(0);
    expect(result.metrics.candidateRows).toBe(0);
    expect(result.outcome).toHaveProperty("report.status", "attention");
  });

  it.each([
    "update retailers set name='' where id='tottus'",
    "update retailer_listings set title=' ' where retailer_id='tottus'",
    "update retailer_listings set source_unit_multiplier=0 where retailer_id='tottus'",
    "update price_history set regular_price_cents=-1",
  ])("preserves validation failures for retained dynamic fields: %s", async (statement) => {
    await fixture.seed(8);
    await fixture.scoped.query(statement);
    expect((await compare()).outcome).toHaveProperty("error.name", "ZodError");
  });

  it("preserves SQL errors and stage/attempt metadata", async () => {
    await fixture.seed(8);
    await fixture.scoped.query("alter table price_history rename to hidden_prices");
    try {
      const result = await compare();
      expect(result.outcome).toHaveProperty("error.code", "42P01");
      expect(result.outcome).toHaveProperty("error.stage", "offers_page");
      expect(result.outcome).toHaveProperty("error.attempts", 1);
    } finally {
      await fixture.scoped.query("alter table hidden_prices rename to price_history");
    }
  });

  it("examines the entire 50,000-row catalog and rejects overflow before scanning offers", async () => {
    await fixture.seed(50_000);
    const full = await compare();
    expect(full.metrics.candidateRows).toBe(50_000);
    expect(full.outcome).toHaveProperty("report.status", "warning");
    await fixture.seed(50_001);
    const overflow = await compare();
    expect(overflow.outcome).toHaveProperty(
      "error.message",
      "Catalog audit exceeds retained capacity",
    );
    expect(overflow.metrics.candidateRows).toBe(0);
    expect(overflow.metrics.pages).toBe(0);
  }, 30_000);
});
