import { cleanupDiscoveryDemand } from "./discovery.ts";
import { discoveryDemandPolicy } from "@comprafino/core";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeLocalTestConnections } from "./testing/test-query-client.ts";

import {
  recordDiscoveryForSearch,
  claimDiscoveryQueries,
  previewDiscoveryQueries,
  finishDiscoveryQuery,
  inspectDiscovery,
} from "./discovery.ts";

import { catalogTestContext } from "./testing/catalog-fixtures.ts";

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)("PostgreSQL discovery (explicit TEST_DATABASE_URL)", () => {
  // Keep deliberate contention inside each case; cases start with independent data.
  const harness = catalogTestContext({
    ...process.env,
    TEST_DATABASE_URL: testUrl ?? "postgresql://unused@localhost/comprafino_test",
  });
  const { db, query, resetDiscovery } = harness;
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
  it("discovery safely deduplicates concurrent demand and increments counts", async () => {
    await resetDiscovery();
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        recordDiscoveryForSearch(db, i % 2 ? " arroz  costeño " : "ARROZ COSTEÑO", 0),
      ),
    );
    const { queries } = await inspectDiscovery(db);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.normalizedQuery).toBe("arroz costeño");
    expect(queries[0]?.requestCount).toBe(12);
    expect(await recordDiscoveryForSearch(db, "aceite primor", 1)).toBe(false);
    expect(await recordDiscoveryForSearch(db, "??", 0)).toBe(false);
    expect((await inspectDiscovery(db)).queries).toHaveLength(1);
  }, 30_000);
  it("discovery preserves 24h cooldown despite demand, expires at the boundary and rejects stale completion", async () => {
    await resetDiscovery();
    await recordDiscoveryForSearch(db, "aceite primor", 0);
    const [claim] = await claimDiscoveryQueries(db, 1);

    if (!claim) {
      throw new Error("Expected claim");
    }

    await finishDiscoveryQuery(db, claim, { status: "no_results", resultCount: 0, error: null });
    expect((await inspectDiscovery(db)).queries[0]?.status).toBe("no_results");
    await recordDiscoveryForSearch(db, "ACEITE PRIMOR", 0);
    expect(await claimDiscoveryQueries(db, 30)).toEqual([]);
    expect(await previewDiscoveryQueries(db, 30)).toEqual([]);
    expect((await inspectDiscovery(db)).queries[0]?.requestCount).toBe(2);
    await query(
      "update discovery_queries set last_attempted_at=statement_timestamp()-interval '24 hours', next_eligible_at=statement_timestamp() where id=$1",
      [claim.id],
    );
    const [retry] = await claimDiscoveryQueries(db, 1);

    if (!retry) {
      throw new Error("Expected retry");
    }

    await finishDiscoveryQuery(db, claim, { status: "completed", resultCount: 1, error: null });
    expect((await inspectDiscovery(db)).queries[0]?.status).toBe("processing");
    await finishDiscoveryQuery(db, retry, {
      status: "failed",
      resultCount: 0,
      error: "Retailer discovery failed.",
    });
    expect((await inspectDiscovery(db)).queries[0]?.status).toBe("failed");
  }, 30_000);
  it("discovery shares the UTC daily cap across concurrent processors and retains prior-day accounting", async () => {
    await resetDiscovery();
    await Promise.all(
      Array.from({ length: 4 }, (_, i) => recordDiscoveryForSearch(db, `arroz ${i}`, 0)),
    );
    await query(
      "insert into discovery_daily_budget(day,processed) values ((statement_timestamp() at time zone 'UTC')::date,29),((statement_timestamp() at time zone 'UTC')::date-1,30)",
    );
    const claims = await Promise.all([claimDiscoveryQueries(db, 3), claimDiscoveryQueries(db, 3)]);
    expect(claims.flat()).toHaveLength(1);
    expect((await inspectDiscovery(db)).stats.processedToday).toBe(30);
    expect(await claimDiscoveryQueries(db, 30)).toEqual([]);
    expect(await previewDiscoveryQueries(db, 30)).toEqual([]);
    await expect(query("update discovery_daily_budget set processed=31")).rejects.toThrow(
      /discovery_daily_cap/u,
    );
  }, 30_000);
  it("discovery prioritizes popularity then oldest eligibility and dry-run performs no writes", async () => {
    await resetDiscovery();
    await recordDiscoveryForSearch(db, "arroz viejo", 0);
    await recordDiscoveryForSearch(db, "arroz nuevo", 0);
    await recordDiscoveryForSearch(db, "arroz popular", 0);
    await recordDiscoveryForSearch(db, "ARROZ POPULAR", 0);
    await query(
      "update discovery_queries set next_eligible_at=statement_timestamp()-interval '2 hours' where normalized_query='arroz viejo'",
    );
    const before = await query("select * from discovery_queries order by id");
    expect(await previewDiscoveryQueries(db, 3)).toEqual([
      { query: "arroz popular" },
      { query: "arroz viejo" },
      { query: "arroz nuevo" },
    ]);
    expect(await query("select * from discovery_queries order by id")).toEqual(before);
    expect(await query("select * from discovery_daily_budget")).toEqual([]);
    const claims = await claimDiscoveryQueries(db, 3);
    expect(claims.map((c) => c.query).sort()).toEqual([
      "arroz nuevo",
      "arroz popular",
      "arroz viejo",
    ]);
    const popular = claims.find((c) => c.query === "arroz popular");

    if (!popular) {
      throw new Error("Expected claim");
    }

    await finishDiscoveryQuery(db, popular, { status: "completed", resultCount: 2, error: null });
    await query(
      "update discovery_queries set last_attempted_at=statement_timestamp()-interval '25 hours', next_eligible_at=statement_timestamp()-interval '1 hour' where id=$1",
      [popular.id],
    );
    // No new demand since the successful attempt: keep completed work dormant.
    await query(
      "update discovery_queries set first_requested_at=statement_timestamp()-interval '2 days',last_requested_at=statement_timestamp()-interval '2 days' where id=$1",
      [popular.id],
    );
    expect(await previewDiscoveryQueries(db, 3)).toEqual([]);
    await recordDiscoveryForSearch(db, "arroz popular", 0);
    expect(await previewDiscoveryQueries(db, 3)).toEqual([{ query: "arroz popular" }]);
  }, 30_000);

  it("expires bounded inactive demand, detaches acquisition FKs, and preserves processing/cooldown/recent demand", async () => {
    for (const value of [
      "old pending",
      "old completed",
      "old failed",
      "old processing",
      "old cooldown",
      "recent demand",
    ]) {
      await recordDiscoveryForSearch(db, value, 0);
    }

    await query(
      "update discovery_queries set first_requested_at=statement_timestamp()-interval '32 days',last_requested_at=statement_timestamp()-interval '31 days',next_eligible_at=statement_timestamp()-interval '1 day' where normalized_query<>'recent demand'",
    );
    await query(
      "update discovery_queries set status='processing' where normalized_query='old processing'",
    );
    await query("update discovery_queries set status='failed' where normalized_query='old failed'");
    await query(
      "update discovery_queries set status='completed' where normalized_query='old completed'",
    );
    await query(
      "update discovery_queries set next_eligible_at=statement_timestamp()+interval '1 hour' where normalized_query='old cooldown'",
    );
    const demand = (await inspectDiscovery(db)).queries.find(
      (q) => q.normalizedQuery === "old completed",
    )!;
    await query(
      "insert into retailer_listings(retailer_id,external_id,product_id,title,url,current_price_cents,currency,price_unit,first_seen_at,last_seen_at,discovery_query_id,first_seen_via) values('metro','retention-fk','retention-fk','Retention fixture','https://www.metro.pe/test/p',100,'PEN','UN',statement_timestamp(),statement_timestamp(),$1,'discovery')",
      [demand.id],
    );
    expect(await cleanupDiscoveryDemand(db)).toEqual({ removed: 3 });
    expect(await cleanupDiscoveryDemand(db)).toEqual({ removed: 0 });
    expect((await inspectDiscovery(db)).queries.map((q) => q.normalizedQuery).sort()).toEqual([
      "old cooldown",
      "old processing",
      "recent demand",
    ]);
    expect(
      await query(
        "select discovery_query_id,first_seen_via from retailer_listings where external_id='retention-fk'",
      ),
    ).toEqual([{ discovery_query_id: null, first_seen_via: "discovery" }]);
  });
  it("cleanup is bounded and idempotent", async () => {
    await query(
      "insert into discovery_queries(normalized_query,original_query,first_requested_at,last_requested_at,next_eligible_at) select 'old query '||n,'old query '||n,statement_timestamp()-interval '32 days',statement_timestamp()-interval '31 days',statement_timestamp()-interval '1 day' from generate_series(1,102) n",
    );
    expect(await cleanupDiscoveryDemand(db)).toEqual({
      removed: discoveryDemandPolicy.cleanupBatch,
    });
    expect(await cleanupDiscoveryDemand(db)).toEqual({ removed: 2 });
    expect(await cleanupDiscoveryDemand(db)).toEqual({ removed: 0 });
  });
  it("serializes admission at capacity, deduplicates existing demand, and never exceeds the retained bound", async () => {
    await query(
      `insert into discovery_queries(normalized_query,original_query) select 'arroz bulk '||n,'arroz bulk '||n from generate_series(1,${discoveryDemandPolicy.maximumRows - 1}) n`,
    );
    const admitted = await Promise.all([
      recordDiscoveryForSearch(db, "aceite last slot", 0),
      recordDiscoveryForSearch(db, "leche last slot", 0),
    ]);
    expect(admitted.filter(Boolean)).toHaveLength(1);
    expect((await inspectDiscovery(db)).stats.total).toBe(discoveryDemandPolicy.maximumRows);
    expect(await recordDiscoveryForSearch(db, "arroz bulk 1", 0)).toBe(true);
    expect(
      (await inspectDiscovery(db)).queries.find((q) => q.normalizedQuery === "arroz bulk 1")
        ?.requestCount,
    ).toBe(2);
    expect(await recordDiscoveryForSearch(db, "new overflow query", 0)).toBe(false);
  });
});
