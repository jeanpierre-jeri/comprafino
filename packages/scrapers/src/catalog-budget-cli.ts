import { readFileSync, existsSync } from "node:fs";
import { z } from "zod";
import { catalogBudget } from "@comprafino/db";
import { categoryRequestBudget, workflowCadence, catalogProjection } from "./catalog-budget.ts";

try {
  if (process.argv.slice(2).some((arg) => arg !== "--")) throw new Error("No options supported");
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
  const evidence = existsSync(evidencePath)
    ? z
        .object({
          durationMs: z.number().nonnegative(),
          targeted: z.object({
            status: z.string(),
            result: z.object({ requests: z.number().int().nonnegative() }).optional(),
          }),
        })
        .passthrough()
        .parse(JSON.parse(readFileSync(evidencePath, "utf8")))
    : null;
  const n = metrics.coverage.knownListings;
  console.log(
    JSON.stringify(
      {
        ...metrics,
        refresh: {
          categorySources: budget.categorySources,
          usableCategoryObservationCap: budget.observationCap,
          targetedRequestCap: 100,
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
          targetedPerRunCap: 100,
          discoveryPerRunCap: 30,
          discoveryPerDayCap: 90,
          totalScheduledDailyCap: refreshCadence.runsPerDay * (budget.maximumRequests + 100) + 90,
          note: "Category estimate: Tottus 2+3 pages; VTEX dairy 5 pages and six one-page staples each. Actual source availability affects pages. Discovery caps are 10 queries/run, 30/day, three retailers. Audit/manual calls excluded.",
        },
        actions: {
          refreshCommandMinutesPerDay: evidence
            ? (refreshCadence.runsPerDay * evidence.durationMs) / 60000
            : null,
          refreshCommandMinutesPer30Days: evidence
            ? (30 * refreshCadence.runsPerDay * evidence.durationMs) / 60000
            : null,
          discoveryCommandMinutes: null,
          note: "Workflow runtime also includes checkout/setup/install/queue overhead. No GitHub APIs queried; billing and plan quotas are not inferred.",
        },
        growth: {
          monthlyHistoryChanges: null,
          note: "Catalog recently bootstrapped; last-seven-day counts include acquisition. A stable multi-day change rate is needed before monthly extrapolation.",
          categoryIngestionRunsPer30Days: 30 * refreshCadence.runsPerDay * 3,
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
