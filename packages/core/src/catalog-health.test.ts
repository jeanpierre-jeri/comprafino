import { describe, expect, it } from "vitest";
import { evaluateCatalogHealth } from "./catalog-health.ts";
import type { CatalogHealthSnapshot } from "./catalog-health.ts";
import { catalogPolicy } from "./catalog-policy.ts";
import { retailerIdSchema } from "./listing.ts";

const now = new Date("2026-10-07T01:00:00Z");

function snapshot(): CatalogHealthSnapshot {
  return {
    retainedListings: retailerIdSchema.options.length * 10,
    skippedByCapacity: null,
    retailers: retailerIdSchema.options.map((retailer, index) => {
      const success = {
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        retailerId: retailer,
        startedAt: new Date(now.getTime() - 12 * 3_600_000),
        endedAt: new Date(now.getTime() - 11 * 3_600_000),
        status: "success" as const,
        listingsFetched: 10,
        listingsPersisted: 10,
        listingsChanged: 0,
      };
      return {
        retailer,
        known: 10,
        freshSearchableOffers: 5,
        latestAttempt: success,
        latestSuccess: success,
      };
    }),
  };
}

describe("catalog health monitoring", () => {
  it("warns for a marked useful partial run with fresh offers despite an old complete cycle", () => {
    const input = snapshot();
    const row = input.retailers[0]!;
    row.latestSuccess!.startedAt = new Date(now.getTime() - 40 * 3_600_000);
    row.latestAttempt = {
      ...row.latestSuccess!,
      startedAt: new Date(now.getTime() - 3600000),
      endedAt: now,
      status: "failed",
      failureKind: "partial_source",
    };
    expect(evaluateCatalogHealth(input, now)).toMatchObject({
      status: "warning",
      issues: [
        { severity: "warning", reason: "refresh_overdue" },
        { severity: "warning", reason: "latest_attempt_failed" },
      ],
    });
    expect(evaluateCatalogHealth(input, now).retailers[0]).toMatchObject({
      freshness: "stale",
      priceFreshness: "fresh_offers_present",
    });
  });

  it.each(["access_restricted", "persistence_failed", "capacity_skips"] as const)(
    "keeps %s fatal even with fresh offers and useful prior writes",
    (failureKind) => {
      const input = snapshot();
      input.retailers[0]!.latestAttempt = {
        ...input.retailers[0]!.latestSuccess!,
        status: "failed",
        failureKind,
      };
      expect(evaluateCatalogHealth(input, now)).toMatchObject({
        status: "attention",
        issues: [{ severity: "error", reason: "latest_attempt_failed" }],
      });
    },
  );

  it("does not downgrade a marked partial run without fresh offers", () => {
    const input = snapshot();
    input.retailers[0]!.latestAttempt = {
      ...input.retailers[0]!.latestSuccess!,
      status: "failed",
      failureKind: "partial_source",
    };
    input.retailers[0]!.freshSearchableOffers = 0;
    expect(evaluateCatalogHealth(input, now).status).toBe("attention");
  });
  it("keeps successful bounded catalogs healthy without inventing capacity measurements", () => {
    expect(evaluateCatalogHealth(snapshot(), now)).toMatchObject({
      readOnly: true,
      status: "healthy",
      skippedByCapacity: null,
      issues: [],
    });
  });

  it("uses the existing 30-hour delayed boundary before reporting overdue refreshes", () => {
    const input = snapshot();
    input.retailers[0]!.latestSuccess!.startedAt = new Date(now.getTime() - 30 * 3_600_000);
    expect(evaluateCatalogHealth(input, now).issues).toEqual([]);
    input.retailers[0]!.latestSuccess!.startedAt = new Date(now.getTime() - 30 * 3_600_000 - 1);
    expect(evaluateCatalogHealth(input, now).issues).toContainEqual({
      severity: "warning",
      reason: "refresh_overdue",
      retailer: "tottus",
    });
  });

  it("distinguishes recent failed attempts from the last successful refresh", () => {
    const input = snapshot();
    input.retailers[1]!.latestAttempt = {
      ...input.retailers[1]!.latestSuccess!,
      status: "failed",
      startedAt: now,
    };
    expect(evaluateCatalogHealth(input, now)).toMatchObject({
      status: "attention",
      issues: [{ reason: "latest_attempt_failed", retailer: "plaza-vea" }],
    });
  });

  it("does not let a successful run hide lost current offer coverage", () => {
    const input = snapshot();
    input.retailers[2]!.freshSearchableOffers = 0;
    expect(evaluateCatalogHealth(input, now).issues).toEqual([
      { severity: "error", reason: "no_fresh_searchable_offers", retailer: "metro" },
    ]);
  });

  it("reports never-observed sources and empty coverage", () => {
    const input = snapshot();
    input.retailers[0]!.latestAttempt = null;
    input.retailers[0]!.latestSuccess = null;
    input.retailers[0]!.freshSearchableOffers = 0;
    expect(evaluateCatalogHealth(input, now).issues.map((issue) => issue.reason)).toEqual([
      "refresh_overdue",
      "no_fresh_searchable_offers",
    ]);
  });

  it("warns at full capacity while separately alerting on observed skips and overflow", () => {
    const input = snapshot();
    input.retainedListings = catalogPolicy.retainedListingCap;
    input.retailers[0]!.known =
      catalogPolicy.retainedListingCap - (retailerIdSchema.options.length - 1) * 10;
    expect(evaluateCatalogHealth(input, now)).toMatchObject({
      status: "warning",
      issues: [{ severity: "warning", reason: "catalog_full" }],
    });
    input.skippedByCapacity = 3;
    expect(evaluateCatalogHealth(input, now)).toMatchObject({
      status: "attention",
      skippedByCapacity: 3,
    });
    input.retainedListings = catalogPolicy.overflowSentinel;
    input.retailers[0]!.known =
      catalogPolicy.overflowSentinel - (retailerIdSchema.options.length - 1) * 10;
    expect(evaluateCatalogHealth(input, now).issues).toContainEqual({
      severity: "error",
      reason: "catalog_overflow",
      retailer: null,
    });
  });

  it("rejects missing or duplicate retailers, mismatched owners and invalid counts", () => {
    const input = snapshot();
    expect(() =>
      evaluateCatalogHealth({ ...input, retailers: input.retailers.slice(1) }, now),
    ).toThrow(/.+/u);
    expect(() =>
      evaluateCatalogHealth(
        { ...input, retailers: [input.retailers[0], input.retailers[0], input.retailers[2]] },
        now,
      ),
    ).toThrow(/.+/u);
    expect(() => evaluateCatalogHealth({ ...input, retainedListings: 31 }, now)).toThrow(/.+/u);
    expect(() => evaluateCatalogHealth({ ...input, skippedByCapacity: -1 }, now)).toThrow(/.+/u);
    input.retailers[0]!.latestSuccess!.retailerId = "metro";
    expect(() => evaluateCatalogHealth(input, now)).toThrow(/.+/u);
  });

  it("rejects a future successful observation rather than reporting fabricated health", () => {
    const input = snapshot();
    input.retailers[0]!.latestSuccess!.startedAt = new Date(now.getTime() + 1);
    expect(() => evaluateCatalogHealth(input, now)).toThrow(/observation time/u);
  });
});
