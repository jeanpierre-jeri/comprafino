import { z } from "zod";
import { normalizeWhitespace } from "./listing.ts";

export const normalizationVersion = 1;
export const unitSchema = z.enum(["g", "kg", "ml", "l", "unit"]);
export type Unit = z.infer<typeof unitSchema>;
export type Quantity = { value: number; unit: "g" | "ml" | "unit" };
const sourceQuantitySchema = z.object({
  value: z.string().regex(/^\d+(?:[.,]\d{1,6})?$/u),
  unit: unitSchema,
});
export const catalogInputSchema = z.object({
  title: z.string().trim().min(1),
  priceUnit: z.enum(["KG", "UN"]),
  packageText: z.string().nullable().optional(),
  sourceBrand: z.string().nullable().optional(),
  // A sale-unit multiplier is retained for inspection, never assumed to be a pack count.
  sourceUnitMultiplier: z.number().positive().finite().nullable().optional(),
  // Only adapters with independently verified semantics may supply these hints.
  sourceQuantity: sourceQuantitySchema.optional(),
  sourcePackageCount: z.number().int().positive().max(2_147_483_647).optional(),
});
export type CatalogInput = z.infer<typeof catalogInputSchema>;
export type CatalogAttributes = {
  normalizationVersion: number;
  normalizedTitle: string;
  brand: string | null;
  brandKey: string | null;
  brandSource: "source" | "title" | null;
  quantity: Quantity | null;
  packageCount: number | null;
  totalQuantity: Quantity | null;
  pricingBasis: "kg" | "unit";
  soldByWeight: boolean;
  sourcePackageDescription: string | null;
  issues: string[];
};

/** Cosmetic normalization only; retain accents, numbers, decimals and apostrophes. */
export function normalizeTitle(value: string): string {
  return normalizeWhitespace(
    value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[’‘]/gu, "'")
      .replace(/[–—]/gu, "-")
      .replace(/[;|]/gu, " "),
  );
}
const brands = [
  "Gloria",
  "Laive",
  "Tottus",
  "Bell's",
  "Metro",
  "San Fernando",
  "Redondos",
  "Avinka",
  "Artisan",
  "La Calera",
  "Bonlé",
  "Cuisine & Co",
  "Vakimu",
  "Braedt",
  "Danlac",
  "Vigor",
  "Ideal",
  "Sbelt",
  "Milkito",
  "Suiza",
];
function titleBrands(title: string): string[] {
  return brands.filter((brand) => {
    const key = normalizeTitle(brand).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`(?<![\\p{L}\\d])${key}(?![\\p{L}\\d])`, "u").test(title);
  });
}
function displayBrand(raw: string): string {
  const key = normalizeTitle(raw);
  return (
    brands.find((brand) => normalizeTitle(brand) === key) ??
    normalizeWhitespace(raw.normalize("NFKC").replace(/[’‘]/gu, "'"))
      .toLowerCase()
      .replace(
        /(^|\s)(\p{L})/gu,
        (_, space: string, letter: string) => space + letter.toUpperCase(),
      )
  );
}
export function normalizeUnit(raw: string): Unit | null {
  const key = normalizeTitle(raw);
  if (["g", "gr", "grs", "gramo", "gramos"].includes(key)) return "g";
  if (["kg", "kilo", "kilos", "kilogramo", "kilogramos"].includes(key)) return "kg";
  if (["ml", "mililitro", "mililitros"].includes(key)) return "ml";
  if (["l", "lt", "lts", "litro", "litros"].includes(key)) return "l";
  if (["un", "und", "uds", "unidad", "unidades", "unit"].includes(key)) return "unit";
  return null;
}
/** Decimal arithmetic uses integers; sub-base-unit precision remains unknown. */
export function toBaseQuantity(value: string, unit: Unit): Quantity | null {
  if (!/^\d+(?:[.,]\d{1,6})?$/u.test(value)) return null;
  const [whole, fraction = ""] = value.replace(",", ".").split(".");
  const scale = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole!) * scale + BigInt(fraction || "0");
  const base = numerator * (unit === "kg" || unit === "l" ? 1000n : 1n);
  if (base % scale !== 0n || base <= 0n || base / scale > 2_147_483_647n) return null;
  return { value: Number(base / scale), unit: unit === "kg" ? "g" : unit === "l" ? "ml" : unit };
}
const unitPattern =
  "kilogramos?|kilos?|gramos?|mililitros?|litros?|unidades|unidad|unit|kg|grs?|ml|lts?|l|g|und|uds|un";
