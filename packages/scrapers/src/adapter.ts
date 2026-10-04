import type { NormalizedRetailerListing, RetailerId } from "@comprafino/core";

export interface RetailerAdapter {
  readonly retailer: RetailerId;
  fetchListings(
    limit: number,
  ): Promise<{ listings: NormalizedRetailerListing[]; discovered: number }>;
}

/** Search reuses the ingestion listing contract, with an independently small bound. */
export interface SearchRetailerAdapter extends RetailerAdapter {
  searchProducts(
    query: string,
    limit: number,
  ): Promise<{ listings: NormalizedRetailerListing[]; discovered: number }>;
}
