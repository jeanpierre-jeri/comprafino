import { expect, it } from "vitest";
import {
  limitGenericOffers,
  filterGenericOffers,
  genericProductOffer,
  sortGenericOffers,
  searchGenericProductOffers,
} from "./generic-offers.ts";
import { catalogFingerprint } from "./catalog.ts";
import { searchFilters } from "@comprafino/core";
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
  ]) {
    expect(genericProductOffer({ ...raw, ...patch }, now)).toBeNull();
  }

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
      basis: "mass" as const,
      quality: "strong" as const,
      displayUnit: "kg" as const,
    },
  };
  const volume = {
    ...base,
    unitPrice: {
      numerator: 100n,
      denominator: 1n,
      dimension: "volume" as const,
      basis: "volume" as const,
      quality: "strong" as const,
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

it("sorts approximate rolls separately from physical item counts, reserving both blocks", () => {
  const egg = genericProductOffer(raw, now)!;
  const paperListing = { ...listing, title: "Papel Higiénico Elite 65m 12un" };
  const paper = genericProductOffer(
    {
      ...raw,
      listing: paperListing,
      fingerprint: catalogFingerprint(paperListing),
      currentPriceCents: 1,
    },
    now,
  )!;
  expect(paper.unitPrice).toMatchObject({ basis: "roll", quality: "approximate" });
  expect(sortGenericOffers([paper, egg], "unit-price")).toEqual([egg, paper]);
  const many = Array.from({ length: 40 }, (_, i) => ({ ...egg, id: String(i) }));
  expect(limitGenericOffers([...many, paper], "unit-price")).toContain(paper);
});

it("benefits ranking and unit prices retain the ordinary quote and required card", () => {
  const conditionalOffers = [
    {
      conditionType: "payment_card",
      programKey: "cmr",
      conditionLabel: "Requiere tarjeta CMR",
      priceCents: 1490,
      observedAt: now,
    },
  ];
  const standard = genericProductOffer({ ...raw, conditionalOffers }, now)!;
  const benefits = genericProductOffer({ ...raw, conditionalOffers }, now, "benefits")!;
  expect(standard.ranking.priceCents).toBe(1790);
  expect(benefits.currentPriceCents).toBe(1790);
  expect(benefits.ranking.condition?.programKey).toBe("cmr");
  expect(benefits.unitPrice?.numerator).toBe(1490n);
  expect(sortGenericOffers([standard, benefits], "total-price")[0]).toBe(benefits);
});

it("unit and retailer filters never mix mass, litres, physical items or approximate rolls", () => {
  const base = genericProductOffer(raw, now)!;
  const variants = [
    { ...base, retailerId: "tottus" as const },
    ...(["mass", "volume", "roll"] as const).map((basis) => ({
      ...base,
      unitPrice: {
        ...base.unitPrice!,
        basis,
        quality: basis === "roll" ? ("approximate" as const) : ("strong" as const),
        displayUnit: displayUnitForBasis(basis),
      },
    })),
  ];

  for (const unit of ["kg", "L", "unit", "roll"]) {
    const result = filterGenericOffers(variants, searchFilters({ unit }));
    expect(result).toHaveLength(1);
    expect(result[0]?.unitPrice?.displayUnit).toBe(unit === "L" ? "l" : unit);
  }

  expect(filterGenericOffers(variants, searchFilters({ retailer: "tottus" }))).toEqual([
    variants[0],
  ]);
  expect(filterGenericOffers(variants, searchFilters({ retailer: "plaza-vea" }))).toEqual([]);
});

it("withholds zero ordinary offers from generic ranking in both modes", () => {
  for (const mode of ["standard", "benefits"] as const) {
    expect(genericProductOffer({ ...raw, currentPriceCents: 0 }, now, mode)).toBeNull();
  }
});

function displayUnitForBasis(basis: string): "kg" | "l" | "roll" {
  if (basis === "mass") return "kg";

  if (basis === "volume") return "l";

  return "roll";
}
