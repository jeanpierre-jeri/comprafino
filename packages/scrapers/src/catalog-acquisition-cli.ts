import {
  catalogPolicy,
  listingRefreshPolicy,
  parseAcquisitionOptions,
  retailerIdSchema,
} from "@comprafino/core";
import {
  createDatabase,
  createIngestionStore,
  persistListingsDetailed,
  registerCatalogSources,
  claimCatalogSource,
  completeCatalogPage,
  failCatalogPage,
  inspectCatalogAcquisition,
  inspectCatalogWork,
  normalizeChangedCatalog,
  matchChangedCatalog,
  assertRefreshScope,
  previewListingRefresh,
} from "@comprafino/db";
import {
  CatalogAccessRestriction,
  discoverCatalogSources,
  fetchCatalogPage,
} from "./catalog-sources.ts";
import type { RetailerId } from "@comprafino/core";
import { acquireCatalogPages } from "./catalog-acquisition.ts";
import { logDiagnostic } from "./diagnostics.ts";
import { refreshKnownListings } from "./listing-refresh.ts";
import { listingRefreshTasks } from "./listing-refresh-tasks.ts";

try {
  const options = parseAcquisitionOptions(process.argv.slice(2));
  const db = createDatabase();
  await assertRefreshScope(db);
  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          pagesPerRetailer: options.pages,
          capacity: catalogPolicy.retainedListingCap,
          sourceCalls: 0,
          writes: 0,
          categories: await inspectCatalogAcquisition(db),
        },
        null,
        2,
      ),
    );
  } else {
    const store = createIngestionStore(db);
    const retailers = options.retailer ? [options.retailer] : retailerIdSchema.options;
    let skippedByCapacity = 0;
    const restrictedRetailers = new Set<RetailerId>();
    for (const retailer of retailers) {
      try {
        const sources = await discoverCatalogSources(retailer);
        await registerCatalogSources(db, retailer, sources);
        const run = await store.start(retailer);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const result = await acquireCatalogPages(
          {
            claim: () => claimCatalogSource(db, retailer),
            fetchPage: fetchCatalogPage,
            persist: (claim, listings) =>
              persistListingsDetailed(db, claim.retailer, listings, { source: "category" }),
            complete: (claim, cursor, discovered, ids, skips) =>
              completeCatalogPage(db, claim, cursor, discovered, ids, skips),
            fail: (claim) => failCatalogPage(db, claim),
            pause: () => new Promise((resolve) => setTimeout(resolve, 1000)),
          },
          options.pages,
        );
        await store.finish(run, {
          status: result.failedPages || result.skippedByCapacity ? "failed" : "success",
          fetched: result.fetched,
          persisted: result.persisted,
          changed: result.changed,
          ...(result.failedPages ? { error: "Catalog page failure; progress retained" } : {}),
        });
        skippedByCapacity += result.skippedByCapacity;
        if (result.restricted) {
          restrictedRetailers.add(retailer);
        }
        console.log(JSON.stringify({ retailer, registeredCategories: sources.length, ...result }));
        if (result.failedPages || result.skippedByCapacity) {
          process.exitCode = 1;
        }
      } catch (error) {
        if (error instanceof CatalogAccessRestriction) {
          restrictedRetailers.add(retailer);
        }
        logDiagnostic(error, {
          stage: "source",
          operation: "ingestion",
          retailer,
          reason: "source_request_failed",
        });
        process.exitCode = 1;
      }
    }
    // Accepted pages remain useful even when another category/retailer failed.
    const targeted = await refreshKnownListings(
      (
        await previewListingRefresh(db, {
          limit: listingRefreshPolicy.limit,
          dryRun: false,
          retailer: options.retailer,
          externalId: undefined,
        })
      ).filter((row) => !restrictedRetailers.has(row.retailer)),
      listingRefreshTasks(db),
    );
    console.log(JSON.stringify({ targeted }));
    if (targeted.failures) {
      process.exitCode = 1;
    }
    console.log(
      JSON.stringify({
        normalization: await normalizeChangedCatalog(db, 10_000),
        matching: await matchChangedCatalog(db, 250),
      }),
    );
    console.log(JSON.stringify({ operation: "catalog_capacity", skippedByCapacity }));
    console.log(JSON.stringify({ categories: await inspectCatalogAcquisition(db) }));
    console.log(JSON.stringify({ pending: await inspectCatalogWork(db) }));
  }
} catch (error) {
  logDiagnostic(error, { stage: "persistence", operation: "ingestion", reason: "db_write_failed" });
  process.exitCode = 1;
}
