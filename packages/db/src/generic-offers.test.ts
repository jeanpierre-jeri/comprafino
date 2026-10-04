import { expect, it } from "vitest";
import {
  limitGenericOffers,
  genericProductOffer,
  sortGenericOffers,
  searchGenericProductOffers,
} from "./generic-offers.ts";
import { catalogFingerprint } from "./catalog.ts";
import { normalizationVersion } from "@comprafino/core";
import { createDatabase } from "./client.ts";
const now = new Date("2026-10-03T10:00:00Z");
const listing = {
  id: "00000000-0000-4000-8000-000000000001",
  retailerId: "metro",
  title: "Huevos Metro Bandeja 30un",
  priceUnit: "UN" as const,
  sourceBrand: "Metro",
};
const raw = {
  listing,
  retailerName: "Metro",
  url: "https://www.metro.pe/eggs/p",
  imageUrl: null,
  currentPriceCents: 1790,
  observedAt: now,
  available: true,
  fingerprint: catalogFingerprint(listing),
  version: normalizationVersion,
  canonicalId: null,
  retailerCount: 0,
};
it("includes single-store offers with explicit independent identity", () => {
  const offer = genericProductOffer(raw, now)!;
  expect(offer.canonicalId).toBeNull();
  expect(offer.totalQuantity).toEqual({ value: 30, unit: "unit" });
  expect(offer.unitPrice?.denominator).toBe(30n);
});
it("rejects stale normalization, unsafe sources, stale/unavailable prices and invalid boundary values", () => {
  for (const patch of [
    { fingerprint: "old" },
    { version: 0 },
    { url: "https://evil.test/p" },
    { available: false },
    { observedAt: new Date("2026-09-01") },
  ])
    expect(genericProductOffer({ ...raw, ...patch }, now)).toBeNull();
  expect(() => genericProductOffer({ ...raw, currentPriceCents: 0.5 }, now)).toThrow(
    /integer|Invalid input/u,
  );
});
it("retains unknown quantities and exact metadata without inventing unit prices", () => {
  const unknown = { ...listing, title: "Huevos premium bandeja" };
  expect(
    genericProductOffer(
      { ...raw, listing: unknown, fingerprint: catalogFingerprint(unknown) },
      now,
    ),
  ).toMatchObject({ unitPrice: null, unitPriceUnavailableReason: "missing-quantity" });
  expect(
    genericProductOffer({ ...raw, canonicalId: listing.id, retailerCount: 2 }, now)?.canonicalId,
  ).toBe(listing.id);
});
it("orders precise unit prices within dimensions, missing last, preserving relevance ties", () => {
  const a = genericProductOffer(raw, now)!;
  const b = genericProductOffer({ ...raw, currentPriceCents: 1800 }, now)!;
  const c = { ...a, unitPrice: null };
  const massListing = { ...listing, title: "Arroz Metro 1kg" };
  const mass = genericProductOffer(
    { ...raw, listing: massListing, fingerprint: catalogFingerprint(massListing) },
    now,
  )!;
  expect(sortGenericOffers([c, b, a, mass], "unit-price")).toEqual([mass, a, b, c]);
  expect(sortGenericOffers([b, a], "total-price")).toEqual([a, b]);
  expect(sortGenericOffers([b, a], "relevance")).toEqual([b, a]);
});
it("does not treat direct KG quotes as package totals", () => {
  const kgListing = { ...listing, title: "Arroz Metro por kg", priceUnit: "KG" as const };
  const kg = genericProductOffer(
    {
      ...raw,
      listing: kgListing,
      fingerprint: catalogFingerprint(kgListing),
      currentPriceCents: 1,
    },
    now,
  )!;
  const packageOffer = genericProductOffer(raw, now)!;
  expect(sortGenericOffers([kg, packageOffer], "total-price")).toEqual([packageOffer, kg]);
});
it("invalid searches return without a database call", async () => {
  const db = createDatabase({ DATABASE_URL: "postgresql://unused@localhost/unused" });
  expect(await searchGenericProductOffers(db, " ")).toEqual([]);
});

it("bounded unit mode reserves room for every dimension and retains unknown offers last", () => {
  const base = genericProductOffer(raw, now)!;
  const mass = {
    ...base,
    unitPrice: {
      numerator: 100n,
      denominator: 1n,
      dimension: "mass" as const,
      displayUnit: "kg" as const,
    },
  };
  const volume = {
    ...base,
    unitPrice: {
      numerator: 100n,
      denominator: 1n,
      dimension: "volume" as const,
      displayUnit: "l" as const,
    },
  };
  const unknown = { ...base, unitPrice: null };
  const results = limitGenericOffers(
    [...Array.from({ length: 40 }, () => ({ ...mass })), base, volume, unknown],
    "unit-price",
  );
  expect(results).toHaveLength(30);
  expect(results).toContain(base);
  expect(results).toContain(volume);
  expect(results.at(-1)).toBe(unknown);
});
