import { readFileSync, existsSync } from "node:fs";
import {
  catalogPolicy,
  discoveryRunLimit,
  listingRefreshPolicy,
  discoveryDailyLimit,
  discoveryDefaultQueryLimit,
  retailerIdSchema,
} from "@comprafino/core";
import {
  catalogBudget,
  createDatabase,
  inspectCatalogAcquisition,
  inspectCatalogWork,
} from "@comprafino/db";
import { refreshCoverage } from "./refresh-adapters.ts";
import {
  categoryRequestBudget,
  workflowCadence,
  catalogProjection,
  refreshMeasurementEvidence,
} from "./catalog-budget.ts";

try {
  if (process.argv.slice(2).some((arg) => arg !== "--")) {
    throw new Error("No options supported");
  }

  const db = createDatabase();
  const metrics = await catalogBudget(db);
  const sources = await inspectCatalogAcquisition(db);
  const pending = await inspectCatalogWork(db);
  const refreshWorkflow = readFileSync(
    new URL("../../../.github/workflows/refresh-catalog.yml", import.meta.url),
    "utf8",
  );
  const discoveryWorkflow = readFileSync(
    new URL("../../../.github/workflows/discover-catalog.yml", import.meta.url),
    "utf8",
  );
  const refreshCadence = workflowCadence(refreshWorkflow);
  const discoveryCadence = workflowCadence(discoveryWorkflow);
  const budget = categoryRequestBudget();
  const evidencePath = new URL("../../../docs/catalog-refresh-measurement.json", import.meta.url);
  const n = metrics.coverage.knownListings;
  const evidence = existsSync(evidencePath)
    ? refreshMeasurementEvidence(JSON.parse(readFileSync(evidencePath, "utf8")) as unknown, n)
    : null;
  const retailerCount = retailerIdSchema.options.length;
  console.log(
    JSON.stringify(
      {
        ...metrics,
        acquisition: {
          pagesPerRetailer: catalogPolicy.acquisitionPagesPerRetailer,
          totalPageBudget: catalogPolicy.acquisitionPagesPerRetailer * retailerCount,
          categoryRegistryRequests: retailerCount,
          categories: sources,
          pending,
        },
        refresh: {
          mode: "legacy-manual-sample-budget",
          categorySources: budget.categorySources,
          usableCategoryObservationCap: budget.observationCap,
          targetedRequestCap: listingRefreshPolicy.limit,
          recentMeasurement: evidence,
        },
        schedule: {
          refreshCron: refreshCadence.cron,
          discoveryCron: discoveryCadence.cron,
          refreshRunsPerDay: refreshCadence.runsPerDay,
          discoveryRunsPerDay: discoveryCadence.runsPerDay,
        },
        requests: {
          legacySampleTypicalEstimate: budget.typicalRequests,
          legacySampleHardCap: budget.maximumRequests,
          targetedSelectedNow: metrics.coverage.selectedTargeted,
          targetedPerRunCap: listingRefreshPolicy.limit,
          discoveryPerRunCap: discoveryRunLimit * retailerCount,
          discoveryDefaultRunRequests: discoveryDefaultQueryLimit * retailerCount,
          discoveryPerDayCap: discoveryDailyLimit * retailerCount,
          totalScheduledDailyCap:
            refreshCadence.runsPerDay *
              (retailerCount * (catalogPolicy.acquisitionPagesPerRetailer + 1) +
                listingRefreshPolicy.limit) +
            discoveryDailyLimit * retailerCount,
          note: "Scheduled category requests use the resumable page budget plus registry calls; fixed sample estimates are legacy manual scope. Discovery run/day bounds are independent. Audit/manual calls excluded.",
        },
        actions: {
          refreshCommandMinutesPerDay: null,
          refreshCommandMinutesPer30Days: null,
          discoveryCommandMinutes: null,
          note: "No comparable resumable-acquisition timing is recorded. Workflow runtime also includes checkout/setup/install/queue overhead. No GitHub APIs queried; billing and plan quotas are not inferred.",
        },
        growth: {
          monthlyHistoryChanges: null,
          note: "Catalog recently bootstrapped; last-seven-day counts include acquisition. A stable multi-day change rate is needed before monthly extrapolation.",
          categoryIngestionRunsPer30Days:
            30 * refreshCadence.runsPerDay * Object.keys(refreshCoverage).length,
          additionalRunsDependOnManualIngestion: true,
          discoveryDailyBudgetRowsPer30Days: 30,
          discoveryQueries:
            "Deduplicated; growth depends on new unique demand. Discovery and targeted persistence do not create ingestion_runs.",
        },
        scenarios: [n * 2, 1500].map((listings) => ({
          ...catalogProjection(n, metrics.matching.candidates, listings),
          requestsWithUnchangedBounds: "unchanged; coverage latency rises",
          note: "Quadratic candidate estimate assumes unchanged brand/retailer composition. Whole DB size is not linear because fixed overhead/history differ.",
        })),
      },
      null,
      2,
    ),
  );
} catch {
  console.error(
    "Read-only catalog budget failed. Check database configuration, migrations and normalization; no credentials logged.",
  );
  process.exitCode = 1;
}
