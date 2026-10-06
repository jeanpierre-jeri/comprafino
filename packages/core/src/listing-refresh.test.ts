import { expect, it } from "vitest";
import {
  offerFreshness,
  selectListingRefresh,
  parseListingRefreshOptions,
} from "./listing-refresh.ts";
import type { KnownListing } from "./listing-refresh.ts";
import { cheapestOffers } from "./public-products.ts";

const now = new Date("2026-10-04T12:00:00Z");

const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

function row(index: number, hours: number, publicListing = false, discovery = false): KnownListing {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    retailer: "metro",
    externalId: String(index),
    productId: String(index),
    url: "https://www.metro.pe/product/p",
    observedAt: ago(hours),
    public: publicListing,
    firstSeenVia: discovery ? "discovery" : "unknown",
    lastCategoryObservedAt: null,
    lastTargetedAttemptAt: null,
  };
}

it("prioritizes public listings, then discovery, then other known listings by oldest observation", () => {
  const rows = [
    row(1, 200),
    row(2, 40, false, true),
    row(3, 30, true),
    row(4, 100, true),
    row(5, 48, false, true),
  ];
  expect(selectListingRefresh(rows, now, 100).map((r) => r.externalId)).toEqual([
    "4",
    "3",
    "5",
    "2",
    "1",
  ]);
  expect(rows.map((r) => r.externalId)).toEqual(["1", "2", "3", "4", "5"]);
});

it("enforces age, attempt cooldown and per-run bounds including exact boundaries", () => {
  const a = row(1, 24, true);
  const b = { ...row(2, 100, true), lastTargetedAttemptAt: ago(11) };
  const c = { ...row(3, 30, true), lastTargetedAttemptAt: ago(12) };
  expect(selectListingRefresh([row(4, 23), a, b, c], now, 1).map((r) => r.externalId)).toEqual([
    "3",
  ]);
  expect(selectListingRefresh([a, b, c], now, 100).map((r) => r.externalId)).toEqual(["3", "1"]);
  expect(() => selectListingRefresh([], now, 101)).toThrow(/./u);
});

it.each([
  [0, "fresh"],
  [36, "fresh"],
  [36.001, "stale"],
  [72, "stale"],
  [72.001, "too-stale"],
  [-1, "too-stale"],
] as const)("classifies %s observation hours as %s", (hours, expected) =>
  expect(offerFreshness(ago(hours), now)).toBe(expected),
);

it("stale, too stale and unavailable offers cannot win against current offers", () => {
  const offers = [
    { currentPriceCents: 1, observedAt: ago(73) },
    { currentPriceCents: 2, observedAt: ago(37) },
    { currentPriceCents: 3, observedAt: ago(1), available: false },
    { currentPriceCents: 100, observedAt: ago(2) },
  ];
  expect(cheapestOffers(offers, now)).toEqual([offers[3]]);
  expect(cheapestOffers(offers.slice(0, 3), now)).toEqual([]);
});

it("validates CLI bounds and explicit one-SKU scopes", () => {
  expect(
    parseListingRefreshOptions(["--", "--retailer=metro", "--external-id=428", "--dry-run"])
      .externalId,
  ).toBe("428");

  for (const args of [
    ["--limit=0"],
    ["--limit=101"],
    ["--external-id=1"],
    ["--retailer=other"],
    ["--dry-run", "--dry-run"],
    ["--force"],
    ["--limit=1.5"],
  ]) {
    expect(() => parseListingRefreshOptions(args)).toThrow(/./u);
  }
});

it("prioritizes exact, safe shopping candidates, discovery, useful staples and other rows deterministically", () => {
  const rows = [
    row(1, 100),
    { ...row(2, 80), usefulStaple: true },
    row(3, 70, false, true),
    { ...row(4, 50), shoppingRelevant: true },
    row(5, 30, true),
    { ...row(6, 90), shoppingRelevant: true },
    { ...row(7, 10), shoppingRelevant: true },
  ];
  const ids = ["5", "6", "4", "3", "2", "1"];
  expect(selectListingRefresh(rows, now, 100).map((r) => r.externalId)).toEqual(ids);
  expect(selectListingRefresh([...rows].reverse(), now, 100).map((r) => r.externalId)).toEqual(ids);
});

it("unknown stock remains eligible under freshness rules while explicit unavailability is excluded", () => {
  const unknown = { currentPriceCents: 1, observedAt: ago(1), available: null };
  const available = { currentPriceCents: 2, observedAt: ago(1), available: true };
  expect(cheapestOffers([unknown, available], now)).toEqual([unknown]);
  expect(cheapestOffers([{ ...unknown, available: false }, available], now)).toEqual([available]);
});

it("allows explicit unavailable recovery despite recent unknown category quotes, but respects fresh evidence and cooldown", () => {
  const negative = { ...row(1, 1, true), available: false, availabilityVerifiedAt: ago(25) };
  expect(selectListingRefresh([negative], now, 100)).toEqual([negative]);
  expect(
    selectListingRefresh([{ ...negative, availabilityVerifiedAt: ago(23) }], now, 100),
  ).toEqual([]);
  expect(selectListingRefresh([{ ...negative, lastTargetedAttemptAt: ago(11) }], now, 100)).toEqual(
    [],
  );
  expect(selectListingRefresh([{ ...negative, available: null }], now, 100)).toEqual([]);
});
