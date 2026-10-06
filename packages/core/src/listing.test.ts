import { describe, expect, it } from "vitest";
import { listingSchema, normalizeWhitespace, parsePenCents, priceStateChanged } from "./listing.ts";

describe("exact PEN cents", () => {
  it.each([
    ["S/ 10", 1000],
    ["S/ 10.90", 1090],
    ["0.29", 29],
    ["12.9", 1290],
    [10.9, 1090],
    ["21474836.47", 2147483647],
  ])("parses %s", (value, expected) => {
    expect(parsePenCents(value)).toBe(expected);
  });
  it.each(["-1", "1.001", "1,90", "1e3", "", "NaN", "21474836.48"])("rejects %s", (value) => {
    expect(() => parsePenCents(value)).toThrow(/Invalid PEN|exceeds database/u);
  });
});

it("normalizes whitespace without guessing package quantities", () => {
  expect(normalizeWhitespace("  Pack\n 3  Cajas\u00a0 946 mL ")).toBe("Pack 3 Cajas 946 mL");
});

it("compares regular prices, units and missing reference prices", () => {
  const state = { currentPriceCents: 1290, currency: "PEN", priceUnit: "UN" } as const;
  expect(priceStateChanged(undefined, state)).toBe(true);
  expect(priceStateChanged(state, { ...state, regularPriceCents: null })).toBe(false);
  expect(priceStateChanged(state, { ...state, regularPriceCents: 1490 })).toBe(true);
  expect(priceStateChanged(state, { ...state, priceUnit: "KG" })).toBe(true);
  expect(priceStateChanged(state, { ...state, currentPriceCents: 1090 })).toBe(true);
});

it("rejects invalid normalized boundary values", () => {
  expect(listingSchema.safeParse({}).success).toBe(false);
});
