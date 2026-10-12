import { createCliProgress } from "../../../scripts/cli-progress.ts";
import { logDiagnostic, reportCatalogAlert } from "./diagnostics.ts";
import { DiagnosticError, catalogFailureSeverity } from "@comprafino/core";
import {
  createDatabase,
  claimDiscoveryQueries,
  cleanupDiscoveryDemand,
  previewDiscoveryQueries,
  finishDiscoveryQuery,
  inspectDiscovery,
  persistListingsDetailed,
  normalizeChangedCatalog,
  matchChangedCatalog,
  assertRefreshScope,
  parseDiscoveryOptions,
} from "@comprafino/db";
import { processDiscoveryQuery } from "./discovery.ts";
import { createTottusAdapter } from "./tottus.ts";
import { createPlazaVeaAdapter } from "./plaza-vea.ts";
import { createMetroAdapter } from "./metro.ts";
import { createMakroAdapter } from "./makro.ts";
import type { RetailerId } from "@comprafino/core";

const progress = createCliProgress();

try {
  let options: ReturnType<typeof parseDiscoveryOptions>;

  try {
    options = parseDiscoveryOptions(process.argv.slice(2));
  } catch (error) {
    throw new DiagnosticError(error, {
      stage: "admission",
      operation: "discovery",
      reason: "invalid_discovery_options",
    });
  }

  const { limit, dryRun, manual } = options;
  const db = createDatabase();
  const { stats } = await inspectDiscovery(db);

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun,
          manual,
          dailyBudgetApplied: !manual,
          ...stats,
          eligible: await previewDiscoveryQueries(db, limit, manual),
          retailerSearchCalls: 0,
          writes: 0,
        },
        null,
        2,
      ),
    );
  } else {
    // Guard before reserving any work, then again before downstream writes.
    await assertRefreshScope(db);
    const retention = await cleanupDiscoveryDemand(db);
    console.log(JSON.stringify({ operation: "discovery_retention", ...retention }));
    const claims = await claimDiscoveryQueries(db, limit, manual);
    const results: Awaited<ReturnType<typeof processDiscoveryQuery>>[] = [];
    const restrictedRetailers = new Set<RetailerId>();
    const tasks = {
      isRestricted: (retailer: RetailerId) => restrictedRetailers.has(retailer),
      adapters: [
        createTottusAdapter(),
        createPlazaVeaAdapter(),
        createMetroAdapter(),
        createMakroAdapter(),
      ],
      persist: (
        retailer: Parameters<typeof persistListingsDetailed>[1],
        rows: Parameters<typeof persistListingsDetailed>[2],
        claim: Parameters<typeof processDiscoveryQuery>[0],
      ) => persistListingsDetailed(db, retailer, rows, { source: "discovery", queryId: claim.id }),
      async normalize() {
        await assertRefreshScope(db);
        const r = await normalizeChangedCatalog(db, 10_000, progress);

        return r.changed;
      },
      async match() {
        await assertRefreshScope(db);
        const r = await matchChangedCatalog(db, 250, progress);
        return { writes: r.associationsChanged + r.productsChanged, created: r.productsCreated };
      },
      finish: (
        claim: Parameters<typeof finishDiscoveryQuery>[1],
        outcome: Parameters<typeof finishDiscoveryQuery>[2],
      ) => finishDiscoveryQuery(db, claim, outcome),
    };

    for (const [index, claim] of claims.entries()) {
      progress("Búsquedas seleccionadas", index, claims.length);
      const result = await processDiscoveryQuery(claim, tasks);
      for (const retailer of result.retailers) {
        if (retailer.restricted) {
          restrictedRetailers.add(retailer.retailer);
        }
      }
      results.push(result);
      progress("Búsquedas seleccionadas", index + 1, claims.length);
      console.log(JSON.stringify(result));
    }

    const metric = (
      key:
        | "retailerSearchCalls"
        | "listingsDiscovered"
        | "newListings"
        | "skippedByCapacity"
        | "normalizationWrites"
        | "matchingWrites"
        | "canonicalGroupsCreated",
    ) => results.reduce((n, r) => n + r[key], 0);
    console.log(
      JSON.stringify(
        {
          dryRun,
          manual,
          dailyBudgetApplied: !manual,
          queriesProcessed: claims.length,
          queriesSkippedByCooldown: stats.cooldown,
          processedToday: (await inspectDiscovery(db)).stats.processedToday,
          retailerSearchCalls: metric("retailerSearchCalls"),
          listingsDiscovered: metric("listingsDiscovered"),
          newListings: metric("newListings"),
          skippedByCapacity: metric("skippedByCapacity"),
          normalizationWrites: metric("normalizationWrites"),
          matchingWrites: metric("matchingWrites"),
          canonicalGroupsCreated: metric("canonicalGroupsCreated"),
        },
        null,
        2,
      ),
    );

    console.log(
      JSON.stringify({
        operation: "catalog_capacity",
        skippedByCapacity: metric("skippedByCapacity"),
      }),
    );

    if (!claims.length) {
      console.log(
        JSON.stringify({
          operation: "discovery_idle",
          status: "no_work",
          reason: "no_eligible_queries",
        }),
      );
    }
    const useful = results.some((result) => result.listingsDiscovered > 0);
    for (const result of results) {
      if (result.status === "failed" || result.diagnostic || result.skippedByCapacity > 0) {
        process.exitCode = 1;
      }
      for (const retailer of result.retailers) {
        if (retailer.diagnostic) {
          const severity = catalogFailureSeverity(
            retailer.diagnostic,
            useful && result.status !== "failed",
          );
          reportCatalogAlert(
            severity,
            `${retailer.retailer} discovery: ${retailer.diagnostic.sourceResponseCode ?? retailer.diagnostic.reason}`,
          );
          if (severity === "error" || retailer.restricted) {
            process.exitCode = 1;
          }
        }
      }
    }
  }
} catch (error) {
  logDiagnostic(error, { stage: "admission", operation: "discovery", reason: "db_read_failed" });
  process.exitCode = 1;
}
