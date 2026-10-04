import { offerFreshness } from "./listing-refresh.ts";
import type { ConditionalOffer } from "./conditional-offer.ts";
export { conditionalOfferSchema } from "./conditional-offer.ts";
export type { ConditionalOffer } from "./conditional-offer.ts";
export type PriceMode = "standard" | "benefits";
export function priceMode(value: unknown): PriceMode {
  return value === "benefits" ? "benefits" : "standard";
}
export function currentConditionalOffers(offers: readonly ConditionalOffer[], now = new Date()) {
  return offers.filter(
    (offer) =>
      offerFreshness(offer.observedAt, now) === "fresh" &&
      (!offer.startsAt || offer.startsAt <= now) &&
      (!offer.endsAt || offer.endsAt > now),
  );
}
export function rankedPrice(
  currentPriceCents: number,
  offers: readonly ConditionalOffer[],
  mode: PriceMode = "standard",
  now = new Date(),
) {
  const best =
    mode === "benefits"
      ? currentConditionalOffers(offers, now)
          .filter((offer) => offer.priceCents < currentPriceCents)
          .sort(
            (a, b) => a.priceCents - b.priceCents || a.programKey.localeCompare(b.programKey),
          )[0]
      : undefined;
  return { priceCents: best?.priceCents ?? currentPriceCents, condition: best ?? null };
}
