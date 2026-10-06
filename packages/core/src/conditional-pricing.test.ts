import { expect, it } from "vitest";
import {
  conditionalOfferSchema,
  currentConditionalOffers,
  rankedPrice,
} from "./conditional-pricing.ts";

const now = new Date("2026-10-04T12:00:00Z");

const offer = conditionalOfferSchema.parse({
  conditionType: "payment_card",
  programKey: "cmr",
  conditionLabel: "Requiere tarjeta CMR",
  priceCents: 990,
  observedAt: now,
});

it("keeps ordinary prices by default and returns the required program in benefits mode", () => {
  expect(rankedPrice(1090, [offer], "standard", now)).toEqual({
    priceCents: 1090,
    condition: null,
  });
  expect(rankedPrice(1090, [offer], "benefits", now)).toEqual({
    priceCents: 990,
    condition: offer,
  });
  expect(rankedPrice(990, [offer], "benefits", now)).toEqual({ priceCents: 990, condition: null });
});

it("rejects missing conditions and unknown program identity", () => {
  expect(conditionalOfferSchema.safeParse({ ...offer, conditionLabel: undefined }).success).toBe(
    false,
  );
  expect(conditionalOfferSchema.safeParse({ ...offer, programKey: "card" }).success).toBe(false);
});

it("excludes stale, future, expired and not-yet-started conditional offers", () => {
  for (const patch of [
    { observedAt: new Date(now.getTime() - 36 * 3600000 - 1) },
    { observedAt: new Date(now.getTime() + 1) },
    { endsAt: now },
    { startsAt: new Date(now.getTime() + 1) },
  ]) {
    expect(currentConditionalOffers([{ ...offer, ...patch }], now)).toEqual([]);
    expect(rankedPrice(1090, [{ ...offer, ...patch }], "benefits", now).priceCents).toBe(1090);
  }

  expect(
    currentConditionalOffers(
      [{ ...offer, observedAt: new Date(now.getTime() - 36 * 3600000) }],
      now,
    ),
  ).toHaveLength(1);
});
