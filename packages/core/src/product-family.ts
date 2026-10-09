import type { RetailerId } from "./listing.ts";
import { normalizeSearchQuery } from "./public-products.ts";

export type ProductFamily =
  | "eggs"
  | "rice"
  | "sugar"
  | "cooking_oil"
  | "pasta"
  | "flour"
  | "oats"
  | "canned_tuna"
  | "detergent"
  | "toilet_paper";

export type FamilyEvidence = {
  family: ProductFamily | null;
  origin: "source-category" | "title" | null;
  evidence: string;
};

// Only observed leaf categories. Broad flour/baking and oats/mixed cereal
// categories intentionally require a product noun instead of granting membership.
const categories: Record<RetailerId, Partial<Record<ProductFamily, readonly string[]>>> = {
  tottus: {
    eggs: ["J0501020204", "J0501020203"],
    rice: ["J0101010203"],
    cooking_oil: ["J0101010104"],
    canned_tuna: ["J0101020403"],
    detergent: ["J0201020102"],
  },
  "plaza-vea": {
    eggs: ["839"],
    rice: ["439", "440", "442"],
    sugar: ["444", "1625"],
    cooking_oil: ["599", "600", "602", "1624"],
    pasta: ["454", "455", "456", "458"],
    canned_tuna: ["460"],
    detergent: ["413", "1371"],
    toilet_paper: ["402"],
  },
  makro: {
    sugar: ["444", "1625"],
    pasta: ["454"],
    toilet_paper: ["402"],
  },
  metro: {
    eggs: ["1001348"],
    rice: ["1001283", "1001284", "1001285"],
    sugar: ["1001259", "1001260"],
    cooking_oil: ["1733", "1735", "1000671", "1001280"],
    pasta: ["1000743", "1000744", "1001299", "1000695"],
    flour: ["1000766"],
    canned_tuna: ["1737"],
    detergent: ["1912", "1000715"],
    toilet_paper: ["1001196"],
  },
};

const mismatches: Record<RetailerId, readonly string[]> = {
  tottus: ["J0102010302", "J0102010307", "J0101070507", "J0502050201", "J0502050203"],
  "plaza-vea": ["859", "1652", "785", "1498", "38", "1389", "34", "319"],
  makro: ["859", "1652", "785", "1498", "38", "1389", "34", "319"],
  metro: ["1001440", "1001624", "1000923", "1001690", "1001200", "2406"],
};

// Accent folding is confined to family interpretation. Remaining identity tokens
// keep the existing exact spelling and numeric-token search semantics.
function familyText(title: string) {
  return normalizeSearchQuery(title).normalize("NFD").replace(/\p{M}/gu, "");
}

const nouns: readonly [ProductFamily, RegExp][] = [
  ["eggs", /^huevos?\b/u],
  ["rice", /^arroz\b/u],
  ["sugar", /^azucar\b/u],
  ["cooking_oil", /^aceites?\b/u],
  ["pasta", /^(?:fideos?|pastas?|spaghetti|spaguetti|tallarin(?:es)?)\b/u],
  ["flour", /^harinas?\b/u],
  ["oats", /^avena(?:s)?\b/u],
  ["canned_tuna", /^(?:(?:filete|trozos|solido|ventresca|lomitos) de )?atun\b/u],
  ["detergent", /^detergentes?\b/u],
  ["toilet_paper", /^papel(?:es)? higienico(?:s)?\b/u],
];

function contradictsNoun(family: ProductFamily, title: string): boolean {
  if (family === "eggs") return /\b(?:pascua|chocolate)\b/u.test(title);

  if (family === "rice") return /\b(?:preparado|cocido|chaufa|con pollo)\b/u.test(title);

  if (family === "cooking_oil") {
    return /\b(?:corporal|cabello|motor|bebe|esencial|cosmetico|atun)\b/u.test(title);
  }

  if (family === "pasta") return /\b(?:dental|dientes|salsa)\b/u.test(title);

  if (family === "oats" || family === "sugar") {
    return /\b(?:bebida|leche|yogurt|gaseosa)\b/u.test(title);
  }

  return false;
}

export function classifyProductFamily(input: {
  title: string;
  retailerId?: RetailerId;
  sourceCategory?: string | null;
}): FamilyEvidence {
  const text = familyText(input.title);

  // Mixed bundles do not represent a single shopping option/quantity family.
  if (
    input.title.includes("+") ||
    /\b(?:sin|zero|cero) azucar\b/u.test(text) ||
    /\b(?:cocedor|cortador|organizador)\b/u.test(text)
  ) {
    return { family: null, origin: null, evidence: "mixed-bundle-or-property/accessory" };
  }

  if (input.retailerId && input.sourceCategory) {
    for (const [family] of nouns) {
      if (categories[input.retailerId][family]?.includes(input.sourceCategory)) {
        return { family, origin: "source-category", evidence: input.sourceCategory };
      }
    }

    if (mismatches[input.retailerId].includes(input.sourceCategory)) {
      return { family: null, origin: null, evidence: `category-mismatch:${input.sourceCategory}` };
    }
  }

  const title = text.replace(
    /^(?:(?:two|three|six|four)pack|pack(?: de)? \d+ (?:un|und|unidades)) /u,
    "",
  );

  for (const [family, noun] of nouns) {
    if (!noun.test(title)) {
      continue;
    }

    if (contradictsNoun(family, title)) {
      break;
    }

    return { family, origin: "title", evidence: `product-noun:${family}` };
  }

  return { family: null, origin: null, evidence: "no-confident-product-noun" };
}

/** Resolve only a leading product noun; 'bebida sin azúcar' stays lexical.
 * Every remaining brand, size and variant token remains required. */
export function resolveProductFamilyQuery(raw: string) {
  const query = normalizeSearchQuery(raw);
  const folded = familyText(raw);

  for (const [family, noun] of nouns) {
    const match = noun.exec(folded);

    if (match && !contradictsNoun(family, folded)) {
      return { family, remainingQuery: query.slice(match[0].length).trim() };
    }
  }

  return null;
}

/** Stable ordering retains SQL title/prefix/trigram relevance within evidence tiers. */
export function selectFamilyOffers<T extends { family: FamilyEvidence }>(
  offers: readonly T[],
  family: ProductFamily,
) {
  return offers
    .filter((o) => o.family.family === family)
    .sort(
      (a, b) =>
        Number(b.family.origin === "source-category") -
        Number(a.family.origin === "source-category"),
    );
}
