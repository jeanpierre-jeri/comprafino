import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { getCanonicalProductPriceHistory } from "./price-history.ts";

import { closeLocalTestConnections } from "./testing/test-query-client.ts";

import { persistMatching } from "./matching.ts";

import { createIngestionStore, persistListings } from "./ingestion.ts";

import { recordDiscoveryForSearch, inspectDiscovery } from "./discovery.ts";

import { knownListings, claimListingRefresh, finishListingRefresh } from "./listing-refresh.ts";
import { observationCoverageReport } from "./observation-coverage.ts";

import { catalogTestContext, observation } from "./testing/catalog-fixtures.ts";
const testUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!testUrl)("PostgreSQL history (explicit TEST_DATABASE_URL)", () => {
  // Keep deliberate contention inside each case; cases start with independent data.
  const harness = catalogTestContext({
    ...process.env,
    TEST_DATABASE_URL: testUrl ?? "postgresql://unused@localhost/comprafino_test",
  });
  const { db, query, states, seedMatch, coverageDays } = harness;
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
  it("queries range-clipped ordinary history for multiple verified retailers, excluding CMR and unlinked rows", async () => {
    const { rows, pairs } = await seedMatch("history-query");
    await persistMatching(db, rows, pairs);
    const links = z
      .array(z.object({ canonical_product_id: z.uuid() }))
      .parse(
        await query(
          "select canonical_product_id from canonical_product_listings where listing_id=$1",
          [rows[0]!.id],
        ),
      );
    const id = links[0]!.canonical_product_id;
    const base = {
      ...observation("history-query-metro", 0, 1290),
      retailer: "metro" as const,
      title: "Leche Gloria Entera Caja 946ml",
      sourceBrand: "Gloria",
    };
    await persistListings(db, "metro", [
      {
        ...base,
        currentPriceCents: 1190,
        observedAt: new Date("2026-10-13T09:00:00Z"),
        conditionalOffers: [
          {
            programKey: "cmr",
            conditionType: "payment_card",
            conditionLabel: "Requiere tarjeta CMR",
            priceCents: 900,
            observedAt: new Date("2026-10-13T09:00:00Z"),
          },
        ],
      },
    ]);
    await persistListings(db, "metro", [
      {
        ...base,
        currentPriceCents: 1190,
        observedAt: new Date("2026-10-14T09:00:00Z"),
        conditionalOffers: [
          {
            programKey: "cmr",
            conditionType: "payment_card",
            conditionLabel: "Requiere tarjeta CMR",
            priceCents: 900,
            observedAt: new Date("2026-10-14T09:00:00Z"),
          },
        ],
      },
    ]);
    await persistListings(db, "metro", [
      { ...base, externalId: "history-unmatched", currentPriceCents: 1 },
    ]);
    const history = await getCanonicalProductPriceHistory(db, id, {
      range: "7d",
      now: new Date("2026-10-15T09:00:00Z"),
    });
    expect(history?.retailers).toHaveLength(2);
    const metro = history!.retailers.find((r) => r.retailerId === "metro")!;
    expect(metro.summary).toMatchObject({
      currentPriceCents: 1190,
      minimumPriceCents: 1190,
      maximumPriceCents: 1290,
      changeCount: 1,
      differenceCents: -100,
      lastChange: { fromCents: 1290, toCents: 1190 },
    });
    expect(metro.states).toHaveLength(2);
    expect(
      await query("select price_cents from retailer_listing_offers where listing_id=$1", [
        rows.find((r) => r.retailer === "metro")!.id,
      ]),
    ).toEqual([{ price_cents: 900 }]);
    expect(metro.states.map((state) => state.priceCents)).not.toContain(900);
    expect(metro.states[0]?.validFrom).toEqual(base.observedAt);
    expect(metro.states[1]?.validUntil).toBeNull();
    expect(metro.summary.points.map((p) => p.priceCents)).toEqual([1190, 1190]);
    expect(history!.retailers.find((r) => r.retailerId === "plaza-vea")?.summary.status).toBe(
      "empty",
    );
    const narrow = await getCanonicalProductPriceHistory(db, id, {
      range: "7d",
      now: new Date("2026-10-20T09:00:00Z"),
    });
    expect(narrow!.retailers.find((r) => r.retailerId === "metro")?.states).toHaveLength(1);
    expect(
      narrow!.retailers.find((r) => r.retailerId === "metro")?.summary.lastChange,
    ).toMatchObject({ fromCents: 1290, toCents: 1190 });
    expect(await getCanonicalProductPriceHistory(db, "malformed")).toBeNull();
    expect(await getCanonicalProductPriceHistory(db, randomUUID())).toBeNull();
    await query("update canonical_product_listings set confidence=0.85 where listing_id=$1", [
      rows[0]!.id,
    ]);
    expect(await getCanonicalProductPriceHistory(db, id)).toBeNull();
    await query(
      "update canonical_product_listings set method='manual',confidence=1 where listing_id=$1",
      [rows[0]!.id],
    );
    expect(await getCanonicalProductPriceHistory(db, id)).toBeNull();
  }, 30000);

  it("persists current benefits idempotently, updates/removes them and never changes ordinary history for benefits", async () => {
    const base = observation("conditional-state", 0, 1090);
    const cmr = {
      conditionType: "payment_card" as const,
      programKey: "cmr" as const,
      conditionLabel: "Requiere tarjeta CMR" as const,
      priceCents: 990,
      observedAt: base.observedAt,
    };
    const first = { ...base, conditionalOffers: [cmr] };
    await persistListings(db, "tottus", [first]);
    const before = await states(base.externalId);
    const read = () =>
      query(
        "select o.*,o.xmin::text as revision from retailer_listing_offers o join retailer_listings l on l.id=o.listing_id where l.external_id=$1",
        [base.externalId],
      );
    const initial = await read();
    expect(initial).toHaveLength(1);
    expect(initial[0]).toMatchObject({ price_cents: 990, program_key: "cmr" });
    await persistListings(db, "tottus", [{ ...first, observedAt: observation("x", 1).observedAt }]);
    expect(await read()).toEqual(initial);
    expect(await states(base.externalId)).toEqual(before);
    const changed = {
      ...first,
      observedAt: observation("x", 2).observedAt,
      conditionalOffers: [{ ...cmr, priceCents: 890 }],
    };
    await persistListings(db, "tottus", [changed]);
    expect((await read())[0]).toMatchObject({ price_cents: 890 });
    await persistListings(db, "tottus", [first]);
    await persistListings(db, "tottus", [{ ...changed, conditionalOffers: [] }]);
    expect((await read())[0]).toMatchObject({ price_cents: 890 });
    await persistListings(db, "tottus", [
      { ...first, observedAt: observation("x", 3).observedAt, conditionalOffers: [] },
    ]);
    expect(await read()).toEqual([]);
    expect(await states(base.externalId)).toEqual(before);
  }, 30000);

  it("daily coverage shares category, discovery and targeted persistence with no replay duplication", async () => {
    await recordDiscoveryForSearch(db, "observation rollup fixture", 0);
    const demand = (await inspectDiscovery(db)).queries.find(
      (q) => q.normalizedQuery === "observation rollup fixture",
    )!;
    const value = observation("coverage-rollup", 0);
    await persistListings(db, "tottus", [value], { source: "discovery", queryId: demand.id });
    await persistListings(db, "tottus", [observation(value.externalId, 1)], { source: "category" });
    await persistListings(db, "tottus", [observation(value.externalId, 2)], { source: "targeted" });
    expect(await coverageDays(value.externalId)).toMatchObject([
      {
        observation_date: "2026-10-03",
        first_observed_at: value.observedAt,
        last_observed_at: observation(value.externalId, 2).observedAt,
        observation_count: 3,
      },
    ]);
    await persistListings(db, "tottus", [value]);
    await persistListings(db, "tottus", [observation(value.externalId, 2)]);
    expect((await coverageDays(value.externalId))[0]!.observation_count).toBe(3);
    expect(await states(value.externalId)).toHaveLength(1);
    await persistListings(db, "tottus", [
      { ...value, currentPriceCents: 1090, observedAt: new Date("2026-10-04T04:59:59Z") },
    ]);
    expect(await states(value.externalId)).toHaveLength(2);
    expect((await coverageDays(value.externalId))[0]!.observation_count).toBe(4);
    await persistListings(db, "tottus", [
      { ...value, currentPriceCents: 1090, observedAt: new Date("2026-10-04T05:00:00Z") },
    ]);
    expect((await coverageDays(value.externalId)).map((d) => d.observation_date)).toEqual([
      "2026-10-03",
      "2026-10-04",
    ]);
  }, 30000);
  it("serializes concurrent daily observations and enforces listing/day uniqueness", async () => {
    const value = observation("coverage-concurrent", 0);
    await Promise.all([
      persistListings(db, "tottus", [value]),
      persistListings(db, "tottus", [value]),
    ]);
    expect((await coverageDays(value.externalId))[0]!.observation_count).toBe(1);
    const results = await Promise.all(
      [1, 2, 3].map((n) => persistListings(db, "tottus", [observation(value.externalId, n)])),
    );
    const days = await coverageDays(value.externalId);
    expect(days).toHaveLength(1);
    expect(days[0]!.observation_count).toBe(1 + results.reduce((sum, r) => sum + r.persisted, 0));
    expect(days[0]!.first_observed_at).toEqual(value.observedAt);
    expect(days[0]!.last_observed_at).toEqual(observation(value.externalId, 3).observedAt);
    await expect(
      query("insert into listing_observation_days select * from listing_observation_days limit 1"),
    ).rejects.toMatchObject({ code: "23505" });
  }, 30000);
  it("failed, missing, unavailable and malformed observations do not manufacture coverage", async () => {
    const store = createIngestionStore(db);
    const value = observation("coverage-failure", 0);
    await store.persist("tottus", [value]);
    const before = await coverageDays(value.externalId);
    const run = await store.start("tottus");
    await store.finish(run, { status: "failed", fetched: 0, persisted: 0, changed: 0 });
    const row = (await knownListings(db)).find((r) => r.externalId === value.externalId)!;
    const at = observation("x", 1).observedAt;
    await claimListingRefresh(db, row, at);
    await finishListingRefresh(db, row, at, "unavailable");
    await finishListingRefresh(db, row, at, "not-found");
    expect(await coverageDays(value.externalId)).toEqual(before);
    await expect(
      persistListings(db, "tottus", [{ ...value, currentPriceCents: -1 }]),
    ).rejects.toThrow(/Too small/u);
    expect(await coverageDays(value.externalId)).toEqual(before);
    await expect(
      persistListings(db, "tottus", [observation("coverage-zero", 0, 0)]),
    ).rejects.toThrow("Ordinary payable price must be positive");
    await persistListings(db, "tottus", [
      { ...observation("coverage-unavailable", 0), available: false },
    ]);
    expect(await coverageDays("coverage-zero")).toEqual([]);
    expect(await coverageDays("coverage-unavailable")).toEqual([]);
  }, 30000);
  it("history range joins daily evidence without multiplying states and breaks a genuine fixture gap", async () => {
    const { rows, pairs } = await seedMatch("coverage-public");
    await persistMatching(db, rows, pairs);
    const links = z
      .array(z.object({ canonical_product_id: z.uuid() }))
      .parse(
        await query(
          "select canonical_product_id from canonical_product_listings where listing_id=$1",
          [rows[0]!.id],
        ),
      );
    const id = links[0]!.canonical_product_id;
    const value = {
      ...observation("coverage-public-metro", 0),
      retailer: "metro" as const,
      title: "Leche Gloria Entera Caja 946ml",
      sourceBrand: "Gloria",
    };
    for (const day of [4, 6, 7])
      await persistListings(db, "metro", [
        { ...value, observedAt: new Date(Date.UTC(2026, 9, day, 9)) },
      ]);
    const history = await getCanonicalProductPriceHistory(db, id, {
      range: "7d",
      now: new Date("2026-10-07T23:00:00Z"),
    });
    const metro = history!.retailers.find((r) => r.retailerId === "metro")!;
    expect(metro.states).toHaveLength(1);
    expect(metro.coverage.map((d) => d.observationDate)).toEqual([
      "2026-10-03",
      "2026-10-04",
      "2026-10-06",
      "2026-10-07",
    ]);
    expect(metro.summary.segments).toHaveLength(2);
    expect(metro.summary.verifiedUnchangedDays).toBe(2);
    const report = await observationCoverageReport(db, new Date("2026-10-07T23:00:00Z"));
    expect(report.recentPublicGaps).toContainEqual({
      retailer: "metro",
      externalId: value.externalId,
      day: "2026-10-05",
    });
    expect(report.publicObservedToday).toBeGreaterThan(0);
    const later = await getCanonicalProductPriceHistory(db, id, {
      range: "7d",
      now: new Date("2026-10-15T23:00:00Z"),
    });
    expect(later!.retailers.find((r) => r.retailerId === "metro")!.coverage).toEqual([]);
  }, 30000);
});
