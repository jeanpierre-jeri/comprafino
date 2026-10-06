import type { Quantity } from "./catalog.ts";
import type { FamilyEvidence } from "./product-family.ts";
import { normalizeSearchQuery } from "./public-products.ts";
import {
  getSubstitutionProfile,
  genericSubstitutionContexts,
  inferGenericSubstitutionProfile,
} from "./substitution-compatibility.ts";
import { shoppingQuantitySchema, shoppingQueryForTitle } from "./shopping-list.ts";
import type { ShoppingListItem } from "./shopping-list.ts";

export type ShoppingCreationSeed = {
  label: string;
  query: string;
  canonicalId: string | null;
  quantity?: ShoppingListItem["quantity"];
  substitutionProfile?: string | null;
};

/** canonicalId must come from the existing safe public association boundary.
 * Never promote an independent retailer listing to an exact product identity. */
export function shoppingSeedForRetailerOffer(offer: {
  title: string;
  canonicalId: string | null;
  family?: FamilyEvidence;
  totalQuantity: { value: number; unit: "g" | "ml" | "unit" } | null;
  unitPrice: { quality: string } | null;
  pricingBasis: "unit" | "kg";
}): ShoppingCreationSeed {
  if (offer.canonicalId) {
    return {
      label: offer.title.slice(0, 120),
      query: shoppingQueryForTitle(offer.title),
      canonicalId: offer.canonicalId,
    };
  }

  const profile = getSubstitutionProfile(offer);
  const context = profile ? genericSubstitutionContexts[profile] : undefined;
  const catalogQuantity = offer.totalQuantity;
  const unit = context?.unit ?? catalogQuantityToShoppingUnit(catalogQuantity?.unit);
  const normalized = shoppingQuantitySchema.safeParse(
    catalogQuantity && offer.unitPrice?.quality === "strong" && offer.pricingBasis === "unit"
      ? {
          amount: catalogQuantity.value / (catalogQuantity.unit === "unit" ? 1 : 1000),
          unit: catalogQuantityToShoppingUnit(catalogQuantity.unit),
        }
      : null,
  );
  const quantity =
    normalized.success && normalized.data.unit === unit ? normalized.data : { amount: 1, unit };
  const query = normalizeSearchQuery(context?.query ?? offer.title).slice(0, 120);

  return {
    label: context?.label ?? offer.title.slice(0, 120),
    query,
    canonicalId: null,
    quantity,
    substitutionProfile:
      context && inferGenericSubstitutionProfile(query, unit) === profile ? profile : null,
  };
}

/** Converts known catalog base units; it does not infer a quantity or dimension. */
export function catalogQuantityToShoppingUnit(
  unit: Quantity["unit"] | undefined,
): ShoppingListItem["quantity"]["unit"] {
  if (unit === "g") return "kg";

  if (unit === "ml") return "L";

  return "unit";
}
