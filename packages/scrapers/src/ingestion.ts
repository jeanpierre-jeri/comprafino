import { safeIngestionError } from "@comprafino/core";
import type { NormalizedRetailerListing, RetailerId } from "@comprafino/core";
import type { RetailerAdapter } from "./adapter.ts";
export interface IngestionStore {
  start(retailer: RetailerId): Promise<string>;
  persist(
    retailer: RetailerId,
    listings: readonly NormalizedRetailerListing[],
  ): Promise<{ persisted: number; changed: number }>;
  finish(
    id: string,
    result: {
      status: "success" | "failed";
      fetched: number;
      persisted: number;
      changed: number;
      error?: string;
    },
  ): Promise<void>;
}
export async function ingest(adapter: RetailerAdapter, limit: number, store: IngestionStore) {
  const id = await store.start(adapter.retailer);
  let fetched = 0;
  let persisted = 0;
  let changed = 0;
  try {
    const sample = await adapter.fetchListings(limit);
    fetched = sample.discovered;
    ({ persisted, changed } = await store.persist(adapter.retailer, sample.listings));
    await store.finish(id, { status: "success", fetched, persisted, changed });
    return { id, fetched, persisted, changed };
  } catch (error) {
    // Persist a safe error code; driver messages may contain connection credentials.
    await store.finish(id, {
      status: "failed",
      fetched,
      persisted,
      changed,
      error: safeIngestionError,
    });
    throw error;
  }
}
