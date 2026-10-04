import type { NormalizedRetailerListing, RetailerId } from "@comprafino/core";
import type { TargetedRetailerAdapter } from "./targeted.ts";

export interface RetailerAdapter {
  readonly retailer: RetailerId;
  fetchListings(
    limit: number,
  ): Promise<{ listings: NormalizedRetailerListing[]; discovered: number }>;
}

/** Search and targeted lookup reuse the ingestion listing contract. */
export interface SearchRetailerAdapter extends RetailerAdapter, TargetedRetailerAdapter {
  searchProducts(
    query: string,
    limit: number,
  ): Promise<{ listings: NormalizedRetailerListing[]; discovered: number }>;
}
