import { createCliProgress } from "../../../scripts/cli-progress.ts";
import {
  catalogPolicy,
  listingRefreshPolicy,
  parseAcquisitionOptions,
  retailerIdSchema,
  catalogFailureSeverity,
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
import { logDiagnostic, reportCatalogAlert } from "./diagnostics.ts";
import { refreshKnownListings } from "./listing-refresh.ts";
import { listingRefreshTasks } from "./listing-refresh-tasks.ts";

const progress = createCliProgress();

try {
  progress("Preparando comando");
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
    for (const [index, retailer] of retailers.entries()) {
      let run: string | undefined;
      let stage: "admission" | "source" | "persistence" = "admission";
      try {
        run = await store.start(retailer);
        stage = "source";
        progress(
          `Tienda ${index + 1}/${retailers.length}: ${retailer}; leyendo categorías públicas`,
        );
        const sources = await discoverCatalogSources(retailer);
        stage = "persistence";
        await registerCatalogSources(db, retailer, sources);
        progress(`${retailer}: ${sources.length} categorías registradas; iniciando páginas`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const result = await acquireCatalogPages(
          {
            claim: () => claimCatalogSource(db, retailer),
            fetchPage: fetchCatalogPage,
            persist: (claim, listings) =>
              persistListingsDetailed(db, claim.retailer, listings, { source: "category" }),
            complete: (claim, cursor, discovered, ids, skips) =>
              completeCatalogPage(db, claim, cursor, discovered, ids, skips),
            fail: (claim, reason) => failCatalogPage(db, claim, reason),
            pause: () => new Promise((resolve) => setTimeout(resolve, 1000)),
          },
          options.pages,
          progress,
        );
        const persistenceFailure = result.failures.some(
          (failure) => failure.diagnostic.stage !== "source",
        );
        let errorCode: string | undefined;
        if (result.restricted) {
          errorCode = "catalog_access_restricted";
        } else if (result.skippedByCapacity > 0) {
          errorCode = "catalog_capacity_skips";
        } else if (persistenceFailure) {
          errorCode = "catalog_persistence_failed";
        } else if (result.failedPages) {
          errorCode = result.persisted > 0 ? "catalog_partial_source" : "catalog_source_failed";
        }
        await store.finish(run, {
          status: result.failedPages || result.skippedByCapacity ? "failed" : "success",
          fetched: result.fetched,
          persisted: result.persisted,
          changed: result.changed,
          ...(errorCode ? { error: errorCode } : {}),
        });
        run = undefined;
        skippedByCapacity += result.skippedByCapacity;
        if (result.restricted) {
          restrictedRetailers.add(retailer);
        }
        console.log(JSON.stringify({ retailer, registeredCategories: sources.length, ...result }));
        for (const failure of result.failures) {
          const severity = catalogFailureSeverity(failure.diagnostic, result.persisted > 0);
          reportCatalogAlert(
            severity,
            `${retailer} category ${failure.sourceKey}: ${failure.diagnostic.sourceResponseCode ?? failure.diagnostic.reason}; progress retained`,
          );
          if (severity === "error") {
            process.exitCode = 1;
          }
        }
        if (result.restricted || result.skippedByCapacity) {
          process.exitCode = 1;
        }
      } catch (error) {
        if (error instanceof CatalogAccessRestriction) {
          restrictedRetailers.add(retailer);
        }
        if (run) {
          let errorCode = "catalog_source_failed";
          if (error instanceof CatalogAccessRestriction) {
            errorCode = "catalog_access_restricted";
          } else if (stage !== "source") {
            errorCode = "catalog_persistence_failed";
          }
          await store.finish(run, {
            status: "failed",
            fetched: 0,
            persisted: 0,
            changed: 0,
            error: errorCode,
          });
        }
        logDiagnostic(error, {
          stage,
          operation: "ingestion",
          retailer,
          reason: stage === "source" ? "source_request_failed" : "db_write_failed",
        });
        process.exitCode = 1;
      }
    }
    // Accepted pages remain useful even when another category/retailer failed.
    progress("Seleccionando productos para actualizar");
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
      progress,
    );
    console.log(JSON.stringify({ targeted }));
    for (const row of targeted.results) {
      if (row.diagnostic) {
        const severity = catalogFailureSeverity(row.diagnostic, targeted.observed > 0);
        reportCatalogAlert(
          severity,
          `${row.retailer} targeted refresh: ${row.diagnostic.sourceResponseCode ?? row.diagnostic.reason}`,
        );
        if (severity === "error") {
          process.exitCode = 1;
        }
      }
    }
    console.log(
      JSON.stringify({
        normalization: await normalizeChangedCatalog(db, 10_000, progress),
        matching: await matchChangedCatalog(db, 250, progress),
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
