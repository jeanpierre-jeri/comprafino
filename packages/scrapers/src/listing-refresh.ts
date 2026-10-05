import { listingSchema, safeDiagnostic, DiagnosticError } from "@comprafino/core";
import type {
  KnownListing,
  NormalizedRetailerListing,
  RetailerId,
  SafeDiagnostic,
} from "@comprafino/core";
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
    diagnostic?: SafeDiagnostic;
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
    let claimed: boolean;
    try {
      claimed = await tasks.claim(row, at);
    } catch (error) {
      throw new DiagnosticError(error, {
        stage: "admission",
        operation: "targeted",
        retailer: row.retailer,
        reason: "db_write_failed",
      });
    }
    if (!claimed) {
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
    let stage: "source" | "persistence" = "source";
    let diagnostic: SafeDiagnostic | undefined;
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
        stage = "persistence";
        priceStates = (await tasks.persist(row.retailer, [listing])).changed;
      }
      consecutive.set(row.retailer, 0);
    } catch (error) {
      diagnostic = safeDiagnostic(error, {
        stage,
        operation: "targeted",
        retailer: row.retailer,
        reason: stage === "source" ? "source_request_failed" : "db_write_failed",
      });
      status = "failed";
      consecutive.set(row.retailer, (consecutive.get(row.retailer) ?? 0) + 1);
    }
    try {
      await tasks.finish(row, at, status);
    } catch (error) {
      throw new DiagnosticError(error, {
        stage: "completion",
        operation: "targeted",
        retailer: row.retailer,
        reason: "db_write_failed",
      });
    }
    results.push({
      retailer: row.retailer,
      externalId: row.externalId,
      status,
      priceStates,
      ...(diagnostic ? { diagnostic } : {}),
    });
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
