import type { NormalizedRetailerListing, RetailerId } from "@comprafino/core";

export interface RetailerAdapter {
  readonly retailer: RetailerId;
  fetchListings(
    limit: number,
  ): Promise<{ listings: NormalizedRetailerListing[]; discovered: number }>;
}
