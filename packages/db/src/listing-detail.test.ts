import { expect, it } from "vitest";
import { normalizationVersion } from "@comprafino/core";
import { catalogFingerprint } from "./catalog.ts";
import { createDatabase } from "./client.ts";
import { getPublicRetailerListingDetail, publicRetailerListing } from "./listing-detail.ts";

const now = new Date("2026-10-04T12:00:00Z");

const listing = {
  id: "69c3625d-2d3e-8624-b483-2323e108f94b",
  retailerId: "tottus",
  title: "Leche Gloria Entera 946ml",
  sourceBrand: "Gloria",
  priceUnit: "UN" as const,
};

const raw = {
  listing,
  retailerName: "Tottus",
  url: "https://www.tottus.com.pe/tottus-pe/articulo/1/test",
  imageUrl: null,
  sourceCategory: null,
  observedAt: now,
  available: true,
  active: true,
  open: true,
  currentPriceCents: 650,
  regularPriceCents: 700,
  fingerprint: catalogFingerprint(listing),
  version: normalizationVersion,
  canonicalId: null,
  conditionalOffers: [
    {
      conditionType: "payment_card",
      programKey: "cmr",
      conditionLabel: "Requiere tarjeta CMR",
      priceCents: 540,
      observedAt: now,
    },
  ],
};

it("exposes an unmatched ordinary price, reference and supported unit price with separate CMR", () => {
  const detail = publicRetailerListing(raw, now);
  expect(detail).toMatchObject({
    canonicalId: null,
    current: true,
    currentPriceCents: 650,
    regularPriceCents: 700,
    conditionalOffers: [{ priceCents: 540 }],
    unitPrice: { displayUnit: "l" },
  });
  expect(detail).not.toHaveProperty("fingerprint");
  expect(detail).not.toHaveProperty("version");
});

it("preserves only the association admitted by the query boundary", () => {
  expect(publicRetailerListing({ ...raw, canonicalId: listing.id }, now)?.canonicalId).toBe(
    listing.id,
  );
});

it.each(["stale", "closed", "unavailable"])(
  "withholds buying benefits and unit price for %s records",
  (kind) => {
    const detail = publicRetailerListing(
      {
        ...raw,
        ...listingOverrides(kind, now),
      },
      now,
    );
    expect(detail).toMatchObject({ current: false, conditionalOffers: [], unitPrice: null });
  },
);

it("withholds unsafe tuna quantity and reference prices that are not greater", () => {
  const tuna = { ...listing, title: "Atún Florida Trozos en Agua 170g" };
  expect(
    publicRetailerListing(
      { ...raw, listing: tuna, fingerprint: catalogFingerprint(tuna), regularPriceCents: 650 },
      now,
    ),
  ).toMatchObject({ unitPrice: null, regularPriceCents: null });
});

it.each([
  { active: false },
  { url: "https://evil.test/p" },
  { version: 0 },
  { fingerprint: "obsolete" },
])("rejects nonpublic metadata %j", (change) => {
  expect(publicRetailerListing({ ...raw, ...change }, now)).toBeNull();
});

it("malformed IDs do not access PostgreSQL", async () => {
  const db = createDatabase({ DATABASE_URL: "postgresql://unused@localhost/unused" });
  expect(await getPublicRetailerListingDetail(db, "not-a-uuid")).toBeNull();
  expect(publicRetailerListing(null, now)).toBeNull();
});

it("closed states retain actual observation time instead of a state interval endpoint", () => {
  const observedAt = new Date(now.getTime() - 48 * 3600000);
  const detail = publicRetailerListing(
    { ...raw, open: false, observedAt, priceObservedAt: now },
    now,
  );
  expect(detail).toMatchObject({
    observedAt,
    freshness: "stale",
    current: false,
    historicalOnly: true,
  });
  expect(detail).not.toHaveProperty("priceObservedAt");
});

it("old open states use the established historical freshness boundary", () => {
  const observedAt = new Date(now.getTime() - 80 * 3600000);
  expect(publicRetailerListing({ ...raw, observedAt }, now)).toMatchObject({
    observedAt,
    freshness: "too-stale",
    historicalOnly: true,
    current: false,
    conditionalOffers: [],
    unitPrice: null,
    unitPriceUnavailableReason: "not-fresh",
  });
});

function listingOverrides(kind: string, observedNow: Date) {
  if (kind === "stale") return { observedAt: new Date(observedNow.getTime() - 40 * 3600000) };

  if (kind === "closed") return { open: false };

  return { available: false };
}
