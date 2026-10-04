import type { RetailerAdapter } from "./adapter.ts";
import { createTottusAdapter } from "./tottus.ts";
import { createPlazaVeaAdapter } from "./plaza-vea.ts";
import { createMetroAdapter } from "./metro.ts";

// Freeze the independently validated coverage; do not use CLI defaults (20).
export const refreshCoverage = {
  tottus: { meat: 50, dairy: 100 },
  "plaza-vea": { dairy: 100 },
  metro: { dairy: 100 },
} as const;
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
export function createRefreshAdapters() {
  return {
    tottus: { adapter: combineTottusCoverage(), limit: 150 },
    "plaza-vea": { adapter: createPlazaVeaAdapter(), limit: refreshCoverage["plaza-vea"].dairy },
    metro: { adapter: createMetroAdapter(), limit: refreshCoverage.metro.dairy },
  };
}
