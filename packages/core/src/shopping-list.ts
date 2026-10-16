import { z } from "zod";
import { retailerIdSchema } from "./listing.ts";
import { normalizeSearchQuery } from "./public-products.ts";
import { classifyProductFamily } from "./product-family.ts";
import {
  getSubstitutionProfile,
  genericSubstitutionContexts,
  inferGenericSubstitutionProfile,
  isListingCompatibleWithGenericNeed,
} from "./substitution-compatibility.ts";

export { shoppingCompatibilityKey } from "./substitution-compatibility.ts";

import { offerFreshness } from "./listing-refresh.ts";
import { conditionalOfferSchema, rankedPrice } from "./conditional-pricing.ts";
import type { PriceMode } from "./conditional-pricing.ts";

const quantityScale = 1000;

export const shoppingListPolicy = {
  maximumItems: 50,
  maximumAmount: 10000,
  quantityScale,
  quantityStep: 1 / quantityScale,
  preferredSavingsCents: 100,
  preferredSavingsFraction: 0.05,
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
      .max(shoppingListPolicy.maximumAmount)
      .refine(
        (n) =>
          Math.abs(
            n * shoppingListPolicy.quantityScale - Math.round(n * shoppingListPolicy.quantityScale),
          ) < 0.000001,
        "Usa hasta 3 decimales",
      ),
    unit: z.enum(["unit", "kg", "L"]),
  })
  .refine((q) => q.unit !== "unit" || Number.isInteger(q.amount), "Las unidades deben ser enteras");

const common = {
  id: z.uuid(),
  label: z.string().trim().min(2).max(120),
  query: z.string().trim().min(2).max(120),
  quantity: shoppingQuantitySchema,
  quantityMode: z.enum(["normalized", "packages"]).default("normalized"),
  substitutionProfile: z.string().max(80).nullable().default(null),
  frequency: z.enum(["weekly", "biweekly", "monthly"]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  listingId: z.uuid().optional(),
};

function validPackageQuantity(item: {
  quantityMode: string;
  quantity: { amount: number; unit: string };
}) {
  return (
    item.quantityMode !== "packages" ||
    (item.quantity.unit === "unit" && Number.isInteger(item.quantity.amount))
  );
}

export const shoppingListItemSchema = z.discriminatedUnion("intent", [
  z.object({
    ...common,
    listingId: z.undefined().optional(),
    quantityMode: z.literal("normalized").default("normalized"),
    intent: z.literal("generic"),
    canonicalId: z.null(),
  }),
  z
    .object({ ...common, intent: z.literal("preferred"), canonicalId: z.uuid().nullable() })
    .refine(validPackageQuantity, "Package count must be whole units")
    .refine((item) => Boolean(item.canonicalId || item.listingId), "Product identity required"),
  z
    .object({ ...common, intent: z.literal("strict"), canonicalId: z.uuid().nullable() })
    .refine(validPackageQuantity, "Package count must be whole units")
    .refine((item) => Boolean(item.canonicalId || item.listingId), "Product identity required"),
]);

export type ShoppingListItem = z.infer<typeof shoppingListItemSchema>;

export const shoppingListSchema = z
  .object({
    version: z.literal(2),
    items: z.array(shoppingListItemSchema).max(shoppingListPolicy.maximumItems),
  })
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
  return { version: 2, items: [] };
}

