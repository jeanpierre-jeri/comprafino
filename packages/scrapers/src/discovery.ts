import {
  safeDiagnostic,
  DiagnosticError,
  discoveryRetailerLimit,
  matchesDiscoveryQuery,
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
  ): Promise<{ created: number; changed: number; skippedByCapacity: number }>;
  normalize(): Promise<number>;
  match(): Promise<{ writes: number; created: number }>;
  finish(claim: DiscoveryClaim, outcome: DiscoveryOutcome): Promise<void>;
}

export async function processDiscoveryQuery(claim: DiscoveryClaim, tasks: DiscoveryTasks) {
  // Explicitly require all existing retailers; accidental missing coverage must
  // never be reported as complete success.
  if (
    tasks.adapters.length !== retailerIdSchema.options.length ||
    new Set(tasks.adapters.map((a) => a.retailer)).size !== retailerIdSchema.options.length ||
    tasks.adapters.some((a) => !retailerIdSchema.safeParse(a.retailer).success)
  ) {
    throw new Error("Discovery requires all registered retailers");
  }

  const retailers: {
    retailer: RetailerId;
    status: "success" | "failed";
    sourceProducts: number;
    listings: number;
    created: number;
    priceStates: number;
    skippedByCapacity: number;
    diagnostic?: SafeDiagnostic;
  }[] = [];

  for (const adapter of tasks.adapters) {
    let stage: "source" | "persistence" = "source";

    try {
      const sample = await adapter.searchProducts(claim.query, discoveryRetailerLimit);
      const validated = sample.listings.map((row) => listingSchema.parse(row));
      const rows = boundedSearchListings(
        validated.filter((row) => matchesDiscoveryQuery(claim.query, row)),
        discoveryRetailerLimit,
      );

      if (validated.some((row) => row.retailer !== adapter.retailer)) {
        throw new Error("Mixed retailers");
      }

      stage = "persistence";
      const saved = rows.length
        ? await tasks.persist(adapter.retailer, rows, claim)
        : { created: 0, changed: 0, skippedByCapacity: 0 };
      retailers.push({
        retailer: adapter.retailer,
        status: "success",
        sourceProducts: sample.discovered,
        listings: rows.length - saved.skippedByCapacity,
        created: saved.created,
        priceStates: saved.changed,
        skippedByCapacity: saved.skippedByCapacity,
      });
    } catch (error) {
      retailers.push({
        retailer: adapter.retailer,
        status: "failed",
        sourceProducts: 0,
        listings: 0,
        created: 0,
        priceStates: 0,
        skippedByCapacity: 0,
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
  const skippedByCapacity = retailers.reduce((n, r) => n + r.skippedByCapacity, 0);
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
    status: discoveryStatus(derivationFailed, successes, resultCount, skippedByCapacity),
    resultCount,
    error: discoveryFailureMessage(derivationFailed, successes),
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
    skippedByCapacity,
    newListings: retailers.reduce((n, r) => n + r.created, 0),
    normalizationWrites,
    matchingWrites,
    canonicalGroupsCreated,
  };
}

function discoveryStatus(
  derivationFailed: boolean,
  successes: number,
  resultCount: number,
  skippedByCapacity: number,
): DiscoveryOutcome["status"] {
  if (derivationFailed || successes === 0) return "failed";

  if (successes < retailerIdSchema.options.length) return "partial";

  if (resultCount === 0 && skippedByCapacity === 0) return "no_results";

  return "completed";
}

function discoveryFailureMessage(
  derivationFailed: boolean,
  successes: number,
): DiscoveryOutcome["error"] {
  if (derivationFailed) return "Catalog derivation failed.";

  if (successes < retailerIdSchema.options.length) return "Retailer discovery failed.";

  return null;
}
