import { auditCatalogCoverage, coverageQueryTimings } from "./catalog-coverage.ts";

try {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");

  if (args.some((arg) => arg !== "--timings")) {
    throw new Error("Unsupported option");
  }

  const audit = await auditCatalogCoverage();
  console.log(
    JSON.stringify(
      { ...audit, timings: args.includes("--timings") ? await coverageQueryTimings() : null },
      null,
      2,
    ),
  );
} catch {
  console.error(
    "Read-only catalog/availability audit failed; check database access, schema and configured catalog guard. No credentials logged.",
  );
  process.exitCode = 1;
}
