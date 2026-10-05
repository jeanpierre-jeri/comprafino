import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { closeLocalTestConnections } from "./testing/test-query-client.ts";

import { createIngestionStore, persistListings } from "./ingestion.ts";
import { inspectOperations } from "./operations.ts";
import { recordDiscoveryForSearch, inspectDiscovery } from "./discovery.ts";

import { knownListings, claimListingRefresh, finishListingRefresh } from "./listing-refresh.ts";

import { catalogTestContext, observation } from "./testing/catalog-fixtures.ts";
const testUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!testUrl)("PostgreSQL ingestion (explicit TEST_DATABASE_URL)", () => {
  // Keep deliberate contention inside each case; cases start with independent data.
  const harness = catalogTestContext({
    ...process.env,
    TEST_DATABASE_URL: testUrl ?? "postgresql://unused@localhost/comprafino_test",
  });
  const { db, query, states, coverageDays } = harness;
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
  it("distinguishes latest attempt from success and preserves last-good price on failure", async () => {
    const store = createIngestionStore(db);
    const first = await store.start("metro");
    const listing = { ...observation("operations-last-good", 0), retailer: "metro" as const };
    await store.persist("metro", [listing]);
    await store.finish(first, { status: "success", fetched: 1, persisted: 1, changed: 1 });
    const before = await states(listing.externalId);
    const failed = await store.start("metro");
    // Explicit times make ordering deterministic, independent of DB clock resolution.
    await query("update ingestion_runs set started_at=$1 where id=$2", [
      "2026-10-03T10:00:00Z",
      first,
    ]);
    await query("update ingestion_runs set started_at=$1 where id=$2", [
      "2026-10-03T11:00:00Z",
      failed,
    ]);
    await store.finish(failed, {
      status: "failed",
      fetched: 0,
      persisted: 0,
      changed: 0,
      error: "postgres://secret@internal/db",
    });
    const operations = await inspectOperations(db, new Date("2026-10-04T11:00:00Z"));
    const metro = operations.find((r) => r.retailer === "metro");
    expect(metro).toMatchObject({
      latestAttempt: { id: failed, status: "failed" },
      latestSuccess: { id: first, status: "success" },
      freshness: "delayed",
      ageHours: 25,
    });
    expect(JSON.stringify(operations)).not.toContain("secret");
    expect(await states(listing.externalId)).toEqual(before);
    const persisted = z
      .array(z.object({ current_price_cents: z.number().int(), last_seen_at: z.coerce.date() }))
      .parse(
        await query(
          "select current_price_cents,last_seen_at from retailer_listings where external_id=$1",
          [listing.externalId],
        ),
      );
    expect(persisted).toEqual([{ current_price_cents: 1290, last_seen_at: listing.observedAt }]);
  }, 30_000);

  it("keeps unchanged observations idempotent and closes/opens a changed price", async () => {
    const initial = observation("transition", 0);
    expect(await persistListings(db, "tottus", [initial])).toEqual({ persisted: 1, changed: 1 });
    expect(await states(initial.externalId)).toEqual([
      {
        current_price_cents: 1290,
        regular_price_cents: 1490,
        valid_from: initial.observedAt,
        valid_until: null,
      },
    ]);
    expect(await persistListings(db, "tottus", [observation("transition", 1)])).toEqual({
      persisted: 1,
      changed: 0,
    });
    expect(await states("transition")).toHaveLength(1);
    const changed = observation("transition", 2, 1090);
    expect(await persistListings(db, "tottus", [changed])).toEqual({ persisted: 1, changed: 1 });
    const history = await states("transition");
    expect(history).toEqual([
      {
        current_price_cents: 1290,
        regular_price_cents: 1490,
        valid_from: initial.observedAt,
        valid_until: changed.observedAt,
      },
      {
        current_price_cents: 1090,
        regular_price_cents: 1490,
        valid_from: changed.observedAt,
        valid_until: null,
      },
    ]);
    expect(history.filter((state) => state.valid_until === null)).toHaveLength(1);
    for (const minute of [0, 2]) {
      expect(await persistListings(db, "tottus", [observation("transition", minute, 990)])).toEqual(
        { persisted: 0, changed: 0 },
      );
    }
    expect(await states("transition")).toEqual(history);
  }, 30_000);

  it("rolls back listing changes and closed history when the final insert fails", async () => {
    await persistListings(db, "tottus", [observation("rollback", 0)]);
    const beforeListings = await query("select * from retailer_listings where external_id = $1", [
      "rollback",
    ]);
    const beforeHistory = await states("rollback");
    const beforeCoverage = await coverageDays("rollback");
    // Force a real constraint failure only in this isolated schema, after the
    // upsert and history-close statements have executed. No production hooks.
    await query(
      "alter table price_history add constraint test_reject_changed_price check (current_price_cents <> 990)",
    );
    try {
      await expect(
        persistListings(db, "tottus", [
          observation("rollback", 1, 990),
          observation("rollback-new", 1),
        ]),
      ).rejects.toMatchObject({ code: "23514", constraint: "test_reject_changed_price" });
      expect(
        await query("select * from retailer_listings where external_id = $1", ["rollback"]),
      ).toEqual(beforeListings);
      expect(await states("rollback")).toEqual(beforeHistory);
      expect(await coverageDays("rollback")).toEqual(beforeCoverage);
      expect(
        await query("select id from retailer_listings where external_id = $1", ["rollback-new"]),
      ).toEqual([]);
    } finally {
      await query("alter table price_history drop constraint test_reject_changed_price");
    }
  }, 30_000);

  it("serializes concurrent writers without duplicate listings or broken transitions", async () => {
    const initial = observation("concurrent", 0);
    const duplicates = await Promise.all([
      persistListings(db, "tottus", [initial]),
      persistListings(db, "tottus", [initial]),
    ]);
    expect(duplicates.reduce((sum, result) => sum + result.changed, 0)).toBe(1);
    expect(await states("concurrent")).toHaveLength(1);
    const attempts = await Promise.all([
      persistListings(db, "tottus", [observation("concurrent", 1, 1190)]),
      persistListings(db, "tottus", [observation("concurrent", 2, 1090)]),
    ]);
    const history = await states("concurrent");
    // Either intermediate observation can acquire the lock first. The newest
    // observation must win in both orders, with strictly contiguous intervals.
    expect(history).toHaveLength(1 + attempts.reduce((sum, result) => sum + result.changed, 0));
    expect(history.filter((state) => state.valid_until === null)).toHaveLength(1);
    expect(history.at(-1)).toMatchObject({ current_price_cents: 1090, valid_until: null });
    for (let index = 0; index < history.length - 1; index++) {
      expect(history[index]?.valid_until).toEqual(history[index + 1]?.valid_from);
      expect(history[index]!.valid_until!.getTime()).toBeGreaterThan(
        history[index]!.valid_from.getTime(),
      );
    }
    expect(
      await query(
        "select current_price_cents, last_seen_at from retailer_listings where external_id = $1",
        ["concurrent"],
      ),
    ).toHaveLength(1);
    const current = z
      .array(z.object({ current_price_cents: z.number(), last_seen_at: z.coerce.date() }))
      .parse(
        await query(
          "select current_price_cents, last_seen_at from retailer_listings where external_id = $1",
          ["concurrent"],
        ),
      );
    expect(current).toEqual([
      { current_price_cents: 1090, last_seen_at: observation("concurrent", 2).observedAt },
    ]);
  }, 30_000);

  it("preserves first acquisition identity and records category coverage without price-state duplication", async () => {
    await recordDiscoveryForSearch(db, "refresh controlled demand", 0);
    const demand = (await inspectDiscovery(db)).queries.find(
      (q) => q.normalizedQuery === "refresh controlled demand",
    )!;
    const value = { ...observation("70000001", 0), productId: "70000001" };
    await persistListings(db, "tottus", [value], { source: "discovery", queryId: demand.id });
    await persistListings(
      db,
      "tottus",
      [{ ...value, observedAt: observation("unused", 1).observedAt }],
      { source: "category" },
    );
    const listing = (await knownListings(db)).find((row) => row.externalId === value.externalId)!;
    expect(listing.firstSeenVia).toBe("discovery");
    expect(listing.lastCategoryObservedAt).toEqual(observation("unused", 1).observedAt);
    expect(await states(value.externalId)).toHaveLength(1);
    expect(
      (
        await query("select discovery_query_id from retailer_listings where id=$1", [listing.id])
      )[0],
    ).toMatchObject({ discovery_query_id: demand.id });
  }, 30000);
  it("targeted unchanged observations write zero states; a changed price opens exactly one", async () => {
    const value = { ...observation("70000002", 0), productId: "70000002" };
    await persistListings(db, "tottus", [value]);
    expect(
      await persistListings(
        db,
        "tottus",
        [{ ...value, observedAt: observation("unused", 1).observedAt }],
        { source: "targeted" },
      ),
    ).toMatchObject({ changed: 0 });
    expect(
      await persistListings(
        db,
        "tottus",
        [{ ...value, currentPriceCents: 990, observedAt: observation("unused", 2).observedAt }],
        { source: "targeted" },
      ),
    ).toMatchObject({ changed: 1 });
    expect(await states(value.externalId)).toHaveLength(2);
    expect(
      (await knownListings(db)).find((row) => row.externalId === value.externalId)!
        .lastCategoryObservedAt,
    ).toEqual(value.observedAt);
  }, 30000);
  it("serializes targeted admission and preserves history/freshness on unavailable or missing observations", async () => {
    const value = { ...observation("70000003", 0), productId: "70000003" };
    await persistListings(db, "tottus", [value]);
    const row = (await knownListings(db)).find((r) => r.externalId === value.externalId)!;
    const at = observation("unused", 3).observedAt;
    const claimed = await Promise.all([
      claimListingRefresh(db, row, at),
      claimListingRefresh(db, row, at),
    ]);
    expect(claimed.filter(Boolean)).toHaveLength(1);
    await finishListingRefresh(db, row, at, "unavailable");
    expect(
      (
        await query(
          "select available,last_seen_at,targeted_status from retailer_listings where id=$1",
          [row.id],
        )
      )[0],
    ).toMatchObject({ available: false, targeted_status: "unavailable" });
    expect((await knownListings(db)).find((r) => r.id === row.id)!.observedAt).toEqual(
      value.observedAt,
    );
    expect(await states(value.externalId)).toHaveLength(1);
    const current = (await knownListings(db)).find((r) => r.id === row.id)!;
    const next = observation("unused", 4).observedAt;
    expect(await claimListingRefresh(db, current, next)).toBe(true);
    await persistListings(
      db,
      "tottus",
      [{ ...value, available: true, observedAt: observation("unused", 5).observedAt }],
      { source: "targeted" },
    );
    await finishListingRefresh(db, current, next, "unavailable");
    // A newer successful observation supersedes the older negative result.
    expect(
      (await query("select available from retailer_listings where id=$1", [row.id]))[0],
    ).toMatchObject({ available: true });
    expect(await states(value.externalId)).toHaveLength(1);
    const before = await states(value.externalId);
    await finishListingRefresh(db, current, next, "not-found");
    expect(await states(value.externalId)).toEqual(before);
  }, 30000);
});
