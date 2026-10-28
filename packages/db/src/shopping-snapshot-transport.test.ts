import { expect, it } from "vitest";
import { shoppingSnapshotRow, shoppingSnapshotRows } from "./shopping-snapshot-transport.ts";

it.each([
  ["offer", 14],
  ["history", 4],
  ["weekday", 3],
] as const)("rejects incomplete, oversized and non-array %s transport", (kind, length) => {
  for (const raw of [
    null,
    {},
    [],
    Array.from({ length: length - 1 }, () => null),
    Array.from({ length: length + 1 }, () => null),
  ]) {
    expect(() => shoppingSnapshotRow(kind, raw)).toThrow(/array/u);
  }
});

it("preserves null evidence and invalid domain values for the existing validator", () => {
  const values = ["invalid-uuid", "invalid-date", null];
  expect(shoppingSnapshotRow("weekday", values)).toEqual({
    listingId: "invalid-uuid",
    date: "invalid-date",
    priceCents: null,
  });
  expect(values).toEqual(["invalid-uuid", "invalid-date", null]);
  expect(shoppingSnapshotRows("weekday", [])).toEqual([]);
  expect(() => shoppingSnapshotRows("weekday", null)).toThrow(/array/u);
});
