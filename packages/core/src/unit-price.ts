import { classifyProductFamily } from "./product-family.ts";
import type { ProductFamily } from "./product-family.ts";
import type { Quantity } from "./catalog.ts";
import { offerFreshness } from "./listing-refresh.ts";
import { formatPen } from "./public-products.ts";

export type UnitPriceDimension = "mass" | "volume" | "count";

/** Exact rational cents per kg, litre or unit. Never sort rounded display values. */
export const unitPriceBases = ["mass", "volume", "item-count", "roll"] as const;

export type UnitPriceBasis = (typeof unitPriceBases)[number];

export function unitPriceBasisLabel(basis: UnitPriceBasis | "unknown"): string {
  return {
    mass: "Precio por kg",
    volume: "Precio por litro",
    "item-count": "Precio por unidad",
    roll: "Precio por rollo · orientativo",
    unknown: "Otras opciones sin precio por unidad",
  }[basis];
}

export type UnitPrice = {
  basis: UnitPriceBasis;
  quality: "strong" | "approximate";
  numerator: bigint;
  denominator: bigint;
  dimension: UnitPriceDimension;
  displayUnit: "kg" | "l" | "unit" | "roll";
};

export type UnitPriceInput = {
  currentPriceCents: number;
  pricingBasis: "kg" | "unit";
  totalQuantity: Quantity | null;
  issues: readonly string[];
  title: string;
  sourcePackageDescription?: string | null;
  productFamily?: ProductFamily | null;
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
        | "ambiguous-semantics"
        | "conflicting-dimensions"
        | "missing-quantity"
        | "invalid-quantity";
    };

export function calculateUnitPrice(input: UnitPriceInput, now = new Date()): UnitPriceResult {
  const unavailable = (reason: Exclude<UnitPriceResult["reason"], null>): UnitPriceResult => ({
    price: null,
    reason,
  });

  if (!Number.isSafeInteger(input.currentPriceCents) || input.currentPriceCents < 0) {
    return unavailable("invalid-price");
  }

  if (input.available === false) return unavailable("unavailable");

  if (offerFreshness(input.observedAt, now) !== "fresh") return unavailable("not-fresh");

  const family = input.productFamily ?? classifyProductFamily({ title: input.title }).family;
  const text = `${input.title} ${input.sourcePackageDescription ?? ""}`
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

  // The audited sources do not establish consistent net/drained semantics.
  // Count-only cans also fail to establish comparable content.
  if (family === "canned_tuna" || /\batun\b/u.test(text)) return unavailable("ambiguous-semantics");

  if (/\b(?:escurrid[oa]|drenad[oa])\b/u.test(text)) return unavailable("ambiguous-semantics");

  if (
    input.issues.includes("ambiguous-quantity") &&
    /\d\s*(?:kg|g)\b/u.test(text) &&
    /\d\s*(?:ml|l)\b/u.test(text)
  ) {
    return unavailable("conflicting-dimensions");
  }

  // KG is the source quote, independent of approximate/variable package mass.
  if (input.pricingBasis === "kg") {
    return {
      price: {
        numerator: BigInt(input.currentPriceCents),
        denominator: 1n,
        dimension: "mass",
        basis: "mass",
        quality: "strong",
        displayUnit: "kg",
      },
      reason: null,
    };
  }

  // Observed retailer typo: 'Harina de Arroz Costeño 1 g'. Keep its
  // declared quantity for display; do not turn tiny staple packs into S/kg.
  if (
    input.totalQuantity?.unit === "g" &&
    input.totalQuantity.value < 10 &&
    input.productFamily &&
    ["rice", "sugar", "flour", "oats", "pasta"].includes(input.productFamily)
  ) {
    return unavailable("ambiguous-quantity");
  }

  // Unknown *pack words are unsafe even when the legacy normalizer defaulted to one.
  const packWords = input.title.toLowerCase().match(/\b[a-z]+pack\b/gu) ?? [];

  if (
    input.issues.length ||
    packWords.some((word) => !["tripack", "fourpack", "sixpack", "doypack"].includes(word))
  ) {
    return unavailable("ambiguous-quantity");
  }

  const q = input.totalQuantity;

  if (!q) return unavailable("missing-quantity");

  if (!Number.isSafeInteger(q.value) || q.value <= 0 || !["g", "ml", "unit"].includes(q.unit)) {
    return unavailable("invalid-quantity");
  }

  const paper = family === "toilet_paper";

  if (paper && q.unit !== "unit") return unavailable("ambiguous-semantics");

  if (family === "detergent" && q.unit === "unit" && !/\b(?:pods?|capsulas?)\b/u.test(text)) {
    return unavailable("ambiguous-semantics");
  }

  return {
    price: {
      numerator: BigInt(input.currentPriceCents) * (q.unit === "unit" ? 1n : 1000n),
      denominator: BigInt(q.value),
      ...unitPriceMetadata(q.unit, paper),
      quality: paper ? "approximate" : "strong",
    },
    reason: null,
  };
}

export function compareUnitPrices(a: UnitPrice, b: UnitPrice): number {
  if (a.dimension !== b.dimension || a.basis !== b.basis || a.quality !== b.quality) {
    throw new Error("Incompatible unit-price dimensions");
  }

  const difference = a.numerator * b.denominator - b.numerator * a.denominator;

  if (difference < 0n) {
    return -1;
  } else if (difference > 0n) {
    return 1;
  } else {
    return 0;
  }
}

export function formatUnitPrice(price: UnitPrice): string {
  const cents = (price.numerator * 2n + price.denominator) / (price.denominator * 2n);

  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Unit price exceeds display range");
  }

  return `${formatPen(Number(cents))} / ${unitDisplayLabels[price.displayUnit]}`;
}

export type GenericOfferSort = "relevance" | "total-price" | "unit-price";

export function genericOfferSort(value: unknown): GenericOfferSort {
  return value === "total-price" || value === "unit-price" ? value : "relevance";
}

const unitDisplayLabels: Record<UnitPrice["displayUnit"], string> = {
  l: "L",
  unit: "unidad",
  roll: "rollo",
  kg: "kg",
};

function unitPriceMetadata(
  unit: Quantity["unit"],
  paper: boolean,
): Pick<UnitPrice, "dimension" | "basis" | "displayUnit"> {
  if (unit === "g") return { dimension: "mass", basis: "mass", displayUnit: "kg" };

  if (unit === "ml") return { dimension: "volume", basis: "volume", displayUnit: "l" };

  return {
    dimension: "count",
    basis: paper ? "roll" : "item-count",
    displayUnit: paper ? "roll" : "unit",
  };
}
