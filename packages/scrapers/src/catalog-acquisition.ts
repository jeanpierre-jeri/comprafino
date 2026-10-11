import { listingSchema, safeDiagnostic } from "@comprafino/core";
import type { SafeDiagnostic } from "@comprafino/core";
import type { CatalogSourceClaim, NormalizedRetailerListing } from "@comprafino/core";
import { CatalogAccessRestriction } from "./catalog-sources.ts";
import type { ReportProgress } from "../../../scripts/cli-progress.ts";

export interface CatalogAcquisitionTasks {
  claim(): Promise<CatalogSourceClaim | null>;
  fetchPage(claim: CatalogSourceClaim): Promise<{
    listings: NormalizedRetailerListing[];
    discovered: number;
    nextCursor: number | null;
  }>;
  persist(
    claim: CatalogSourceClaim,
    listings: readonly NormalizedRetailerListing[],
  ): Promise<{ persisted: number; changed: number; skippedByCapacity: number }>;
  complete(
    claim: CatalogSourceClaim,
    nextCursor: number | null,
    discovered: number,
    externalIds: readonly string[],
    capacitySkips: number,
  ): Promise<void>;
  fail(claim: CatalogSourceClaim): Promise<void>;
  pause(): Promise<void>;
}

/** One sequential retailer stream; per-page persistence precedes durable progress. */
export async function acquireCatalogPages(
  tasks: CatalogAcquisitionTasks,
  pages: number,
  progress?: ReportProgress,
) {
  let fetched = 0,
    persisted = 0,
    changed = 0,
    completedPages = 0,
    failedPages = 0,
    skippedByCapacity = 0;
  let restricted = false;
  const failures: { sourceKey: string; diagnostic: SafeDiagnostic }[] = [];
  for (let page = 0; page < pages; page++) {
    const claim = await tasks.claim();
    if (!claim) {
      progress?.("Adquisición sin más categorías elegibles", page, pages);
      break;
    }
    if (page > 0) {
      await tasks.pause();
    }
    let stage: "source" | "persistence" | "completion" = "source";
    progress?.(
      `${claim.retailer}: páginas de esta corrida`,
      page,
      pages,
      `${claim.name} (${claim.key}); cursor ${claim.cursor}`,
    );
    try {
      const result = await tasks.fetchPage(claim);
      const listings = result.listings.map((listing) => listingSchema.parse(listing));
      if (listings.some((listing) => listing.retailer !== claim.retailer)) {
        throw new Error("Mixed retailers in catalog page");
      }
      fetched += result.discovered;
      stage = "persistence";
      const saved = listings.length
        ? await tasks.persist(claim, listings)
        : { persisted: 0, changed: 0, skippedByCapacity: 0 };
      persisted += saved.persisted;
      changed += saved.changed;
      skippedByCapacity += saved.skippedByCapacity;
      // Record admission skips, but continue refreshing known rows on later pages.
      // Every completed cycle restarts at page one and retries omitted identities.
      stage = "completion";
      await tasks.complete(
        claim,
        result.nextCursor,
        result.discovered,
        listings.map((listing) => listing.externalId),
        saved.skippedByCapacity,
      );
      completedPages++;
      progress?.(
        `${claim.retailer}: páginas de esta corrida`,
        page + 1,
        pages,
        `${persisted} observaciones guardadas; ${failedPages} fallos`,
      );
    } catch (error) {
      failures.push({
        sourceKey: claim.key,
        diagnostic: safeDiagnostic(error, {
          stage,
          operation: "ingestion",
          retailer: claim.retailer,
          reason: stage === "source" ? "source_request_failed" : "db_write_failed",
        }),
      });
      await tasks.fail(claim);
      failedPages++;
      progress?.(
        `${claim.retailer}: página fallida (${claim.key})`,
        page + 1,
        pages,
        `avance conservado; ${failedPages} fallos`,
      );
      if (error instanceof CatalogAccessRestriction) {
        restricted = true;
        break;
      }
    }
  }
  return {
    fetched,
    persisted,
    changed,
    completedPages,
    failedPages,
    skippedByCapacity,
    restricted,
    failures,
  };
}
