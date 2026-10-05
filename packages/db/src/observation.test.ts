import { expect, it } from "vitest";
import { applyObservation } from "./observation.ts";
import type { ListingObservation } from "./observation.ts";
import type { NormalizedRetailerListing } from "@comprafino/core";
const listing: NormalizedRetailerListing = {
  retailer: "tottus",
  externalId: "sku1",
  productId: "product1",
  title: "Sample",
  url: "https://www.tottus.com.pe/tottus-pe/articulo/product1/sample",
  currentPriceCents: 1290,
  currency: "PEN",
  priceUnit: "UN",
  observedAt: new Date("2026-10-03T09:00:00Z"),
};
it("keeps one listing and one history state across unchanged observations", () => {
  const rows = new Map<string, ListingObservation>();
  for (const hour of [9, 12, 18]) {
    const next = {
      ...listing,
      observedAt: new Date(`2026-10-03T${String(hour).padStart(2, "0")}:00:00Z`),
    };
    rows.set(next.externalId, applyObservation(rows.get(next.externalId), next));
  }
  expect(rows.size).toBe(1);
  const result = rows.get("sku1")!;
  expect(result.history).toHaveLength(1);
  expect(result.history[0]?.validUntil).toBeUndefined();
  expect(result.firstSeenAt).toEqual(listing.observedAt);
  expect(result.listing.observedAt.getUTCHours()).toBe(18);
});
it("closes changed prices, ignores stale/replayed observations and permits a return to an old price", () => {
  const first = applyObservation(undefined, listing);
  const at = new Date("2026-10-05T09:00:00Z");
  const second = applyObservation(first, { ...listing, currentPriceCents: 1090, observedAt: at });
  expect(second.history).toHaveLength(2);
  expect(second.history[0]?.validUntil).toEqual(at);
  expect(second.history[1]?.validFrom).toEqual(at);
  expect(applyObservation(second, listing)).toBe(second);
  expect(applyObservation(second, { ...listing, observedAt: at })).toBe(second);
  const third = applyObservation(second, {
    ...listing,
    observedAt: new Date("2026-10-06T09:00:00Z"),
  });
  expect(third.history).toHaveLength(3);
  expect(third.history.filter((state) => !state.validUntil)).toHaveLength(1);
  expect(first.history[0]?.validUntil).toBeUndefined();
});
it("treats reference price and price-unit changes as meaningful states", () => {
  const first = applyObservation(undefined, listing);
  const second = applyObservation(first, {
    ...listing,
    regularPriceCents: 1490,
    observedAt: new Date("2026-10-04T09:00:00Z"),
  });
  const third = applyObservation(second, {
    ...listing,
    regularPriceCents: 1490,
    priceUnit: "KG",
    observedAt: new Date("2026-10-05T09:00:00Z"),
  });
  expect(third.history).toHaveLength(3);
});
it("preserves prospective daily coverage independently of ordinary and reference state changes", () => {
  const first = applyObservation(undefined, listing);
  const second = applyObservation(first, {
    ...listing,
    observedAt: new Date("2026-10-03T18:00:00Z"),
  });
  const changed = applyObservation(second, {
    ...listing,
    currentPriceCents: 1090,
    observedAt: new Date("2026-10-03T23:00:00Z"),
  });
  expect(changed.history).toHaveLength(2);
  expect(changed.coverageDays).toEqual([
    {
      observationDate: "2026-10-03",
      firstObservedAt: listing.observedAt,
      lastObservedAt: changed.listing.observedAt,
      observationCount: 3,
    },
  ]);
  expect(applyObservation(changed, listing)).toBe(changed);
  const next = applyObservation(changed, {
    ...listing,
    observedAt: new Date("2026-10-04T05:00:00Z"),
  });
  expect(next.coverageDays).toHaveLength(2);
});
it("does not count unusable or explicitly unavailable price observations", () => {
  for (const value of [
    { ...listing, currentPriceCents: 0 },
    { ...listing, available: false },
  ])
    expect(applyObservation(undefined, value).coverageDays).toEqual([]);
});
