import { readFileSync, existsSync } from "node:fs";
import {
  listingRefreshPolicy,
  discoveryDailyLimit,
  discoveryDefaultQueryLimit,
  retailerIdSchema,
} from "@comprafino/core";
import { catalogBudget } from "@comprafino/db";
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

  const metrics = await catalogBudget();
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
  const comparableDurationMs = evidence?.comparable ? evidence.measurement.durationMs : null;
  const retailerCount = retailerIdSchema.options.length;
  console.log(
    JSON.stringify(
      {
        ...metrics,
        refresh: {
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
          categoryTypicalEstimate: budget.typicalRequests,
          categoryHardCap: budget.maximumRequests,
          targetedSelectedNow: metrics.coverage.selectedTargeted,
          targetedPerRunCap: listingRefreshPolicy.limit,
          discoveryPerRunCap: discoveryDailyLimit * retailerCount,
          discoveryDefaultRunRequests: discoveryDefaultQueryLimit * retailerCount,
          discoveryPerDayCap: discoveryDailyLimit * retailerCount,
          totalScheduledDailyCap:
            refreshCadence.runsPerDay * (budget.maximumRequests + listingRefreshPolicy.limit) +
            discoveryDailyLimit * retailerCount,
          note: "Category estimates derive from configured scopes and bounded pages. Discovery hard per-run/day bounds use the shared daily query cap; default-run requests use the CLI query default. Audit/manual calls excluded.",
        },
        actions: {
          refreshCommandMinutesPerDay:
            comparableDurationMs !== null
              ? (refreshCadence.runsPerDay * comparableDurationMs) / 60000
              : null,
          refreshCommandMinutesPer30Days:
            comparableDurationMs !== null
              ? (30 * refreshCadence.runsPerDay * comparableDurationMs) / 60000
              : null,
          discoveryCommandMinutes: null,
          note: "Workflow runtime also includes checkout/setup/install/queue overhead. No GitHub APIs queried; billing and plan quotas are not inferred.",
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
