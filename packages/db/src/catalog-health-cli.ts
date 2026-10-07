import { appendFileSync, readFileSync } from "node:fs";
import { inspectCatalogHealth } from "./catalog-health.ts";
import { readCatalogCapacityLog } from "./catalog-health-log.ts";

try {
  const options = process.argv.slice(2).filter((argument) => argument !== "--");
  if (
    options.length > 1 ||
    options.some(
      (argument) => !argument.startsWith("--acquisition-log=") || argument === "--acquisition-log=",
    )
  ) {
    throw new Error("Use an optional --acquisition-log=path");
  }
  const logPath = options[0]?.slice("--acquisition-log=".length);
  const skippedByCapacity = logPath ? readCatalogCapacityLog(readFileSync(logPath, "utf8")) : null;
  const report = await inspectCatalogHealth(undefined, new Date(), skippedByCapacity);
  console.log(JSON.stringify(report, null, 2));

  if (process.env.GITHUB_ACTIONS === "true") {
    for (const issue of report.issues) {
      console.log(
        `::${issue.severity}::Catalog health: ${issue.retailer ?? "catalog"} ${issue.reason}`,
      );
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      const rows = report.retailers
        .map(
          (row) =>
            `| ${row.retailer} | ${row.freshness} | ${row.freshSearchableOffers} | ${row.latestAttemptStatus ?? "unknown"} |`,
        )
        .join("\n");
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `## Catalog health: ${report.status}\n\nObserved: ${report.observedAt}\n\n| Retailer | Refresh health | Fresh searchable offers | Latest attempt |\n| --- | --- | --- | --- |\n${rows}\n\nRetained: ${report.retainedListings}/${report.capacity}. Capacity skips: ${report.skippedByCapacity ?? "not measured in this run"}.\n\n${report.issues.map((issue) => `- ${issue.severity}: ${issue.retailer ?? "catalog"} ${issue.reason}`).join("\n")}\n`,
      );
    }
  }
  if (report.status === "attention") {
    process.exitCode = 1;
  }
} catch {
  console.error(
    "Catalog health check unavailable. Check database, migrations and acquisition log; no credentials or source payloads logged.",
  );
  process.exitCode = 1;
}
