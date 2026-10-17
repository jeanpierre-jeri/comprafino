import { compareUnitPrices, unitPriceBases } from "./unit-price.ts";
import type { UnitPrice } from "./unit-price.ts";
import type { GenericOfferSort } from "./unit-price.ts";
import type { ConditionalOffer, rankedPrice } from "./conditional-pricing.ts";

export type RankableSearchResult = {
  pricingBasis: "kg" | "unit";
  ranking: ReturnType<typeof rankedPrice>;
  unitPrice: UnitPrice | null;
};

type ConfirmedSearchOffer = RankableSearchResult & {
  id: string;
  canonicalId: string | null;
  retailerId: string;
  title: string;
  currentPriceCents: number;
  conditionalOffers: readonly ConditionalOffer[];
};

/** The caller supplies the complete filtered, purchase-eligible snapshot and
 * canonical IDs admitted by the public identity boundary. Names never link SKUs.
 * Map insertion order retains the most relevant member as the group's relevance.
 * Unconfirmed listings remain independent, even with identical names/content. */
export function groupSearchOffers<T extends ConfirmedSearchOffer>(offers: readonly T[]) {
  const groups = new Map<string, T[]>();
  for (const offer of offers) {
    const key = offer.canonicalId ? `product:${offer.canonicalId}` : `listing:${offer.id}`;
    const members = groups.get(key);
    if (members) {
      members.push(offer);
    } else {
      groups.set(key, [offer]);
    }
  }

  return [...groups.values()].map((members) => {
    // Stable provenance for ties, independent of SQL/relevance order.
    const ordered = [...members].sort(
      (a, b) => a.retailerId.localeCompare(b.retailerId) || a.id.localeCompare(b.id),
    );
    const representative = [...ordered].sort(
      (a, b) => a.title.length - b.title.length || a.id.localeCompare(b.id),
    )[0]!;
    const ordinaryOffer = [...ordered].sort(
      (a, b) => a.currentPriceCents - b.currentPriceCents,
    )[0]!;
    const rankingOffer = [...ordered].sort(
      (a, b) => a.ranking.priceCents - b.ranking.priceCents,
    )[0]!;
    const benefits = ordered
      .flatMap((offer) =>
        offer.conditionalOffers
          .filter((benefit) => benefit.priceCents < offer.currentPriceCents)
          .map((benefit) => ({ offer, benefit })),
      )
      .sort((a, b) => a.benefit.priceCents - b.benefit.priceCents);
    return {
      lowestBenefit: benefits[0] ?? null,
      benefitTies: benefits.filter(
        (entry) => entry.benefit.priceCents === benefits[0]?.benefit.priceCents,
      ),
      id: representative.canonicalId ?? representative.id,
      canonicalId: representative.canonicalId,
      representative,
      offers: ordered,
      ordinaryOffer,
      rankingOffer,
      cheapestOffers: ordered.filter(
        (offer) => offer.currentPriceCents === ordinaryOffer.currentPriceCents,
      ),
      bestOffers: ordered.filter(
        (offer) => offer.ranking.priceCents === rankingOffer.ranking.priceCents,
      ),
      retailerCount: new Set(ordered.map((offer) => offer.retailerId)).size,
      pricingBasis: rankingOffer.pricingBasis,
      ranking: rankingOffer.ranking,
      unitPrice: rankingOffer.unitPrice,
    };
  });
}

export function sortGenericOffers<T extends RankableSearchResult>(
  offers: readonly T[],
  sort: GenericOfferSort,
) {
  // Input order is relevance; stable sorting retains it as the tie-breaker.
  return [...offers].sort((a, b) => {
    if (sort === "total-price") {
      // A KG quote is not a package total; keep direct quotes in a separate block.
      return (
        Number(a.pricingBasis === "kg") - Number(b.pricingBasis === "kg") ||
        a.ranking.priceCents - b.ranking.priceCents
      );
    }

    if (sort !== "unit-price") return 0;

    if (!a.unitPrice || !b.unitPrice) return Number(!a.unitPrice) - Number(!b.unitPrice);

    return (
      unitPriceBases.indexOf(a.unitPrice.basis) - unitPriceBases.indexOf(b.unitPrice.basis) ||
      compareUnitPrices(a.unitPrice, b.unitPrice)
    );
  });
}

/** Reserve room for every present dimension and unknown quantities before filling
 * spare capacity. The global bound must not hide all litres behind mass results. */
export function limitGenericOffers<T extends RankableSearchResult>(
  offers: readonly T[],
  sort: GenericOfferSort,
  page = 1,
): T[] {
  const sorted = sortGenericOffers(offers, sort);

  if (page > 1) {
    const first = new Set(limitGenericOffers(offers, sort));
    return sorted.filter((offer) => !first.has(offer)).slice((page - 2) * 30, (page - 1) * 30);
  }

  if (sort !== "unit-price" || sorted.length <= 30) return sorted.slice(0, 30);

  const groups = [...new Set(sorted.map((o) => o.unitPrice?.basis ?? "unknown"))];
  const quota = Math.floor(30 / groups.length);
  const selected = new Set<T>();

  for (const group of groups) {
    for (const offer of sorted
      .filter((o) => (o.unitPrice?.basis ?? "unknown") === group)
      .slice(0, quota)) {
      selected.add(offer);
    }
  }

  for (const offer of sorted) {
    if (selected.size >= 30) {
      break;
    }

    selected.add(offer);
  }

  return sorted.filter((o) => selected.has(o));
}
