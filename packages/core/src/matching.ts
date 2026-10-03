import { z } from "zod";
import { retailerIdSchema } from "./listing.ts";
import { normalizeTitle } from "./catalog.ts";

export const matchingVersion = 1;
export const matchingThresholds = { auto: 0.9, review: 0.65 } as const;
const matchingQuantitySchema = z.object({
  value: z.number().int().positive(),
  unit: z.enum(["g", "ml", "unit"]),
});
export const matchingListingSchema = z.object({
  id: z.string().min(1),
  retailer: retailerIdSchema,
  title: z.string().min(1),
  attributes: z.object({
    normalizationVersion: z.number().int().positive(),
    normalizedTitle: z.string().min(1),
    brand: z.string().nullable(),
    brandKey: z.string().nullable(),
    brandSource: z.enum(["source", "title"]).nullable(),
    quantity: matchingQuantitySchema.nullable(),
    packageCount: z.number().int().positive().nullable(),
    totalQuantity: matchingQuantitySchema.nullable(),
    pricingBasis: z.enum(["kg", "unit"]),
    soldByWeight: z.boolean(),
    sourcePackageDescription: z.string().nullable(),
    issues: z.array(z.string()),
  }),
});
export type MatchingListing = z.infer<typeof matchingListingSchema>;
export type MatchDecision = "auto_match" | "review" | "incompatible" | "no_match";
export type MatchResult = {
  score: number;
  decision: MatchDecision;
  reasons: string[];
  similarity: number;
};

