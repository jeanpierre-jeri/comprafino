import { priceStateChanged } from "@comprafino/core";
import type { NormalizedRetailerListing, PriceState } from "@comprafino/core";
export type HistoricalState = PriceState & { validFrom: Date; validUntil?: Date };
export type ListingObservation = {
  listing: NormalizedRetailerListing;
  firstSeenAt: Date;
  history: HistoricalState[];
};
/** Reference model for the SQL transition contract, independent of PostgreSQL/network. */
export function applyObservation(
  previous: ListingObservation | undefined,
  next: NormalizedRetailerListing,
): ListingObservation {
  if (previous && next.observedAt <= previous.listing.observedAt) return previous;
  const history = previous?.history.map((state) => ({ ...state })) ?? [];
  const current = history.find((state) => !state.validUntil);
  if (priceStateChanged(current, next)) {
    if (current) current.validUntil = next.observedAt;
    history.push({
      currentPriceCents: next.currentPriceCents,
      regularPriceCents: next.regularPriceCents,
      currency: next.currency,
      priceUnit: next.priceUnit,
      validFrom: next.observedAt,
    });
  }
  return { listing: next, firstSeenAt: previous?.firstSeenAt ?? next.observedAt, history };
}
