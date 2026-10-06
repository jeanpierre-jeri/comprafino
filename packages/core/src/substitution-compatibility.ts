import { normalizeSearchQuery } from "./public-products.ts";
import { classifyProductFamily, resolveProductFamilyQuery } from "./product-family.ts";
import type { FamilyEvidence } from "./product-family.ts";

/** Reuse catalog family evidence, then narrow to audited interchangeable variants.
 * Unsupported or ambiguous families fail closed, even with lexical matches. */
export function getSubstitutionProfile(input: {
  title: string;
  family?: FamilyEvidence;
}): string | null {
  const { title } = input;
  const family = input.family ? input.family.family : classifyProductFamily({ title }).family;
  const t = normalizeSearchQuery(title).normalize("NFD").replace(/\p{M}/gu, "");

  if (
    /\b(?:organic[oa]s?|premium|ecologic[oa]s?|enriquecid[oa]s?|integral(?:es)?|parbolizado|parboiled|precocido|rojo|negro|basmati|jazmin|risotto|arborio|salvaje|sushi|glutinoso|aromatico|gallinas? libres?|free range|camperos?|libre pastoreo|pastoreo|corral|omega|codorniz|codornices|pato|avestruz|ganso|pascua|chocolate|bebe|antibacterial|hipoalergenico|suavizante|pods?|capsulas?|capsules?|tabletas?|oliva|coco|palta|sesamo|sacha inchi|oleico|quinua)\b/u.test(
      t,
    )
  ) {
    return null;
  }

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
    ) {
      return null;
    }

    const machine = /\b(?:matic|automatic[oa])\b/u.test(t) ? ":machine" : "";

    if (/\bliquido\b/u.test(t) && /\bpolvo\b/u.test(t)) return null;

    if (/\bliquido\b/u.test(t)) return `detergent:liquid${machine}`;

    if (/\bpolvo\b/u.test(t)) return `detergent:powder${machine}`;

    return null;
  }

  return null;
}

export const shoppingCompatibilityKey = (title: string) => getSubstitutionProfile({ title });

export function areSafeSubstitutes(
  a: Parameters<typeof getSubstitutionProfile>[0],
  b: Parameters<typeof getSubstitutionProfile>[0],
): boolean {
  const profile = getSubstitutionProfile(a);

  return profile !== null && profile === getSubstitutionProfile(b);
}

export function inferGenericSubstitutionProfile(
  query: string,
  unit: "unit" | "kg" | "L",
): string | null {
  const explicit = shoppingCompatibilityKey(query);

  if (explicit) return explicit;

  const resolved = resolveProductFamilyQuery(query);

  if (resolved?.remainingQuery) return null;

  if (resolved?.family === "cooking_oil") return "oil:vegetable";

  if (resolved?.family === "detergent") {
    if (unit === "kg") {
      return "detergent:powder";
    } else if (unit === "L") {
      return "detergent:liquid";
    } else {
      return null;
    }
  }

  return null;
}

export function isListingCompatibleWithGenericNeed(
  need: {
    substitutionProfile?: string | null;
    query: string;
    quantity: { unit: "unit" | "kg" | "L" };
  },
  listing: Parameters<typeof getSubstitutionProfile>[0],
): boolean {
  const profile = need.substitutionProfile;

  return (
    profile != null &&
    profile === inferGenericSubstitutionProfile(need.query, need.quantity.unit) &&
    profile === getSubstitutionProfile(listing)
  );
}

export const genericSubstitutionContexts: Record<
  string,
  { query: string; label: string; unit: "unit" | "kg" | "L" }
> = {
  "eggs:regular": { query: "huevos", label: "Huevos", unit: "unit" },
  "rice:white": { query: "arroz blanco", label: "Arroz blanco", unit: "kg" },
  "oil:vegetable": { query: "aceite vegetal", label: "Aceite vegetal", unit: "L" },
  "oil:sunflower": { query: "aceite girasol", label: "Aceite de girasol", unit: "L" },
  "detergent:powder": { query: "detergente en polvo", label: "Detergente en polvo", unit: "kg" },
  "detergent:liquid": { query: "detergente líquido", label: "Detergente líquido", unit: "L" },
  "detergent:powder:machine": {
    query: "detergente en polvo matic",
    label: "Detergente en polvo matic",
    unit: "kg",
  },
  "detergent:liquid:machine": {
    query: "detergente líquido matic",
    label: "Detergente líquido matic",
    unit: "L",
  },
};