/** Packaging/measurement syntax only; identity words and unknown words survive. */
export function comparisonTitle(listing: MatchingListing): string {
  let title = normalizeTitle(listing.attributes.normalizedTitle)
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  const brand = listing.attributes.brandKey?.normalize("NFD").replace(/\p{M}/gu, "");
  if (brand)
    title = title.replace(
      new RegExp(
        `(?<![\\p{L}\\p{N}])${brand.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![\\p{L}\\p{N}])`,
        "gu",
      ),
      " ",
    );
  return title
    .replace(/\b(?:sin lactosa|deslactosada|zero lacto)\b/gu, "lactosafree")
    .replace(/\b(?:descremada|descremado)\b/gu, "descremad")
    .replace(/\bpack\s*(?:x\s*)?\d+\b/gu, " ")
    .replace(/\bx\s*\d+\b/gu, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|g|gr|ml|l|un|und|unidades)\b/gu, " ")
    .replace(
      /\b(?:tripack|fourpack|sixpack|pack|paquete|cajas|caja|bolsa|lata|botella|vaso|pote|barra|frasco|bandeja|empaque|galonera|x)\b/gu,
      " ",
    )
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}
function tokens(listing: MatchingListing): Set<string> {
  return new Set(comparisonTitle(listing).split(" ").filter(Boolean));
}
function family(listing: MatchingListing): string | undefined {
  return [...tokens(listing)].find((t) =>
    ["leche", "yogurt", "queso", "mantequilla", "huevos", "mezcla", "kefir"].includes(t),
  );
}
/** Indexed brand blocks, with family blocks for missing brands. Never Cartesian catalog pairs. */
export function generateCandidates(
  rows: readonly MatchingListing[],
): [MatchingListing, MatchingListing][] {
  const brands = new Map<string, MatchingListing[]>();
  const families = new Map<string, MatchingListing[]>();
  const pairs: [MatchingListing, MatchingListing][] = [];
  for (const row of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = row.attributes.brandKey;
    const f = family(row);
    const pool = new Map<string, MatchingListing>();
    for (const other of key ? (brands.get(key) ?? []) : []) pool.set(other.id, other);
    for (const other of f ? (families.get(f) ?? []) : [])
      if (!key || !other.attributes.brandKey) pool.set(other.id, other);
    for (const other of pool.values())
      if (other.retailer !== row.retailer) pairs.push([other, row]);
    if (key) brands.set(key, [...(brands.get(key) ?? []), row]);
    if (f) families.set(f, [...(families.get(f) ?? []), row]);
  }
  return pairs;
}
export function hardConflicts(a: MatchingListing, b: MatchingListing): string[] {
  const x = a.attributes,
    y = b.attributes;
  const reasons: string[] = [];
  if (a.retailer === b.retailer) reasons.push("same_retailer");
  if (x.brandKey && y.brandKey && x.brandKey !== y.brandKey) reasons.push("different_brand");
  if (x.pricingBasis !== y.pricingBasis) reasons.push("different_pricing_basis");
  if (x.quantity && y.quantity) {
    if (x.quantity.unit !== y.quantity.unit) reasons.push("different_dimension");
    else if (x.quantity.value !== y.quantity.value) reasons.push("different_quantity");
  }
  if (x.packageCount !== null && y.packageCount !== null && x.packageCount !== y.packageCount)
    reasons.push("different_package_count");
  if (
    x.totalQuantity &&
    y.totalQuantity &&
    (x.totalQuantity.unit !== y.totalQuantity.unit ||
      x.totalQuantity.value !== y.totalQuantity.value)
  )
    reasons.push("different_total_quantity");
  const tx = tokens(a),
    ty = tokens(b);
  const containers = (row: MatchingListing) =>
    normalizeTitle(row.title).match(/\b(?:bolsa|caja|lata|botella)\b/gu) ?? [];
  const ca = containers(a),
    cb = containers(b);
  if (ca.length === 1 && cb.length === 1 && ca[0] !== cb[0]) reasons.push("different_container");
  // Explicit modifiers are not stopwords. Absence can mean omitted metadata, so review
  // handles asymmetric tokens; explicit contradictory values are hard conflicts.
  for (const group of [
    ["entera", "light", "descremad"],
    ["fresa", "vainilla", "lucuma", "mango", "natural"],
    ["con sal", "sin sal"],
  ] as const) {
    const cx = group.filter((t) => comparisonTitle(a).includes(t)),
      cy = group.filter((t) => comparisonTitle(b).includes(t));
    if (cx.length && cy.length && cx.join("|") !== cy.join("|")) reasons.push("different_variant");
  }
  if (
    tx.has("natural") !== ty.has("natural") &&
    tx.has("rojos") !== ty.has("rojos") &&
    (tx.has("rojos") || ty.has("rojos"))
  )
    reasons.push("different_variant");
  return [...new Set(reasons)];
}
export function scoreMatch(
  a: MatchingListing,
  b: MatchingListing,
  similarity: number,
): MatchResult {
  if (!Number.isFinite(similarity) || similarity < 0 || similarity > 1)
    throw new Error("Invalid similarity");
  const conflicts = hardConflicts(a, b);
  if (conflicts.length)
    return { score: 0, decision: "incompatible", reasons: conflicts, similarity };
  const x = a.attributes,
    y = b.attributes;
  const reasons: string[] = [];
  let score = 0;
  const evidence: [boolean, number, string][] = [
    [!!x.brandKey && x.brandKey === y.brandKey, 0.2, "same_brand"],
    [!!x.quantity && !!y.quantity, 0.2, "same_quantity"],
    [x.packageCount !== null && y.packageCount !== null, 0.15, "same_package_count"],
    [!!x.totalQuantity && !!y.totalQuantity, 0.05, "same_total_quantity"],
  ];
  for (const [present, weight, reason] of evidence) {
    if (present) {
      score += weight;
      reasons.push(reason);
    } else reasons.push(`missing_${reason.slice(5)}`);
  }
  score = Math.round((score + 0.4 * similarity) * 10000) / 10000;
  reasons.push(`title_similarity:${similarity.toFixed(4)}`);
  const identityA = [...tokens(a)].sort().join(" "),
    identityB = [...tokens(b)].sort().join(" ");
  const sameIdentity = identityA.length > 0 && identityA === identityB;
  if (!sameIdentity) reasons.push("identity_tokens_differ");
  if (x.soldByWeight || y.soldByWeight) reasons.push("variable_weight");
  if (x.issues.length || y.issues.length) reasons.push("normalization_issues");
  const complete = evidence.every(([present]) => present);
  const safe =
    complete &&
    !x.soldByWeight &&
    !y.soldByWeight &&
    !x.issues.length &&
    !y.issues.length &&
    sameIdentity;
  return {
    score,
    similarity,
    reasons,
    decision:
      safe && score >= matchingThresholds.auto
        ? "auto_match"
        : score >= matchingThresholds.review
          ? "review"
          : "no_match",
  };
}

export type MatchPair = { a: string; b: string; result: MatchResult };
/** Complete-link clustering: every group pair must auto-match, and retailers stay unique. */
export function canonicalGroups(
  rows: readonly MatchingListing[],
  pairs: readonly MatchPair[],
): string[][] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const groups = rows.map((r) => [r.id]).sort((a, b) => a[0]!.localeCompare(b[0]!));
  const auto = new Set(
    pairs.filter((p) => p.result.decision === "auto_match").map((p) => [p.a, p.b].sort().join("|")),
  );
  for (const pair of [...pairs]
    .filter((p) => p.result.decision === "auto_match")
    .sort(
      (a, b) => b.result.score - a.result.score || a.a.localeCompare(b.a) || a.b.localeCompare(b.b),
    )) {
    const ga = groups.find((g) => g.includes(pair.a))!,
      gb = groups.find((g) => g.includes(pair.b))!;
    if (ga === gb) continue;
    const merged = [...ga, ...gb];
    if (new Set(merged.map((id) => byId.get(id)!.retailer)).size !== merged.length) continue;
    if (!ga.every((a) => gb.every((b) => auto.has([a, b].sort().join("|"))))) continue;
    ga.push(...gb);
    ga.sort();
    groups.splice(groups.indexOf(gb), 1);
  }
  return groups.filter((g) => g.length > 1);
}
