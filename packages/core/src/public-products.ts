import { offerFreshness } from "./listing-refresh.ts";
import { normalizeTitle } from "./catalog.ts";

export const maximumSearchLength = 120;
/** Preserve all identity terms; separate attached units without synonym expansion. */
export function normalizeSearchQuery(value: string): string {
  return normalizeTitle(value)
    .replace(/(\d)(\p{L})/gu, "$1 $2")
    .replace(/(\p{L})(\d)/gu, "$1 $2")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}
export function usefulSearchQuery(value: string): boolean {
  const query = normalizeSearchQuery(value);
  return value.length <= maximumSearchLength && query.length >= 2;
}
export function formatPen(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("Invalid PEN cents");
  return `S/ ${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
export function meaningfulReferencePrice(current: number, regular: number | null): number | null {
  return regular !== null && regular > current ? regular : null;
}
export function cheapestOffers<
  T extends { currentPriceCents: number; observedAt?: Date; available?: boolean | null },
>(offers: readonly T[], now = new Date()): T[] {
  offers = offers.filter(
    (offer) =>
      offer.available !== false &&
      (!offer.observedAt || offerFreshness(offer.observedAt, now) === "fresh"),
  );
  if (!offers.length) return [];
  const lowest = Math.min(...offers.map((offer) => offer.currentPriceCents));
  return offers.filter((offer) => offer.currentPriceCents === lowest);
}
