import { vtexCategoryKeys } from "./staple-categories.ts";
import type { VtexCategory } from "./staple-categories.ts";
import type { NormalizedRetailerListing } from "@comprafino/core";
import type { RetailerAdapter } from "./adapter.ts";
import { createTottusAdapter } from "./tottus.ts";
import { createPlazaVeaAdapter } from "./plaza-vea.ts";
import { createMetroAdapter } from "./metro.ts";

// Fixed, validated scheduled coverage; never use operator CLI defaults.
export const refreshCoverage = {
  tottus: { meat: 50, dairy: 100 },
  "plaza-vea": {
    dairy: 100,
    "sugar-brown": 20,
    "sugar-white": 20,
    pasta: 20,
    flour: 20,
    oats: 20,
    "toilet-paper": 20,
  },
  metro: {
    eggs: 10,
    dairy: 100,
    "sugar-brown": 20,
    "sugar-white": 20,
    pasta: 20,
    flour: 20,
    oats: 20,
    "toilet-paper": 20,
  },
} as const;
export function scheduledObservationLimit(retailer: keyof typeof refreshCoverage): number {
  return Object.values(refreshCoverage[retailer]).reduce((sum: number, limit) => sum + limit, 0);
}
export function combineTottusCoverage(
  meat: RetailerAdapter = createTottusAdapter(),
  dairy: RetailerAdapter = createTottusAdapter(undefined, "dairy"),
): RetailerAdapter {
  return {
    retailer: "tottus",
    async fetchListings() {
      // Fetch both before persisting: a failed category leaves the retailer intact.
      const a = await meat.fetchListings(refreshCoverage.tottus.meat);
      const b = await dairy.fetchListings(refreshCoverage.tottus.dairy);
      const listings = new Map([...a.listings, ...b.listings].map((row) => [row.externalId, row]));
      return { listings: [...listings.values()], discovered: a.discovered + b.discovered };
    },
  };
}
/** All category fetches complete before the single atomic retailer write. */
export function combineVtexCoverage(
  retailer: "plaza-vea" | "metro",
  createAdapter: (category: VtexCategory) => RetailerAdapter = (category) =>
    retailer === "metro"
      ? createMetroAdapter(undefined, category)
      : createPlazaVeaAdapter(undefined, category),
  pause: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 1000)),
): RetailerAdapter {
  return {
    retailer,
    async fetchListings(limit) {
      const expectedLimit = scheduledObservationLimit(retailer);
      if (limit !== expectedLimit)
        throw new Error(`Scheduled VTEX coverage requires limit ${expectedLimit}`);
      const listings = new Map<string, NormalizedRetailerListing>();
      let discovered = 0;
      const categories: readonly VtexCategory[] =
        retailer === "metro" ? [...vtexCategoryKeys, "eggs"] : vtexCategoryKeys;
      for (const [index, category] of categories.entries()) {
        const categoryLimit =
          category === "eggs" ? refreshCoverage.metro.eggs : refreshCoverage[retailer][category];
        if (index > 0) await pause();
        const result = await createAdapter(category).fetchListings(categoryLimit);
        if (result.listings.length > categoryLimit)
          throw new Error("Category exceeded listing limit");
        discovered += result.discovered;
        for (const row of result.listings) listings.set(row.externalId, row);
      }
      return { listings: [...listings.values()], discovered };
    },
  };
}
export function createRefreshAdapters(fetchPage: typeof fetch = fetch) {
  return {
    tottus: {
      adapter: combineTottusCoverage(
        createTottusAdapter(fetchPage),
        createTottusAdapter(fetchPage, "dairy"),
      ),
      limit: scheduledObservationLimit("tottus"),
    },
    "plaza-vea": {
      adapter: combineVtexCoverage("plaza-vea", (category) =>
        createPlazaVeaAdapter(fetchPage, category),
      ),
      limit: scheduledObservationLimit("plaza-vea"),
    },
    metro: {
      adapter: combineVtexCoverage("metro", (category) => createMetroAdapter(fetchPage, category)),
      limit: scheduledObservationLimit("metro"),
    },
  };
}
