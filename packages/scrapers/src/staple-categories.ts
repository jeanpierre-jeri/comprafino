// Paths validated against the public category tree AND a returned product page.
// New sources fetch at most two 20-product pages / twenty usable listings.
export const vtexCategories = {
  "plaza-vea": {
    dairy: "845",
    "sugar-brown": "431/434/444",
    "sugar-white": "431/434/1625",
    pasta: "431/436/454",
    flour: "493/346/349",
    oats: "478/479/1639",
    "toilet-paper": "399/1627/402",
  },
  metro: {
    eggs: "1001327/1001347/1001348", // Milestone 18: validated narrow eggs source
    dairy: "1001436", // existing verified dairy root
    "sugar-brown": "1001253/1001258/1001259",
    "sugar-white": "1001253/1001258/1001260",
    pasta: "1700/1711/1000743",
    flour: "1700/1000694/1000766",
    oats: "1001253/1001262/1001265",
    "toilet-paper": "1900/1001195/1001196",
  },
} as const;

export type VtexCategory = keyof typeof vtexCategories.metro;

export const vtexCategoryKeys = [
  "dairy",
  "sugar-brown",
  "sugar-white",
  "pasta",
  "flour",
  "oats",
  "toilet-paper",
] as const;

export function isVtexCategory(value: string): value is VtexCategory {
  return Object.hasOwn(vtexCategories.metro, value);
}
