import type { Quantity } from "./catalog.ts";
import { offerFreshness } from "./listing-refresh.ts";
import { formatPen } from "./public-products.ts";

export type UnitPriceDimension = "mass" | "volume" | "count";
/** Exact rational cents per kg, litre or unit. Never sort rounded display values. */
export type UnitPrice = {
  numerator: bigint;
  denominator: bigint;
  dimension: UnitPriceDimension;
  displayUnit: "kg" | "l" | "unit";
};
export type UnitPriceInput = {
  currentPriceCents: number;
  pricingBasis: "kg" | "unit";
  totalQuantity: Quantity | null;
  issues: readonly string[];
  title: string;
  observedAt: Date;
  available?: boolean | null;
};
export type UnitPriceResult =
  | { price: UnitPrice; reason: null }
  | {
      price: null;
      reason:
        | "invalid-price"
        | "not-fresh"
        | "unavailable"
        | "ambiguous-quantity"
        | "missing-quantity"
        | "invalid-quantity";
    };
export function calculateUnitPrice(input: UnitPriceInput, now = new Date()): UnitPriceResult {
  const unavailable = (reason: Exclude<UnitPriceResult["reason"], null>): UnitPriceResult => ({
    price: null,
    reason,
  });
  if (!Number.isSafeInteger(input.currentPriceCents) || input.currentPriceCents < 0)
    return unavailable("invalid-price");
  if (input.available === false) return unavailable("unavailable");
  if (offerFreshness(input.observedAt, now) !== "fresh") return unavailable("not-fresh");
  // KG is the source quote, independent of approximate/variable package mass.
  if (input.pricingBasis === "kg")
    return {
      price: {
        numerator: BigInt(input.currentPriceCents),
        denominator: 1n,
        dimension: "mass",
        displayUnit: "kg",
      },
      reason: null,
    };
  // Unknown *pack words are unsafe even when the legacy normalizer defaulted to one.
  const packWords = input.title.toLowerCase().match(/\b[a-z]+pack\b/gu) ?? [];
  if (
    input.issues.length ||
    packWords.some((word) => !["tripack", "fourpack", "sixpack", "doypack"].includes(word))
  )
    return unavailable("ambiguous-quantity");
  const q = input.totalQuantity;
  if (!q) return unavailable("missing-quantity");
  if (!Number.isSafeInteger(q.value) || q.value <= 0 || !["g", "ml", "unit"].includes(q.unit))
    return unavailable("invalid-quantity");
  return {
    price: {
      numerator: BigInt(input.currentPriceCents) * (q.unit === "unit" ? 1n : 1000n),
      denominator: BigInt(q.value),
      dimension: q.unit === "g" ? "mass" : q.unit === "ml" ? "volume" : "count",
      displayUnit: q.unit === "g" ? "kg" : q.unit === "ml" ? "l" : "unit",
    },
    reason: null,
  };
}
export function compareUnitPrices(a: UnitPrice, b: UnitPrice): number {
  if (a.dimension !== b.dimension) throw new Error("Incompatible unit-price dimensions");
  const difference = a.numerator * b.denominator - b.numerator * a.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
export function formatUnitPrice(price: UnitPrice): string {
  const cents = (price.numerator * 2n + price.denominator) / (price.denominator * 2n);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Unit price exceeds display range");
  return `${formatPen(Number(cents))} / ${price.displayUnit === "l" ? "L" : price.displayUnit === "unit" ? "unidad" : "kg"}`;
}
export type GenericOfferSort = "relevance" | "total-price" | "unit-price";
export function genericOfferSort(value: unknown): GenericOfferSort {
  return value === "total-price" || value === "unit-price" ? value : "relevance";
}
