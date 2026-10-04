import { listingSchema } from "@comprafino/core";
import type { KnownListing, NormalizedRetailerListing, RetailerId } from "@comprafino/core";
import type { TargetedRetailerAdapter } from "./targeted.ts";
export interface ListingRefreshTasks {
  adapters: Record<RetailerId, TargetedRetailerAdapter>;
  claim(this: void, row: KnownListing, at: Date): Promise<boolean>;
  persist(
    this: void,
    retailer: RetailerId,
    rows: readonly NormalizedRetailerListing[],
  ): Promise<{ changed: number }>;
  finish(
    this: void,
    row: KnownListing,
    at: Date,
    status: "observed" | "unavailable" | "not-found" | "failed",
  ): Promise<void>;
  pause(this: void): Promise<void>;
}
export async function refreshKnownListings(
  rows: readonly KnownListing[],
  tasks: ListingRefreshTasks,
) {
  if (rows.length > 100) throw new Error("Targeted refresh exceeds budget");
  const consecutive = new Map<RetailerId, number>();
  const results: {
    retailer: RetailerId;
    externalId: string;
    status: "observed" | "unavailable" | "not-found" | "failed" | "skipped";
    priceStates: number;
  }[] = [];
  let requests = 0;
  for (const row of rows) {
    if ((consecutive.get(row.retailer) ?? 0) >= 3) {
      results.push({
        retailer: row.retailer,
        externalId: row.externalId,
        status: "skipped",
        priceStates: 0,
      });
      continue;
    }
    const at = new Date();
    // DB failures during admission/recording are fatal; never make unaccounted requests.
    if (!(await tasks.claim(row, at))) {
      results.push({
        retailer: row.retailer,
        externalId: row.externalId,
        status: "skipped",
        priceStates: 0,
      });
      continue;
    }
    if (requests > 0) await tasks.pause();
    requests++;
    let status: "observed" | "unavailable" | "not-found" | "failed" = "failed";
    let priceStates = 0;
    try {
      const result = await tasks.adapters[row.retailer].lookupListing(row);
      status = result.status;
      if (result.status === "observed") {
        const listing = listingSchema.parse(result.listing);
        if (
          listing.retailer !== row.retailer ||
          listing.externalId !== row.externalId ||
          listing.productId !== row.productId
        )
          throw new Error("Lookup returned another listing");
        priceStates = (await tasks.persist(row.retailer, [listing])).changed;
      }
      consecutive.set(row.retailer, 0);
    } catch {
      status = "failed";
      consecutive.set(row.retailer, (consecutive.get(row.retailer) ?? 0) + 1);
    }
    await tasks.finish(row, at, status);
    results.push({ retailer: row.retailer, externalId: row.externalId, status, priceStates });
  }
  return {
    requests,
    results,
    changed: results.reduce((n, r) => n + r.priceStates, 0),
    observed: results.filter((r) => r.status === "observed").length,
    failures: results.filter((r) => r.status === "failed").length,
    status: results.some((r) => r.status === "failed")
      ? ("partial" as const)
      : ("success" as const),
  };
}
