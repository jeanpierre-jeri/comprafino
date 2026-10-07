import { evaluateCatalogHealth } from "@comprafino/core";
import { auditCatalogCoverage } from "./catalog-coverage.ts";
import { createDatabase } from "./client.ts";
import { inspectOperations } from "./operations.ts";

/** Reuses the complete bounded audit; exports only operational counts, never queries or account data. */
export async function inspectCatalogHealth(
  db = createDatabase(),
  now = new Date(),
  skippedByCapacity: number | null = null,
) {
  const [coverage, operations] = await Promise.all([
    auditCatalogCoverage(db, now),
    inspectOperations(db, now),
  ]);

  return evaluateCatalogHealth(
    {
      retainedListings: coverage.totals.known,
      skippedByCapacity,
      retailers: operations.map((operation) => {
        const retailerCoverage = coverage.retailers[operation.retailer];

        if (!retailerCoverage) {
          throw new Error("Missing retailer coverage in catalog health snapshot");
        }

        return {
          retailer: operation.retailer,
          latestAttempt: operation.latestAttempt,
          latestSuccess: operation.latestSuccess,
          known: retailerCoverage.known,
          freshSearchableOffers: retailerCoverage.publicGeneric,
        };
      }),
    },
    now,
  );
}
