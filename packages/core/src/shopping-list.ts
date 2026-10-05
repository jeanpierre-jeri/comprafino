import { z } from "zod";
import { normalizeSearchQuery } from "./public-products.ts";
import { classifyProductFamily, resolveProductFamilyQuery } from "./product-family.ts";
import { offerFreshness } from "./listing-refresh.ts";
import { conditionalOfferSchema, rankedPrice } from "./conditional-pricing.ts";
import type { PriceMode } from "./conditional-pricing.ts";

export const shoppingIntentLabels = {
  generic: "Cualquier opción que convenga",
  preferred: "Prefiero este producto",
  strict: "Solo quiero este producto",
} as const;
export const shoppingFrequencyLabels = {
  weekly: "Cada semana",
  biweekly: "Cada 2 semanas",
  monthly: "Cada mes",
} as const;
export const shoppingQuantitySchema = z
  .object({
    amount: z
      .number()
      .positive()
      .max(10000)
      .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 0.000001, "Usa hasta 3 decimales"),
    unit: z.enum(["unit", "kg", "L"]),
  })
  .refine((q) => q.unit !== "unit" || Number.isInteger(q.amount), "Las unidades deben ser enteras");
const common = {
  id: z.uuid(),
  label: z.string().trim().min(2).max(120),
  query: z.string().trim().min(2).max(120),
  quantity: shoppingQuantitySchema,
  frequency: z.enum(["weekly", "biweekly", "monthly"]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};
export const shoppingListItemSchema = z.discriminatedUnion("intent", [
  z.object({ ...common, intent: z.literal("generic"), canonicalId: z.null() }),
  z.object({ ...common, intent: z.literal("preferred"), canonicalId: z.uuid() }),
  z.object({ ...common, intent: z.literal("strict"), canonicalId: z.uuid() }),
]);
export type ShoppingListItem = z.infer<typeof shoppingListItemSchema>;
export const shoppingListSchema = z
  .object({ version: z.literal(1), items: z.array(shoppingListItemSchema).max(50) })
  .refine(
    (list) => new Set(list.items.map((i) => i.id)).size === list.items.length,
    "Duplicate IDs",
  )
  .refine(
    (list) => new Set(list.items.map(shoppingItemKey)).size === list.items.length,
    "Duplicate needs",
  );
export type ShoppingList = z.infer<typeof shoppingListSchema>;
export function emptyShoppingList(): ShoppingList {
  return { version: 1, items: [] };
}
export function parseShoppingList(raw: string | null): { list: ShoppingList; invalid: boolean } {
  if (raw === null) return { list: emptyShoppingList(), invalid: false };
  try {
    const parsed = shoppingListSchema.safeParse(JSON.parse(raw) as unknown);
    if (parsed.success) return { list: parsed.data, invalid: false };
  } catch {
    /* Invalid storage is recoverable. */
  }
  return { list: emptyShoppingList(), invalid: true };
}
export function serializeShoppingList(list: ShoppingList): string {
  return JSON.stringify(shoppingListSchema.parse(list));
}
export function shoppingItemKey(item: ShoppingListItem): string {
  // Frequency/amount are editable metadata; adding again updates the existing need.
  return `${item.intent}:${item.intent === "generic" ? shoppingGenericNeedKey(item.query, item.quantity.unit) : item.canonicalId}:${item.quantity.unit}`;
}
export function saveShoppingItem(list: ShoppingList, raw: ShoppingListItem): ShoppingList {
  const item = shoppingListItemSchema.parse(raw);
  const existing =
    list.items.find((i) => i.id === item.id) ??
    list.items.find((i) => shoppingItemKey(i) === shoppingItemKey(item));
  const duplicate = list.items.find(
    (i) => i.id !== existing?.id && shoppingItemKey(i) === shoppingItemKey(item),
  );
  if (duplicate) throw new Error("Ya tienes esta necesidad en tu lista. Edita la existente.");
  if (!existing && list.items.length >= 50)
    throw new Error("Tu lista admite hasta 50 necesidades.");
  const saved = existing ? { ...item, id: existing.id, createdAt: existing.createdAt } : item;
  return shoppingListSchema.parse({
    version: 1,
    items: existing
      ? list.items.map((i) => (i.id === existing.id ? saved : i))
      : [...list.items, saved],
  });
}
export function removeShoppingItem(list: ShoppingList, id: string): ShoppingList {
  return { version: 1, items: list.items.filter((i) => i.id !== id) };
}

/** Reuse catalog family evidence, then narrow to audited interchangeable variants.
 * Unsupported or ambiguous families fail closed, even with lexical matches. */
export function shoppingCompatibilityKey(title: string): string | null {
  const family = classifyProductFamily({ title }).family;
  const t = normalizeSearchQuery(title).normalize("NFD").replace(/\p{M}/gu, "");
  if (
    /\b(?:organic[oa]s?|premium|ecologic[oa]s?|enriquecid[oa]s?|integral(?:es)?|parbolizado|parboiled|precocido|rojo|negro|basmati|jazmin|risotto|arborio|gallinas? libres?|libre pastoreo|pastoreo|corral|omega|codorniz|pato|bebe|antibacterial|hipoalergenico|suavizante|pods?|capsulas?|oliva|coco|palta|sesamo|sacha inchi|oleico|quinua)\b/u.test(
      t,
    )
  )
    return null;
  if (family === "eggs") return "eggs:regular";
  if (family === "rice") return "rice:white";
  if (family === "cooking_oil") {
    if (/\bgirasol\b/u.test(t)) return "oil:sunflower";
    if (/\b(?:vegetal|soya|soja)\b/u.test(t)) return "oil:vegetable";
    return null;
  }
  if (family === "detergent") {
    if (
      /\b(?:baby|kids|bebes?|ninos?|micelar|ropa negra|ropa blanca|hipoalergenico|color)\b/u.test(t)
    )
      return null;
    const machine = /\b(?:matic|automatic[oa])\b/u.test(t) ? ":machine" : "";
    if (/\bliquido\b/u.test(t)) return `detergent:liquid${machine}`;
    if (/\bpolvo\b/u.test(t)) return `detergent:powder${machine}`;
    return null;
  }
  return null;
}
export function shoppingQueryForTitle(title: string): string {
  const family = classifyProductFamily({ title }).family;
  return family
    ? {
        eggs: "huevos",
        rice: "arroz",
        cooking_oil: "aceite",
        detergent: "detergente",
        sugar: "azúcar",
        pasta: "pasta",
        flour: "harina",
        oats: "avena",
        canned_tuna: "atún",
        toilet_paper: "papel higiénico",
      }[family]
    : title.slice(0, 120);
}
function genericCompatibilityKey(query: string, unit: "unit" | "kg" | "L") {
  const family = resolveProductFamilyQuery(query)?.family;
  // A broad oil need defaults to ordinary vegetable oil; detergent's dimension
  // selects powder versus liquid. More specific unsafe tokens remain excluded.
  const explicit = shoppingCompatibilityKey(query);
  if (explicit) return explicit;
  if (family === "cooking_oil" && !resolveProductFamilyQuery(query)?.remainingQuery)
    return "oil:vegetable";
  if (family === "detergent" && !resolveProductFamilyQuery(query)?.remainingQuery)
    return unit === "kg" ? "detergent:powder" : unit === "L" ? "detergent:liquid" : null;
  return null;
}
/** A generic intent is a compatible family/variant, never a brand or pack size.
 * Unsupported intents retain their query rather than being silently generalized. */
export function shoppingGenericNeedKey(query: string, unit: "unit" | "kg" | "L") {
  return genericCompatibilityKey(query, unit) ?? normalizeSearchQuery(query);
}
export function shoppingMarketQuery(item: ShoppingListItem): string {
  return genericCompatibilityKey(item.query, item.quantity.unit)
    ? shoppingQueryForTitle(item.query)
    : item.query;
}
export const shoppingCandidateSchema = z.object({
  id: z.string().min(1),
  canonicalId: z.uuid().nullable(),
  title: z.string().min(1),
  retailerName: z.string().min(1),
  url: z.string().url(),
  ordinaryPriceCents: z.number().int().nonnegative().safe(),
  conditionalOffers: z.array(conditionalOfferSchema),
  observedAt: z.coerce.date(),
  available: z.boolean().nullable(),
  packageQuantity: shoppingQuantitySchema.nullable(),
  strongQuantity: z.boolean(),
});
export type ShoppingCandidate = z.infer<typeof shoppingCandidateSchema>;
export const shoppingOptionSchema = z.object({
  id: z.string(),
  canonicalId: z.uuid().nullable(),
  title: z.string(),
  retailerName: z.string(),
  url: z.string().url(),
  packages: z.number().int().positive(),
  countsPackages: z.boolean(),
  purchasedQuantity: z.number().positive(),
  overbuy: z.number().nonnegative(),
  totalCostCents: z.number().int().nonnegative().safe(),
  ordinaryTotalCents: z.number().int().nonnegative().safe(),
  effectiveUnitCents: z.number().nonnegative(),
  condition: z.string().nullable(),
});
export type ShoppingOption = z.infer<typeof shoppingOptionSchema>;
export const shoppingEvaluationSchema = z.object({
  itemId: z.uuid(),
  best: shoppingOptionSchema.nullable(),
  preferred: shoppingOptionSchema.nullable(),
  alternative: shoppingOptionSchema.nullable(),
  savingsCents: z.number().int().nonnegative(),
  options: z.array(shoppingOptionSchema).max(3),
});
export type ShoppingEvaluation = z.infer<typeof shoppingEvaluationSchema>;
export function evaluateShoppingListItem(
  item: ShoppingListItem,
  candidates: readonly ShoppingCandidate[],
  mode: PriceMode,
  now = new Date(),
  preferredTitle?: string,
): ShoppingEvaluation {
  const compatibility =
    item.intent === "generic"
      ? genericCompatibilityKey(item.query, item.quantity.unit)
      : preferredTitle
        ? shoppingCompatibilityKey(preferredTitle)
        : null;
  const evaluated: ShoppingOption[] = [];
  for (const c of candidates) {
    if (c.available === false || offerFreshness(c.observedAt, now) !== "fresh") continue;
    const exact = item.intent !== "generic" && c.canonicalId === item.canonicalId;
    if (item.intent === "strict" && !exact) continue;
    if (!exact && (!compatibility || shoppingCompatibilityKey(c.title) !== compatibility)) continue;
    // Count for a specific mass/volume SKU means whole retail packages (envases).
    const countsPackages =
      exact &&
      item.quantity.unit === "unit" &&
      (c.packageQuantity?.unit === "kg" || c.packageQuantity?.unit === "L");
    const q = countsPackages ? { amount: 1, unit: "unit" as const } : c.packageQuantity;
    if (!q || (!c.strongQuantity && !countsPackages) || q.unit !== item.quantity.unit) continue;
    const required = Math.round(item.quantity.amount * 1000);
    const size = Math.round(q.amount * 1000);
    const packages = Math.ceil(required / size);
    const purchased = packages * size;
    // At most 100% extra. Oversize options cannot win by forcing a bulk purchase.
    if (purchased > required * 2) continue;
    const ranking = rankedPrice(c.ordinaryPriceCents, c.conditionalOffers, mode, now);
    const totalCostCents = packages * ranking.priceCents;
    const ordinaryTotalCents = packages * c.ordinaryPriceCents;
    if (!Number.isSafeInteger(totalCostCents) || !Number.isSafeInteger(ordinaryTotalCents))
      continue;
    evaluated.push({
      id: c.id,
      canonicalId: c.canonicalId,
      title: c.title,
      retailerName: c.retailerName,
      url: c.url,
      packages,
      countsPackages,
      purchasedQuantity: purchased / 1000,
      overbuy: (purchased - required) / 1000,
      totalCostCents,
      ordinaryTotalCents,
      effectiveUnitCents: (totalCostCents * 1000) / purchased,
      condition: ranking.condition?.conditionLabel ?? null,
    });
  }
  evaluated.sort(
    (a, b) =>
      a.totalCostCents - b.totalCostCents ||
      a.overbuy - b.overbuy ||
      a.effectiveUnitCents - b.effectiveUnitCents ||
      a.id.localeCompare(b.id),
  );
  const preferred =
    item.intent === "preferred"
      ? (evaluated.find((o) => o.canonicalId === item.canonicalId) ?? null)
      : null;
  const cheapestAlternative =
    item.intent === "preferred"
      ? (evaluated.find((o) => o.canonicalId !== item.canonicalId) ?? null)
      : null;
  // Meaningful: at least S/1 AND 5% of this purchase's preferred total.
  const alternative =
    cheapestAlternative &&
    (!preferred ||
      preferred.totalCostCents - cheapestAlternative.totalCostCents >=
        Math.max(100, Math.ceil(preferred.totalCostCents * 0.05)))
      ? cheapestAlternative
      : null;
  const best = item.intent === "preferred" ? (preferred ?? alternative) : (evaluated[0] ?? null);
  return {
    itemId: item.id,
    best,
    preferred,
    alternative,
    savingsCents:
      preferred && alternative ? preferred.totalCostCents - alternative.totalCostCents : 0,
    options: evaluated.slice(0, 3),
  };
}
