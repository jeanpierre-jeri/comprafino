import { observationCoverageReport } from "./observation-coverage.ts";
try {
  if (process.argv.slice(2).some((arg) => arg !== "--")) throw new Error("No options supported");
  console.log(JSON.stringify(await observationCoverageReport(), null, 2));
} catch {
  console.error(
    "Observation coverage audit failed. Check database configuration and migrations; no credentials logged.",
  );
  process.exitCode = 1;
}