export function parseShoppingList(raw: string | null): { list: ShoppingList; invalid: boolean } {
  if (raw === null) return { list: emptyShoppingList(), invalid: false };

  try {
    const value: unknown = JSON.parse(raw);
    const legacy = z
      .object({
        version: z.literal(1),
        items: z.array(shoppingListItemSchema).max(shoppingListPolicy.maximumItems),
      })
      .safeParse(value);
    const parsed = shoppingListSchema.safeParse(
      legacy.success
        ? {
            version: 2,
            items: legacy.data.items.map((item) => ({
              ...item,
              quantityMode: "normalized",
              substitutionProfile:
                item.intent === "generic"
                  ? inferGenericSubstitutionProfile(item.query, item.quantity.unit)
                  : null,
            })),
          }
        : value,
    );

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
  return `${item.intent}:${item.intent === "generic" ? shoppingGenericNeedKey(item.query, item.quantity.unit) : (item.listingId ?? item.canonicalId)}:${item.intent === "generic" ? (item.substitutionProfile ?? "withheld") : ""}:${item.quantityMode}:${item.quantity.unit}`;
}

export function saveShoppingItem(list: ShoppingList, raw: ShoppingListItem): ShoppingList {
  const item = shoppingListItemSchema.parse(raw);

  if (item.intent === "generic") {
    const query = normalizeSearchQuery(item.query);
    const generatedLabel = normalizeSearchQuery(item.label) === query;
    item.query = query;

    if (
      item.substitutionProfile !== inferGenericSubstitutionProfile(item.query, item.quantity.unit)
    ) {
      item.substitutionProfile = null;
    }

    const context = item.substitutionProfile
      ? genericSubstitutionContexts[item.substitutionProfile]
      : undefined;
    // Persist the safe need itself, independent of retailer/brand search modifiers.
    // Unsupported semantic variants retain their description; custom labels survive.
    item.query = context?.query ?? query;

    if (generatedLabel) {
      item.label = context?.label ?? item.label.charAt(0).toUpperCase() + item.label.slice(1);
    }
  }

  const existing =
    list.items.find((i) => i.id === item.id) ??
    list.items.find((i) => shoppingItemKey(i) === shoppingItemKey(item));
  const duplicate = list.items.find(
    (i) => i.id !== existing?.id && shoppingItemKey(i) === shoppingItemKey(item),
  );

  if (duplicate) {
    throw new Error("Ya tienes esta necesidad en tu lista. Edita la existente.");
  }

  if (!existing && list.items.length >= shoppingListPolicy.maximumItems) {
    throw new Error("Tu lista admite hasta 50 necesidades.");
  }

  const saved = existing ? { ...item, id: existing.id, createdAt: existing.createdAt } : item;

  return shoppingListSchema.parse({
    version: 2,
    items: existing
      ? list.items.map((i) => (i.id === existing.id ? saved : i))
      : [...list.items, saved],
  });
}

export function removeShoppingItem(list: ShoppingList, id: string): ShoppingList {
  return { version: 2, items: list.items.filter((i) => i.id !== id) };
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

/** A generic intent is a compatible family/variant, never a brand or pack size.
 * Unsupported intents retain their query rather than being silently generalized. */
export function shoppingGenericNeedKey(query: string, unit: "unit" | "kg" | "L") {
  return inferGenericSubstitutionProfile(query, unit) ?? normalizeSearchQuery(query);
}

export function shoppingMarketQuery(item: ShoppingListItem): string {
  return inferGenericSubstitutionProfile(item.query, item.quantity.unit)
    ? shoppingQueryForTitle(item.query)
    : item.query;
}

export const shoppingCandidateSchema = z.object({
  id: z.string().min(1),
  canonicalId: z.uuid().nullable(),
  title: z.string().min(1),
  imageUrl: z.string().url().nullable().optional(),
  retailerId: retailerIdSchema.optional(),
  retailerName: z.string().min(1),
  url: z.string().url(),
  ordinaryPriceCents: z.number().int().nonnegative().safe(),
  conditionalOffers: z.array(conditionalOfferSchema),
  observedAt: z.coerce.date(),
  available: z.boolean().nullable(),
  packageQuantity: shoppingQuantitySchema.nullable(),
  strongQuantity: z.boolean(),
  pricingBasis: z.enum(["unit", "kg"]).optional(),
  substitutionProfile: z.string().nullable().optional(),
});

export type ShoppingCandidate = z.infer<typeof shoppingCandidateSchema>;

export const shoppingOptionSchema = z.object({
  available: z.boolean().nullable(),
  id: z.string(),
  canonicalId: z.uuid().nullable(),
  title: z.string(),
  imageUrl: z.string().url().nullable().optional(),
  retailerId: retailerIdSchema.optional(),
  retailerName: z.string(),
  url: z.string().url(),
  packages: z.number().int().positive(),
  countsPackages: z.boolean(),
  quantityUnit: z.enum(["unit", "kg", "L"]),
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
  alternatives: z.array(shoppingOptionSchema).max(3).optional(),
});

export type ShoppingEvaluation = z.infer<typeof shoppingEvaluationSchema>;

export function evaluateShoppingFulfillment(
  item: ShoppingListItem,
  candidates: readonly ShoppingCandidate[],
  mode: PriceMode,
  now = new Date(),
  preferredTitle?: string,
) {
  const selected = item.listingId ? candidates.find((c) => c.id === item.listingId) : undefined;
  // A saved listing never authorizes an old canonical association. Resolve it
  // from today's validated catalog, and keep its own quote as the baseline.
  const canonicalId = item.listingId ? selected?.canonicalId : item.canonicalId;
  const exactCandidate = (candidate: Pick<ShoppingCandidate, "id" | "canonicalId">) =>
    item.intent !== "generic" &&
    (candidate.id === item.listingId ||
      Boolean(canonicalId && candidate.canonicalId === canonicalId));
  let compatibility = preferredTitle ? getSubstitutionProfile({ title: preferredTitle }) : null;
  if (item.listingId) {
    compatibility = selected?.substitutionProfile ?? null;
  }
  const reference =
    item.intent !== "generic" && item.quantityMode === "packages"
      ? [...candidates]
          .sort((a, b) => a.id.localeCompare(b.id))
          .find(
            (c) =>
              (item.listingId ? c.id === item.listingId : exactCandidate(c)) &&
              c.pricingBasis !== "kg" &&
              c.strongQuantity &&
              Number.isSafeInteger(c.ordinaryPriceCents) &&
              c.ordinaryPriceCents > 0 &&
              c.available !== false &&
              offerFreshness(c.observedAt, now) === "fresh" &&
              c.packageQuantity,
          )
      : null;
  const evaluated: ShoppingOption[] = [];

  for (const c of candidates) {
    if (
      !Number.isSafeInteger(c.ordinaryPriceCents) ||
      c.ordinaryPriceCents <= 0 ||
      c.available === false ||
      c.pricingBasis === "kg" ||
      offerFreshness(c.observedAt, now) !== "fresh"
    ) {
      continue;
    }

    const exact = exactCandidate(c);

    if (item.intent === "strict" && !exact) {
      continue;
    }

    const candidateProfile =
      c.substitutionProfile !== undefined
        ? c.substitutionProfile
        : getSubstitutionProfile({ title: c.title });

    if (
      !exact &&
      (item.intent === "generic"
        ? !isListingCompatibleWithGenericNeed(item, { title: c.title }) ||
          candidateProfile !== item.substitutionProfile
        : !compatibility || candidateProfile !== compatibility)
    ) {
      continue;
    }

    const countsPackages =
      exact &&
      (item.quantityMode === "packages" ||
        (item.quantity.unit === "unit" &&
          (c.packageQuantity?.unit === "kg" || c.packageQuantity?.unit === "L")));
    const q = countsPackages ? { amount: 1, unit: "unit" as const } : c.packageQuantity;
    let target;

    if (!exact && item.quantityMode === "packages") {
      if (reference?.packageQuantity) {
        target = {
          amount: reference.packageQuantity.amount * item.quantity.amount,
          unit: reference.packageQuantity.unit,
        };
      } else {
        target = null;
      }
    } else {
      target = item.quantity;
    }

    if (!q || !target || (!c.strongQuantity && !countsPackages) || q.unit !== target.unit) {
      continue;
    }

    const required = Math.round(target.amount * shoppingListPolicy.quantityScale);
    const size = Math.round(q.amount * shoppingListPolicy.quantityScale);
    const packages = Math.ceil(required / size);
    const purchased = packages * size;

    // At most 100% extra. Oversize options cannot win by forcing a bulk purchase.
    if (purchased > required * 2) {
      continue;
    }

    const ranking = rankedPrice(c.ordinaryPriceCents, c.conditionalOffers, mode, now);
    const totalCostCents = packages * ranking.priceCents;
    const ordinaryTotalCents = packages * c.ordinaryPriceCents;

    if (!Number.isSafeInteger(totalCostCents) || !Number.isSafeInteger(ordinaryTotalCents)) {
      continue;
    }

    evaluated.push({
      available: c.available,
      id: c.id,
      canonicalId: c.canonicalId,
      title: c.title,
      imageUrl: c.imageUrl ?? null,
      retailerId: c.retailerId,
      retailerName: c.retailerName,
      url: c.url,
      packages,
      countsPackages,
      quantityUnit: q.unit,
      purchasedQuantity: purchased / shoppingListPolicy.quantityScale,
      overbuy: (purchased - required) / shoppingListPolicy.quantityScale,
      totalCostCents,
      ordinaryTotalCents,
      effectiveUnitCents: (totalCostCents * shoppingListPolicy.quantityScale) / purchased,
      condition: ranking.condition?.conditionLabel ?? null,
    });
  }

  evaluated.sort(compareShoppingOptions);
  const preferred =
    item.intent === "preferred"
      ? (evaluated.find((o) => (item.listingId ? o.id === item.listingId : exactCandidate(o))) ??
        null)
      : null;
  const cheapestAlternative =
    item.intent === "preferred"
      ? (evaluated.find((o) => (item.listingId ? o.id !== item.listingId : !exactCandidate(o))) ??
        null)
      : null;
  // Global preference gate: all alternatives use the same exact market baseline.
  const approved =
    item.intent === "preferred"
      ? evaluated.filter(
          (option) =>
            exactCandidate(option) ||
            !preferred ||
            preferred.totalCostCents - option.totalCostCents >=
              Math.max(
                shoppingListPolicy.preferredSavingsCents,
                Math.ceil(preferred.totalCostCents * shoppingListPolicy.preferredSavingsFraction),
              ),
        )
      : evaluated;
  const alternative =
    cheapestAlternative &&
    approved.includes(cheapestAlternative) &&
    (!preferred ||
      preferred.totalCostCents - cheapestAlternative.totalCostCents >=
        Math.max(
          shoppingListPolicy.preferredSavingsCents,
          Math.ceil(preferred.totalCostCents * shoppingListPolicy.preferredSavingsFraction),
        ))
      ? cheapestAlternative
      : null;
  let best = evaluated[0] ?? null;
  if (item.intent === "preferred") {
    best = preferred ?? alternative;
  } else if (item.listingId) {
    best = evaluated.find((option) => option.id === item.listingId) ?? null;
  }
  const baseline = item.intent === "preferred" ? preferred : best;

  const evaluation: ShoppingEvaluation = {
    itemId: item.id,
    best,
    preferred,
    alternative,
    savingsCents:
      preferred && alternative ? preferred.totalCostCents - alternative.totalCostCents : 0,
    options: evaluated.slice(0, 3),
    alternatives: approved
      .filter(
        (option) =>
          option.id !== baseline?.id &&
          (!baseline || option.totalCostCents < baseline.totalCostCents),
      )
      .slice(0, 3),
  };

  return { evaluation, approved };
}

export function compareShoppingOptions(a: ShoppingOption, b: ShoppingOption) {
  return (
    a.totalCostCents - b.totalCostCents ||
    a.overbuy - b.overbuy ||
    a.effectiveUnitCents - b.effectiveUnitCents ||
    a.id.localeCompare(b.id)
  );
}

export function evaluateShoppingListItem(
  ...args: Parameters<typeof evaluateShoppingFulfillment>
): ShoppingEvaluation {
  return evaluateShoppingFulfillment(...args).evaluation;
}
