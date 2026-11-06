import { listingSchema, safeDiagnostic, SourceResponseError } from "@comprafino/core";
import type { SafeDiagnostic } from "@comprafino/core";
import type { CatalogSourceClaim, NormalizedRetailerListing } from "@comprafino/core";
import { CatalogAccessRestriction } from "./catalog-sources.ts";
import type { ReportProgress } from "../../../scripts/cli-progress.ts";

export interface CatalogAcquisitionTasks {
  claim(): Promise<CatalogSourceClaim | null>;
  start?(): Promise<void>;
  fetchPage(claim: CatalogSourceClaim): Promise<{
    listings: NormalizedRetailerListing[];
    discovered: number;
    nextCursor: number | null;
    coverageLimited?: boolean;
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
    coverageLimited?: boolean,
  ): Promise<void>;
  fail(claim: CatalogSourceClaim, reason?: "redirect_to_home" | "pagination_limit"): Promise<void>;
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
    skippedByCapacity = 0,
    paginationLimitedPages = 0,
    consecutiveHomepageRedirects = 0;
  let restricted = false;
  let stoppedAfterRedirects = false;
  const failures: { sourceKey: string; cursor: number; diagnostic: SafeDiagnostic }[] = [];
  for (let page = 0; page < pages; page++) {
    const claim = await tasks.claim();
    if (!claim) {
      progress?.("Adquisición sin más categorías elegibles", page, pages);
      break;
    }
    if (page === 0) {
      await tasks.start?.();
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
      consecutiveHomepageRedirects = 0;
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
        result.coverageLimited,
      );
      completedPages++;
      if (result.coverageLimited) {
        paginationLimitedPages++;
        failures.push({
          sourceKey: claim.key,
          cursor: claim.cursor,
          diagnostic: safeDiagnostic(new SourceResponseError("pagination_limit"), {
            stage: "source",
            operation: "ingestion",
            retailer: claim.retailer,
            reason: "source_request_failed",
          }),
        });
      }
      progress?.(
        `${claim.retailer}: páginas de esta corrida`,
        page + 1,
        pages,
        `${persisted} observaciones guardadas; ${failedPages} fallos`,
      );
    } catch (error) {
      const failure = {
        sourceKey: claim.key,
        cursor: claim.cursor,
        diagnostic: safeDiagnostic(error, {
          stage,
          operation: "ingestion",
          retailer: claim.retailer,
          reason: stage === "source" ? "source_request_failed" : "db_write_failed",
        }),
      };
      failures.push(failure);
      if (failure.diagnostic.sourceResponseCode === "redirect_to_home") {
        await tasks.fail(claim, "redirect_to_home");
        consecutiveHomepageRedirects++;
      } else if (failure.diagnostic.sourceResponseCode === "pagination_limit") {
        consecutiveHomepageRedirects = 0;
        await tasks.fail(claim, "pagination_limit");
      } else {
        consecutiveHomepageRedirects = 0;
        await tasks.fail(claim);
      }
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
      if (claim.retailer === "tottus" && consecutiveHomepageRedirects >= 3) {
        stoppedAfterRedirects = true;
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
    stoppedAfterRedirects,
    paginationLimitedPages,
    failures,
  };
}
