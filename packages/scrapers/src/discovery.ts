import {
  safeDiagnostic,
  DiagnosticError,
  discoveryRetailerLimit,
  listingSchema,
  retailerIdSchema,
} from "@comprafino/core";
import type { NormalizedRetailerListing, RetailerId, SafeDiagnostic } from "@comprafino/core";
import type { DiscoveryClaim, DiscoveryOutcome } from "@comprafino/db";
import type { SearchRetailerAdapter } from "./adapter.ts";
import { boundedSearchListings } from "./search.ts";

export interface DiscoveryTasks {
  adapters: readonly SearchRetailerAdapter[];
  persist(
    retailer: RetailerId,
    rows: readonly NormalizedRetailerListing[],
    claim: DiscoveryClaim,
  ): Promise<{ created: number; changed: number }>;
  normalize(): Promise<number>;
  match(): Promise<{ writes: number; created: number }>;
  finish(claim: DiscoveryClaim, outcome: DiscoveryOutcome): Promise<void>;
}
export async function processDiscoveryQuery(claim: DiscoveryClaim, tasks: DiscoveryTasks) {
  // Explicitly require all existing retailers; accidental missing coverage must
  // never be reported as complete success.
  if (
    tasks.adapters.length !== 3 ||
    new Set(tasks.adapters.map((a) => a.retailer)).size !== 3 ||
    tasks.adapters.some((a) => !retailerIdSchema.safeParse(a.retailer).success)
  )
    throw new Error("Discovery requires the three existing retailers");
  const retailers: {
    retailer: RetailerId;
    status: "success" | "failed";
    sourceProducts: number;
    listings: number;
    created: number;
    priceStates: number;
    diagnostic?: SafeDiagnostic;
  }[] = [];
  for (const adapter of tasks.adapters) {
    let stage: "source" | "persistence" = "source";
    try {
      const sample = await adapter.searchProducts(claim.query, discoveryRetailerLimit);
      const rows = boundedSearchListings(sample.listings, discoveryRetailerLimit).map((r) =>
        listingSchema.parse(r),
      );
      if (rows.some((row) => row.retailer !== adapter.retailer)) throw new Error("Mixed retailers");
      stage = "persistence";
      const saved = rows.length
        ? await tasks.persist(adapter.retailer, rows, claim)
        : { created: 0, changed: 0 };
      retailers.push({
        retailer: adapter.retailer,
        status: "success",
        sourceProducts: sample.discovered,
        listings: rows.length,
        created: saved.created,
        priceStates: saved.changed,
      });
    } catch (error) {
      retailers.push({
        retailer: adapter.retailer,
        status: "failed",
        sourceProducts: 0,
        listings: 0,
        created: 0,
        priceStates: 0,
        diagnostic: safeDiagnostic(error, {
          stage,
          operation: "discovery",
          retailer: adapter.retailer,
          reason: stage === "source" ? "source_request_failed" : "db_write_failed",
        }),
      });
    }
  }
  const successes = retailers.filter((r) => r.status === "success").length;
  const resultCount = retailers.reduce((n, r) => n + r.listings, 0);
  let normalizationWrites = 0;
  let matchingWrites = 0;
  let canonicalGroupsCreated = 0;
  let derivationFailed = false;
  let diagnostic: SafeDiagnostic | undefined;
  let stage: "normalization" | "matching" = "normalization";
  if (resultCount > 0) {
    try {
      normalizationWrites = await tasks.normalize();
      stage = "matching";
      const match = await tasks.match();
      matchingWrites = match.writes;
      canonicalGroupsCreated = match.created;
    } catch (error) {
      diagnostic = safeDiagnostic(error, {
        stage,
        operation: "discovery",
        reason: "db_write_failed",
      });
      derivationFailed = true;
    }
  }
  const outcome: DiscoveryOutcome = {
    status: derivationFailed
      ? "failed"
      : successes === 0
        ? "failed"
        : successes < 3
          ? "partial"
          : resultCount === 0
            ? "no_results"
            : "completed",
    resultCount,
    error: derivationFailed
      ? "Catalog derivation failed."
      : successes < 3
        ? "Retailer discovery failed."
        : null,
  };
  try {
    await tasks.finish(claim, outcome);
  } catch (error) {
    throw new DiagnosticError(error, {
      stage: "completion",
      operation: "discovery",
      reason: "db_write_failed",
    });
  }
  return {
    query: claim.query,
    ...(diagnostic ? { diagnostic } : {}),
    ...outcome,
    retailers,
    retailerSearchCalls: retailers.length,
    listingsDiscovered: resultCount,
    newListings: retailers.reduce((n, r) => n + r.created, 0),
    normalizationWrites,
    matchingWrites,
    canonicalGroupsCreated,
  };
}
