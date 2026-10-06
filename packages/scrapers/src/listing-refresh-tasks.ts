import { claimListingRefresh, finishListingRefresh, persistListingsDetailed } from "@comprafino/db";
import type { createDatabase } from "@comprafino/db";
import { createTottusAdapter } from "./tottus.ts";
import { createPlazaVeaAdapter } from "./plaza-vea.ts";
import { createMetroAdapter } from "./metro.ts";
import type { ListingRefreshTasks } from "./listing-refresh.ts";

export function listingRefreshTasks(db: ReturnType<typeof createDatabase>): ListingRefreshTasks {
  return {
    adapters: {
      tottus: createTottusAdapter(),
      "plaza-vea": createPlazaVeaAdapter(),
      metro: createMetroAdapter(),
    },
    claim: (row, at) => claimListingRefresh(db, row, at),
    persist: (retailer, rows) =>
      persistListingsDetailed(db, retailer, rows, { source: "targeted" }),
    finish: (row, at, status) => finishListingRefresh(db, row, at, status),
    pause: () => new Promise((resolve) => setTimeout(resolve, 1000)),
  };
}