function quantities(text: string): Quantity[] {
  const pattern = new RegExp(
    `(?<![\\p{L}\\d.,-])(\\d+(?:[.,]\\d{1,6})?)\\s*(${unitPattern})(?![\\p{L}\\d])`,
    "gu",
  );
  return [...text.matchAll(pattern)].flatMap((match) => {
    const unit = normalizeUnit(match[2]!);
    const quantity = unit && toBaseQuantity(match[1]!, unit);
    return quantity ? [quantity] : [];
  });
}
function distinctQuantities(values: Quantity[]): Quantity[] {
  return [...new Map(values.map((value) => [`${value.unit}:${value.value}`, value])).values()];
}
function counts(text: string, hasMeasure: boolean): number[] {
  const values: number[] = [];
  for (const [word, count] of [
    ["tripack", 3],
    ["fourpack", 4],
    ["sixpack", 6],
  ] as const) {
    if (new RegExp(`\\b${word}\\b`, "u").test(text)) values.push(count);
  }
  const patterns = [
    /\b(?:pack|paquete)\s*(?:x\s*)?(\d+)\s*(?:cajas?|latas?|botellas?|bolsas?)(?!\p{L})/gu,
    /\bpack\s*x\s*(\d+)(?![\d.,])(?=\s|$)/gu,
    new RegExp(
      `(?<![\\d.,-])(\\d+)\\s*[x×]\\s*\\d+(?:[.,]\\d+)?\\s*(?:${unitPattern})(?![\\p{L}\\d])`,
      "gu",
    ),
  ];
  if (hasMeasure) {
    patterns.push(/(?<![\d.,-])(\d+)\s*(?:un|und|unidad|unidades)\b/gu);
    patterns.push(/\bx\s*(\d+)(?![\d.,])(?=\s*$)/gu);
  }
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const after = text.slice(match.index + match[0].length);
      // `pack x 500 g` is a mass, never five hundred packages.
      if (new RegExp(`^\\s*(?:${unitPattern})(?![\\p{L}\\d])`, "u").test(after)) continue;
      const value = Number(match[1]);
      if (Number.isInteger(value) && value > 0 && value <= 2_147_483_647) values.push(value);
    }
  }
  return [...new Set(values)];
}
export function normalizeCatalogListing(raw: CatalogInput): CatalogAttributes {
  const input = catalogInputSchema.parse(raw);
  const title = normalizeTitle(input.title);
  const packageText = input.packageText
    ? normalizeTitle(input.packageText).replace(/\b[\p{L}-]+\s*:/gu, "")
    : "";
  const issues: string[] = [];
  const foundBrands = titleBrands(title);
  const brand = input.sourceBrand?.trim()
    ? displayBrand(input.sourceBrand)
    : foundBrands.length === 1
      ? foundBrands[0]!
      : null;
  const soldByWeight = input.priceUnit === "KG";
  let quantity: Quantity | null = null;
  let packageCount: number | null = null;
  const combined = `${title} ${packageText}`;
  // A package described by its mass/volume is a single package; a bare pack remains uncertain.
  const packSignals = combined.replace(
    new RegExp(`\\bpaquete\\s+(?=\\d+(?:[.,]\\d+)?\\s*(?:${unitPattern})(?![\\p{L}\\d]))`, "gu"),
    "",
  );
  const mixedBundle = /\s\+\s/u.test(title);
  if (mixedBundle) issues.push("mixed-bundle");
  if (!soldByWeight && !mixedBundle) {
    const sourceValues = distinctQuantities(quantities(packageText));
    const titleValues = distinctQuantities(quantities(title));
    const sourceMass = sourceValues.filter((q) => q.unit !== "unit");
    const titleMass = titleValues.filter((q) => q.unit !== "unit");
    const approximate = /\b(?:aprox|aproximad[oa]s?)\b/u.test(combined);
    if (approximate) issues.push("approximate-quantity");
    const hint = input.sourceQuantity
      ? toBaseQuantity(input.sourceQuantity.value, input.sourceQuantity.unit)
      : null;
    const measures = sourceMass.length ? sourceMass : titleMass;
    if (hint) quantity = hint;
    else if (!approximate && measures.length === 1) quantity = measures[0]!;
    else if (measures.length > 1) issues.push("ambiguous-quantity");
    if (
      sourceMass.length === 1 &&
      titleMass.some((q) => q.unit !== sourceMass[0]!.unit || q.value !== sourceMass[0]!.value)
    )
      issues.push("source-title-quantity-conflict");
    const hasMeasure = measures.length > 0 || (hint !== null && hint.unit !== "unit");
    const sourceCounts = counts(packageText, hasMeasure);
    const titleCounts = counts(title, hasMeasure);
    const candidates = sourceCounts.length ? sourceCounts : titleCounts;
    if (input.sourcePackageCount) packageCount = input.sourcePackageCount;
    else if (candidates.length === 1) packageCount = candidates[0]!;
    else if (candidates.length > 1) issues.push("ambiguous-package-count");
    else if (!/\b(?:pack|paquete|tripack|fourpack|sixpack)\b|\bx\s*\d+\s*$/u.test(packSignals))
      packageCount = 1;
    if (sourceCounts.length === 1 && titleCounts.some((count) => count !== sourceCounts[0]))
      issues.push("source-title-count-conflict");
    if (!hasMeasure && !hint) {
      const countValues = sourceValues.length ? sourceValues : titleValues;
      if (!approximate && countValues.length === 1 && candidates.length === 0) {
        quantity = countValues[0]!;
        packageCount = 1;
      } else if (countValues.length > 0) issues.push("ambiguous-count-quantity");
    }
    if (
      !hasMeasure &&
      !hint &&
      candidates.length === 0 &&
      !quantity &&
      !input.sourcePackageCount &&
      !/\b(?:empaque|bandeja|caja|bolsa|lata|botella|unitario)\b/u.test(combined)
    )
      packageCount = null;
    // Unknown pack wording must not silently default to a single package.
    if (packageCount === null && !issues.includes("ambiguous-package-count"))
      issues.push("unknown-package-count");
  }
  const total = quantity && packageCount ? BigInt(quantity.value) * BigInt(packageCount) : null;
  const totalQuantity =
    total !== null && total <= 2_147_483_647n
      ? { value: Number(total), unit: quantity!.unit }
      : null;
  if (total !== null && total > 2_147_483_647n) issues.push("total-overflow");
  return {
    normalizationVersion,
    normalizedTitle: title,
    brand,
    brandKey: brand ? normalizeTitle(brand) : null,
    brandSource: brand ? (input.sourceBrand?.trim() ? "source" : "title") : null,
    quantity,
    packageCount,
    totalQuantity,
    pricingBasis: soldByWeight ? "kg" : "unit",
    soldByWeight,
    sourcePackageDescription: input.packageText ?? null,
    issues,
  };
}
