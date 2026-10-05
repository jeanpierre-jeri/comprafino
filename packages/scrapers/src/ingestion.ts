import { safeDiagnostic, DiagnosticError } from "@comprafino/core";
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
  let id: string;
  try {
    id = await store.start(adapter.retailer);
  } catch (error) {
    throw new DiagnosticError(error, {
      stage: "admission",
      operation: "ingestion",
      retailer: adapter.retailer,
      reason: "db_write_failed",
    });
  }
  let stage: "source" | "persistence" | "completion" = "source";
  let fetched = 0;
  let persisted = 0;
  let changed = 0;
  try {
    const sample = await adapter.fetchListings(limit);
    fetched = sample.discovered;
    stage = "persistence";
    ({ persisted, changed } = await store.persist(adapter.retailer, sample.listings));
    stage = "completion";
    await store.finish(id, { status: "success", fetched, persisted, changed });
    return { id, fetched, persisted, changed };
  } catch (error) {
    // Persist a safe error code; driver messages may contain connection credentials.
    const context = {
      stage,
      operation: "ingestion" as const,
      retailer: adapter.retailer,
      reason:
        stage === "source" ? ("source_request_failed" as const) : ("db_write_failed" as const),
    };
    const diagnostic = safeDiagnostic(error, context);
    try {
      await store.finish(id, {
        status: "failed",
        fetched,
        persisted,
        changed,
        error: JSON.stringify(diagnostic),
      });
    } catch (finishError) {
      throw new DiagnosticError(finishError, {
        stage: "completion",
        operation: "ingestion",
        retailer: adapter.retailer,
        reason: "db_write_failed",
      });
    }
    throw new DiagnosticError(error, context);
  }
}
