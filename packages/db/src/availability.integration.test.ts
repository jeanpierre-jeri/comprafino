import { getPublicRetailerListingDetail } from "./listing-detail.ts";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { closeLocalTestConnections } from "./testing/test-query-client.ts";

import { persistListings } from "./ingestion.ts";

import { knownListings, claimListingRefresh, finishListingRefresh } from "./listing-refresh.ts";

import { searchGenericProductOffers } from "./generic-offers.ts";
import { catalogTestContext, observation, publicNow } from "./testing/catalog-fixtures.ts";
const testUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!testUrl)("PostgreSQL availability (explicit TEST_DATABASE_URL)", () => {
  // Keep deliberate contention inside each case; cases start with independent data.
  const harness = catalogTestContext({
    ...process.env,
    TEST_DATABASE_URL: testUrl ?? "postgresql://unused@localhost/comprafino_test",
  });
  const { db, query, states, seedGeneric, coverageDays } = harness;
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
  it("persists explicit availability independently of price coverage, unknown quotes, failures and recovery", async () => {
    const row = await seedGeneric("Arroz Availabilityfixture 1kg", 500);
    const externalId = (await knownListings(db)).find((r) => r.id === row.id)!.externalId;
    const value = { ...observation(externalId, 1, 500), title: row.title, available: true };
    await persistListings(db, "tottus", [value], { source: "targeted" });
    const read = async () =>
      z
        .object({
          available: z.boolean().nullable(),
          availability_verified_at: z.coerce.date().nullable(),
          exact_missing_count: z.number(),
          last_exact_missing_at: z.coerce.date().nullable(),
        })
        .parse(
          (
            await query(
              "select available,availability_verified_at,exact_missing_count,last_exact_missing_at from retailer_listings where id=$1",
              [row.id],
            )
          )[0],
        );
    expect(await read()).toMatchObject({
      available: true,
      availability_verified_at: value.observedAt,
    });
    const history = await states(externalId);
    const coverage = await coverageDays(externalId);
    const known = (await knownListings(db)).find((r) => r.id === row.id)!;
    const unavailableAt = observation("unused", 2).observedAt;
    expect(await claimListingRefresh(db, known, unavailableAt)).toBe(true);
    await finishListingRefresh(db, known, unavailableAt, "unavailable");
    expect(await read()).toMatchObject({
      available: false,
      availability_verified_at: unavailableAt,
    });
    expect(await states(externalId)).toEqual(history);
    expect(await coverageDays(externalId)).toEqual(coverage);
    expect(
      await searchGenericProductOffers(db, "arroz availabilityfixture", "relevance", publicNow),
    ).toEqual([]);
    const detail = await getPublicRetailerListingDetail(db, row.id, { now: publicNow });
    expect(detail).toMatchObject({ available: false, current: false });
    expect(detail?.history).not.toBeNull();
    // A quote arriving out of order cannot undo a newer exact negative.
    await persistListings(db, "tottus", [
      { ...value, observedAt: new Date(value.observedAt.getTime() + 30000) },
    ]);
    expect(await read()).toMatchObject({
      available: false,
      availability_verified_at: unavailableAt,
    });
    expect(await coverageDays(externalId)).toEqual(coverage);
    // A successfully parsed price with unknown stock cannot erase explicit evidence.
    await persistListings(db, "tottus", [
      { ...value, available: undefined, observedAt: observation("unused", 3).observedAt },
    ]);
    expect(await read()).toMatchObject({
      available: false,
      availability_verified_at: unavailableAt,
    });
    expect(await coverageDays(externalId)).toEqual(coverage);
    const current = (await knownListings(db)).find((r) => r.id === row.id)!;
    const failedAt = observation("unused", 4).observedAt;
    await claimListingRefresh(db, current, failedAt);
    await finishListingRefresh(db, current, failedAt, "failed");
    expect(await read()).toMatchObject({
      available: false,
      availability_verified_at: unavailableAt,
    });
    const recovered = { ...value, observedAt: observation("unused", 5).observedAt };
    await persistListings(db, "tottus", [recovered], { source: "targeted" });
    expect(await read()).toMatchObject({
      available: true,
      availability_verified_at: recovered.observedAt,
      exact_missing_count: 0,
    });
    expect(await states(externalId)).toEqual(history);
    expect((await coverageDays(externalId))[0]!.observation_count).toBe(
      coverage[0]!.observation_count + 1,
    );
    expect(
      (
        await searchGenericProductOffers(db, "arroz availabilityfixture", "relevance", publicNow)
      ).map((o) => o.id),
    ).toEqual([row.id]);
  }, 30000);

  it("counts repeated exact absence without inferring stock, rejects replay and ignores category omission", async () => {
    const row = await seedGeneric("Arroz Missingfixture 1kg", 500);
    const externalId = (await knownListings(db)).find((r) => r.id === row.id)!.externalId;
    const history = await states(externalId);
    const coverage = await coverageDays(externalId);
    for (const minute of [1, 2]) {
      const known = (await knownListings(db)).find((r) => r.id === row.id)!;
      const at = observation("unused", minute).observedAt;
      expect(await claimListingRefresh(db, known, at)).toBe(true);
      await finishListingRefresh(db, known, at, "not-found");
      await finishListingRefresh(db, known, at, "not-found");
    }
    expect(
      (
        await query(
          "select available,exact_missing_count,last_exact_missing_at from retailer_listings where id=$1",
          [row.id],
        )
      )[0],
    ).toMatchObject({
      available: null,
      exact_missing_count: 2,
    });
    await persistListings(db, "tottus", [observation("unrelated-category-observation", 3)]);
    expect(
      (
        await query("select available,exact_missing_count from retailer_listings where id=$1", [
          row.id,
        ])
      )[0],
    ).toMatchObject({ available: null, exact_missing_count: 2 });
    expect(await states(externalId)).toEqual(history);
    expect(await coverageDays(externalId)).toEqual(coverage);
    expect(
      (await searchGenericProductOffers(db, "arroz missingfixture", "relevance", publicNow)).map(
        (o) => o.id,
      ),
    ).toEqual([row.id]);
    await persistListings(db, "tottus", [
      { ...observation(externalId, 4, 500), title: row.title, available: true },
    ]);
    expect(
      (
        await query(
          "select available,exact_missing_count,last_exact_missing_at from retailer_listings where id=$1",
          [row.id],
        )
      )[0],
    ).toMatchObject({ available: true, exact_missing_count: 0, last_exact_missing_at: null });
  }, 30000);
});
